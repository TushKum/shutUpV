// Helpers for database tests: impersonate a Supabase caller and seed small events.

import { randomUUID } from "node:crypto";
import type pg from "pg";
import { buildSeedPlan, toSeedPayload, type SeedOptions, type SeedPlan, type StaffRow } from "../../scripts/lib/seed-plan";

export type Caller = { kind: "user"; id: string } | { kind: "anon" } | { kind: "service" };

export const anon: Caller = { kind: "anon" };
export const service: Caller = { kind: "service" };
export const user = (id: string): Caller => ({ kind: "user", id });

/**
 * Runs `fn` inside a transaction as the given PostgREST role, exactly as Supabase would:
 * SET LOCAL ROLE + request.jwt.claims. Rolls back unless `commit` is set.
 */
export async function as<T>(
  pool: pg.Pool,
  caller: Caller,
  fn: (c: pg.PoolClient) => Promise<T>,
  { commit = false } = {},
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const role = caller.kind === "user" ? "authenticated" : caller.kind === "anon" ? "anon" : "service_role";
    const claims = caller.kind === "user" ? { sub: caller.id, role } : { role };
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await c.query(`set local role ${role}`);
    const out = await fn(c);
    await c.query(commit ? "commit" : "rollback");
    return out;
  } catch (err) {
    await c.query("rollback").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

/** Shorthand: rows of one query as a caller. */
export async function rowsAs<R extends pg.QueryResultRow = Record<string, unknown>>(
  pool: pg.Pool,
  caller: Caller,
  sql: string,
  params: unknown[] = [],
): Promise<R[]> {
  return as(pool, caller, async (c) => (await c.query<R>(sql, params)).rows);
}

export interface SeededEvent {
  eventId: string;
  plan: SeedPlan;
  /** team code → { teamId, userId } */
  teams: Map<string, { teamId: string; userId: string }>;
  /** staff email → user id */
  staff: Map<string, string>;
}

export const TEST_STAFF: StaffRow[] = [
  { email: "lead@example.org", role: "ORGANISER", name: "Event lead", roll_number: "S1" },
  { email: "exchange@example.org", role: "ORGANISER", name: "Exchange desk", roll_number: "S2" },
  { email: "fairness@example.org", role: "FAIRNESS", name: "Fairness officer" },
  { email: "display@example.org", role: "DISPLAY", name: "Projector" },
];

// Team codes are logins, so they are unique across events; each test event gets its own prefix letter.
let prefixCounter = 0;
const PREFIXES = "ABDEGHJKLMNQRSTUVWYZ";

/** Creates auth users (as Supabase Auth would) and calls seed_event() as the service role. */
export async function seedEvent(pool: pg.Pool, overrides: Partial<SeedOptions> = {}): Promise<SeededEvent> {
  const plan = buildSeedPlan({
    slug: `t-${randomUUID().slice(0, 8)}`,
    name: "Test event",
    rehearsal: true,
    clockSpeed: 1,
    startsAt: new Date(Date.now() + 3_600_000),
    teamsPerTrack: 3,
    cardSecret: "test-secret-0123456789",
    emailDomain: "teams.example.org",
    staff: TEST_STAFF,
    problemCards: Array.from({ length: 9 }, (_, i) => ({
      number: i + 1,
      sector: "Test",
      title: `Problem ${i + 1}`,
      body: "A problem.",
    })),
    crisisCards: [{ category: "Test", number: 1, title: "Crisis", body: "Something bad." }],
    codePrefix: overrides.rehearsal === false ? "" : PREFIXES[prefixCounter++ % PREFIXES.length],
    ...overrides,
  });

  const ids = new Map<string, string>();
  const existing = await pool.query<{ id: string; email: string }>("select id, email from auth.users");
  for (const r of existing.rows) ids.set(r.email, r.id);
  for (const email of [...plan.teams.map((t) => t.email), ...plan.staff.map((s) => s.email)]) {
    if (ids.has(email)) continue;
    const id = randomUUID();
    await pool.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
    ids.set(email, id);
  }

  const eventId = await as(
    pool,
    service,
    async (c) => (await c.query<{ id: string }>("select public.seed_event($1) as id", [toSeedPayload(plan, ids)])).rows[0]!.id,
    { commit: true },
  );

  const teamRows = await pool.query<{ id: string; code: string }>("select id, code from teams where event_id = $1", [eventId]);
  const teams = new Map<string, { teamId: string; userId: string }>();
  for (const t of teamRows.rows) {
    const email = plan.teams.find((p) => p.code === t.code)!.email;
    teams.set(t.code, { teamId: t.id, userId: ids.get(email)! });
  }
  const staff = new Map(plan.staff.map((s) => [s.email, ids.get(s.email)!]));
  return { eventId, plan, teams, staff };
}

export async function setPhase(pool: pg.Pool, eventId: string, phase: string): Promise<void> {
  await pool.query("update events set current_phase = $2::phase_code, phase_started_at = now() where id = $1", [
    eventId,
    phase,
  ]);
}
