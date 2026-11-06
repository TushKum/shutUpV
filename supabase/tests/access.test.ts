// Row Level Security and grants: who can read what, from when, and that no client can write anything directly.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestDb } from "./pg";
import { anon, rowsAs, seedEvent, user, type Caller } from "./helpers";
import { buildFixture, type Fixture } from "./fixtures";

let db: Awaited<ReturnType<typeof createTestDb>>;
let fx: Fixture;
let other: Awaited<ReturnType<typeof seedEvent>>;

beforeAll(async () => {
  db = await createTestDb();
  fx = await buildFixture(db.pool);
  other = await seedEvent(db.pool); // a second (rehearsal) event, to prove events are isolated
});
afterAll(async () => {
  await db.drop();
});

const count = async (caller: Caller, table: string, where = "true", params: unknown[] = []) =>
  Number((await rowsAs<{ n: string }>(db.pool, caller, `select count(*) as n from ${table} where ${where}`, params))[0]!.n);

const ALL_TABLES = [
  "events", "event_secrets", "phases", "deadlines", "rounds", "teams", "members", "accounts", "problem_cards",
  "crisis_cards", "companies", "holdings", "orders", "round_prices", "drafts", "submissions", "judge_runs", "scores",
  "injection_logs", "judge_injection_checks", "appeals", "calibration_samples", "calibration_runs", "qa_questions",
  "qa_answers", "bulletins", "ledger_entries", "public_ledger", "corrections", "flags", "results",
  "leaderboard_frozen", "awards", "audit_log", "rate_limits", "error_log", "client_pings",
];

const t1 = () => user(fx.team(fx.codes[0]!).userId); // founded company 0, rescues company 1
const t1Id = () => fx.team(fx.codes[0]!).teamId;
const organiser = () => user(fx.staffId("lead@example.org"));
const fairness = () => user(fx.staffId("fairness@example.org"));
const display = () => user(fx.staffId("display@example.org"));

describe("grants", () => {
  test("every table in the schema is covered by these tests and has RLS on", async () => {
    const { rows } = await db.pool.query(
      "select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename",
    );
    expect(rows.map((r) => r.tablename).sort()).toEqual([...ALL_TABLES].sort());
    expect(rows.filter((r) => !r.rowsecurity)).toEqual([]);
  });

  test("clients have no INSERT, UPDATE, DELETE or TRUNCATE on any table", async () => {
    const { rows } = await db.pool.query(
      `select grantee, table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'`,
    );
    expect(rows).toEqual([]);
    for (const t of ALL_TABLES) {
      for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
        const r = await db.pool.query("select has_table_privilege('authenticated', $1, $2) as ok", [`public.${t}`, priv]);
        expect(r.rows[0].ok, `${priv} on ${t}`).toBe(false);
      }
    }
  });

  test("anon (not logged in) can read nothing", async () => {
    for (const t of ALL_TABLES) {
      await expect(rowsAs(db.pool, anon, `select 1 from ${t} limit 1`), t).rejects.toThrow(/permission denied/);
    }
  });

  test("seeding and purging are for the service role only", async () => {
    for (const f of ["public.seed_event(jsonb)", "public.purge_event(text)"]) {
      const r = await db.pool.query(
        "select has_function_privilege('service_role', $1, 'EXECUTE') as svc, has_function_privilege('authenticated', $1, 'EXECUTE') as auth, has_function_privilege('anon', $1, 'EXECUTE') as anon",
        [f],
      );
      expect(r.rows[0], f).toEqual({ svc: true, auth: false, anon: false });
    }
  });

  test("internal app.* functions are not callable by signed-in users (only the RLS helpers are)", async () => {
    const { rows } = await db.pool.query(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and has_function_privilege('authenticated', p.oid, 'EXECUTE') order by 1`);
    expect(rows.map((r) => r.proname)).toEqual([
      "can_hear", "in_my_event", "is_fairness", "is_organiser", "is_staff", "my_company_id", "my_event_id",
      "my_rescue_company_id", "my_role", "my_team_id", "phase_reached", "sees_all_events",
    ]);
    await expect(rowsAs(db.pool, t1(), "select app.audit_row()")).rejects.toThrow(/permission denied/);
  });

  test("a team cannot write, even to its own rows", async () => {
    await expect(rowsAs(db.pool, t1(), "update teams set cash_cents = 999999999")).rejects.toThrow(/permission denied/);
    await expect(rowsAs(db.pool, t1(), "delete from orders")).rejects.toThrow(/permission denied/);
    await expect(rowsAs(db.pool, t1(), "update drafts set content = '{}'")).rejects.toThrow(/permission denied/);
    await expect(
      rowsAs(db.pool, t1(), "insert into qa_answers (event_id, question_id, company_id, body, word_count) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'x', 1)"),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("a team, all night", () => {
  beforeAll(async () => {
    await fx.setPhase("BUILD");
  });

  test("its own private rows only: team, members, cash, holdings, orders, ledger, drafts", async () => {
    expect(await count(t1(), "teams")).toBe(1);
    expect((await rowsAs(db.pool, t1(), "select id from teams"))[0]!.id).toBe(t1Id());
    expect(await count(t1(), "holdings")).toBe(1);
    expect(await count(t1(), "holdings", "team_id <> $1", [t1Id()])).toBe(0);
    expect(await count(t1(), "orders", "team_id <> $1", [t1Id()])).toBe(0);
    expect(await count(t1(), "ledger_entries", "team_id is distinct from $1", [t1Id()])).toBe(0);
    expect(await count(t1(), "accounts")).toBe(1);
    // Its PRD draft and its solution draft (for the company it rescues); nobody else's.
    expect(await count(t1(), "drafts")).toBe(2);
    expect(await count(t1(), "drafts", "team_id <> $1", [t1Id()])).toBe(0);
  });

  test("public data of its own event only, never another event's", async () => {
    expect(await count(t1(), "companies")).toBe(fx.codes.length);
    expect(await count(t1(), "companies", "event_id = $1", [other.eventId])).toBe(0);
    expect(await count(t1(), "events")).toBe(1);
    expect(await count(t1(), "rounds", "event_id = $1", [other.eventId])).toBe(0);
    expect(await count(t1(), "public_ledger")).toBe(1);
    expect(await count(t1(), "qa_questions")).toBe(1);
  });

  test("bulletins: published ones only (the twist stays a draft until 22:15)", async () => {
    expect(await count(t1(), "bulletins")).toBe(1);
    expect(await count(t1(), "bulletins", "kind = 'TWIST'")).toBe(0);
    expect(await count(organiser(), "bulletins", "kind = 'TWIST' and event_id = $1", [fx.eventId])).toBe(1);
  });

  test("staff-only and fairness-only tables are empty to a team", async () => {
    for (const t of [
      "event_secrets", "judge_runs", "injection_logs", "judge_injection_checks", "appeals", "calibration_samples",
      "calibration_runs", "corrections", "flags", "leaderboard_frozen", "audit_log", "error_log", "client_pings",
    ]) {
      expect(await count(t1(), t), t).toBe(0);
    }
  });

  test("21:15–23:30: only its own problem card; no crisis cards; only its own writing; no scores, results or awards", async () => {
    await fx.setPhase("BUILD");
    expect(await count(t1(), "problem_cards")).toBe(1);
    const mine = await rowsAs<{ id: string }>(db.pool, t1(), "select problem_card_id as id from companies where id = $1", [fx.company[0]]);
    expect((await rowsAs<{ id: string }>(db.pool, t1(), "select id from problem_cards"))[0]!.id).toBe(mine[0]!.id);
    expect(await count(t1(), "crisis_cards")).toBe(0);
    expect(await count(t1(), "submissions")).toBe(2); // its own PRD and its own solution
    expect(await count(t1(), "submissions", "team_id <> $1", [t1Id()])).toBe(0);
    expect(await count(t1(), "scores")).toBe(0);
    expect(await count(t1(), "results")).toBe(0);
    expect(await count(t1(), "awards")).toBe(0);
  });

  test("23:30 (REVEAL_1): every PRD and problem card; revealed PRD scores", async () => {
    await fx.setPhase("REVEAL_1");
    expect(await count(t1(), "problem_cards")).toBe(fx.codes.length);
    expect(await count(t1(), "submissions", "type = 'PRD'")).toBe(fx.codes.length);
    expect(await count(t1(), "submissions", "type = 'SOLUTION'")).toBe(1);
    expect(await count(t1(), "crisis_cards")).toBe(0);
    expect(await count(t1(), "scores")).toBe(0); // sealed, not yet revealed
    await fx.revealScores("PRD", true);
    expect(await count(t1(), "scores", "type = 'PRD'")).toBe(fx.codes.length);
  });

  test("23:45 (CRISIS_QA): every crisis card", async () => {
    await fx.setPhase("CRISIS_QA");
    expect(await count(t1(), "crisis_cards")).toBe(10);
  });

  test("01:45 (JUDGING_2): solution scores stay secret, and so do other teams' solutions", async () => {
    await fx.setPhase("JUDGING_2");
    expect(await count(t1(), "scores", "type = 'SOLUTION'")).toBe(0);
    expect(await count(t1(), "submissions", "type = 'SOLUTION'")).toBe(1);
  });

  test("02:15 (MARKET_BLIND): every solution, still without scores", async () => {
    await fx.setPhase("MARKET_BLIND");
    expect(await count(t1(), "submissions", "type = 'SOLUTION'")).toBe(fx.codes.length);
    expect(await count(t1(), "scores", "type = 'SOLUTION'")).toBe(0);
  });

  test("02:45 (MARKET): the solution scores once revealed", async () => {
    await fx.setPhase("MARKET");
    expect(await count(t1(), "scores", "type = 'SOLUTION'")).toBe(0);
    await fx.revealScores("SOLUTION", true);
    expect(await count(t1(), "scores", "type = 'SOLUTION'")).toBe(fx.codes.length);
  });

  test("results and awards only at AWARDS", async () => {
    await fx.setPhase("SETTLEMENT");
    expect(await count(t1(), "results")).toBe(0);
    expect(await count(t1(), "awards")).toBe(0);
    await fx.setPhase("AWARDS");
    expect(await count(t1(), "results")).toBe(fx.codes.length);
    expect(await count(t1(), "awards")).toBe(1);
  });

  test("a team of another event sees none of this event", async () => {
    const stranger = user(other.teams.get(other.plan.teams[0]!.code)!.userId);
    for (const t of ["companies", "submissions", "scores", "results", "awards", "bulletins", "qa_questions", "public_ledger"]) {
      expect(await count(stranger, t, "event_id = $1", [fx.eventId]), t).toBe(0);
    }
  });
});

describe("staff and the projector", () => {
  test("organisers read everything of every event except collusion flags (and their audit history)", async () => {
    await fx.setPhase("BUILD");
    await fx.revealScores("SOLUTION", false);
    expect(await count(organiser(), "teams", "event_id = $1", [fx.eventId])).toBe(fx.codes.length);
    expect(await count(organiser(), "teams", "event_id = $1", [other.eventId])).toBe(other.plan.teams.length);
    expect(await count(organiser(), "drafts", "event_id = $1", [fx.eventId])).toBe(2 * fx.codes.length);
    expect(await count(organiser(), "scores", "type = 'SOLUTION' and event_id = $1", [fx.eventId])).toBe(fx.codes.length);
    expect(await count(organiser(), "event_secrets")).toBe(1);
    expect(await count(organiser(), "judge_runs")).toBe(fx.codes.length);
    expect(await count(organiser(), "crisis_cards", "event_id = $1", [fx.eventId])).toBe(10);
    expect(await count(organiser(), "results", "event_id = $1", [fx.eventId])).toBe(fx.codes.length);
    expect(await count(organiser(), "flags")).toBe(0);
    expect(await count(organiser(), "audit_log", "entity = 'flags'")).toBe(0);
    expect(await count(organiser(), "audit_log", "entity = 'companies'")).toBeGreaterThan(0);
  });

  test("the fairness officer also reads the flags and their history", async () => {
    expect(await count(fairness(), "flags")).toBe(1);
    expect(await count(fairness(), "audit_log", "entity = 'flags'")).toBeGreaterThan(0);
  });

  test("the projector reads public data of every event, and nothing private", async () => {
    await fx.setPhase("BUILD");
    expect(await count(display(), "companies", "event_id = $1", [fx.eventId])).toBe(fx.codes.length);
    expect(await count(display(), "companies", "event_id = $1", [other.eventId])).toBe(other.plan.teams.length);
    expect(await count(display(), "public_ledger")).toBe(1);
    for (const t of ["teams", "members", "holdings", "orders", "drafts", "ledger_entries", "event_secrets", "flags", "audit_log"]) {
      expect(await count(display(), t), t).toBe(0);
    }
    expect(await count(display(), "problem_cards")).toBe(0);
    // Revealed PRD scores are public; the sealed solution scores are not.
    expect(await count(display(), "scores", "type = 'PRD'")).toBe(fx.codes.length);
    expect(await count(display(), "scores", "type = 'SOLUTION'")).toBe(0);
  });
});

describe("realtime", () => {
  test("a team hears its own event's channel; staff also hear the staff channel; nobody hears another event", async () => {
    const hears = async (who: Caller, topic: string) =>
      (await rowsAs<{ v: boolean }>(db.pool, who, "select app.can_hear($1) as v", [topic]))[0]!.v;
    expect(await hears(t1(), `event:${fx.eventId}`)).toBe(true);
    expect(await hears(t1(), `event:${other.eventId}`)).toBe(false);
    expect(await hears(t1(), `staff:${fx.eventId}`)).toBe(false);
    expect(await hears(organiser(), `staff:${fx.eventId}`)).toBe(true);
    expect(await hears(display(), `event:${other.eventId}`)).toBe(true);
    expect(await hears(display(), `staff:${fx.eventId}`)).toBe(false);
    expect(await hears(organiser(), "staff:00000000-0000-0000-0000-000000000000")).toBe(false);
  });
});
