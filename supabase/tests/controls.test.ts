// Organiser controls and the smaller rules around order entry, Q&A, corrections and broadcasts.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sha256Hex } from "@msim/engine";
import { createTestDb } from "./pg";
import { rowsAs } from "./helpers";
import { Night } from "./night";

let db: Awaited<ReturnType<typeof createTestDb>>;
let n: Night;
let s1: any, s2: any, s3: any, s4: any;
let c1: string, c2: string;
const SEED = sha256Hex("controls-seed"); // 64 hex characters, as run_lottery requires

const at = async (table: string, where: string, params: unknown[] = []) =>
  (await n.one(`select * from ${table} where ${where}`, params));

beforeAll(async () => {
  db = await createTestDb();
  n = await Night.create(db.pool, 4);
  await n.org("set_seed_commitment", n.eventId, sha256Hex(SEED));
  await n.advanceTo("SQUAD_DRAW");
  await n.org("run_lottery", n.eventId, SEED, "2");
  [s1, s2, s3, s4] = [await n.squad(1), await n.squad(2), await n.squad(3), await n.squad(4)];
  await n.advanceTo("BUILD");
  for (const [i, s] of [s1, s2, s3, s4].entries()) {
    await n.ok(n.team(s.p_code), "save_draft", "PITCH", { company_name: `Co ${i}`, ticker: `TK${"ABCD"[i]}`, problem: "A real problem." }, 0);
    await n.ok(n.team(s.p_code), "submit_submission", "PITCH");
  }
  await n.deadlinePassed("PITCH");
  await n.advanceTo("READING");
  for (const s of [s1, s2, s3, s4]) expect(await n.judge(s.company_id, "PITCH", [60, 60, 60])).toMatchObject({ ok: true });
  await n.deadlinePassed("CALL_1");
  await n.org("release_scores", n.eventId, "PITCH");
  await n.advanceTo("IPO");
  await n.advanceTo("ROUNDS_1_4");
  c1 = s1.company_id;
  c2 = s2.company_id;
});
afterAll(async () => {
  await db.drop();
});

describe("order entry", () => {
  test("orders are refused outside an open round", async () => {
    expect(await n.call(n.team(s2.f_code), "place_order", c1, "BUY", 10)).toMatchObject({ ok: false, code: "TRADING_HALTED" });
  });

  test("edit and cancel until the round closes; never another team's order; client_ref makes placing idempotent", async () => {
    await n.openRound(1);
    const placed = await n.ok(n.team(s2.f_code), "place_order", c1, "BUY", 100, "tablet-1");
    const again = await n.ok(n.team(s2.f_code), "place_order", c1, "BUY", 100, "tablet-1");
    expect(again).toMatchObject({ duplicate: true });
    expect(again.order.id).toBe(placed.order.id);

    const edited = await n.ok(n.team(s2.f_code), "edit_order", placed.order.id, 4000);
    expect(edited.order).toMatchObject({ qty: 4000, reserve_cents: 4000 * 1050 * 110 / 100 });
    expect(await n.call(n.team(s2.f_code), "edit_order", placed.order.id, 4001)).toMatchObject({ ok: false, code: "LONG_LIMIT" });
    expect(await n.call(n.team(s3.f_code), "edit_order", placed.order.id, 10)).toMatchObject({ ok: false, code: "NOT_EDITABLE" });
    expect(await n.call(n.team(s3.f_code), "cancel_order", placed.order.id)).toMatchObject({ ok: false, code: "NOT_EDITABLE" });

    const second = await n.ok(n.team(s3.f_code), "place_order", c1, "BUY", 1);
    await n.ok(n.team(s3.f_code), "cancel_order", second.order.id);
    expect((await at("orders", "id = $1", [second.order.id])).status).toBe("CANCELLED");

    // After the closing time, edits and cancels are refused even before the round is cleared.
    await n.q("update rounds set closes_at = now() - interval '1 millisecond' where event_id = $1 and number = 1", [n.eventId]);
    expect(await n.call(n.team(s2.f_code), "edit_order", placed.order.id, 50)).toMatchObject({ ok: false, code: "TRADING_HALTED" });
    expect(await n.call(n.team(s2.f_code), "cancel_order", placed.order.id)).toMatchObject({ ok: false, code: "TRADING_HALTED" });
    expect(await n.call(n.team(s3.f_code), "place_order", c1, "BUY", 1)).toMatchObject({ ok: false, code: "TRADING_HALTED" });
    await n.clearRound(1);
    expect((await at("orders", "id = $1", [placed.order.id])).status).toBe("FILLED");
  });

  test("clearing is idempotent: running it again changes nothing", async () => {
    const before = await n.q("select id, cash_cents from teams where event_id = $1 order by id", [n.eventId]);
    const round = await at("rounds", "event_id = $1 and number = 1", [n.eventId]);
    const again = await n.one("select app.clear_round($1, true) as r", [round.id]);
    expect(again.r).toMatchObject({ ok: true, already: true });
    expect(await n.q("select id, cash_cents from teams where event_id = $1 order by id", [n.eventId])).toEqual(before);
    expect((await n.one("select count(*)::int as c from round_prices where round_id = $1", [round.id])).c).toBe(4);
  });

  test("order entry is rate-limited per team (20 actions per 10 seconds)", async () => {
    await n.openRound(2);
    const fund = n.team(s3.f_code);
    // Start from a fresh window: the earlier tests used some of this fund's allowance.
    await n.q("delete from rate_limits where team_id = $1", [n.teamId(s3.f_code)]);
    const results = [];
    for (let i = 0; i < 21; i++) results.push(await n.call(fund, "place_order", c1, "BUY", 1));
    expect(results.slice(0, 20).every((r) => r.ok)).toBe(true);
    expect(results[20]).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    // Another team is not affected.
    expect(await n.call(n.team(s4.f_code), "place_order", c1, "BUY", 1)).toMatchObject({ ok: true });
  });

  test("a collateral deficit blocks buys and new shorts but not sells or covers; nothing is liquidated", async () => {
    const fund = n.team(s4.f_code);
    await n.ok(fund, "place_order", c2, "SHORT", 1000);
    await n.clearRound(2);
    const t = await at("teams", "code = $1", [s4.f_code]);
    expect(Number(t.collateral_cents)).toBeGreaterThan(0);
    // Simulate a fund that has spent its cash (test-only edit).
    await n.q("update teams set cash_cents = collateral_cents - 1 where code = $1", [s4.f_code]);
    await n.openRound(3);
    expect(await n.call(fund, "place_order", c1, "BUY", 1)).toMatchObject({ ok: false, code: "COLLATERAL_DEFICIT" });
    expect(await n.call(fund, "place_order", c1, "SHORT", 1)).toMatchObject({ ok: false, code: "COLLATERAL_DEFICIT" });
    expect(await n.call(fund, "place_order", c2, "COVER", 100)).toMatchObject({ ok: true });
    expect((await at("holdings", "team_id = $1 and company_id = $2 and lot = 'SHORT'", [n.teamId(s4.f_code), c2])).qty).toBe(1000);
    // Restore the ledger-backed cash so the invariants still hold.
    await n.q("update teams t set cash_cents = (select sum(cash_delta_cents) from ledger_entries where team_id = t.id) where code = $1", [s4.f_code]);
    await n.clearRound(3);
    await n.checkInvariants();
  });
});

describe("phase control", () => {
  test("advance needs the phase the organiser sees, and only an organiser", async () => {
    expect(await n.call(n.lead, "advance_phase", n.eventId, "READING")).toMatchObject({ ok: false, code: "STALE" });
    await expect(n.call(n.team(s1.p_code), "advance_phase", n.eventId, "ROUNDS_1_4")).rejects.toThrow(/only an organiser/);
  });

  test("pause: orders are refused, deadlines after the pause began are frozen, and resume shifts everything ahead", async () => {
    await n.openRound(4);
    const round = await at("rounds", "event_id = $1 and number = 4", [n.eventId]);
    const fee = await at("deadlines", "event_id = $1 and code = 'FEE'", [n.eventId]);
    await n.org("pause_event", n.eventId);
    expect(await n.call(n.lead, "pause_event", n.eventId)).toMatchObject({ ok: false, code: "ALREADY_PAUSED" });
    expect(await n.call(n.team(s2.f_code), "place_order", c1, "BUY", 1)).toMatchObject({ ok: false, code: "TRADING_PAUSED" });
    expect((await n.one("select app.trading_state($1) as s", [n.eventId])).s).toBe("PAUSED");
    // A deadline that falls inside the pause has not passed.
    await n.q("update deadlines set at = now() - interval '1 second' where event_id = $1 and code = 'CALL_1'", [n.eventId]);
    await n.q("update events set paused_at = now() - interval '10 minutes' where id = $1", [n.eventId]);
    expect((await n.one("select app.deadline_passed($1, 'CALL_1') as p", [n.eventId])).p).toBe(false);
    // The tick does nothing while paused.
    expect(await n.ok(n.lead, "tick", n.eventId)).toMatchObject({ paused: true });

    await n.org("resume_event", n.eventId);
    const r2 = await at("rounds", "id = $1", [round.id]);
    const shifted = (new Date(r2.closes_at).getTime() - new Date(round.closes_at).getTime()) / 60_000;
    expect(shifted).toBeGreaterThan(9.9);
    expect(shifted).toBeLessThan(10.2);
    const fee2 = await at("deadlines", "event_id = $1 and code = 'FEE'", [n.eventId]);
    expect((new Date(fee2.at).getTime() - new Date(fee.at).getTime()) / 60_000).toBeGreaterThan(9.9);
    expect(await n.call(n.team(s1.f_code), "place_order", c2, "BUY", 1)).toMatchObject({ ok: true });
  });

  test("extend: the current round and everything after it move later", async () => {
    const r4 = await at("rounds", "event_id = $1 and number = 4", [n.eventId]);
    const r5 = await at("rounds", "event_id = $1 and number = 5", [n.eventId]);
    const r1 = await at("rounds", "event_id = $1 and number = 1", [n.eventId]);
    await n.org("extend_event", n.eventId, 5);
    expect((new Date((await at("rounds", "id = $1", [r4.id])).closes_at).getTime() - new Date(r4.closes_at).getTime()) / 60_000).toBeCloseTo(5);
    expect((new Date((await at("rounds", "id = $1", [r5.id])).opens_at).getTime() - new Date(r5.opens_at).getTime()) / 60_000).toBeCloseTo(5);
    expect((await at("rounds", "id = $1", [r1.id])).closes_at).toEqual(r1.closes_at); // the past does not move
    await expect(n.call(n.lead, "extend_event", n.eventId, 0)).rejects.toThrow(/1 to 120/);
    await n.clearRound(4);
  });

  test("auto-advance follows the schedule but waits at a gate", async () => {
    await n.org("set_auto_advance", n.eventId, true);
    await n.q("update phases set starts_at = now() - interval '1 hour', ends_at = now() - interval '1 second' where event_id = $1 and code = 'ROUNDS_1_4'", [n.eventId]);
    await n.q("update phases set starts_at = now() - interval '1 second', ends_at = now() + interval '1 hour' where event_id = $1 and code = 'CRISIS'", [n.eventId]);
    const t = await n.ok(n.lead, "tick", n.eventId);
    expect(t.actions).toContain("advanced to CRISIS");
    expect(await n.phase()).toBe("CRISIS");
    // A late start shifts the rest of the schedule so phases keep their length.
    await n.q("update phases set starts_at = now() - interval '1 hour', ends_at = now() - interval '1 second' where event_id = $1 and code = 'CRISIS'", [n.eventId]);
    await n.q("update phases set starts_at = now() - interval '3 minutes', ends_at = now() + interval '57 minutes' where event_id = $1 and code = 'RESCUE_1'", [n.eventId]);
    const r5 = await at("rounds", "event_id = $1 and number = 5", [n.eventId]);
    await n.ok(n.lead, "tick", n.eventId);
    expect(await n.phase()).toBe("RESCUE_1");
    const rescue = await at("phases", "event_id = $1 and code = 'RESCUE_1'", [n.eventId]);
    expect(Math.abs(new Date(rescue.starts_at).getTime() - Date.now())).toBeLessThan(10_000);
    expect(new Date((await at("rounds", "id = $1", [r5.id])).opens_at).getTime()).toBeGreaterThan(new Date(r5.opens_at).getTime());
    await n.org("set_auto_advance", n.eventId, false);
  });

  test("the default fee is applied once at 01:05, however often the tick runs", async () => {
    await n.deadlinePassed("FEE");
    await n.ok(n.lead, "tick", n.eventId);
    await n.ok(n.lead, "tick", n.eventId);
    const fees = await n.q("select is_default, executed_at is not null as done from fees where event_id = $1", [n.eventId]);
    expect(fees).toHaveLength(4);
    expect(fees.every((f) => f.is_default && f.done)).toBe(true);
    expect((await n.one("select count(*)::int as c from ledger_entries where event_id = $1 and kind = 'FEE_DEFAULT'", [n.eventId])).c).toBe(8);
    await n.checkInvariants();
  });
});

describe("Q&A, bulletins and broadcasts", () => {
  test("Finance asks, the company answers in up to 100 words, everyone reads; the asker stays anonymous", async () => {
    expect(await n.call(n.team(s1.c_code), "post_question", c1, "How many towns?")).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    const q = await n.ok(n.team(s2.f_code), "post_question", c1, "How many towns have signed up?");
    expect(await n.call(n.team(s2.p_code), "answer_question", q.question_id, "None.")).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    const long = Array.from({ length: 101 }, () => "word").join(" ");
    expect(await n.call(n.team(s1.p_code), "answer_question", q.question_id, long)).toMatchObject({ ok: false, code: "BAD_LENGTH" });
    await n.ok(n.team(s1.p_code), "answer_question", q.question_id, "None yet; three pilots are planned.");
    const reader = n.team(s3.f_code);
    expect(await rowsAs(db.pool, reader, "select body from qa_answers where question_id = $1", [q.question_id])).toEqual([
      { body: "None yet; three pilots are planned." },
    ]);
    await expect(rowsAs(db.pool, reader, "select asker_team_id from qa_questions")).rejects.toThrow(/permission denied/);
  });

  test("bulletins are published by organisers only and broadcast on commit", async () => {
    await expect(n.call(n.team(s1.p_code), "publish_bulletin", n.eventId, "GENERAL", "x", "y")).rejects.toThrow(/only an organiser/);
    await n.org("publish_bulletin", n.eventId, "GENERAL", "Dinner is served", "At your desks.");
    const msgs = await n.q("select event, topic, payload from realtime.messages where topic = $1 order by id", [`event:${n.eventId}`]);
    const kinds = msgs.map((m) => m.event);
    expect(kinds).toEqual(expect.arrayContaining(["squad_draw", "verdicts", "ipo_allocated", "round_open", "round_cleared", "paused", "resumed", "phase", "crisis", "bulletin", "qa"]));
    expect(msgs.find((m) => m.event === "bulletin")!.payload).toMatchObject({ title: "Dinner is served", kind: "bulletin" });
    // A broadcast never carries private data: no team ids, cash or holdings.
    expect(JSON.stringify(msgs)).not.toMatch(/cash_cents|holdings|team_id/);
  });
});

describe("ledger corrections need two people", () => {
  test("requested by one organiser, approved by another (never the requester), then applied and published", async () => {
    const team = n.teamId(s3.f_code);
    await expect(n.call(n.lead, "request_correction", n.eventId, "short", JSON.stringify([{ team_id: team, cash_delta_cents: 100 }]))).rejects.toThrow(/reason/);
    const req = await n.org("request_correction", n.eventId, "Manual refund of a double-charged order", JSON.stringify([{ team_id: team, cash_delta_cents: 12_345 }]));
    await expect(n.call(n.lead, "decide_correction", req.correction_id, true, null)).rejects.toThrow(/second person/);
    await expect(n.call(n.team(s3.f_code), "decide_correction", req.correction_id, true, null)).rejects.toThrow(/only an organiser or the fairness officer/);
    const before = Number((await at("teams", "id = $1", [team])).cash_cents);
    await n.ok(n.second, "decide_correction", req.correction_id, true, "Checked against the order log.");
    expect(Number((await at("teams", "id = $1", [team])).cash_cents)).toBe(before + 12_345);
    expect(await at("corrections", "id = $1", [req.correction_id])).toMatchObject({ status: "APPROVED" });
    const pub = await rowsAs(db.pool, n.team(s1.p_code), "select kind, details from public_ledger where kind = 'CORRECTION'");
    expect(pub).toEqual([{ kind: "CORRECTION", details: { reason: "Manual refund of a double-charged order", entries: 1 } }]);
    await expect(n.call(n.second, "decide_correction", req.correction_id, true, null)).rejects.toThrow(/no pending correction/);
    await n.checkInvariants();
  });
});
