// The control panel's database functions (migration 12): deck uploads and the Setup gate, the status line, auto-advance
// when overdue, "close round N now", the model switch, heartbeats and the health summary.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb } from "./pg";
import { as } from "./helpers";
import { Night, SEED } from "./night";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const cards = (n: number) => Array.from({ length: n }, (_, i) => ({ number: i + 1, sector: "Snacks", title: `Problem ${i + 1}`, body: "A problem." }));
const crises = (n: number) => Array.from({ length: n }, (_, i) => ({ number: i + 1, category: `Type ${i + 1}`, title: `Crisis ${i + 1}`, body: "Bad news." }));

describe("content and the Setup gate", () => {
  test("decks replace the old ones, need ⌈teams ÷ 3⌉ problem cards and unique numbers, and lock at the draw", async () => {
    const n = await Night.create(db.pool, 7);
    expect(await n.call(n.lead, "upload_problem_deck", n.eventId, JSON.stringify(cards(2)))).toMatchObject({ ok: false, code: "BAD_DECK" });
    expect(await n.call(n.lead, "upload_problem_deck", n.eventId, JSON.stringify([...cards(2), { ...cards(1)[0] }]))).toMatchObject({
      ok: false,
      message: "Card numbers must be unique.",
    });
    expect(await n.call(n.lead, "upload_problem_deck", n.eventId, JSON.stringify([...cards(2), { number: 3, title: "", body: "x" }]))).toMatchObject({ ok: false });
    await n.org("upload_problem_deck", n.eventId, JSON.stringify(cards(3)));
    expect(await n.q("select count(*)::int as n from problem_cards where event_id = $1", [n.eventId])).toEqual([{ n: 3 }]);
    expect(await n.call(n.lead, "upload_crisis_deck", n.eventId, JSON.stringify([{ number: 100, category: "x", title: "t", body: "b" }]))).toMatchObject({ ok: false });
    await n.org("upload_crisis_deck", n.eventId, JSON.stringify(crises(10)));
    await expect(n.call(n.team(n.codes[0]!), "upload_problem_deck", n.eventId, JSON.stringify(cards(3)))).rejects.toThrow(/organiser/);

    await n.advanceTo("BRIEFING");
    await n.org("run_lottery", n.eventId, SEED, "1");
    expect(await n.call(n.lead, "upload_problem_deck", n.eventId, JSON.stringify(cards(4)))).toMatchObject({ ok: false, code: "TOO_LATE" });
    expect(await n.call(n.lead, "upload_crisis_deck", n.eventId, JSON.stringify(crises(10)))).toMatchObject({ ok: false, code: "TOO_LATE" });
  });

  test("Setup waits for the commitment, both decks and the twist", async () => {
    const n = await Night.create(db.pool, 4);
    const gate = async () => (await n.call(n.lead, "event_status", n.eventId)).gate;
    await n.q("delete from problem_cards where event_id = $1", [n.eventId]);
    expect(await gate()).toBe("Upload a problem deck of at least 2 cards before the event starts.");
    await n.org("upload_problem_deck", n.eventId, JSON.stringify(cards(2)));
    await n.q("delete from crisis_cards where event_id = $1", [n.eventId]);
    expect(await gate()).toBe("Upload the crisis deck before the event starts.");
    await n.org("upload_crisis_deck", n.eventId, JSON.stringify(crises(10)));
    await n.q("delete from bulletins where event_id = $1 and kind = 'TWIST'", [n.eventId]);
    expect(await gate()).toBe("Write the twist (Bulletins) before the event starts.");
    expect(await n.call(n.lead, "advance_phase", n.eventId, "SETUP")).toMatchObject({ ok: false, code: "GATE" });
    await n.org("set_twist", n.eventId, "Margin squeeze", "Distributors want 3% more.");
    expect(await gate()).toBeNull();
    // The twist can be rewritten until it is published.
    await n.org("set_twist", n.eventId, "Margin squeeze", "Distributors want 4% more.");
    expect((await n.one("select body from bulletins where event_id = $1 and kind = 'TWIST'", [n.eventId])).body).toBe("Distributors want 4% more.");
  });
});

describe("the status line", () => {
  test("phase, next phase, gate, trading, rounds, the next deadline and the server clock; teams of another event are refused", async () => {
    const n = await Night.create(db.pool, 3);
    const s = await n.call(n.team(n.codes[0]!), "event_status", n.eventId);
    expect(s).toMatchObject({ phase: "SETUP", next_phase: "CHECKIN", gate: null, paused: false, trading: "HALTED", open_round: null, drawn: false, leaderboard_frozen: false });
    // Nothing has a time before an organiser starts the night.
    expect(s).toMatchObject({ next_deadline: null, phase_ends_at: null, started_at: null, ended_at: null, timing_version: 0 });
    expect(typeof s.server_time).toBe("string");
    const other = await Night.create(db.pool, 3);
    await expect(n.call(other.team(other.codes[0]!), "event_status", n.eventId)).rejects.toMatchObject({ code: "42501" });
  });
});

describe("auto-advance, close round now, the model switch", () => {
  test("turning auto-advance on when overdue needs a confirmation", async () => {
    const n = await Night.create(db.pool, 3);
    await n.advanceTo("CHECKIN");
    await n.q("update phases set paused_seconds = 0, duration_seconds = 60, started_at = now() - interval '2 minutes' where event_id = $1 and code = 'CHECKIN'", [n.eventId]);
    await n.q("select app.reproject($1)", [n.eventId]);
    expect(await n.call(n.lead, "set_auto_advance", n.eventId, true, false)).toMatchObject({ ok: false, code: "OVERDUE" });
    await n.org("set_auto_advance", n.eventId, true, true);
    expect((await n.one("select auto_advance from events where id = $1", [n.eventId])).auto_advance).toBe(true);
    await n.org("set_auto_advance", n.eventId, false, false);
  });

  test("close round N refuses a round that is no longer the open one", async () => {
    const n = await Night.create(db.pool, 4);
    await n.advanceTo("BRIEFING");
    await n.org("run_lottery", n.eventId, SEED, "2");
    await n.advanceTo("BUILD");
    for (const c of n.codes) await n.save(c, "PRD", { problem: "A problem." });
    await n.advanceTo("JUDGING_1");
    await n.judgeAll("PRD");
    await n.advanceTo("RESCUE");
    await n.advanceTo("JUDGING_2");
    await n.advanceTo("MARKET_BLIND");
    expect(await n.call(n.lead, "close_round_now", n.eventId, 1)).toMatchObject({ ok: false, code: "NO_OPEN_ROUND" });
    await n.openRound(1);
    expect(await n.call(n.lead, "close_round_now", n.eventId, 2)).toMatchObject({ ok: false, code: "ROUND_CHANGED" });
    expect(await n.call(n.lead, "close_round_now", n.eventId, 1)).toMatchObject({ ok: true, round: 1 });
    await n.checkInvariants();
  });

  test("each round's judge switches between its primary and backup model; only organisers", async () => {
    const n = await Night.create(db.pool, 3);
    await n.org("set_model_slot", n.eventId, "SOLUTION", "BACKUP");
    expect(await n.one("select prd_model_slot, solution_model_slot from events where id = $1", [n.eventId])).toEqual({ prd_model_slot: "PRIMARY", solution_model_slot: "BACKUP" });
    await expect(n.call(n.lead, "set_model_slot", n.eventId, "PRD", "OTHER")).rejects.toThrow(/PRIMARY or BACKUP/);
    await expect(n.call(n.fairness, "set_model_slot", n.eventId, "PRD", "BACKUP")).rejects.toThrow(/organiser/);
  });
});

describe("health", () => {
  test("pings are counted per area and role; staff only read the summary", async () => {
    const n = await Night.create(db.pool, 3);
    await n.ok(n.team(n.codes[0]!), "ping", randomUUID(), n.eventId, "team", "SUBSCRIBED");
    await n.ok(n.team(n.codes[1]!), "ping", randomUUID(), n.eventId, "team", "CONNECTING");
    await n.ok(n.lead, "ping", randomUUID(), n.eventId, "admin", "SUBSCRIBED");
    const h = await n.ok(n.lead, "admin_health", n.eventId);
    expect(h.screens).toEqual([
      { area: "admin", role: "ORGANISER", connected: 1, realtime_ok: 1 },
      { area: "team", role: "TEAM", connected: 2, realtime_ok: 1 },
    ]);
    expect(h.judge_queue).toEqual({ queued: 0, running: 0, done: 0, failed: 0 });
    await expect(n.call(n.team(n.codes[0]!), "admin_health", n.eventId)).rejects.toThrow(/staff/);
    await expect(as(db.pool, n.team(n.codes[0]!), (c) => c.query("select public.ping($1, $2, 'nowhere', 'SUBSCRIBED')", [randomUUID(), n.eventId]))).rejects.toThrow(/bad ping/);
  });
});
