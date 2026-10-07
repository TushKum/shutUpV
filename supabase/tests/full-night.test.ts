// A full-size night: 150 teams (50 squads) played through every phase by bots, with every fund trading in every
// round. Each clearing is compared with the TypeScript engine (Night.clearRound), the ledger invariants are checked
// after each phase, the final values and rankings are recomputed with the engine, and every clearing tick is timed
// (the brief: clearing must finish in under 5 seconds). One round carries 10 orders from every fund (~500 orders).

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { dealPriceBand, largestPosition, rankTrack, sha256Hex, type Holding, type RankEntry } from "@msim/engine";
import { createTestDb } from "./pg";
import { rowsAs } from "./helpers";
import { Night } from "./night";

const SQUADS = 50;
const HEAVY_ROUND = 13;
const CLEARING_BUDGET_MS = 5000;

let db: Awaited<ReturnType<typeof createTestDb>>;
let n: Night;
let squads: any[] = [];
let companies: string[] = [];
const outcomes = { ok: 0, rejected: new Map<string, number>(), edits: 0, cancels: 0 };

// Deterministic bots: mulberry32.
let state = 20261008;
function rand(): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;

function tally(r: any) {
  if (r.ok) outcomes.ok++;
  else outcomes.rejected.set(r.code, (outcomes.rejected.get(r.code) ?? 0) + 1);
  return r;
}

/** Runs `fn` for every squad with up to 10 at a time (the pool size), so team actions really overlap. */
async function eachSquad(fn: (s: any, i: number) => Promise<void>) {
  await Promise.all(squads.map((s, i) => fn(s, i)));
}

async function seal(companyId: string, type: "PITCH" | "PLAN" | "FLASH", score: number) {
  return n.org("seal_score", companyId, type, [score - 1, score, score + 1], { total: score }, "Bot score.");
}

/** Every fund places `perFund` orders on random companies (never its own), editing or cancelling a few. */
async function botOrders(perFund: number) {
  const books = await n.fundBooks();
  await eachSquad(async (s) => {
    const fund = n.team(s.f_code);
    const book = books[n.teamId(s.f_code)]!;
    const pending: Record<string, { BUY: number; SELL: number; SHORT: number; COVER: number }> = {};
    // Now and then a fund tries its own squad's company: always refused and logged.
    if (rand() < 0.1) expect(tally(await n.call(fund, "place_order", s.company_id, "BUY", 10))).toMatchObject({ ok: false, code: "INSIDER" });
    for (let k = 0; k < perFund; k++) {
      const c = pick(companies.filter((id) => id !== s.company_id));
      const pos = book.positions[c] ?? { exchangeQty: 0, shortQty: 0 };
      const p = (pending[c] ??= { BUY: 0, SELL: 0, SHORT: 0, COVER: 0 });
      const canSell = pos.exchangeQty - p.SELL;
      const canCover = pos.shortQty - p.COVER;
      const roll = rand();
      let type: "BUY" | "SELL" | "SHORT" | "COVER";
      let qty: number;
      if (roll < 0.3 && canSell > 0) [type, qty] = ["SELL", between(1, canSell)];
      else if (roll < 0.45 && canCover > 0) [type, qty] = ["COVER", between(1, canCover)];
      else if (roll < 0.6) [type, qty] = ["SHORT", between(10, 400)];
      else [type, qty] = ["BUY", between(10, 700)];
      const r = tally(await n.call(fund, "place_order", c, type, qty));
      if (!r.ok) continue;
      p[type] += qty;
      const after = rand();
      if (after < 0.04) {
        if ((await n.call(fund, "cancel_order", r.order.id)).ok) {
          outcomes.cancels++;
          p[type] -= qty;
        }
      } else if (after < 0.08 && (type === "BUY" || type === "SHORT")) {
        const smaller = Math.max(1, Math.floor(qty / 2));
        if ((await n.call(fund, "edit_order", r.order.id, smaller)).ok) {
          outcomes.edits++;
          p[type] -= qty - smaller;
        }
      }
    }
  });
}

async function round(num: number, perFund = 4) {
  // Each round is three minutes on the night: the per-team order rate limit window has long reset.
  await n.q("delete from rate_limits where bucket = 'orders'");
  await n.openRound(num);
  await botOrders(perFund);
  await n.clearRound(num);
}

async function submit(s: any, type: "PLAN" | "FLASH") {
  const who = n.team(s.number % 2 ? s.p_code : s.c_code);
  const draft = await n.one("select version from submission_drafts where squad_id = $1 and type = $2", [s.id, type]);
  const content =
    type === "FLASH"
      ? { answer: `Squad ${s.number} stays profitable by licensing.` }
      : {
          crisis: "The supplier stopped deliveries.",
          new_plan: "License the software to councils.",
          money: "The rescue covers six months.",
          deal: "Shares at a fair discount.",
          time_to_recovery: "Nine months.",
          risks: "Partners may refuse.",
          next_steps: "Sign two partners.",
        };
  await n.ok(who, "save_draft", type, content, draft.version);
  return n.call(who, "submit_submission", type);
}

beforeAll(async () => {
  db = await createTestDb();
  n = await Night.create(db.pool, SQUADS);
}, 120_000);
afterAll(async () => {
  console.log(
    `full night: ${outcomes.ok} accepted actions, rejected ${JSON.stringify(Object.fromEntries(outcomes.rejected))}, ` +
      `${outcomes.edits} edits, ${outcomes.cancels} cancels`,
  );
  console.log(`clearing ticks (ms): ${n.clearings.map((c) => `r${c.round}:${c.orders}o/${Math.round(c.ms)}`).join(" ")}`);
  await db.drop();
});

describe("a full night with 150 teams", { timeout: 600_000 }, () => {
  test("the draw forms 50 squads; pitches, scores and the IPO", async () => {
    await n.advanceTo("SQUAD_DRAW");
    await n.org("set_seed_commitment", n.eventId, sha256Hex("full-night"));
    await n.org("run_lottery", n.eventId, "full-night", "3");
    squads = [];
    for (let i = 1; i <= SQUADS; i++) squads.push(await n.squad(i));
    companies = squads.map((s) => s.company_id);
    expect(new Set(squads.flatMap((s) => [s.p_code, s.c_code, s.f_code])).size).toBe(150);

    // Call 1: every consultant calls both of its companies.
    const coverage = await n.q("select consultant_team_id, company_id from coverage where event_id = $1", [n.eventId]);
    expect(coverage).toHaveLength(100);
    const codeOf = new Map(squads.map((s) => [n.teamId(s.c_code), s.c_code]));
    for (const c of coverage) tally(await n.call(n.team(codeOf.get(c.consultant_team_id)!), "make_call", c.company_id, 1, pick(["BUY", "SELL"])));

    await n.advanceTo("BUILD");
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXY";
    await eachSquad(async (s, i) => {
      const p = n.team(s.p_code);
      await n.ok(p, "save_draft", "PITCH", {
        company_name: `Company ${i + 1}`,
        ticker: `Q${letters[Math.floor(i / 25)]}${letters[i % 25]}`,
        problem: "Unsafe water in small towns.",
        solution: "Sensors in every tank.",
        customers: "Town councils.",
        business_model: "Yearly subscription.",
        advantage: "Cheaper than lab tests.",
        use_of_seed: "First 100 sensors.",
      }, 0);
      // Two squads never submit (their companies get a default ticker and the missing score).
      if (i >= 48) return;
      tally(await n.call(p, "submit_submission", "PITCH"));
    });
    await n.deadlinePassed("PITCH");
    await n.advanceTo("READING");
    for (const [i, s] of squads.entries()) if (i < 48) await seal(s.company_id, "PITCH", between(35, 90));
    await n.org("seal_missing_scores", n.eventId, "PITCH");
    await n.org("release_scores", n.eventId, "PITCH");
    const ipo = await n.q("select ipo_price from companies where event_id = $1 and squad_id is not null", [n.eventId]);
    expect(ipo).toHaveLength(SQUADS);
    expect(ipo.every((c) => c.ipo_price >= 900 && c.ipo_price <= 1100)).toBe(true);

    await n.advanceTo("IPO");
    await eachSquad(async (s) => {
      const targets = new Set<string>();
      while (targets.size < 5) targets.add(pick(companies.filter((id) => id !== s.company_id)));
      for (const c of targets) tally(await n.call(n.team(s.f_code), "place_ipo_bid", c, between(1, 40) * 50));
    });
    await n.advanceTo("ROUNDS_1_4");
    const allocated = await n.one("select count(*)::int as c from ipo_bids where event_id = $1 and qty_allocated > 0", [n.eventId]);
    expect(allocated.c).toBeGreaterThan(200);
    await n.checkInvariants();
  });

  test("rounds 1–4", async () => {
    for (const r of [1, 2, 3, 4]) await round(r);
    await n.checkInvariants();
  });

  test("crisis, fees (half agreed, half by default) and rounds 5–8", async () => {
    await n.advanceTo("CRISIS");
    const shocked = await n.q("select count(*)::int as c from companies where event_id = $1 and crisis_card_id is not null", [n.eventId]);
    expect(shocked[0].c).toBe(SQUADS);
    await eachSquad(async (s, i) => {
      if (i % 2) return;
      const proposal = tally(await n.call(n.team(s.c_code), "propose_fee", between(10, 25) * 100_000, between(0, 5) * 100));
      if (!proposal.ok) return;
      tally(await n.call(n.team(s.p_code), "confirm_fee", proposal.fee.version));
      tally(await n.call(n.team(s.c_code), "confirm_fee", proposal.fee.version));
    });
    await n.advanceTo("RESCUE_1");
    await round(5);
    await n.deadlinePassed("FEE");
    await n.ok(n.lead, "tick", n.eventId);
    const fees = await n.q("select is_default, executed_at from fees where event_id = $1", [n.eventId]);
    expect(fees).toHaveLength(SQUADS);
    expect(fees.every((f) => f.executed_at !== null)).toBe(true);
    expect(fees.filter((f) => f.is_default).length).toBeGreaterThanOrEqual(25);
    for (const r of [6, 7, 8]) await round(r);
    await n.checkInvariants();
  });

  test("deals (two thirds signed), plans and rounds 9–12", async () => {
    await n.advanceTo("RESCUE_2");
    await eachSquad(async (s, i) => {
      if (i % 3 === 2) return;
      const post = (await n.one("select post_crisis_price from companies where id = $1", [s.company_id])).post_crisis_price;
      const band = dealPriceBand(post);
      tally(await n.call(n.team(s.c_code), "edit_deal", null, between(band.min, band.max)));
      const cash = Number((await n.one("select cash_cents from teams where code = $1", [s.f_code])).cash_cents);
      const amount = Math.min(between(40, 80) * 100_000, Math.floor(cash / 100_000) * 100_000);
      const edited = tally(await n.call(n.team(s.f_code), "edit_deal", amount, null));
      if (!edited.ok) return;
      for (const code of [s.p_code, s.c_code, s.f_code]) tally(await n.call(n.team(code), "sign_deal", edited.deal.version));
    });
    const executed = await n.one("select count(*)::int as c from deals where event_id = $1 and executed_at is not null", [n.eventId]);
    expect(executed.c).toBeGreaterThan(25);
    for (const r of [9, 10, 11, 12]) await round(r);

    await eachSquad(async (s, i) => {
      if (i === 47) return; // one squad misses the plan deadline
      tally(await submit(s, "PLAN"));
    });
    await n.deadlinePassed("PLAN");
    await n.deadlinePassed("DEAL");
    await n.checkInvariants();
  });

  test("verdicts, flash news and rounds 13–21 (round 13 carries ~500 orders)", async () => {
    await n.advanceTo("PLANS_PUBLISHED");
    for (const [i, s] of squads.entries()) if (i !== 47) await seal(s.company_id, "PLAN", between(30, 95));
    await n.org("seal_missing_scores", n.eventId, "PLAN");
    await n.advanceTo("VERDICTS");
    await n.org("release_scores", n.eventId, "PLAN");
    await n.advanceTo("ROUNDS_13_21");
    const calls = await n.q("select distinct consultant_team_id, company_id from calls where event_id = $1", [n.eventId]);
    const codeOf = new Map(squads.map((s) => [n.teamId(s.c_code), s.c_code]));
    for (const c of calls) tally(await n.call(n.team(codeOf.get(c.consultant_team_id)!), "make_call", c.company_id, 2, pick(["BUY", "SELL"])));

    await round(HEAVY_ROUND, 10);
    for (const r of [14, 15]) await round(r);
    await n.org("publish_bulletin", n.eventId, "FLASH", "Interest rates rise", "Investors want profit within 12 months.");
    await eachSquad(async (s) => void tally(await submit(s, "FLASH")));
    await n.deadlinePassed("FLASH");
    for (const r of [16, 17]) await round(r);
    for (const s of squads) await seal(s.company_id, "FLASH", between(30, 95));
    await n.org("release_scores", n.eventId, "FLASH");
    for (const c of calls) tally(await n.call(n.team(codeOf.get(c.consultant_team_id)!), "make_call", c.company_id, 3, pick(["BUY", "SELL"])));
    for (const r of [18, 19, 20, 21]) await round(r);
    await n.checkInvariants();

    const heavy = n.clearings.find((c) => c.round === HEAVY_ROUND)!;
    expect(heavy.orders).toBeGreaterThan(400);
    for (const c of n.clearings) expect(c.ms, `clearing round ${c.round} (${c.orders} orders)`).toBeLessThan(CLEARING_BUDGET_MS);
  });

  test("close and settlement: the database's final values and ranks are the engine's", async () => {
    await n.advanceTo("CLOSE");
    expect((await n.one("select coalesce(sum(qty), 0)::int as q from holdings where event_id = $1 and lot = 'SHORT'", [n.eventId])).q).toBe(0);
    const started = performance.now();
    await n.advanceTo("SETTLEMENT");
    const settleMs = performance.now() - started;
    expect(settleMs).toBeLessThan(CLEARING_BUDGET_MS);
    await n.checkInvariants();

    const results = await n.q("select team_id, track, final_value_cents, rank, eligible from results where event_id = $1", [n.eventId]);
    expect(results).toHaveLength(150);
    const closing = Object.fromEntries(
      (await n.q("select id, closing_price from companies where event_id = $1 and squad_id is not null", [n.eventId])).map((c) => [c.id, c.closing_price as number]),
    );
    const cash = Object.fromEntries((await n.q("select id, cash_cents from teams where event_id = $1", [n.eventId])).map((t) => [t.id, Number(t.cash_cents)]));
    const lots = await n.q("select team_id, company_id, lot, qty from holdings where event_id = $1", [n.eventId]);
    const covered = await n.q(
      "select team_id, company_id, sum(share_delta)::int as qty from ledger_entries where event_id = $1 and kind = 'SHORT_CLOSE' group by team_id, company_id",
      [n.eventId],
    );
    const planScore = Object.fromEntries(
      (await n.q("select company_id, final_score from scores where event_id = $1 and type = 'PLAN'", [n.eventId])).map((s) => [s.company_id, s.final_score as number]),
    );

    const entries: RankEntry[] = [];
    for (const s of squads) {
      const p = n.teamId(s.p_code);
      const c = n.teamId(s.c_code);
      const f = n.teamId(s.f_code);
      const qty = (team: string, lot: string, company = s.company_id) =>
        lots.find((h) => h.team_id === team && h.company_id === company && h.lot === lot)?.qty ?? 0;
      entries.push({ teamId: p, track: "PRODUCT", finalValue: qty(p, "RETAINED") * closing[s.company_id]! + cash[p]!, eligible: true, planScore: planScore[s.company_id] ?? 0 });
      entries.push({ teamId: c, track: "CONSULTING", finalValue: cash[c]! + qty(c, "FEE") * closing[s.company_id]!, eligible: true, planScore: planScore[s.company_id] ?? 0 });
      const holdings: Holding[] = companies
        .map((id) => ({
          companyId: id,
          longQty: lots.filter((h) => h.team_id === f && h.company_id === id && (h.lot === "EXCHANGE" || h.lot === "SQUAD")).reduce((a, h) => a + h.qty, 0),
          shortQty: covered.find((x) => x.team_id === f && x.company_id === id)?.qty ?? 0,
        }))
        .filter((h) => h.longQty || h.shortQty);
      const longValue = holdings.reduce((a, h) => a + h.longQty * closing[h.companyId]!, 0);
      entries.push({ teamId: f, track: "FINANCE", finalValue: cash[f]! + longValue, eligible: true, largestPosition: largestPosition(holdings, closing) });
    }
    for (const track of ["PRODUCT", "CONSULTING", "FINANCE"] as const) {
      for (const e of rankTrack(entries.filter((x) => x.track === track))) {
        const got = results.find((r) => r.team_id === e.teamId)!;
        expect(Number(got.final_value_cents), `${track} value ${e.teamId}`).toBe(e.finalValue);
        expect(got.rank, `${track} rank ${e.teamId}`).toBe(e.rank);
      }
    }

    // Teams see nothing until AWARDS.
    const someTeam = n.team(squads[0].f_code);
    expect((await rowsAs(db.pool, someTeam, "select count(*)::int as c from results")).at(0)!.c).toBe(0);
  });

  test("appeals and awards", async () => {
    await n.advanceTo("APPEALS");
    for (const f of await n.q("select id from flags where event_id = $1 and status = 'OPEN'", [n.eventId])) {
      await n.ok(n.fairness, "decide_flag", f.id, "CLEARED", "Bot trading; independent.");
    }
    await n.advanceTo("AWARDS");
    const someTeam = n.team(squads[0].f_code);
    expect((await rowsAs(db.pool, someTeam, "select count(*)::int as c from results")).at(0)!.c).toBe(150);
    const codes = new Set((await rowsAs(db.pool, someTeam, "select code from awards")).map((a: any) => a.code));
    expect(codes).toEqual(new Set(["PRODUCT_TOP3", "CONSULTING_TOP3", "FINANCE_TOP3", "BEST_TURNAROUND", "BEST_RESCUE_PLAN", "BEST_JUDGING_FUND"]));
    expect(outcomes.ok).toBeGreaterThan(4000);
    // Every refused attempt is in the audit log, and the bots only ever hit the insider rule.
    expect([...outcomes.rejected.keys()]).toEqual(["INSIDER"]);
    const logged = await n.one("select count(*)::int as c from audit_log where event_id = $1 and action = 'rejected'", [n.eventId]);
    expect(logged.c).toBe(outcomes.rejected.get("INSIDER"));
  });
});
