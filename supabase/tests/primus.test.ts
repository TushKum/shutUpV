// PRIMUS Rounds 2 and 3 (docs/PRIMUS.md), played through the real game functions: the phase flow
// IPO → PRESSURE → SATURATION → CLOSE, a crisis reveal with its −5% shock, the marketplace (offers, counters,
// capacity, escrow paid or refunded at the due time, ratings), response plans and advice memos judged and released
// (the plan moves the price, the advice pays the firm), then Round 3: the Finance injection, the draft (lowest
// score first, defaults for a team that does not pick), Round 3 hiring within the fee band, and saturation.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { planBonus, sha256Hex } from "@msim/engine";
import { Night } from "./night";
import { createTestDb } from "./pg";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

const crisisPlan = {
  impact: "The supplier left; half our orders are late.",
  response: "Sign a second supplier this week and cut the slowest product.",
  money: "Costs $40,000; protects $120,000 of monthly sales.",
  advice_used: "We take the firm's two-supplier advice.",
  time_to_recovery: "Six weeks.",
  risks: "Quality from the new supplier: test every batch.",
  next_steps: "CEO signs by Friday.",
};
const advice = {
  diagnosis: "One supplier is a single point of failure.",
  advice: "Sign a second supplier now; keep two weeks of stock.",
  evidence: "Late orders cost $30,000 a week.",
  fit: "Your margins allow 5% higher unit cost.",
};
const solution = {
  solution: "A shared booking app for clinics.",
  fit: "It answers the statement's waiting times.",
  differentiation: "Works offline.",
  plan: "Pilot in two clinics.",
  impact: "Cuts waits by half.",
  risks: "Adoption: train staff.",
};

describe("PRIMUS rounds 2 and 3", () => {
  test("crisis sub-round with hiring and escrow, then the draft and saturation", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    expect((await n.one("select format from events where id = $1", [n.eventId])).format).toBe("PRIMUS");
    const phases = (await n.q("select code from phases where event_id = $1 order by seq", [n.eventId])).map((r) => r.code);
    expect(phases.slice(phases.indexOf("IPO"))).toEqual(["IPO", "PRESSURE", "SATURATION", "CLOSE", "SETTLEMENT", "APPEALS", "AWARDS"]);

    const seed = sha256Hex("primus");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, seed, "3");
    const [a, b, c] = [await n.squad(1), await n.squad(2), await n.squad(3)];
    await n.advanceTo("BUILD");
    for (const [i, s] of [a, b, c].entries()) {
      await n.ok(n.team(s.p_code), "save_draft", "PITCH", { company_name: `Pri Co ${i}`, ticker: ["PRA", "PRB", "PRC"][i], problem: "A real problem." }, 0);
      await n.ok(n.team(s.p_code), "submit_submission", "PITCH");
    }
    await n.deadlinePassed("PITCH");
    await n.advanceTo("READING");
    for (const [i, s] of [a, b, c].entries()) await n.judge(s.company_id, "PITCH", [[40, 40, 40], [70, 70, 70], [60, 60, 60]][i]!);
    await n.deadlinePassed("CALL_1");
    await n.org("release_scores", n.eventId, "PITCH");
    await n.advanceTo("IPO");
    await n.advanceTo("PRESSURE");

    // ── Crisis 1 revealed: every company gets a card; prices fall 5%.
    const before = await n.prices();
    await n.deadlinePassed("REVEAL_1");
    await n.ok(n.lead, "tick", n.eventId);
    expect(await n.q("select count(*)::int as c from subround_crises where event_id = $1 and k = 1", [n.eventId])).toEqual([{ c: 3 }]);
    const after = await n.prices();
    for (const id of Object.keys(before)) expect(after[id]).toBe(Math.round(before[id]! * 0.95));
    await n.ok(n.lead, "tick", n.eventId); // once only
    expect(await n.prices()).toEqual(after);

    // ── Hiring: A offers firm X (squad a's consulting team); X counters; A accepts. B also hires X; C cannot (full).
    const firm = n.teamId(a.c_code);
    const firmCaller = n.team(a.c_code);
    await n.ok(firmCaller, "save_firm_profile", "Supply chains", ["operations", "suppliers"], "From $500", 0);
    expect(await n.call(n.team(a.f_code), "make_offer", firm, 50000, 0, "")).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    expect(await n.call(n.team(a.p_code), "make_offer", firm, 10_000_000_000, 0, "")).toMatchObject({ ok: false, code: "BAD_TERMS" });
    const offer = (await n.ok(n.team(a.p_code), "make_offer", firm, 50000, 0, "Help us")).offer;
    expect(await n.call(n.team(a.p_code), "respond_offer", offer.id, "ACCEPT")).toMatchObject({ ok: false, code: "NOT_YOUR_TURN" });
    await n.ok(firmCaller, "respond_offer", offer.id, "COUNTER", 80000, 100);
    const cashA = (await n.one("select cash_cents::bigint as c from teams where id = $1", [n.teamId(a.p_code)])).c;
    const accepted = await n.ok(n.team(a.p_code), "respond_offer", offer.id, "ACCEPT");
    expect(accepted.engagement).toMatchObject({ cash_cents: 80000, shares: 100, escrow: "HELD" });
    expect(BigInt((await n.one("select cash_cents::bigint as c from teams where id = $1", [n.teamId(a.p_code)])).c)).toBe(BigInt(cashA) - 80000n);
    const offerB = (await n.ok(n.team(b.p_code), "make_offer", firm, 30000, 0, "")).offer;
    await n.ok(firmCaller, "respond_offer", offerB.id, "ACCEPT");
    expect(await n.call(n.team(c.p_code), "make_offer", firm, 30000, 0, "")).toMatchObject({ ok: false, code: "FIRM_FULL" });
    expect(await n.call(n.team(a.p_code), "make_offer", n.teamId(c.c_code), 30000, 0, "")).toMatchObject({ ok: false, code: "ALREADY_HIRED" });

    // ── Work: A's plan and X's memo for A; nothing for B (its escrow is refunded); C writes a plan with no firm.
    await n.ok(n.team(a.p_code), "save_draft", "CRISIS_1", crisisPlan, 0);
    await n.ok(n.team(a.p_code), "submit_submission", "CRISIS_1");
    await n.ok(n.team(c.p_code), "save_draft", "CRISIS_1", crisisPlan, 0);
    await n.ok(n.team(c.p_code), "submit_submission", "CRISIS_1");
    expect(await n.call(n.team(c.c_code), "save_draft_for", a.company_id, "ADVICE_1", advice, 0)).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    expect(await n.call(n.team(a.p_code), "save_draft", "ADVICE_1", advice, 0)).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    await n.ok(firmCaller, "save_draft_for", a.company_id, "ADVICE_1", advice, 0);
    await n.ok(firmCaller, "submit_for", a.company_id, "ADVICE_1");

    // ── Due: escrow paid to the firm for A (cash and shares), refunded to B.
    const firmCash = BigInt((await n.one("select cash_cents::bigint as c from teams where id = $1", [firm])).c);
    const cashB = BigInt((await n.one("select cash_cents::bigint as c from teams where id = $1", [n.teamId(b.p_code)])).c);
    await n.deadlinePassed("HIRE_1");
    await n.deadlinePassed("DUE_1");
    await n.ok(n.lead, "tick", n.eventId);
    expect(await n.call(n.team(a.p_code), "save_draft", "CRISIS_1", crisisPlan, 1)).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
    expect(BigInt((await n.one("select cash_cents::bigint as c from teams where id = $1", [firm])).c)).toBe(firmCash + 80000n);
    expect(BigInt((await n.one("select cash_cents::bigint as c from teams where id = $1", [n.teamId(b.p_code)])).c)).toBe(cashB + 30000n);
    expect(await n.q("select qty from holdings where team_id = $1 and company_id = $2 and lot = 'FEE'", [firm, a.company_id])).toEqual([{ qty: 100 }]);
    expect((await n.q("select escrow from engagements where event_id = $1 order by escrow", [n.eventId])).map((r) => r.escrow)).toEqual(["REFUNDED", "RELEASED"]);

    // ── Ratings: A rates 5; B's missing rating counts as 3.
    await n.ok(n.team(a.p_code), "rate_firm", 1, 5);
    await n.deadlinePassed("RATE_1");
    await n.ok(n.lead, "tick", n.eventId);
    expect((await n.one("select rating, rating_default from engagements where company_id = $1", [b.company_id]))).toEqual({ rating: 3, rating_default: true });

    // ── Judging and release: the plan moves the price by the plan tier; the advice pays the firm.
    await n.judge(a.company_id, "CRISIS_1", [85, 85, 85]);
    await n.judge(c.company_id, "CRISIS_1", [45, 45, 45]);
    await n.org("seal_missing_scores", n.eventId, "CRISIS_1");
    const pre = await n.prices();
    await n.org("release_scores", n.eventId, "CRISIS_1");
    const post = await n.prices();
    expect(post[a.company_id]).toBe(Math.round(pre[a.company_id]! * 1.2));
    expect(post[c.company_id]).toBe(Math.round(pre[c.company_id]! * 0.9));
    expect(post[b.company_id]).toBe(Math.round(pre[b.company_id]! * 0.8)); // missing: 0 → −20%
    await n.judge(a.company_id, "ADVICE_1", [70, 70, 70]);
    await n.org("seal_missing_scores", n.eventId, "ADVICE_1");
    const cashBefore = BigInt((await n.one("select cash_cents::bigint as c from teams where id = $1", [firm])).c);
    await n.org("release_scores", n.eventId, "ADVICE_1");
    expect(BigInt((await n.one("select cash_cents::bigint as c from teams where id = $1", [firm])).c)).toBe(cashBefore + BigInt(planBonus(70) + 200000));
    const values = await n.call(n.team(c.f_code), "firm_values", n.eventId);
    expect(values).toBeDefined();

    // ── Round 3.
    await n.org("set_problem_statements", n.eventId, JSON.stringify([
      { number: 1, title: "Clinic waits", body: "Patients wait hours.", cap: 2 },
      { number: 2, title: "Farm credit", body: "Farmers lack credit." },
    ]));
    const fundCash = BigInt((await n.one("select cash_cents::bigint as c from teams where id = $1", [n.teamId(a.f_code)])).c);
    await n.advanceTo("SATURATION");
    const inj = await n.one("select sum(cash_delta_cents)::bigint as s from ledger_entries where team_id = $1 and kind = 'INJECTION'", [n.teamId(a.f_code)]);
    expect(BigInt(inj.s)).toBe(25_000_000n);
    expect(BigInt((await n.one("select cash_cents::bigint as c from teams where id = $1", [n.teamId(a.f_code)])).c)).toBe(fundCash + 25_000_000n);

    // Lowest score first: B (missing plan) before C before A.
    const order = (await n.q("select company_id from draft_picks where event_id = $1 order by pick_no", [n.eventId])).map((r) => r.company_id);
    expect(order).toEqual([b.company_id, c.company_id, a.company_id]);
    const st = Object.fromEntries((await n.q("select number, id from problem_statements where event_id = $1", [n.eventId])).map((r) => [r.number, r.id]));
    expect(await n.call(n.team(a.p_code), "pick_statement", st[1])).toMatchObject({ ok: false, code: "NOT_YOUR_TURN" });
    await n.ok(n.team(b.p_code), "pick_statement", st[1]);
    await n.ok(n.team(c.p_code), "pick_statement", st[1]);
    // A does not pick: when its time runs out it gets the least-crowded open statement (1 is full).
    await n.q("update draft_picks set closes_at = now() - interval '1 second' where company_id = $1", [a.company_id]);
    await n.ok(n.lead, "tick", n.eventId);
    expect(await n.one("select statement_id, by_default from draft_picks where company_id = $1", [a.company_id])).toEqual({ statement_id: st[2], by_default: true });

    // Round 3 hiring: the fee is 5–20% of the company's cash.
    await n.deadlinePassed("DRAFT");
    const cashC = BigInt((await n.one("select cash_cents::bigint as c from teams where id = $1", [n.teamId(c.p_code)])).c);
    expect(await n.call(n.team(c.p_code), "make_offer", n.teamId(c.c_code), Number(cashC / 100n), 0, "")).toMatchObject({ ok: false, code: "BAD_TERMS" });
    const o3 = (await n.ok(n.team(c.p_code), "make_offer", n.teamId(c.c_code), Number(cashC / 10n), 0, "")).offer;
    await n.ok(n.team(c.c_code), "respond_offer", o3.id, "ACCEPT");
    await n.ok(n.team(c.c_code), "save_draft_for", c.company_id, "SOLUTION", solution, 0);
    await n.ok(n.team(c.p_code), "submit_submission", "SOLUTION");
    await n.ok(n.team(b.p_code), "save_draft", "SOLUTION", solution, 0);
    await n.ok(n.team(b.p_code), "submit_submission", "SOLUTION");

    // Saturation: B and C share statement 1; C ranks first (full tier), B second (×0.75).
    await n.deadlinePassed("HIRE_5");
    await n.deadlinePassed("DUE_5");
    await n.ok(n.lead, "tick", n.eventId);
    await n.judge(c.company_id, "SOLUTION", [92, 92, 92]);
    await n.judge(b.company_id, "SOLUTION", [85, 85, 85]);
    await n.org("seal_missing_scores", n.eventId, "SOLUTION");
    await n.q("update rounds set status = 'CLEARED' where event_id = $1 and phase = 'SATURATION' and waits_for is null", [n.eventId]);
    const pre3 = await n.prices();
    await n.org("release_scores", n.eventId, "SOLUTION");
    const post3 = await n.prices();
    expect(post3[c.company_id]).toBe(Math.round(pre3[c.company_id]! * 1.25));
    expect(post3[b.company_id]).toBe(Math.round(pre3[b.company_id]! * 1.15));
    expect(post3[a.company_id]).toBe(Math.round(pre3[a.company_id]! * 0.8)); // alone on statement 2: full (negative) tier

    await n.advanceTo("CLOSE");
    await n.checkInvariants();
  });
});
