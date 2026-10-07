// Row Level Security and grants: who can read what, and that no client can write anything directly.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestDb } from "./pg";
import { anon, rowsAs, seedEvent, setPhase, user, type Caller } from "./helpers";
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
  "crisis_cards", "squads", "companies", "coverage", "holdings", "orders", "ipo_bids", "round_prices", "fees",
  "deals", "submission_drafts", "submissions", "judge_runs", "scores", "injection_logs", "calls", "qa_questions",
  "qa_answers", "bulletins", "ledger_entries", "public_ledger", "corrections", "flags", "results", "awards",
  "audit_log", "rate_limits", "error_log",
];

describe("grants", () => {
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

  test("no public function is executable by clients yet (game functions arrive in Phase 2)", async () => {
    const { rows } = await db.pool.query(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
                                   or has_function_privilege('anon', p.oid, 'EXECUTE'))`);
    expect(rows).toEqual([]);
  });

  test("a team cannot write, even to its own rows", async () => {
    const me = user(fx.team(fx.code("F", 1)).userId);
    await expect(rowsAs(db.pool, me, "update teams set cash_cents = 999999999")).rejects.toThrow(/permission denied/);
    await expect(rowsAs(db.pool, me, "delete from orders")).rejects.toThrow(/permission denied/);
    await expect(
      rowsAs(db.pool, me, "insert into qa_answers (event_id, question_id, company_id, body, word_count) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'x', 1)"),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("a Finance team (squad 1)", () => {
  const me = () => user(fx.team(fx.code("F", 1)).userId);
  const myTeam = () => fx.team(fx.code("F", 1)).teamId;

  test("sees only its own team, members, holdings, orders, IPO bids and ledger", async () => {
    expect(await rowsAs(db.pool, me(), "select id from teams")).toEqual([{ id: myTeam() }]);
    for (const t of ["holdings", "orders", "ipo_bids", "ledger_entries", "members"]) {
      expect(await count(me(), t, "team_id <> $1", [myTeam()]), t).toBe(0);
    }
    expect(await count(me(), "holdings")).toBe(2);
    expect(await count(me(), "orders")).toBe(1);
    expect(await count(me(), "ledger_entries")).toBe(1); // starting cash
    expect(await count(me(), "accounts")).toBe(1);
  });

  test("sees its own squad's workspace and nobody else's", async () => {
    expect(await rowsAs(db.pool, me(), "select id from squads")).toEqual([{ id: fx.squad[0] }]);
    for (const t of ["fees", "deals", "submission_drafts"]) {
      expect(await count(me(), t, "squad_id <> $1", [fx.squad[0]]), t).toBe(0);
      expect(await count(me(), t), t).toBeGreaterThan(0);
    }
    expect(await count(me(), "problem_cards")).toBe(3); // the three cards dealt to its squad
  });

  test("companies: only its own squad's before READING, all from READING", async () => {
    await setPhase(db.pool, fx.eventId, "BUILD");
    expect(await rowsAs(db.pool, me(), "select id from companies")).toEqual([{ id: fx.company[0] }]);
    await setPhase(db.pool, fx.eventId, "READING");
    expect(await count(me(), "companies")).toBe(3);
  });

  test("submissions unlock by phase: pitches at READING, plans at PLANS_PUBLISHED, flash on release", async () => {
    const others = "squad_id <> $1";
    await setPhase(db.pool, fx.eventId, "BUILD");
    expect(await count(me(), "submissions", others, [fx.squad[0]])).toBe(0);
    expect(await count(me(), "submissions", "squad_id = $1", [fx.squad[0]])).toBe(3);

    await setPhase(db.pool, fx.eventId, "READING");
    expect(await count(me(), "submissions", `${others} and type = 'PITCH'`, [fx.squad[0]])).toBe(2);
    expect(await count(me(), "submissions", `${others} and type <> 'PITCH'`, [fx.squad[0]])).toBe(0);
    // superseded versions of other squads stay private
    expect(await count(me(), "submissions", "body_text like 'old pitch%'")).toBe(0);

    await setPhase(db.pool, fx.eventId, "PLANS_PUBLISHED");
    expect(await count(me(), "submissions", `${others} and type = 'PLAN'`, [fx.squad[0]])).toBe(2);
    expect(await count(me(), "submissions", `${others} and type = 'FLASH'`, [fx.squad[0]])).toBe(0);

    await db.pool.query(
      "insert into scores (event_id, company_id, type, status, final_score) values ($1, $2, 'FLASH', 'RELEASED', 80)",
      [fx.eventId, fx.company[1]],
    );
    expect(await count(me(), "submissions", `${others} and type = 'FLASH'`, [fx.squad[0]])).toBe(2);
    await db.pool.query("delete from scores where type = 'FLASH' and event_id = $1", [fx.eventId]);
  });

  test("scores are visible only once released", async () => {
    expect(await rowsAs(db.pool, me(), "select type, final_score from scores order by final_score")).toEqual([
      { type: "PITCH", final_score: 58 },
      { type: "PITCH", final_score: 66 },
    ]);
  });

  test("crisis cards are hidden until CRISIS", async () => {
    await setPhase(db.pool, fx.eventId, "ROUNDS_1_4");
    expect(await count(me(), "crisis_cards")).toBe(0);
    await setPhase(db.pool, fx.eventId, "CRISIS");
    expect(await count(me(), "crisis_cards")).toBe(1);
  });

  test("rankings and awards are hidden until AWARDS", async () => {
    for (const phase of ["CLOSE", "SETTLEMENT", "APPEALS"]) {
      await setPhase(db.pool, fx.eventId, phase);
      expect(await count(me(), "results"), phase).toBe(0);
      expect(await count(me(), "awards"), phase).toBe(0);
    }
    await setPhase(db.pool, fx.eventId, "AWARDS");
    expect(await count(me(), "results")).toBe(1);
    expect(await count(me(), "awards")).toBe(1);
    await setPhase(db.pool, fx.eventId, "READING");
  });

  test("Q&A: questions are public but the asker is not", async () => {
    expect(await rowsAs(db.pool, me(), "select body from qa_questions")).toEqual([{ body: "How many towns?" }]);
    await expect(rowsAs(db.pool, me(), "select asker_team_id from qa_questions")).rejects.toThrow(/permission denied/);
    expect(await count(me(), "qa_answers")).toBe(1);
  });

  test("bulletins: published ones only", async () => {
    expect(await rowsAs(db.pool, me(), "select title from bulletins")).toEqual([{ title: "Welcome" }]);
  });

  test("public market data is readable", async () => {
    for (const t of ["events", "phases", "rounds", "deadlines", "round_prices", "public_ledger"]) {
      expect(await count(me(), t), t).toBeGreaterThan(0);
    }
  });

  test("staff-only and fairness-only data is invisible", async () => {
    for (const t of ["judge_runs", "injection_logs", "corrections", "audit_log", "error_log", "event_secrets", "flags", "coverage", "calls", "rate_limits"]) {
      if (t === "rate_limits") {
        await expect(rowsAs(db.pool, me(), "select 1 from rate_limits")).rejects.toThrow(/permission denied/);
      } else {
        expect(await count(me(), t), t).toBe(0);
      }
    }
  });

  test("another event's data is invisible, public or not", async () => {
    for (const t of ["phases", "rounds", "deadlines", "round_prices", "public_ledger", "qa_questions", "bulletins"]) {
      expect(await count(me(), t, "event_id = $1", [other.eventId]), t).toBe(0);
    }
    expect(await count(me(), "events", "id = $1", [other.eventId])).toBe(0);
  });
});

describe("a Consulting team", () => {
  test("sees its own coverage and calls only", async () => {
    const me = user(fx.team(fx.code("C", 1)).userId);
    expect(await count(me, "coverage")).toBe(2);
    expect(await count(me, "calls")).toBe(1);
    const other = user(fx.team(fx.code("C", 2)).userId);
    expect(await count(other, "coverage")).toBe(0);
    expect(await count(other, "calls")).toBe(0);
  });
});

describe("the display account", () => {
  const display = () => user(fx.staffId("display@example.org"));

  test("sees public data only, never private rows or rankings before AWARDS", async () => {
    await setPhase(db.pool, fx.eventId, "IPO");
    expect(await count(display(), "companies", "event_id = $1", [fx.eventId])).toBe(3);
    expect(await count(display(), "scores", "event_id = $1", [fx.eventId])).toBe(2); // released only
    for (const t of ["teams", "members", "holdings", "orders", "ipo_bids", "ledger_entries", "squads", "fees", "deals",
      "submission_drafts", "calls", "coverage", "judge_runs", "audit_log", "flags", "corrections", "event_secrets"]) {
      expect(await count(display(), t), t).toBe(0);
    }
    expect(await count(display(), "results")).toBe(0);
    await setPhase(db.pool, fx.eventId, "AWARDS");
    expect(await count(display(), "results")).toBe(1);
    await setPhase(db.pool, fx.eventId, "READING");
  });
});

describe("staff", () => {
  test("an organiser reads everything except collusion flags", async () => {
    const lead = user(fx.staffId("lead@example.org"));
    expect(await count(lead, "teams", "event_id = $1", [fx.eventId])).toBe(9);
    expect(await count(lead, "holdings")).toBeGreaterThan(0);
    expect(await count(lead, "judge_runs")).toBe(1);
    expect(await count(lead, "audit_log")).toBeGreaterThan(0);
    expect(await count(lead, "event_secrets")).toBe(1);
    expect(await count(lead, "results")).toBe(1); // results are reviewable from settlement
    expect(await count(lead, "flags")).toBe(0);
    expect(await count(lead, "qa_questions", "event_id = $1", [fx.eventId])).toBe(2); // including hidden
  });

  test("the fairness officer reads everything including flags", async () => {
    const fo = user(fx.staffId("fairness@example.org"));
    expect(await count(fo, "flags")).toBe(1);
    expect(await count(fo, "teams", "event_id = $1", [fx.eventId])).toBe(9);
    expect(await count(fo, "corrections")).toBe(1);
  });
});
