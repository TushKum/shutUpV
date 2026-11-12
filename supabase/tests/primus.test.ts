// PRIMUS Rounds 2 and 3 (docs/PRIMUS.md), played through the real game functions: the phase flow
// IPO → PRESSURE → SATURATION → CLOSE, a crisis reveal with its −5% shock, the marketplace (offers, counters,
// capacity, escrow paid or refunded at the due time, ratings), response plans and advice memos judged and released
// (the plan moves the price, the advice pays the firm), then Round 3: the Finance injection, the draft (lowest
// score first, defaults for a team that does not pick), Round 3 hiring within the fee band, and saturation.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { planBonus, sha256Hex } from "@msim/engine";
import { Night } from "./night";
import { as } from "./helpers";
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
    // The dealt cards are public in Round 2 (the event never reaches the classic CRISIS phase).
    const cardsSeen = await as(db.pool, n.team(b.f_code), async (cl) =>
      (await cl.query("select x.k, c.title from subround_crises x join crisis_cards c on c.id = x.crisis_card_id")).rows);
    expect(cardsSeen).toHaveLength(3);
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

    // ── The firm's profile carries an "about" text; the hire chat is one on one per company–firm pair: A and X read
    // their thread, B (X's other client) reads only its own, and teams that hired no one cannot post or read.
    await n.ok(firmCaller, "save_firm_profile", "Supply chains", ["operations"], "From $500", 0, "We fixed ten supply chains.");
    expect(await n.one("select about from firm_profiles where team_id = $1", [firm])).toEqual({ about: "We fixed ten supply chains." });
    expect(await n.call(n.team(c.p_code), "post_hire_message", c.company_id, firm, "hi")).toMatchObject({ ok: false, code: "NOT_HIRED" });
    expect(await n.call(n.team(b.p_code), "post_hire_message", a.company_id, firm, "hi")).toMatchObject({ ok: false, code: "NOT_HIRED" });
    expect(await n.call(n.team(a.p_code), "post_hire_message", a.company_id, firm, "   ")).toMatchObject({ ok: false, code: "BAD_LENGTH" });
    await n.ok(n.team(a.p_code), "post_hire_message", a.company_id, firm, "  Can you start now?  ");
    await n.ok(firmCaller, "post_hire_message", a.company_id, firm, "Yes, send us the numbers.");
    await n.ok(firmCaller, "post_hire_message", b.company_id, firm, "Hello B.");
    const hireLog = async (caller: ReturnType<typeof n.team>) =>
      as(db.pool, caller, async (cl) => (await cl.query("select body from hire_messages order by id")).rows.map((r) => r.body));
    expect(await hireLog(n.team(a.p_code))).toEqual(["Can you start now?", "Yes, send us the numbers."]);
    expect(await hireLog(firmCaller)).toEqual(["Can you start now?", "Yes, send us the numbers.", "Hello B."]);
    expect(await hireLog(n.team(b.p_code))).toEqual(["Hello B."]);
    expect(await hireLog(n.team(c.c_code))).toEqual([]);
    expect(await hireLog(n.team(a.f_code))).toEqual([]);

    // ── Work: A's plan and X's memo for A; nothing for B (its escrow is refunded); C writes a plan with no firm.
    await n.ok(n.team(a.p_code), "save_draft", "CRISIS_1", crisisPlan, 0);
    await n.ok(n.team(a.p_code), "submit_submission", "CRISIS_1");
    await n.ok(n.team(c.p_code), "save_draft", "CRISIS_1", crisisPlan, 0);
    await n.ok(n.team(c.p_code), "submit_submission", "CRISIS_1");
    expect(await n.call(n.team(c.c_code), "save_draft_for", a.company_id, "ADVICE_1", advice, 0)).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    expect(await n.call(n.team(a.p_code), "save_draft", "ADVICE_1", advice, 0)).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    await n.ok(firmCaller, "save_draft_for", a.company_id, "ADVICE_1", advice, 0);
    await n.ok(firmCaller, "submit_for", a.company_id, "ADVICE_1");

    // ── A hired firm reads its client's drafts for the sub-round (B is in another squad); a firm not hired does not.
    await n.ok(n.team(b.p_code), "save_draft", "CRISIS_1", crisisPlan, 0);
    const draftsOfB = (caller: ReturnType<typeof n.team>) =>
      as(db.pool, caller, async (cl) => (await cl.query("select type from submission_drafts where company_id = $1", [b.company_id])).rows);
    expect(await draftsOfB(firmCaller)).toEqual(expect.arrayContaining([{ type: "CRISIS_1" }]));
    expect(await draftsOfB(n.team(c.c_code))).toEqual([]);

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

    // The firm co-wrote the solution but sent no Round 3 memo: its fee went back to the client.
    expect((await n.one("select escrow from engagements where company_id = $1 and k = 5", [c.company_id])).escrow).toBe("REFUNDED");

    await n.advanceTo("CLOSE");
    await n.checkInvariants();
  });

  test("Round 3 without statements waits for them; too little room is refused; the draft's deadline fits every company", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    const seed = sha256Hex("primus-late");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, seed, "3");
    await n.advanceTo("BUILD");
    await n.deadlinePassed("PITCH");
    await n.advanceTo("READING");
    await n.org("seal_missing_scores", n.eventId, "PITCH");
    await n.deadlinePassed("CALL_1");
    await n.org("release_scores", n.eventId, "PITCH");
    await n.advanceTo("IPO");
    await n.advanceTo("PRESSURE");
    // Entering Round 3 with no statements: the injection is paid, but no draft starts.
    await n.advanceTo("SATURATION");
    expect((await n.one("select count(*)::int as c from draft_picks where event_id = $1", [n.eventId])).c).toBe(0);
    expect((await n.one("select count(*)::int as c from ledger_entries where event_id = $1 and kind = 'INJECTION' and team_id is not null", [n.eventId])).c).toBe(3);
    // Room for 2 companies only: refused with the numbers.
    expect(await n.call(n.lead, "set_problem_statements", n.eventId, JSON.stringify([{ number: 1, title: "A", body: "a", cap: 2 }]))).toMatchObject({
      ok: false,
      code: "NOT_ENOUGH_ROOM",
    });
    // The draft's planned end is too early for three picks of 20 seconds: it moves later when the draft starts.
    await n.q("update deadlines set at = now() + interval '10 seconds' where event_id = $1 and code = 'DRAFT'", [n.eventId]);
    const up = await n.ok(n.lead, "set_problem_statements", n.eventId, JSON.stringify([{ number: 1, title: "A", body: "a", cap: 2 }, { number: 2, title: "B", body: "b" }]));
    expect(up.draft_started).toBe(true);
    expect((await n.one("select count(*)::int as c from draft_picks where event_id = $1", [n.eventId])).c).toBe(3);
    const t = await n.one("select extract(epoch from (select at from deadlines where event_id = $1 and code = 'DRAFT') - now())::int as draft, extract(epoch from (select at from deadlines where event_id = $1 and code = 'HIRE_5') - (select at from deadlines where event_id = $1 and code = 'DRAFT'))::int as gap", [n.eventId]);
    expect(t.draft).toBeGreaterThanOrEqual(75);
    expect(t.gap).toBeGreaterThanOrEqual(600);
    // Still replaceable until the first pick; then fixed.
    await n.ok(n.lead, "set_problem_statements", n.eventId, JSON.stringify([{ number: 1, title: "A2", body: "a" }]));
    const first = await n.one("select c.product_team_id, t.code from draft_picks d join companies c on c.id = d.company_id join teams t on t.id = c.product_team_id where d.event_id = $1 and d.pick_no = 1", [n.eventId]);
    const st = await n.one("select id from problem_statements where event_id = $1", [n.eventId]);
    await n.ok(n.team(first.code), "pick_statement", st.id);
    expect(await n.call(n.lead, "set_problem_statements", n.eventId, JSON.stringify([{ number: 1, title: "C", body: "c" }]))).toMatchObject({ ok: false, code: "DRAFT_STARTED" });
  });
  test("a full-size night: 50 companies through a crisis, hiring, the draft and the close", async () => {
    const N = 50;
    const n = await Night.create(db.pool, N, "PRIMUS");
    const seed = sha256Hex("primus-full");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, seed, "5");
    const squads = [];
    for (let i = 1; i <= N; i++) squads.push(await n.squad(i));
    await n.advanceTo("BUILD");
    for (const [i, s] of squads.entries()) {
      const t = `Q${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`;
      await n.ok(n.team(s.p_code), "save_draft", "PITCH", { company_name: `Full Co ${i}`, ticker: t, problem: "A real problem." }, 0);
      await n.ok(n.team(s.p_code), "submit_submission", "PITCH");
    }
    await n.deadlinePassed("PITCH");
    await n.advanceTo("READING");
    for (const [i, s] of squads.entries()) await n.judge(s.company_id, "PITCH", [40 + i, 40 + i, 40 + i]);
    await n.deadlinePassed("CALL_1");
    await n.org("release_scores", n.eventId, "PITCH");
    await n.advanceTo("IPO");
    await n.advanceTo("PRESSURE");
    await n.deadlinePassed("REVEAL_1");
    await n.ok(n.lead, "tick", n.eventId);
    expect((await n.one("select count(*)::int as c from subround_crises where event_id = $1 and k = 1", [n.eventId])).c).toBe(N);

    // Every company hires its squad's firm; each firm also gets a second offer it must refuse as full after two.
    for (const s of squads) {
      const o = (await n.ok(n.team(s.p_code), "make_offer", n.teamId(s.c_code), 30000, 0, "")).offer;
      await n.ok(n.team(s.c_code), "respond_offer", o.id, "ACCEPT");
      await n.ok(n.team(s.p_code), "save_draft", "CRISIS_1", crisisPlan, 0);
      await n.ok(n.team(s.p_code), "submit_submission", "CRISIS_1");
      await n.ok(n.team(s.c_code), "save_draft_for", s.company_id, "ADVICE_1", advice, 0);
      await n.ok(n.team(s.c_code), "submit_for", s.company_id, "ADVICE_1");
    }
    expect((await n.one("select count(*)::int as c from engagements where event_id = $1 and k = 1", [n.eventId])).c).toBe(N);
    await n.deadlinePassed("HIRE_1");
    await n.deadlinePassed("DUE_1");
    await n.ok(n.lead, "tick", n.eventId);
    expect((await n.one("select count(*)::int as c from engagements where event_id = $1 and escrow = 'RELEASED'", [n.eventId])).c).toBe(N);
    await n.deadlinePassed("RATE_1");
    await n.ok(n.lead, "tick", n.eventId);
    for (const [i, s] of squads.entries()) {
      await n.judge(s.company_id, "CRISIS_1", [30 + i, 30 + i, 30 + i]);
      await n.judge(s.company_id, "ADVICE_1", [70, 70, 70]);
    }
    await n.org("release_scores", n.eventId, "CRISIS_1");
    await n.org("release_scores", n.eventId, "ADVICE_1");

    // Round 3: ten statements of five; the draft's deadline leaves every company its 20 seconds.
    await n.org("set_problem_statements", n.eventId, JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ number: i + 1, title: `Statement ${i + 1}`, body: "A problem." }))));
    await n.advanceTo("SATURATION");
    expect((await n.one("select count(*)::int as c from draft_picks where event_id = $1", [n.eventId])).c).toBe(N);
    const left = await n.one("select extract(epoch from (select at from deadlines where event_id = $1 and code = 'DRAFT') - now())::int as s", [n.eventId]);
    expect(left.s).toBeGreaterThanOrEqual(N * 20);
    // Nobody picks: once the draft's time is up, the heartbeat spreads the companies over the statements.
    await n.deadlinePassed("DRAFT");
    await n.ok(n.lead, "tick", n.eventId);
    const spread = await n.q("select count(*)::int as c from draft_picks where event_id = $1 group by statement_id", [n.eventId]);
    expect(spread).toHaveLength(10);
    expect(spread.every((r) => r.c === 5)).toBe(true);
    await n.deadlinePassed("HIRE_5");
    await n.deadlinePassed("DUE_5");
    await n.ok(n.lead, "tick", n.eventId);
    await n.org("seal_missing_scores", n.eventId, "SOLUTION");
    await n.q("update rounds set status = 'CLEARED' where event_id = $1 and phase = 'SATURATION' and waits_for is null", [n.eventId]);
    await n.org("release_scores", n.eventId, "SOLUTION");
    await n.advanceTo("CLOSE");
    await n.checkInvariants();
  }, 240_000);
  test("trading through Round 2 into Round 3: orders fill, a crisis's last round waits for its plan scores, leaving Round 2 clears it", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    const seed = sha256Hex("primus-trading");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, seed, "2");
    const [a, b, c] = [await n.squad(1), await n.squad(2), await n.squad(3)];
    await n.advanceTo("BUILD");
    for (const [i, s] of [a, b, c].entries()) {
      await n.ok(n.team(s.p_code), "save_draft", "PITCH", { company_name: `Trade Co ${i}`, ticker: ["TRA", "TRB", "TRC"][i], problem: "A real problem." }, 0);
      await n.ok(n.team(s.p_code), "submit_submission", "PITCH");
    }
    await n.deadlinePassed("PITCH");
    await n.advanceTo("READING");
    for (const s of [a, b, c]) await n.judge(s.company_id, "PITCH", [60, 60, 60]);
    await n.deadlinePassed("CALL_1");
    await n.org("release_scores", n.eventId, "PITCH");
    await n.advanceTo("IPO");
    await n.advanceTo("PRESSURE");
    await n.deadlinePassed("REVEAL_1");
    await n.ok(n.lead, "tick", n.eventId);

    // Round 1 of crisis 1: two funds buy squad 1's company; it clears and the price rises as the engine says.
    const before = (await n.prices())[a.company_id]!;
    await n.openRound(1);
    await n.orderNet(a.company_id, 3000, [b.f_code, c.f_code]);
    const cleared = await n.clearRound(1);
    expect(cleared.companies[a.company_id]!.newPrice).toBeGreaterThan(before);
    // The own squad's fund may not trade its company.
    await n.openRound(2);
    expect(await n.call(n.team(a.f_code), "place_order", a.company_id, "BUY", 100)).toMatchObject({ ok: false });
    for (const r of [2, 3, 4, 5]) {
      if (r > 2) await n.openRound(r);
      await n.clearRound(r);
    }

    // Round 6 is due but waits for the crisis 1 plan scores.
    await n.q("update rounds set opens_at = now() - interval '1 second', closes_at = now() + interval '1 hour' where event_id = $1 and number = 6", [n.eventId]);
    await n.ok(n.lead, "tick", n.eventId);
    expect((await n.one("select status, waits_for from rounds where event_id = $1 and number = 6", [n.eventId]))).toEqual({ status: "SCHEDULED", waits_for: "CRISIS_1" });
    await n.deadlinePassed("DUE_1");
    await n.org("seal_missing_scores", n.eventId, "CRISIS_1"); // no plan submitted: 0, the lowest tier
    await n.org("release_scores", n.eventId, "CRISIS_1");
    expect(await n.roundReaches(6, "OPEN")).toBe("OPEN");
    await n.clearRound(6);

    // Round 12 (crisis 2's last) is left waiting when Round 2 ends: leaving the phase clears every unfinished round,
    // so Round 3's first round opens.
    await n.org("set_problem_statements", n.eventId, JSON.stringify([{ number: 1, title: "A", body: "a" }]));
    await n.advanceTo("SATURATION");
    expect((await n.one("select count(*)::int as c from rounds where event_id = $1 and phase = 'PRESSURE' and status <> 'CLEARED'", [n.eventId])).c).toBe(0);
    const first3 = (await n.one("select min(number)::int as n from rounds where event_id = $1 and phase = 'SATURATION'", [n.eventId])).n;
    await n.openRound(first3);
    await n.orderNet(b.company_id, -1000, [c.f_code, a.f_code]);
    await n.clearRound(first3);
    await n.checkInvariants();
  }, 120_000);
});
