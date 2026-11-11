// Seeds a small rehearsal event on the local stack (real Auth logins through the admin API) and returns the Night
// driver from the database tests, so a spec can move the game to any state through the real game functions and
// then check the screens. Each spec uses its own slug and team-code prefix; re-running a spec replaces its event.

import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { buildSeedPlan, type SeedPlan } from "../../../../scripts/lib/seed-plan";
import { seedWithLogins } from "../../../../scripts/lib/seed-run";
import { CRISIS_DECK, Night } from "../../../../supabase/tests/night";
import { TEST_STAFF } from "../../../../supabase/tests/helpers";
import { e2eEnv } from "./env";

export const STAFF = {
  lead: "lead@example.org",
  second: "exchange@example.org",
  fairness: "fairness@example.org",
  display: "display@example.org",
} as const;

let pool: pg.Pool | undefined;
export function e2ePool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: e2eEnv().DATABASE_URL, max: 4 });
  return pool;
}

export interface E2eEvent {
  n: Night;
  plan: SeedPlan;
  slug: string;
  /** Password of a staff email or a team code. */
  password(login: string): string;
}

export async function seedE2eEvent({ slug, prefix, squads = 3 }: { slug: string; prefix: string; squads?: number }): Promise<E2eEvent> {
  const env = e2eEnv();
  const plan = buildSeedPlan({
    slug,
    name: `E2E ${slug}`,
    rehearsal: true,
    clockSpeed: 1,
    startsAt: new Date(Date.now() + 3_600_000),
    teamsPerTrack: squads,
    cardSecret: env.CARD_SECRET,
    emailDomain: env.TEAM_EMAIL_DOMAIN,
    staff: TEST_STAFF,
    problemCards: Array.from({ length: squads + 2 }, (_, i) => ({ number: i + 1, sector: "Test", title: `Problem ${i + 1}`, body: "A problem." })),
    crisisCards: CRISIS_DECK,
    codePrefix: prefix,
  });
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  process.env.SEED_QUIET = "1";
  const { eventId, ids } = await seedWithLogins(admin, plan, { replace: true });
  const p = e2ePool();
  const teamRows = (await p.query<{ id: string; code: string }>("select id, code from teams where event_id = $1", [eventId])).rows;
  const teams = new Map(teamRows.map((t) => [t.code, { teamId: t.id, userId: ids.get(plan.teams.find((x) => x.code === t.code)!.email)! }]));
  const staff = new Map(plan.staff.map((s) => [s.email, ids.get(s.email)!]));
  const n = new Night(p, { eventId, plan, teams, staff });
  return {
    n,
    plan,
    slug,
    password: (login) => (plan.staff.find((s) => s.email === login) ?? plan.teams.find((t) => t.code === login))!.password,
  };
}
