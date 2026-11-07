// A practice night of 150 teams played by the rehearsal bots' own decisions (scripts/lib/bots.ts), against the real
// database: each bot reads what its team can see (as the team, through RLS) and calls the public game functions as
// the team; the clock is moved by editing the schedule; the judge worker (with the fake judge) judges every round.
// Every clearing is checked against the engine (Night.clearRound) and timed against the brief's target: each round
// settles in under 5 s. The real thing (`pnpm rehearse` against the deployed site, with sign-ins and realtime) is
// the organisers' rehearsal; this proves the bots and the game agree, at full size.

import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { decide, newMemory, remember, rng, type Action, type Memory, type Snapshot } from "../../scripts/lib/bots";
import { fakeJudge } from "../../apps/web/lib/judge/fake";
import { supabaseJudgeDb, type RpcClient } from "../../apps/web/lib/judge/db";
import { promptLoader } from "../../apps/web/lib/judge/prompts";
import { runWorker } from "../../apps/web/lib/judge/worker";
import { createTestDb } from "./pg";
import { as, rowsAs, service } from "./helpers";
import { Night, SEED } from "./night";

const TEAMS = 150;
const CLEARING_TARGET_MS = 5000;

let db: Awaited<ReturnType<typeof createTestDb>>;
let n: Night;
const memories = new Map<string, Memory>();
const randoms = new Map<string, () => number>();
const outcomes: Record<string, number> = {};

beforeAll(async () => {
  db = await createTestDb();
  n = await Night.create(db.pool, TEAMS);
  for (const code of n.codes) {
    memories.set(code, newMemory());
    randoms.set(code, rng(code));
  }
}, 120_000);
afterAll(async () => {
  await db.drop();
});

/** What the bot runner reads through the API, read here as the team through RLS. */
async function snapshot(code: string, index: number): Promise<Snapshot> {
  const me = n.team(code);
  const teamId = n.teamId(code);
  const status = await n.call(me, "event_status", n.eventId);
  const q = <R extends Record<string, unknown>>(sql: string, params: unknown[] = []) => rowsAs<R>(db.pool, me, sql, params);
  const [team, ev, companies, drafts, holdings, pending] = await Promise.all([
    q<{ cash_cents: string }>("select cash_cents from teams where id = $1", [teamId]),
    q<{ crisis_applied_at: string | null }>("select crisis_applied_at from events where id = $1", [n.eventId]),
    q<{ id: string; ticker: string | null; founder_team_id: string; rescuer_team_id: string | null; market_price: number | null }>(
      "select id, ticker, founder_team_id, rescuer_team_id, market_price from companies where event_id = $1",
      [n.eventId],
    ),
    q<{ type: "PRD" | "SOLUTION"; version: number }>("select type, version from drafts where team_id = $1", [teamId]),
    q<{ company_id: string; qty: number }>("select company_id, qty from holdings where team_id = $1", [teamId]),
    q<{ n: number }>("select count(*)::int as n from orders where team_id = $1 and status = 'PENDING'", [teamId]),
  ]);
  const s: Snapshot = {
    phase: status.phase,
    trading: status.trading,
    openRound: status.open_round?.number ?? null,
    paused: status.paused,
    team: { id: teamId, code, index, cash_cents: Number(team[0]!.cash_cents) },
    drawn: status.drawn,
    crisisApplied: !!ev[0]!.crisis_applied_at,
    drafts: { PRD: 0, SOLUTION: 0 },
    companies,
    holdings: Object.fromEntries(holdings.map((h) => [h.company_id, h.qty])),
    unanswered: [],
    asked: 0,
    pendingOrders: pending[0]!.n,
  };
  for (const d of drafts) s.drafts[d.type] = d.version;
  if (s.crisisApplied) {
    const built = companies.find((c) => c.founder_team_id === teamId)!;
    s.unanswered = (
      await q<{ id: string }>("select q.id from qa_questions q where q.company_id = $1 and not exists (select 1 from qa_answers a where a.question_id = q.id)", [built.id])
    ).map((r) => r.id);
    s.asked = (await q<{ n: number }>("select count(*)::int as n from qa_questions where asker_team_id = $1", [teamId]))[0]!.n;
  }
  return s;
}

/** One turn of every team, a few at a time (as 150 laptops would). */
async function turns() {
  const now = Date.now();
  const codes = n.codes;
  for (let i = 0; i < codes.length; i += 25) {
    await Promise.all(
      codes.slice(i, i + 25).map(async (code, j) => {
        const s = await snapshot(code, i + j);
        const m = memories.get(code)!;
        for (const a of decide(s, m, randoms.get(code)!, now, randomUUID)) {
          const r = await n.call(n.team(code), a.fn, ...Object.values(a.args));
          const key = `${a.fn}:${r?.ok ? "ok" : (r?.code ?? "?")}`;
          outcomes[key] = (outcomes[key] ?? 0) + 1;
          remember(m, a as Action, { ok: r?.ok === true, code: r?.code }, now, s);
        }
      }),
    );
  }
}

const shim: RpcClient = {
  async rpc(fn, args = {}) {
    try {
      const keys = Object.keys(args);
      const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`;
      const values = keys.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]));
      return { data: await as(db.pool, service, async (c) => (await c.query(sql, values)).rows[0].r, { commit: true }), error: null };
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
    }
  },
};

async function judge() {
  const s = await runWorker({
    db: supabaseJudgeDb(shim, n.eventId),
    judge: fakeJudge({ latencyMs: 0 }),
    budgetMs: 600_000,
    concurrency: 16,
    models: { PRD: { PRIMARY: "m", BACKUP: "m" }, SOLUTION: { PRIMARY: "m", BACKUP: "m" } },
    prompts: promptLoader(path.resolve(__dirname, "../../prompts")),
    eventId: n.eventId,
  });
  expect(s.failed).toBe(0);
  return s;
}

describe(`a practice night: ${TEAMS} bot teams`, () => {
  test("Round 1: every bot writes and revises its PRD; the lock; every score sealed; the starting prices", async () => {
    await n.advanceTo("BRIEFING");
    await n.org("run_lottery", n.eventId, SEED, "4");
    await n.advanceTo("BUILD");
    await turns(); // first drafts
    await turns(); // revisions
    expect(await n.q("select count(*)::int as n from drafts where event_id = $1 and type = 'PRD' and version = 2", [n.eventId])).toEqual([{ n: TEAMS }]);
    await n.deadlinePassed("TWIST");
    await n.ok(n.lead, "tick", n.eventId);
    await n.deadlinePassed("PRD_LOCK");
    await n.ok(n.lead, "tick", n.eventId);
    const s = await judge();
    expect(s.sealed).toBe(TEAMS);
    await n.advanceTo("REVEAL_1");
    const prices = await n.q("select count(distinct start_price)::int as n from companies where event_id = $1", [n.eventId]);
    expect(prices[0].n).toBeGreaterThan(5); // the fake judge gives a spread of scores
  }, 600_000);

  test("the crisis and Round 2: questions, answers, crisis solutions; every score sealed", async () => {
    await n.advanceTo("CRISIS_QA");
    await turns(); // questions (and the first solutions)
    await turns(); // answers
    expect(await n.q("select count(*)::int as n from qa_questions where event_id = $1", [n.eventId])).toEqual([{ n: TEAMS }]);
    expect(await n.q("select count(*)::int as n from qa_answers where event_id = $1", [n.eventId])).toEqual([{ n: TEAMS }]);
    await n.deadlinePassed("SOLUTION_LOCK");
    await n.ok(n.lead, "tick", n.eventId);
    expect((await judge()).sealed).toBe(TEAMS);
  }, 600_000);

  test(`Round 3: nine rounds of bot orders; every clearing matches the engine and settles in under ${CLEARING_TARGET_MS / 1000} s`, async () => {
    await n.advanceTo("MARKET_BLIND");
    for (let r = 1; r <= 9; r++) {
      if (r === 3) await n.advanceTo("MARKET"); // the 02:45 reveal
      await n.openRound(r);
      await turns();
      if (r === 7) {
        await n.deadlinePassed("LEADERBOARD_FREEZE");
        await n.ok(n.lead, "tick", n.eventId);
      }
      await n.clearRound(r);
      await n.checkInvariants();
    }
    const clearings = n.clearings.map((c) => ({ round: c.round, orders: c.orders, ms: Math.round(c.ms) }));
    console.log(`clearings: ${JSON.stringify(clearings)}`);
    console.log(`bot calls: ${JSON.stringify(outcomes)}`);
    expect(clearings.reduce((s, c) => s + c.orders, 0)).toBeGreaterThan(TEAMS * 9);
    for (const c of clearings) expect(c.ms, `round ${c.round}`).toBeLessThan(CLEARING_TARGET_MS);
    expect(Object.keys(outcomes).filter((k) => k.endsWith(":ERROR"))).toEqual([]);
  }, 900_000);

  test("the close, settlement and the awards", async () => {
    await n.advanceTo("SETTLEMENT");
    const flags = await n.q("select id from flags where event_id = $1 and status = 'OPEN'", [n.eventId]);
    for (const f of flags) await n.ok(n.fairness, "decide_flag", f.id, "CLEARED", "Practice night: reviewed.");
    await n.advanceTo("AWARDS");
    const board = await n.ok(n.team(n.codes[0]!), "leaderboard", n.eventId);
    expect(board.final).toBe(true);
    expect(board.rows).toHaveLength(TEAMS);
    expect((await n.q("select count(distinct code)::int as n from awards where event_id = $1", [n.eventId]))[0].n).toBe(7);
  }, 600_000);
});
