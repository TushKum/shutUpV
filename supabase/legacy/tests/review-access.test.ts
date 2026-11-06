// Regression tests for the access and abuse findings of the SQL review:
//   SEC-1                  event broadcasts go out on a private channel: only accounts of the event (and staff and the
//                          display) may receive, and nobody may send
//   SEC-2 / R4             collusion flags stay with the fairness officer, in the audit log too
//   SEC-3                  scores are sealed only by the judge worker (service role), from the stored judge runs
//   SEC-5                  answer_question is throttled (10 a minute per team)
//   SEC-6                  throttled calls write nothing to the audit log; draft audit rows keep a digest, not the draft
//   SEC-7 / R9             the lottery commitment is fixed once the event has started; a weak seed is refused
//   SEC-8 / MONEY-1 / MONEY-3  correction entries are validated; a SHORT-lot correction follows the ledger convention
//                          and recalculates collateral; a correction may not undercut a pending SELL or COVER
//   R5                     a DISQUALIFIED flag decided again as CLEARED re-enables its teams, unless another flag
//                          still disqualifies them
// Each scenario is the reviewer's failure scenario, played through the real game functions as the real callers, with
// the fixed behaviour asserted. Small events (3 or 4 squads); the clock is moved by editing the schedule (night.ts).
// Rate-limit windows are pinned to start in the future so a slow machine cannot roll a window over mid-test.
// Two cases found while writing these tests are covered too (they failed before the second round of fixes):
//   SEC-8  a share entry with "lot": null is refused when requested (not only at approval)
//   R5     two decide_flag calls that overlap in time (two tabs) are serialised per event, so a team every flag
//          has cleared is re-enabled
// With the pre-fix functions (dd355ea, run with this file's harness) 22 of the 24 original tests fail on the reviewed
// bug; the two that pass there are "nobody can send" (the Supabase stub has RLS on realtime.messages and no policy)
// and the lot-null case (the old check caught it).

import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { RUBRICS, sha256Hex, shortCollateral, type SubmissionType } from "@msim/engine";
import { createTestDb } from "./pg";
import { anon, as, rowsAs, service, user, type Caller } from "./helpers";
import { Night } from "./night";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

const SEED = sha256Hex("review-access"); // 64 hex characters, as run_lottery requires
type Squad = Awaited<ReturnType<Night["squad"]>>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Builds a shared event once, on first use. */
function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined;
  return () => (p ??= fn());
}

// ───────────── Driving an event ─────────────

/** A new event in SETUP; by default with its seed commitment published (the day before). */
async function fresh(squads = 3, commitment: string | null = sha256Hex(SEED)) {
  const n = await Night.create(db.pool, squads);
  if (commitment) await n.org("set_seed_commitment", n.eventId, commitment);
  return n;
}

async function squadsOf(n: Night) {
  const count = (await n.one("select count(*)::int as c from squads where event_id = $1", [n.eventId])).c;
  const s: Squad[] = [];
  for (let i = 1; i <= count; i++) s.push(await n.squad(i));
  return s;
}

async function drawn(squads = 3) {
  const n = await fresh(squads);
  await n.advanceTo("SQUAD_DRAW");
  await n.org("run_lottery", n.eventId, SEED, "4");
  return { n, s: await squadsOf(n) };
}

const pitchOf = (s: Squad) => ({
  company_name: `Company ${s.number}`,
  ticker: `TK${"ABCDEFG"[s.number - 1]}`,
  problem: "Unsafe water in small towns.",
  solution: "Sensors in every tank.",
  business_model: "Yearly subscription per tank.",
  advantage: "Cheaper than lab tests.",
});

async function draftVersion(n: Night, s: Squad, type: string): Promise<number> {
  return (await n.one("select version from submission_drafts where squad_id = $1 and type = $2", [s.id, type])).version;
}

async function submitPitch(n: Night, s: Squad) {
  await n.ok(n.team(s.p_code), "save_draft", "PITCH", pitchOf(s), await draftVersion(n, s, "PITCH"));
  await n.ok(n.team(s.p_code), "submit_submission", "PITCH");
}

/** 3 squads, drawn, in BUILD (the pitch drafts are open). */
const inBuild = once(async () => {
  const g = await drawn(3);
  await g.n.advanceTo("BUILD");
  return g;
});

/** 3 squads, every pitch submitted, in READING (pitch deadline passed, nothing judged yet). */
const inReading = once(async () => {
  const g = await drawn(3);
  await g.n.advanceTo("BUILD");
  for (const x of g.s) await submitPitch(g.n, x);
  await g.n.deadlinePassed("PITCH");
  await g.n.advanceTo("READING");
  return g;
});

/**
 * 4 squads in ROUNDS_1_4: pitches judged 60 and released, s[2]'s fund got 500 shares of s[0]'s company at the IPO, and
 * in round 1 s[1]'s fund sold 1,000 shares of it short.
 */
const trading = once(async () => {
  const g = await drawn(4);
  const { n, s } = g;
  await n.advanceTo("BUILD");
  for (const x of s) await submitPitch(n, x);
  await n.deadlinePassed("PITCH");
  await n.advanceTo("READING");
  for (const x of s) expect(await n.judge(x.company_id, "PITCH", [60, 60, 60])).toMatchObject({ ok: true });
  await n.deadlinePassed("CALL_1");
  await n.org("release_scores", n.eventId, "PITCH");
  await n.advanceTo("IPO");
  await n.ok(n.team(s[2]!.f_code), "place_ipo_bid", s[0]!.company_id, 500);
  await n.advanceTo("ROUNDS_1_4");
  await n.openRound(1);
  await n.ok(n.team(s[1]!.f_code), "place_order", s[0]!.company_id, "SHORT", 1000);
  await n.clearRound(1);
  await n.checkInvariants();
  return g;
});

// ───────────── Small tools ─────────────

/** A fresh rate-limit window for (team, bucket) that cannot roll over during the test. */
async function pinWindow(n: Night, teamId: string, bucket: string) {
  await n.q(
    `insert into rate_limits (team_id, bucket, window_start, count) values ($1, $2, now() + interval '1 hour', 0)
     on conflict (team_id, bucket) do update set window_start = excluded.window_start, count = 0`,
    [teamId, bucket],
  );
}

async function count(n: Night, sql: string, params: unknown[] = []): Promise<number> {
  return (await n.one(`select count(*)::int as c from ${sql}`, params)).c;
}

/** Runs `setup` as the superuser, then `fn` as `caller`, in one transaction that is always rolled back. */
async function inTxAs<T>(setup: string, params: unknown[], caller: Caller, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db.pool.connect();
  try {
    await c.query("begin");
    await c.query(setup, params);
    const role = caller.kind === "user" ? "authenticated" : caller.kind === "anon" ? "anon" : "service_role";
    const claims = caller.kind === "user" ? { sub: caller.id, role } : { role };
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await c.query(`set local role ${role}`);
    return await fn(c);
  } finally {
    await c.query("rollback").catch(() => {});
    c.release();
  }
}

async function lockWaiters(): Promise<number> {
  return (
    await db.pool.query(
      "select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
    )
  ).rows[0].n;
}

/** Returns once some session waits on a lock, or `p` has settled (it did not need to wait). */
async function waitForLockWaiterOr(p: Promise<unknown>) {
  let settled = false;
  void p.then(() => (settled = true), () => (settled = true));
  for (let i = 0; i < 400; i++) {
    if (settled || (await lockWaiters()) >= 1) return;
    await sleep(25);
  }
  throw new Error("no session ever waited on a lock");
}

// ═════════════════════════════ SEC-1 ═════════════════════════════

describe("SEC-1: event broadcasts are private; only the event's accounts can receive them and nobody can send", () => {
  let a: Awaited<ReturnType<typeof trading>>;
  let b: Awaited<ReturnType<typeof inReading>>;
  const topic = (n: Night) => `event:${n.eventId}`;
  const display = () => user(a.n.ev.staff.get("display@example.org")!);

  /** As Realtime Authorization does: the caller's role and claims, with realtime.topic() set to the channel. */
  async function hear(caller: Caller, channel: string | null, where = "true", params: unknown[] = []) {
    return as(db.pool, caller, async (c) => {
      if (channel !== null) await c.query("select set_config('realtime.topic', $1, true)", [channel]);
      return (await c.query(`select topic, event, private from realtime.messages where ${where}`, params)).rows;
    });
  }

  /** A client trying to broadcast a fake price on a channel (explicit id, so only the policy can refuse it). */
  async function send(caller: Caller, channel: string) {
    return as(db.pool, caller, async (c) => {
      await c.query("select set_config('realtime.topic', $1, true)", [channel]);
      await c.query(
        "insert into realtime.messages (id, topic, extension, event, payload, private) values (-1, $1, 'broadcast', 'price', $2, false)",
        [channel, JSON.stringify({ kind: "price", company: "TKA", price: 1 })],
      );
    });
  }

  beforeAll(async () => {
    a = await trading();
    b = await inReading();
  });

  test("SEC-1: every broadcast of both events is sent on a private channel", async () => {
    const rows = await a.n.q("select topic, event, private from realtime.messages where topic = any($1)", [[topic(a.n), topic(b.n)]]);
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.map((r) => r.event)).toEqual(expect.arrayContaining(["squad_draw", "phase", "round_cleared"]));
    expect(rows.filter((r) => r.private !== true)).toEqual([]); // all were private = false before the fix
  });

  test("SEC-1: a team hears its own event's channel; another event's team, a team on another topic and anon hear nothing", async () => {
    const mine = await a.n.q("select event from realtime.messages where topic = $1", [topic(a.n)]);
    const teamA = a.n.team(a.s[0]!.p_code);
    const teamB = b.n.team(b.s[0]!.f_code);

    // A Product team of event A on channel event:A receives every message of that channel.
    expect(await hear(teamA, topic(a.n), "topic = $1", [topic(a.n)])).toHaveLength(mine.length);
    // A Finance team of event B asking for channel event:A is refused (no row at all is visible).
    expect(await hear(teamB, topic(a.n))).toEqual([]);
    // A team of event A asking for event B's channel, or for no channel, gets nothing.
    expect(await hear(teamA, topic(b.n))).toEqual([]);
    expect(await hear(teamA, null)).toEqual([]);
    expect(await hear(teamA, "event:not-a-uuid")).toEqual([]);
    // Anyone holding only the anon key gets nothing.
    expect(await hear(anon, topic(a.n))).toEqual([]);
    // Staff and the display hear every event.
    expect(await hear(display(), topic(a.n), "topic = $1", [topic(a.n)])).toHaveLength(mine.length);
    expect((await hear(a.n.lead, topic(b.n), "topic = $1", [topic(b.n)])).length).toBeGreaterThan(0);
  });

  test("SEC-1: nobody can send on an event channel (there is no INSERT policy)", async () => {
    for (const who of [a.n.team(a.s[0]!.f_code), a.n.lead, a.n.fairness, display(), anon]) {
      await expect(send(who, topic(a.n))).rejects.toThrow(/row-level security/);
    }
    expect(await a.n.q("select id from realtime.messages where id = -1")).toEqual([]);
  });
});

// ═════════════════════════════ SEC-2 / R4 ═════════════════════════════

describe("SEC-2 / R4: collusion flags stay with the fairness officer, in the audit log too", () => {
  test("SEC-2 / R4: organisers see no flags rows in audit_log (open or decided); the fairness officer sees them all", async () => {
    const { n, s } = await inReading();
    const [f1, f2] = [n.teamId(s[0]!.f_code), n.teamId(s[1]!.f_code)];
    const flag = await n.one(
      "insert into flags (event_id, kind, team_ids, details) values ($1, 2, $2, $3) returning id",
      [n.eventId, [f1, f2], JSON.stringify({ cosine: 0.97, orders: [12, 14] })],
    );
    const organisers = [n.lead, n.second];

    for (const org of organisers) {
      expect(await rowsAs(db.pool, org, "select id from flags")).toEqual([]);
      // Before the fix: the whole flag (team_ids, details.cosine, status OPEN) was readable here.
      expect(await rowsAs(db.pool, org, "select after from audit_log where entity = 'flags'")).toEqual([]);
      // The rest of the audit log is still theirs.
      expect((await rowsAs<any>(db.pool, org, "select count(*)::int as c from audit_log where event_id = $1", [n.eventId]))[0].c)
        .toBeGreaterThan(0);
    }
    const fo = await rowsAs<any>(db.pool, n.fairness, "select action, after from audit_log where entity = 'flags' and entity_id = $1", [flag.id]);
    expect(fo).toHaveLength(1);
    expect(fo[0].after).toMatchObject({ team_ids: [f1, f2], details: { cosine: 0.97 }, status: "OPEN" });

    await n.ok(n.fairness, "decide_flag", flag.id, "CLEARED", "Same strategy posted in a public forum.");
    for (const org of organisers) {
      expect(await rowsAs(db.pool, org, "select 1 from audit_log where entity = 'flags'")).toEqual([]);
      // Nor does the decision's reason reach them through any other audit row.
      expect(await rowsAs(db.pool, org,
        "select entity from audit_log where coalesce(before::text, '') || coalesce(after::text, '') like '%public forum%'")).toEqual([]);
    }
    const fo2 = await rowsAs<any>(db.pool, n.fairness, "select action, after from audit_log where entity = 'flags' and entity_id = $1 order by id", [flag.id]);
    expect(fo2.map((r) => r.action)).toEqual(["insert", "update"]);
    expect(fo2[1].after).toMatchObject({ status: "CLEARED", reason: "Same strategy posted in a public forum." });

    // Teams and the display never read the audit log.
    for (const who of [n.team(s[0]!.f_code), user(n.ev.staff.get("display@example.org")!)]) {
      expect(await rowsAs(db.pool, who, "select 1 from audit_log")).toEqual([]);
    }
  });
});

// ═════════════════════════════ SEC-3 ═════════════════════════════

type Run = { total: number | null; breakdown?: unknown; rationale?: string | null; status?: string; run_no?: number };

/** A breakdown that fits the rubric and sums to `total` (each line filled up to its maximum in turn). */
function fill(type: SubmissionType, total: number): Record<string, number> {
  let left = total;
  return Object.fromEntries(RUBRICS[type].map((line) => {
    const v = Math.min(line.max, left);
    left -= v;
    return [line.key, v];
  }));
}

/** Stores judge runs for the company's current submission, as the judge worker does. Returns their generation. */
async function addRuns(n: Night, companyId: string, type: SubmissionType, runs: Run[], generation?: number): Promise<number> {
  const sub = await n.one("select id, event_id from submissions where company_id = $1 and type = $2 and superseded_at is null", [companyId, type]);
  const gen = generation ?? (await n.one("select coalesce(max(generation), 0) + 1 as g from judge_runs where submission_id = $1", [sub.id])).g;
  for (const [i, r] of runs.entries()) {
    const no = r.run_no ?? i + 1;
    const breakdown = r.breakdown === undefined ? (r.total === null ? null : fill(type, r.total)) : r.breakdown;
    await n.q(
      `insert into judge_runs (event_id, submission_id, company_id, type, generation, run_no, model, status, breakdown, total, rationale, finished_at)
       values ($1, $2, $3, $4, $5, $6, 'test-model', $7, $8::jsonb, $9, $10, now())`,
      [sub.event_id, sub.id, companyId, type, gen, no, r.status ?? "DONE", breakdown === null ? null : JSON.stringify(breakdown),
       r.total, r.rationale === undefined ? `Run ${no}: a clear problem, a weak moat.` : r.rationale],
    );
  }
  return gen;
}

const seal = (n: Night, companyId: string, type: SubmissionType = "PITCH") => n.call(service, "seal_score", companyId, type);
const scoreOf = (n: Night, companyId: string, type = "PITCH") =>
  n.q("select status, run_totals, median, final_score, generation, breakdown, rationale from scores where company_id = $1 and type = $2", [companyId, type]);

describe("SEC-3: scores are sealed only by the judge worker, from complete and valid stored runs", () => {
  test("SEC-3: an organiser cannot seal, cannot type in run totals, cannot write judge runs, and cannot release unsealed scores", async () => {
    const { n, s } = await inReading();
    const c = s[0]!.company_id;
    expect(await count(n, "judge_runs where event_id = $1", [n.eventId])).toBe(0);

    await expect(n.call(n.lead, "seal_score", c, "PITCH")).rejects.toThrow(/permission denied/);
    // The reviewer's call: invented totals, breakdown and rationale. Before the fix it sealed 100.
    await expect(
      n.call(n.lead, "seal_score", c, "PITCH", [100, 100, 100], JSON.stringify({ anything: "goes", problem: 999 }), "Invented rationale."),
    ).rejects.toThrow(/does not exist|permission denied/);
    await expect(n.call(n.team(s[0]!.p_code), "seal_score", c, "PITCH")).rejects.toThrow(/permission denied/);
    await expect(n.call(anon, "seal_score", c, "PITCH")).rejects.toThrow(/permission denied/);
    await expect(as(db.pool, n.lead, (cl) => cl.query(
      `insert into judge_runs (event_id, submission_id, company_id, type, run_no, status, breakdown, total, rationale)
       select event_id, id, company_id, type, 1, 'DONE', '{}', 100, 'Invented.' from submissions where company_id = $1`, [c]))).rejects.toThrow(/permission denied/);

    // seal_missing_scores gives 0 only to companies with no submission; every company here has one.
    expect(await n.org("seal_missing_scores", n.eventId, "PITCH")).toMatchObject({ sealed_missing: 0 });
    expect(await n.call(n.lead, "release_scores", n.eventId, "PITCH")).toMatchObject({ ok: false, code: "NOT_READY" });
    expect(await count(n, "scores where event_id = $1", [n.eventId])).toBe(0);
    expect(await n.q("select ipo_price from companies where event_id = $1 and squad_id is not null and ipo_price is not null", [n.eventId])).toEqual([]);
  });

  test("SEC-3: the service role seals only 3 DONE runs within 10 points, or 5; 5 runs work and the median's first run is published", async () => {
    const { n, s } = await inReading();
    const c = s[0]!.company_id;
    expect(await seal(n, c)).toMatchObject({ ok: false, code: "RUNS_INCOMPLETE", runs: 0 });

    const gen = await addRuns(n, c, "PITCH", [{ total: 50 }, { total: 70 }]);
    expect(await seal(n, c)).toMatchObject({ ok: false, code: "RUNS_INCOMPLETE", runs: 2 });
    // Three runs that spread 20 points need two more.
    await addRuns(n, c, "PITCH", [{ run_no: 3, total: 62 }], gen);
    expect(await seal(n, c)).toMatchObject({ ok: false, code: "RUNS_INCOMPLETE", runs: 3 });
    const run4 = { problem: 16, solution: 16, business_model: 16, advantage: 16 };
    await addRuns(n, c, "PITCH", [{ run_no: 4, total: 64, breakdown: run4, rationale: "Fourth run: the median." }], gen);
    expect(await seal(n, c)).toMatchObject({ ok: false, code: "RUNS_INCOMPLETE", runs: 4 });
    // A failed fifth run does not count.
    await addRuns(n, c, "PITCH", [{ run_no: 5, total: null, status: "FAILED", rationale: null }], gen);
    expect(await seal(n, c)).toMatchObject({ ok: false, code: "RUNS_INCOMPLETE", runs: 4 });
    expect(await scoreOf(n, c)).toEqual([]);

    // The retry succeeds: five runs 50, 70, 62, 64, 66 → median 64, published from run 4 (the first run with 64).
    await n.q(
      "update judge_runs set status = 'DONE', total = 66, breakdown = $2::jsonb, rationale = 'Fifth run.' where company_id = $1 and generation = $3 and run_no = 5",
      [c, JSON.stringify(fill("PITCH", 66)), gen]);
    expect(await seal(n, c)).toMatchObject({ ok: true, final: 64, median: 64, runs: 5 });
    expect(await scoreOf(n, c)).toEqual([{
      status: "SEALED", run_totals: [50, 70, 62, 64, 66], median: 64, final_score: 64, generation: gen,
      breakdown: run4, rationale: "Fourth run: the median.",
    }]);
  });

  test("SEC-3: a stored run that does not fit the rubric makes sealing raise", async () => {
    const { n, s } = await inReading();
    const c = s[1]!.company_id;
    const ok60 = { problem: 25, solution: 25, business_model: 10, advantage: 0 };
    const bad: [string, Run][] = [
      ["lines sum to 59, total 60", { total: 60, breakdown: { problem: 25, solution: 25, business_model: 9, advantage: 0 } }],
      ["a line the rubric does not have", { total: 60, breakdown: { ...ok60, bonus: 0 } }],
      ["a line over its maximum", { total: 60, breakdown: { problem: 26, solution: 24, business_model: 10, advantage: 0 } }],
      ["a fractional line", { total: 60, breakdown: { problem: 12.5, solution: 12.5, business_model: 25, advantage: 10 } }],
      ["a line missing", { total: 60, breakdown: { problem: 25, solution: 25, business_model: 10 } }],
      ["a line given as a string", { total: 60, breakdown: { ...ok60, advantage: "0" } }],
      ["a breakdown that is not an object", { total: 60, breakdown: [25, 25, 10, 0] }],
      ["a negative line", { total: 60, breakdown: { problem: 25, solution: 25, business_model: 15, advantage: -5 } }],
      ["a blank rationale", { total: 60, breakdown: ok60, rationale: "   " }],
    ];
    for (const [what, run] of bad) {
      // Runs 1 and 3 are fine; run 2 is the broken one. Each case is its own (latest) generation.
      await addRuns(n, c, "PITCH", [{ total: 60 }, run, { total: 60 }]);
      await expect(seal(n, c), what).rejects.toThrow(/judge run 2 of .* does not fit the rubric/);
      expect(await scoreOf(n, c), what).toEqual([]);
    }
    // A new generation of valid runs seals (earlier generations are ignored).
    const gen = await addRuns(n, c, "PITCH", [{ total: 60 }, { total: 61 }, { total: 59 }]);
    expect(await seal(n, c)).toMatchObject({ ok: true, final: 60, median: 60, runs: 3 });
    expect((await scoreOf(n, c))[0]).toMatchObject({ generation: gen, run_totals: [60, 61, 59], breakdown: ok60 });
  });

  test("SEC-3: the published breakdown and rationale are the first run whose total is the median, of the latest generation", async () => {
    const { n, s } = await inReading();
    const c = s[2]!.company_id;
    const first = { problem: 25, solution: 25, business_model: 14, advantage: 0 };
    const third = { problem: 16, solution: 16, business_model: 16, advantage: 16 };
    await addRuns(n, c, "PITCH", [
      { total: 64, breakdown: first, rationale: "First run: strong problem." },
      { total: 60, rationale: "Second run." },
      { total: 64, breakdown: third, rationale: "Third run: even." },
    ]);
    expect(await seal(n, c)).toMatchObject({ ok: true, median: 64, final: 64 });
    expect((await scoreOf(n, c))[0]).toMatchObject({ run_totals: [64, 60, 64], breakdown: first, rationale: "First run: strong problem." });

    // A re-run (technical appeal) is a new generation: sealing again uses it, published from its run 3 (71).
    const gen2 = await addRuns(n, c, "PITCH", [
      { total: 70, rationale: "Re-run 1." },
      { total: 72, rationale: "Re-run 2." },
      { total: 71, breakdown: { problem: 25, solution: 25, business_model: 21, advantage: 0 }, rationale: "Re-run 3." },
    ]);
    expect(await seal(n, c)).toMatchObject({ ok: true, median: 71, final: 71 });
    expect((await scoreOf(n, c))[0]).toMatchObject({
      generation: gen2, run_totals: [70, 72, 71], breakdown: { problem: 25, solution: 25, business_model: 21, advantage: 0 }, rationale: "Re-run 3.",
    });
  });
});

// ═════════════════════════════ SEC-5 ═════════════════════════════

describe("SEC-5: answers on the Q&A board are throttled", () => {
  test("SEC-5: 60 answers in a row: 10 are stored and broadcast, 50 are RATE_LIMITED; other teams are unaffected", async () => {
    const { n, s } = await inReading();
    const asker = s[1]!.f_code;
    const answerer = s[0]!.p_code;
    const answererId = n.teamId(answerer);
    await n.q("delete from rate_limits where team_id = any($1)", [[n.teamId(asker), answererId]]);
    await pinWindow(n, answererId, "qa_answer");
    await pinWindow(n, answererId, "actions");

    const q = await n.ok(n.team(asker), "post_question", s[0]!.company_id, "How many units have you sold?");
    const qaBroadcasts = () => count(n, "realtime.messages where topic = $1 and event = 'qa'", [`event:${n.eventId}`]);
    const before = await qaBroadcasts();
    const results = [];
    for (let i = 0; i < 60; i++) results.push(await n.call(n.team(answerer), "answer_question", q.question_id, `Junk answer number ${i}.`));

    expect(results.slice(0, 10).every((r) => r.ok)).toBe(true);
    expect(results.slice(10).filter((r) => !(r.ok === false && r.code === "RATE_LIMITED"))).toEqual([]); // all 60 were ok
    expect(await count(n, "qa_answers where question_id = $1", [q.question_id])).toBe(10);
    expect((await qaBroadcasts()) - before).toBe(10);
    // The throttled answers left no audit row.
    expect(await count(n, "audit_log where actor_team_id = $1 and action = 'rejected'", [answererId])).toBe(0);
    expect(await count(n, "audit_log where actor_team_id = $1 and entity = 'qa_answers'", [answererId])).toBe(10);

    // Another company's Product team answers its own question normally.
    const q2 = await n.ok(n.team(s[2]!.f_code), "post_question", s[1]!.company_id, "And yours?");
    await n.ok(n.team(s[1]!.p_code), "answer_question", q2.question_id, "Twelve towns so far.");
    // It is a rate, not a cap: once the minute is over the team answers again.
    await n.q("update rate_limits set window_start = now() - interval '61 seconds' where team_id = $1 and bucket = 'qa_answer'", [answererId]);
    await n.q("delete from rate_limits where team_id = $1 and bucket = 'actions'", [answererId]);
    await n.ok(n.team(answerer), "answer_question", q.question_id, "A real answer at last.");
  });
});

// ═════════════════════════════ SEC-6 ═════════════════════════════

describe("SEC-6: throttled calls write nothing; draft audit rows hold a digest", () => {
  const rejected = (n: Night, teamId: string) => count(n, "audit_log where actor_team_id = $1 and action = 'rejected'", [teamId]);

  test("SEC-6: 30 order attempts while trading is halted: 20 are logged as rejected, the 10 throttled ones write nothing", async () => {
    const { n, s } = await inReading();
    const fund = s[2]!.f_code;
    const fundId = n.teamId(fund);
    await n.q("delete from rate_limits where team_id = $1", [fundId]);
    await pinWindow(n, fundId, "orders");
    const base = await rejected(n, fundId);
    const results = [];
    for (let i = 0; i < 30; i++) results.push(await n.call(n.team(fund), "place_order", s[0]!.company_id, "BUY", 1));
    expect(results.slice(0, 20).every((r) => r.ok === false && r.code !== "RATE_LIMITED")).toBe(true);
    expect(results.slice(20).every((r) => r.ok === false && r.code === "RATE_LIMITED")).toBe(true);
    expect((await rejected(n, fundId)) - base).toBe(20); // 30 before the fix
  });

  test("SEC-6: a throttled question writes no audit row", async () => {
    const { n, s } = await inReading();
    const fund = s[2]!.f_code;
    const fundId = n.teamId(fund);
    await n.q("delete from rate_limits where team_id = $1", [fundId]);
    await pinWindow(n, fundId, "qa");
    await pinWindow(n, fundId, "actions");
    const base = await rejected(n, fundId);
    const results = [];
    for (let i = 0; i < 11; i++) results.push(await n.call(n.team(fund), "post_question", s[0]!.company_id, `Question ${i}?`));
    expect(results.slice(0, 10).every((r) => r.ok)).toBe(true);
    expect(results[10]).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect((await rejected(n, fundId)) - base).toBe(0);
  });

  test("SEC-6: refused draft saves count against the shared bucket: 60 are logged, the 61st is throttled and writes nothing", async () => {
    const { n, s } = await inReading(); // the pitch window has closed: every save is refused (and logged)
    const x = s[2]!;
    const teamId = n.teamId(x.p_code);
    await n.q("delete from rate_limits where team_id = $1", [teamId]);
    await pinWindow(n, teamId, "actions");
    const base = await rejected(n, teamId);
    const v = await draftVersion(n, x, "PITCH");
    const results = [];
    for (let i = 0; i < 61; i++) results.push(await n.call(n.team(x.p_code), "save_draft", "PITCH", pitchOf(x), v));
    expect(results.slice(0, 60).every((r) => r.ok === false && r.code === "DEADLINE_PASSED")).toBe(true);
    expect(results[60]).toMatchObject({ ok: false, code: "RATE_LIMITED" }); // never throttled before the fix
    expect((await rejected(n, teamId)) - base).toBe(60);
  });

  test("SEC-6: 61 saves of a 19,000-character draft: 60 are saved with ~200-byte audit rows (a digest), the 61st is throttled", async () => {
    const { n, s } = await inBuild();
    const x = s[0]!;
    const teamId = n.teamId(x.p_code);
    const draft = await n.one("select id from submission_drafts where squad_id = $1 and type = 'PITCH'", [x.id]);
    await n.q("delete from rate_limits where team_id = $1", [teamId]);
    await pinWindow(n, teamId, "actions");
    const lastAudit = (await n.one("select coalesce(max(id), 0) as id from audit_log")).id;

    let version = await draftVersion(n, x, "PITCH");
    const results = [];
    for (let i = 0; i < 61; i++) {
      const content = { ...pitchOf(x), problem: randomBytes(15_000).toString("base64").slice(0, 19_000) };
      const r = await n.call(n.team(x.p_code), "save_draft", "PITCH", content, version);
      results.push(r);
      if (r.ok) version = r.draft.version;
    }
    expect(results.slice(0, 60).every((r) => r.ok)).toBe(true);
    expect(results[60]).toMatchObject({ ok: false, code: "RATE_LIMITED" }); // all 61 (and more) were saved before the fix

    // 60 audit rows, all for the draft saves: the throttled call wrote none.
    const rows = await n.q(
      `select entity, entity_id, before -> 'content' as before_content, after -> 'content' as after_content,
              pg_column_size(before) + pg_column_size(after) as bytes
         from audit_log where id > $1 and actor_team_id = $2 order by id`, [lastAudit, teamId]);
    expect(rows).toHaveLength(60);
    for (const r of rows) {
      expect(r).toMatchObject({ entity: "submission_drafts", entity_id: draft.id });
      for (const c of [r.before_content, r.after_content]) {
        expect(Object.keys(c).sort()).toEqual(["chars", "md5"]);
        expect(c.md5).toMatch(/^[0-9a-f]{32}$/);
      }
      expect(r.after_content.chars).toBeGreaterThan(19_000);
      expect(r.bytes).toBeLessThan(2_000); // ~37,000 bytes per save before the fix
    }
    // The last row's digest is the stored draft's, and the draft text itself is nowhere in the audit log.
    const stored = await n.one(
      "select content ->> 'problem' as problem, md5(content::text) as md5, length(content::text) as chars from submission_drafts where id = $1",
      [draft.id]);
    expect(rows.at(-1)!.after_content).toEqual({ md5: stored.md5, chars: stored.chars });
    expect(await count(n, "audit_log where strpos(coalesce(before::text, '') || coalesce(after::text, ''), $1) > 0",
      [stored.problem.slice(0, 64)])).toBe(0);
  });
});

// ═════════════════════════════ SEC-7 / R9 ═════════════════════════════

describe("SEC-7 / R9: the lottery commitment is fixed once the event starts, and the seed must be strong", () => {
  test("SEC-7 / R9: replaceable in SETUP only; at the draw a swapped seed is refused and the published commitment is the one verified", async () => {
    const n = await fresh(3, null);
    const published = sha256Hex(SEED);
    // In SETUP the organiser may set it, and correct it.
    await n.org("set_seed_commitment", n.eventId, sha256Hex(sha256Hex("an earlier draft")));
    await n.org("set_seed_commitment", n.eventId, published);
    const commitment = async () => (await n.one("select seed_commitment from events where id = $1", [n.eventId])).seed_commitment;

    await n.advanceTo("CHECKIN");
    await expect(n.call(n.lead, "set_seed_commitment", n.eventId, sha256Hex("chosen-tonight")))
      .rejects.toThrow(/fixed once the event has started/);
    await n.advanceTo("SQUAD_DRAW");
    // The reviewer's swap at draw time: ok before the fix.
    await expect(n.call(n.lead, "set_seed_commitment", n.eventId, sha256Hex("chosen-tonight")))
      .rejects.toThrow(/fixed once the event has started/);
    expect(await commitment()).toBe(published);

    // A seed chosen tonight does not match the published commitment, weak or strong.
    await expect(n.call(n.lead, "run_lottery", n.eventId, "chosen-tonight", "4")).rejects.toThrow(/64 lower-case hex/);
    expect(await n.call(n.lead, "run_lottery", n.eventId, sha256Hex("chosen-tonight"), "4"))
      .toMatchObject({ ok: false, code: "COMMITMENT_MISMATCH" });
    expect((await n.one("select drawn_at from events where id = $1", [n.eventId])).drawn_at).toBeNull();

    await n.org("run_lottery", n.eventId, SEED, "4");
    const draw = await n.one("select payload from realtime.messages where topic = $1 and event = 'squad_draw'", [`event:${n.eventId}`]);
    expect(draw.payload).toMatchObject({ commitment: published, verified: true, dice: "4" });
    await expect(n.call(n.lead, "set_seed_commitment", n.eventId, published)).rejects.toThrow(/fixed once the event has started/);
  });

  test("SEC-7: a weak seed is refused even when its hash is the published commitment", async () => {
    const n = await fresh(3, sha256Hex("x")); // set_seed_commitment cannot tell a weak seed from its digest
    await n.advanceTo("SQUAD_DRAW");
    for (const seed of ["x", "4", SEED.slice(0, 63), SEED.toUpperCase(), `${SEED}0`, ` ${SEED}`]) {
      await expect(n.call(n.lead, "run_lottery", n.eventId, seed, "4"), seed).rejects.toThrow(/64 lower-case hex/);
    }
    expect((await n.one("select drawn_at from events where id = $1", [n.eventId])).drawn_at).toBeNull();
    expect(await count(n, "squads where event_id = $1", [n.eventId])).toBe(0);
  });
});

// ═════════════════════════════ SEC-8 / MONEY-1 / MONEY-3 ═════════════════════════════

async function request(n: Night, entries: unknown, reason = "Reverse a mistaken booking") {
  return n.call(n.lead, "request_correction", n.eventId, reason, JSON.stringify(entries));
}

async function correct(n: Night, entries: unknown[]) {
  const req = await n.org("request_correction", n.eventId, "Reverse a mistaken booking", JSON.stringify(entries));
  await n.ok(n.second, "decide_correction", req.correction_id, true, "Checked against the order log.");
  return req.correction_id as string;
}

describe("SEC-8: correction entries are validated when requested and again when approved", () => {
  test("SEC-8: malformed entries are refused when requested, and nothing is stored", async () => {
    const { n, s } = await trading();
    const other = await inReading(); // another event
    const fund = n.teamId(s[1]!.f_code);
    const c1 = s[0]!.company_id;
    const before = await count(n, "corrections where event_id = $1", [n.eventId]);
    const cases: [string, unknown, RegExp][] = [
      ["unknown lot (the reviewer's)", [{ team_id: fund, company_id: c1, lot: "NOT_A_LOT", share_delta: 5 }], /unknown lot NOT_A_LOT/],
      ["unknown key (the reviewer's)", [{ team_id: fund, company_id: c1, lot: "EXCHANGE", share_delta: 5, junk: "x" }], /only team_id, company_id, lot/],
      ["no entries", [], /1 to 50 entries/],
      ["51 entries", Array.from({ length: 51 }, () => ({ team_id: fund, cash_delta_cents: 1 })), /1 to 50 entries/],
      ["not an array", { team_id: fund, cash_delta_cents: 1 }, /1 to 50 entries/],
      ["an entry that is not an object", ["x"], /only team_id, company_id, lot/],
      ["no team", [{ cash_delta_cents: 100 }], /needs a team_id/],
      ["a team id that is not a uuid", [{ team_id: "F01", cash_delta_cents: 100 }], /needs a team_id/],
      ["a team of another event", [{ team_id: other.n.teamId(other.s[0]!.f_code), cash_delta_cents: 100 }], /not in this event/],
      ["cash as a string", [{ team_id: fund, cash_delta_cents: "100" }], /whole numbers/],
      ["cash null", [{ team_id: fund, cash_delta_cents: null }], /whole numbers/],
      ["fractional cash", [{ team_id: fund, cash_delta_cents: 100.5 }], /whole number up to/],
      ["fractional shares", [{ team_id: fund, company_id: c1, lot: "EXCHANGE", share_delta: 1.5 }], /whole number up to/],
      ["cash over $1,000,000", [{ team_id: fund, cash_delta_cents: 100_000_001 }], /whole number up to/],
      ["shares over 100,000", [{ team_id: fund, company_id: c1, lot: "EXCHANGE", share_delta: -100_001 }], /whole number up to/],
      ["nothing changes", [{ team_id: fund, cash_delta_cents: 0, share_delta: 0 }], /changes cash or shares/],
      ["a company id that is not a uuid", [{ team_id: fund, company_id: "TKA", lot: "EXCHANGE", share_delta: 5 }], /not a company id/],
      ["a company of another event", [{ team_id: fund, company_id: other.s[0]!.company_id, lot: "EXCHANGE", share_delta: 5 }], /not in this event/],
      ["shares without a lot", [{ team_id: fund, company_id: c1, share_delta: 5 }], /needs a company of this event and a lot/],
      ["shares without a company", [{ team_id: fund, lot: "EXCHANGE", share_delta: 5 }], /needs a company of this event and a lot/],
      ["a FEE lot for a fund", [{ team_id: fund, company_id: c1, lot: "FEE", share_delta: 5 }], /FEE lot cannot belong/],
      ["a RETAINED lot for another company's Product team", [{ team_id: n.teamId(s[1]!.p_code), company_id: c1, lot: "RETAINED", share_delta: 5 }], /RETAINED lot cannot belong/],
      ["a SHORT lot for a consultant", [{ team_id: n.teamId(s[1]!.c_code), company_id: c1, lot: "SHORT", share_delta: 5 }], /SHORT lot cannot belong/],
      ["one bad entry among good ones", [{ team_id: fund, cash_delta_cents: 1 }, { team_id: fund, company_id: c1, lot: "short", share_delta: 5 }], /unknown lot short/],
    ];
    for (const [what, entries, error] of cases) {
      await expect(request(n, entries), what).rejects.toThrow(error);
    }
    expect(await count(n, "corrections where event_id = $1", [n.eventId])).toBe(before);
  });

  test("SEC-8: a share entry with \"lot\": null is refused when requested", async () => {
    const { n, s } = await trading();
    const entries = [{ team_id: n.teamId(s[3]!.f_code), company_id: s[0]!.company_id, lot: null, share_delta: 5 }];
    const r = await request(n, entries).then((ok) => ({ ok, err: undefined }), (e) => ({ ok: undefined, err: String(e.message) }));
    let approval = "";
    if (r.ok) {
      // Accepted today: the approval then raises 'null value in column "lot" of relation "holdings" violates not-null
      // constraint' (nothing is applied), and the request stays PENDING until someone rejects it. Before the fix the
      // request itself was refused ('a share correction needs a company of this event and a lot'). Reject it so later
      // tests start clean.
      approval = await n.call(n.second, "decide_correction", r.ok.correction_id, true, "ok").then(
        (x) => `approval returned ${JSON.stringify(x)}`, (e) => `approval raised: ${e.message}`);
      await n.call(n.second, "decide_correction", r.ok.correction_id, false, "Malformed entry.").catch(() => {});
    }
    // PLAN §6 #47: "a lot that fits the team". Expected: refused at request time, like an unknown lot. A fix in
    // app.correction_problem: treat `e ->> 'lot' is null` like a missing lot (and refuse a null lot outright).
    expect({ request: r.ok ? "accepted" : "refused", error: r.err, approval })
      .toEqual({ request: "refused", error: expect.stringMatching(/lot/), approval: "" });
  });

  test("SEC-8 / MONEY-1: a SHORT share correction is refused once the market has closed, when requested and when approved", async () => {
    const { n, s } = await trading();
    const entries = [{ team_id: n.teamId(s[1]!.f_code), company_id: s[0]!.company_id, lot: "SHORT", share_delta: 100 }];
    const close = "update events set market_closed_at = now() where id = $1";
    await expect(inTxAs(close, [n.eventId], n.lead, (c) =>
      c.query("select public.request_correction($1, $2, $3)", [n.eventId, "Restore a short lost to a bug", JSON.stringify(entries)])))
      .rejects.toThrow(/shorts were covered at the close/);
    // Requested while the market is open, approved after the close: checked again against the state at approval.
    const req = await n.org("request_correction", n.eventId, "Restore a short lost to a bug", JSON.stringify(entries));
    await expect(inTxAs(close, [n.eventId], n.second, (c) =>
      c.query("select public.decide_correction($1, true, 'ok')", [req.correction_id])))
      .rejects.toThrow(/shorts were covered at the close/);
    await n.ok(n.second, "decide_correction", req.correction_id, false, "Not needed after all.");
    expect((await n.one("select status from corrections where id = $1", [req.correction_id])).status).toBe("REJECTED");
  });
});

describe("MONEY-1: a SHORT-lot correction follows the ledger convention and keeps the books whole", () => {
  test("MONEY-1: +100 then −100 on a 1,000 short: the holding, ledger, inventory and collateral move together; invariants hold", async () => {
    const { n, s } = await trading();
    const fund = n.teamId(s[1]!.f_code);
    const c1 = s[0]!.company_id;
    const shortQty = async () => (await n.one("select qty from holdings where team_id = $1 and company_id = $2 and lot = 'SHORT'", [fund, c1])).qty;
    const collateral = async () => Number((await n.one("select collateral_cents from teams where id = $1", [fund])).collateral_cents);
    const inventory = async () => (await n.one("select exchange_inventory from companies where id = $1", [c1])).exchange_inventory;
    const px = (await n.one("select market_price from companies where id = $1", [c1])).market_price;
    expect(await shortQty()).toBe(1000);
    expect(await collateral()).toBe(shortCollateral(1000, px));
    const inv0 = await inventory();

    // The reviewer's correction: share_delta is the change in the lot, so 100 more shares short.
    const id = await correct(n, [{ team_id: fund, company_id: c1, lot: "SHORT", share_delta: 100 }]);
    expect(await shortQty()).toBe(1100); // before the fix: 1100 with a ledger saying 900
    expect(await inventory()).toBe(inv0 + 100); // short sales deliver shares to the exchange (before the fix: −100)
    expect(await n.q("select team_id, lot, share_delta from ledger_entries where ref_id = $1 order by team_id nulls last", [id]))
      .toEqual([{ team_id: fund, lot: "SHORT", share_delta: -100 }, { team_id: null, lot: null, share_delta: 100 }]);
    expect(await collateral()).toBe(shortCollateral(1100, px)); // before the fix: unchanged
    await n.checkInvariants(); // before the fix: holdings ≠ −Σ ledger and 99,800 shares

    await correct(n, [{ team_id: fund, company_id: c1, lot: "SHORT", share_delta: -100 }]);
    expect(await shortQty()).toBe(1000);
    expect(await inventory()).toBe(inv0);
    expect(await collateral()).toBe(shortCollateral(1000, px));
    await n.checkInvariants();
  });

  test("MONEY-1: a short corrected away entirely releases its collateral; a correction cannot take a short below zero", async () => {
    const { n, s } = await trading();
    const fund = n.teamId(s[3]!.f_code); // no short yet
    const c1 = s[0]!.company_id;
    const px = (await n.one("select market_price from companies where id = $1", [c1])).market_price;
    await correct(n, [{ team_id: fund, company_id: c1, lot: "SHORT", share_delta: 50 }]);
    expect(Number((await n.one("select collateral_cents from teams where id = $1", [fund])).collateral_cents)).toBe(shortCollateral(50, px));
    await n.checkInvariants();
    const req = await request(n, [{ team_id: fund, company_id: c1, lot: "SHORT", share_delta: -60 }]);
    await expect(n.call(n.second, "decide_correction", req.correction_id, true, "ok")).rejects.toThrow(/qty|check/);
    await n.ok(n.second, "decide_correction", req.correction_id, false, "Too many.");
    await correct(n, [{ team_id: fund, company_id: c1, lot: "SHORT", share_delta: -50 }]);
    expect(Number((await n.one("select collateral_cents from teams where id = $1", [fund])).collateral_cents)).toBe(0);
    await n.checkInvariants();
  });
});

describe("MONEY-3: a correction cannot strand a pending SELL or COVER", () => {
  test("MONEY-3: taking shares a pending SELL or COVER needs is refused; the other direction is fine; the round clears", async () => {
    const { n, s } = await trading();
    const c1 = s[0]!.company_id;
    const seller = s[2]!.f_code; // 500 shares from the IPO
    const shorter = s[1]!.f_code; // short 1,000
    const sellerId = n.teamId(seller);
    const shorterId = n.teamId(shorter);
    expect((await n.one("select qty from holdings where team_id = $1 and company_id = $2 and lot = 'EXCHANGE'", [sellerId, c1])).qty).toBe(500);

    await n.openRound(2);
    await n.ok(n.team(seller), "place_order", c1, "SELL", 500);
    await n.ok(n.team(shorter), "place_order", c1, "COVER", 1000);

    // The reviewer's correction: −10 on the seller's exchange lot. Before the fix it was approved and then every
    // tick, close_round_now and advance_phase raised 'a fund sells or covers more than it holds'.
    const sell = await request(n, [{ team_id: sellerId, company_id: c1, lot: "EXCHANGE", share_delta: -10 }]);
    await expect(n.call(n.second, "decide_correction", sell.correction_id, true, "ok")).rejects.toThrow(/pending sell or cover/i);
    // The same for a cover: 10 fewer shares short than the pending COVER 1,000.
    const cover = await request(n, [{ team_id: shorterId, company_id: c1, lot: "SHORT", share_delta: -10 }]);
    await expect(n.call(n.second, "decide_correction", cover.correction_id, true, "ok")).rejects.toThrow(/pending sell or cover/i);
    // A cash correction alongside does not get through either: the whole correction is refused.
    const mixed = await request(n, [{ team_id: sellerId, cash_delta_cents: 1 }, { team_id: sellerId, company_id: c1, lot: "EXCHANGE", share_delta: -1 }]);
    await expect(n.call(n.second, "decide_correction", mixed.correction_id, true, "ok")).rejects.toThrow(/pending sell or cover/i);
    expect(await n.q("select status from corrections where id = any($1)", [[sell.correction_id, cover.correction_id, mixed.correction_id]]))
      .toEqual([{ status: "PENDING" }, { status: "PENDING" }, { status: "PENDING" }]);
    for (const id of [sell.correction_id, cover.correction_id, mixed.correction_id]) {
      await n.ok(n.second, "decide_correction", id, false, "The team must cancel its order first.");
    }

    // Corrections that leave the pending orders coverable go through.
    await correct(n, [{ team_id: sellerId, company_id: c1, lot: "EXCHANGE", share_delta: 10 }]);
    await correct(n, [{ team_id: shorterId, company_id: c1, lot: "SHORT", share_delta: 10 }]);
    await n.checkInvariants();

    await n.clearRound(2); // checked against the engine's clearRound
    expect((await n.one("select qty from holdings where team_id = $1 and company_id = $2 and lot = 'EXCHANGE'", [sellerId, c1])).qty).toBe(10);
    expect((await n.one("select qty from holdings where team_id = $1 and company_id = $2 and lot = 'SHORT'", [shorterId, c1])).qty).toBe(10);
    await n.checkInvariants();
  });
});

// ═════════════════════════════ R5 ═════════════════════════════

describe("R5: a disqualification follows the flags that are DISQUALIFIED now", () => {
  const disq = async (n: Night, ids: string[]) =>
    Object.fromEntries((await n.q("select id, disqualified, disqualified_reason from teams where id = any($1)", [ids]))
      .map((r) => [r.id, r.disqualified ? r.disqualified_reason : false]));
  const flag = async (n: Night, teams: string[]) =>
    (await n.one("insert into flags (event_id, kind, team_ids, details) values ($1, 2, $2, '{}') returning id", [n.eventId, teams])).id as string;

  test("R5: DISQUALIFIED then CLEARED re-enables the teams", async () => {
    const { n, s } = await inReading();
    const [f1, f2] = [n.teamId(s[0]!.f_code), n.teamId(s[1]!.f_code)];
    const x = await flag(n, [f1, f2]);
    await n.ok(n.fairness, "decide_flag", x, "DISQUALIFIED", "Identical order vectors.");
    expect(await disq(n, [f1, f2])).toEqual({ [f1]: "Identical order vectors.", [f2]: "Identical order vectors." });
    await n.ok(n.fairness, "decide_flag", x, "CLEARED", "Mis-click: coincidence, cleared");
    expect(await disq(n, [f1, f2])).toEqual({ [f1]: false, [f2]: false }); // stayed disqualified before the fix
    expect((await n.one("select status, reason from flags where id = $1", [x]))).toEqual({ status: "CLEARED", reason: "Mis-click: coincidence, cleared" });
  });

  test("R5: a team in two DISQUALIFIED flags stays disqualified until both are cleared", async () => {
    const { n, s } = await inReading();
    const [f1, f2, f3] = [n.teamId(s[0]!.f_code), n.teamId(s[1]!.f_code), n.teamId(s[2]!.f_code)];
    const a = await flag(n, [f1, f2]);
    const b = await flag(n, [f2, f3]);
    await n.ok(n.fairness, "decide_flag", a, "DISQUALIFIED", "Identical order vectors.");
    await n.ok(n.fairness, "decide_flag", b, "DISQUALIFIED", "Second pair, also identical.");
    expect(await disq(n, [f1, f2, f3])).toEqual({ [f1]: "Identical order vectors.", [f2]: "Second pair, also identical.", [f3]: "Second pair, also identical." });

    await n.ok(n.fairness, "decide_flag", a, "CLEARED", "Mis-click: coincidence, cleared");
    expect(await disq(n, [f1, f2, f3])).toEqual({ [f1]: false, [f2]: "Second pair, also identical.", [f3]: "Second pair, also identical." });
    // Re-deciding the other way restores it; clearing both clears everyone.
    await n.ok(n.fairness, "decide_flag", a, "DISQUALIFIED", "On review: identical after all.");
    expect(await disq(n, [f1, f2])).toEqual({ [f1]: "On review: identical after all.", [f2]: "On review: identical after all." });
    await n.ok(n.fairness, "decide_flag", b, "CLEARED", "Different reasons for the same trades.");
    expect(await disq(n, [f1, f2, f3])).toEqual({ [f1]: "On review: identical after all.", [f2]: "On review: identical after all.", [f3]: false });
    await n.ok(n.fairness, "decide_flag", a, "CLEARED", "Cleared on appeal.");
    expect(await disq(n, [f1, f2, f3])).toEqual({ [f1]: false, [f2]: false, [f3]: false });
  });

  test("R5: two CLEARED decisions at the same moment on overlapping flags re-enable the shared team", async () => {
    const { n, s } = await inReading();
    const [f1, f2, f3] = [n.teamId(s[0]!.f_code), n.teamId(s[1]!.f_code), n.teamId(s[2]!.f_code)];
    const a = await flag(n, [f1, f2]);
    const b = await flag(n, [f2, f3]);
    await n.ok(n.fairness, "decide_flag", a, "DISQUALIFIED", "Identical order vectors.");
    await n.ok(n.fairness, "decide_flag", b, "DISQUALIFIED", "Second pair, also identical.");
    try {
      // The fairness officer clears both flags from two tabs. The first decision is held open after its update.
      let signal!: () => void;
      const started = new Promise<void>((r) => (signal = r));
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const first = as(db.pool, n.fairness, async (c) => {
        const r = (await c.query("select public.decide_flag($1, 'CLEARED', 'Coincidence after all.') as r", [a])).rows[0].r;
        signal();
        await gate;
        return r;
      }, { commit: true });
      first.catch(() => signal());
      await started;
      const second = n.call(n.fairness, "decide_flag", b, "CLEARED", "Also a coincidence.");
      await waitForLockWaiterOr(second);
      release();
      expect(await first).toMatchObject({ ok: true });
      expect(await second).toMatchObject({ ok: true });
      expect(await n.q("select status from flags where id = any($1)", [[a, b]])).toEqual([{ status: "CLEARED" }, { status: "CLEARED" }]);
      // Both flags are CLEARED, so nobody may stay disqualified. Today f2 stays disqualified with flag a's reason: the
      // second decision's UPDATE of teams computed f2's reason from a snapshot in which flag a was still DISQUALIFIED,
      // waited on f2's row lock held by the first decision, and on the EvalPlanQual recheck kept that stale value.
      // A fix: serialise decisions per event before recomputing, e.g. lock the event row FOR NO KEY UPDATE at the
      // start of decide_flag (the waiting call's UPDATE then takes its snapshot after the first one committed).
      expect(await disq(n, [f1, f2, f3])).toEqual({ [f1]: false, [f2]: false, [f3]: false });
    } finally {
      // Recompute so later tests start from clean teams.
      await n.call(n.fairness, "decide_flag", b, "CLEARED", "Also a coincidence.");
    }
  });
});
