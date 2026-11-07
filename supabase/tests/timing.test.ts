// Organiser-controlled timing (migration 15): the night starts when an organiser starts it and ends when one ends it;
// every time is projected from the actual phase starts and the durations; pausing freezes the countdowns and resuming
// gives the time back; changes are previewed, confirmed when they bring something earlier, versioned against a second
// console, logged and announced; an untimed phase waits for the organiser; a round closes by clearing or cancelling.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestDb } from "./pg";
import { Night, SEED } from "./night";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const secs = (a: Date | string, b: Date | string) => Math.round((new Date(a).getTime() - new Date(b).getTime()) / 1000);

async function version(n: Night): Promise<number> {
  return (await n.one("select timing_version from events where id = $1", [n.eventId])).timing_version;
}

async function deadline(n: Night, code: string): Promise<Date | null> {
  return (await n.one("select at from deadlines where event_id = $1 and code = $2", [n.eventId, code])).at;
}

async function phaseRow(n: Night, code: string) {
  return n.one("select * from phases where event_id = $1 and code = $2", [n.eventId, code]);
}

/** Through Round 1 and Round 2 to the start of trading. */
async function toMarketBlind(n: Night) {
  await n.advanceTo("BRIEFING");
  await n.org("run_lottery", n.eventId, SEED, "2");
  await n.advanceTo("BUILD");
  for (const c of n.codes) await n.save(c, "PRD", { problem: "A real problem." });
  await n.advanceTo("JUDGING_1");
  await n.judgeAll("PRD");
  await n.advanceTo("RESCUE");
  for (const c of n.codes) await n.save(c, "SOLUTION", { diagnosis: "A diagnosis." });
  await n.advanceTo("JUDGING_2");
  await n.judgeAll("SOLUTION");
  await n.advanceTo("MARKET_BLIND");
}

describe("starting and ending the night", () => {
  test("nothing runs in Setup; an organiser starts the night; every time follows from the actual start", async () => {
    const n = await Night.create(db.pool, 3);
    await n.org("set_auto_advance", n.eventId, true, true);
    // The clock does nothing before the start, and there is nothing to pause.
    expect((await n.org("tick", n.eventId)).actions).toBeUndefined();
    expect(await n.phase()).toBe("SETUP");
    expect(await n.call(n.lead, "pause_event", n.eventId)).toMatchObject({ ok: false, code: "NOT_RUNNING" });
    expect(await n.q("select count(*)::int as n from deadlines where event_id = $1 and at is not null", [n.eventId])).toEqual([{ n: 0 }]);
    // Only organisers start it, from the times they saw.
    await expect(n.call(n.team(n.codes[0]!), "start_event", n.eventId, 0)).rejects.toThrow(/organiser/);
    await expect(n.call(n.fairness, "start_event", n.eventId, 0)).rejects.toThrow(/organiser/);
    expect(await n.call(n.lead, "start_event", n.eventId, 7)).toMatchObject({ ok: false, code: "STALE" });

    const v = await version(n); // switching the mode is a change too
    expect(v).toBe(1);
    expect(await n.call(n.lead, "start_event", n.eventId, v)).toMatchObject({ ok: true, phase: "CHECKIN" });
    expect(await n.call(n.second, "start_event", n.eventId, v)).toMatchObject({ ok: false, code: "ALREADY_STARTED" });
    const ev = await n.one("select started_at, timing_version from events where id = $1", [n.eventId]);
    expect(ev.started_at).not.toBeNull();
    expect(ev.timing_version).toBe(2);
    const checkin = await phaseRow(n, "CHECKIN");
    expect(secs(checkin.ends_at, checkin.started_at)).toBe(45 * 60);
    // The later phases follow back to back: Build starts 75 minutes in, the PRD form locks 180 minutes in.
    expect(secs((await phaseRow(n, "BUILD")).starts_at, checkin.started_at)).toBe(75 * 60);
    expect(secs((await deadline(n, "PRD_LOCK"))!, checkin.started_at)).toBe(180 * 60);
    expect(secs((await deadline(n, "TWIST"))!, checkin.started_at)).toBe(135 * 60);
    // Trading: nine 15-minute rounds from the start of the blind market; the market closes after round 9.
    const blind = await phaseRow(n, "MARKET_BLIND");
    expect(secs(blind.starts_at, checkin.started_at)).toBe(375 * 60);
    expect(secs((await deadline(n, "MARKET_CLOSE"))!, checkin.started_at)).toBe(510 * 60);
    // The awards are untimed: the night ends when an organiser ends it.
    const status = await n.call(n.team(n.codes[0]!), "event_status", n.eventId);
    expect(status).toMatchObject({ phase: "CHECKIN", event_ends_at: null, event_ends_after: "AWARDS", phase_untimed: false });
    expect(await n.q("select action from audit_log where event_id = $1 and action like 'timing:%'", [n.eventId])).toEqual(
      expect.arrayContaining([{ action: "timing:start" }, { action: "timing:mode_auto" }]),
    );
  });

  test("a phase started late takes its full duration from when it actually started", async () => {
    const n = await Night.create(db.pool, 3);
    await n.advanceTo("BRIEFING");
    await n.org("run_lottery", n.eventId, SEED, "1");
    await n.advanceTo("BUILD");
    const build = await phaseRow(n, "BUILD");
    expect(secs(build.ends_at, build.started_at)).toBe(105 * 60);
    expect(secs((await deadline(n, "PRD_LOCK"))!, build.started_at)).toBe(105 * 60);
    expect(secs((await deadline(n, "TWIST"))!, build.started_at)).toBe(60 * 60);
  });

  test("the night ends only from the awards, once; nothing changes afterwards", async () => {
    const n = await Night.create(db.pool, 3);
    expect(await n.call(n.lead, "end_event", n.eventId, null)).toMatchObject({ ok: false, code: "NOT_YET" });
    await n.advanceTo("BRIEFING");
    await n.org("run_lottery", n.eventId, SEED, "3");
    await n.advanceTo("BUILD");
    await n.advanceTo("JUDGING_1");
    await n.judgeAll("PRD");
    await n.advanceTo("JUDGING_2");
    await n.judgeAll("SOLUTION");
    await n.advanceTo("SETTLEMENT");
    for (const f of await n.q("select id from flags where event_id = $1 and status = 'OPEN'", [n.eventId])) {
      await n.ok(n.fairness, "decide_flag", f.id, "CLEARED", "Reviewed.");
    }
    await n.advanceTo("AWARDS");
    expect((await n.call(n.lead, "event_status", n.eventId)).phase_untimed).toBe(true);
    await expect(n.call(n.team(n.codes[0]!), "end_event", n.eventId, null)).rejects.toThrow(/organiser/);
    expect(await n.call(n.lead, "end_event", n.eventId, (await version(n)) - 1)).toMatchObject({ ok: false, code: "STALE" });
    await n.ok(n.lead, "end_event", n.eventId, await version(n));
    expect(await n.call(n.second, "end_event", n.eventId, null)).toMatchObject({ ok: false, code: "ALREADY_ENDED" });
    const ev = await n.one("select ended_at, current_phase from events where id = $1", [n.eventId]);
    expect(ev.ended_at).not.toBeNull();
    expect(ev.current_phase).toBe("AWARDS");
    expect(await n.call(n.lead, "pause_event", n.eventId)).toMatchObject({ ok: false, code: "NOT_RUNNING" });
    expect(await n.call(n.lead, "set_timing", n.eventId, null, JSON.stringify({ extend_seconds: 300 }), true)).toMatchObject({ ok: false, code: "ENDED" });
    expect(await n.call(n.lead, "event_status", n.eventId)).toMatchObject({ ended_at: expect.any(String) });
  });
});

describe("pause and resume", () => {
  test("a pause freezes the countdown; resuming gives back exactly the time left, and tells the teams", async () => {
    const n = await Night.create(db.pool, 3);
    await n.advanceTo("BRIEFING");
    await n.org("run_lottery", n.eventId, SEED, "1");
    await n.advanceTo("BUILD");
    const before = (await deadline(n, "PRD_LOCK"))!;
    await n.org("pause_event", n.eventId);
    // While paused the deadline that is ahead does not pass, even if its time comes.
    await n.q("update events set paused_at = paused_at - interval '20 minutes' where id = $1", [n.eventId]);
    const r = await n.org("resume_event", n.eventId);
    expect(r.paused_seconds).toBeGreaterThanOrEqual(1200);
    const after = (await deadline(n, "PRD_LOCK"))!;
    expect(secs(after, before)).toBeGreaterThanOrEqual(1200);
    expect(secs(after, before)).toBeLessThanOrEqual(1202);
    expect((await phaseRow(n, "BUILD")).paused_seconds).toBe(r.paused_seconds);
    // The change is kept for screens that reconnect, and logged.
    const ev = await n.one("select timing_change from events where id = $1", [n.eventId]);
    expect(ev.timing_change.action).toBe("resume");
    expect(ev.timing_change.changes.map((c: { key: string }) => c.key)).toContain("deadline:PRD_LOCK");
    expect((await n.q("select count(*)::int as n from audit_log where event_id = $1 and action = 'timing:resume'", [n.eventId]))[0].n).toBe(1);
  });

  test("a round paused mid-way gets its time back too", async () => {
    const n = await Night.create(db.pool, 3);
    await toMarketBlind(n);
    await n.openRound(1);
    const r1 = await n.one("select closes_at from rounds where event_id = $1 and number = 1", [n.eventId]);
    await n.org("pause_event", n.eventId);
    await n.q("update events set paused_at = paused_at - interval '5 minutes' where id = $1", [n.eventId]);
    await n.org("resume_event", n.eventId);
    const after = await n.one("select closes_at from rounds where event_id = $1 and number = 1", [n.eventId]);
    expect(secs(after.closes_at, r1.closes_at)).toBeGreaterThanOrEqual(300);
    expect(secs(after.closes_at, r1.closes_at)).toBeLessThanOrEqual(302);
    const r2 = await n.one("select opens_at from rounds where event_id = $1 and number = 2", [n.eventId]);
    expect(new Date(r2.opens_at).getTime()).toBe(new Date(after.closes_at).getTime());
  });
});

describe("changing durations", () => {
  test("preview, confirm when earlier, apply; a stale console is refused; teams see what moved", async () => {
    const n = await Night.create(db.pool, 3);
    await n.advanceTo("BRIEFING");
    await n.org("run_lottery", n.eventId, SEED, "1");
    await n.advanceTo("BUILD");
    const lock = (await deadline(n, "PRD_LOCK"))!;
    const v = await version(n);

    // A preview never changes anything.
    const p = await n.org("preview_timing", n.eventId, JSON.stringify({ phases: { BUILD: 90 * 60 } }));
    expect(p).toMatchObject({ preview: true, shortens: true, timing_version: v });
    const moved = p.changes.find((c: { key: string }) => c.key === "deadline:PRD_LOCK");
    expect(moved).toMatchObject({ label: "PRD form locks", earlier: true });
    expect(secs(moved.from, moved.to)).toBe(15 * 60);
    expect((await phaseRow(n, "BUILD")).duration_seconds).toBe(105 * 60);
    expect(await version(n)).toBe(v);

    // Shorter needs a second confirmation; without it, nothing is applied.
    expect(await n.call(n.lead, "set_timing", n.eventId, v, JSON.stringify({ phases: { BUILD: 90 * 60 } }), false)).toMatchObject({
      ok: false,
      code: "CONFIRM",
      shortens: true,
    });
    expect((await deadline(n, "PRD_LOCK"))!.getTime()).toBe(lock.getTime());
    // Confirmed, it applies once; the second console, still on the old version, is refused.
    const ok = await n.org("set_timing", n.eventId, v, JSON.stringify({ phases: { BUILD: 90 * 60 } }), true);
    expect(ok.timing_version).toBe(v + 1);
    expect(secs(lock, (await deadline(n, "PRD_LOCK"))!)).toBe(15 * 60);
    expect(await n.call(n.second, "set_timing", n.eventId, v, JSON.stringify({ phases: { BUILD: 80 * 60 } }), true)).toMatchObject({
      ok: false,
      code: "STALE",
      timing_version: v + 1,
    });
    // Longer needs no confirmation; later phases and rounds move with it.
    const blindBefore = (await phaseRow(n, "MARKET_BLIND")).starts_at;
    await n.org("set_timing", n.eventId, v + 1, JSON.stringify({ phases: { BUILD: 100 * 60, RESCUE: 100 * 60 }, rounds: { "3": 600 } }), false);
    expect(secs((await phaseRow(n, "MARKET_BLIND")).starts_at, blindBefore)).toBe(20 * 60);
    const r3 = await n.one("select opens_at, closes_at from rounds where event_id = $1 and number = 3", [n.eventId]);
    expect(secs(r3.closes_at, r3.opens_at)).toBe(600);

    // What cannot be: shorter than what has already run; Setup and the trading phases have no duration of their own.
    expect(await n.call(n.lead, "set_timing", n.eventId, null, JSON.stringify({ phases: { BUILD: 30 } }), true)).toMatchObject({ ok: false, code: "TOO_SHORT" });
    expect(await n.call(n.lead, "set_timing", n.eventId, null, JSON.stringify({ phases: { MARKET: 3600 } }), true)).toMatchObject({ ok: false, code: "TRADING_PHASE" });
    expect(await n.call(n.lead, "set_timing", n.eventId, null, JSON.stringify({ phases: { BRIEFING: 3600 } }), true)).toMatchObject({ ok: false, code: "ENDED_PHASE" });
    expect(await n.call(n.lead, "set_timing", n.eventId, null, JSON.stringify({ rounds: { "1": 10 } }), true)).toMatchObject({ ok: false, code: "BAD_DURATION" });
    await expect(n.call(n.team(n.codes[0]!), "set_timing", n.eventId, null, JSON.stringify({ phases: { BUILD: 9000 } }), true)).rejects.toThrow(/organiser/);
    await expect(n.call(n.team(n.codes[0]!), "preview_timing", n.eventId, JSON.stringify({}))).rejects.toThrow(/organiser/);

    // The twist moves with its offset; once published it is history.
    const v2 = await version(n);
    await n.org("set_timing", n.eventId, v2, JSON.stringify({ twist_offset_seconds: 30 * 60 }), true);
    expect(secs((await deadline(n, "TWIST"))!, (await phaseRow(n, "BUILD")).started_at)).toBe(30 * 60);
    await n.deadlinePassed("TWIST");
    await n.org("tick", n.eventId);
    expect(await n.call(n.lead, "set_timing", n.eventId, null, JSON.stringify({ twist_offset_seconds: 3600 }), true)).toMatchObject({ ok: false, code: "DONE" });

    // Every applied change is logged with what moved.
    const log = await n.q("select after from audit_log where event_id = $1 and action = 'timing:set_timing' order by at", [n.eventId]);
    expect(log.length).toBe(3);
    expect(log[0].after.changes.some((c: { key: string }) => c.key === "deadline:PRD_LOCK")).toBe(true);
  });

  test("extend lengthens what is running now: the current phase, or the open round", async () => {
    const n = await Night.create(db.pool, 3);
    await toMarketBlind(n);
    expect(await n.call(n.lead, "extend_event", n.eventId, 5, null)).toMatchObject({ ok: false, code: "NO_ROUND" });
    await n.openRound(1);
    const r1 = await n.one("select closes_at from rounds where event_id = $1 and number = 1", [n.eventId]);
    await n.org("extend_event", n.eventId, 5, await version(n));
    const after = await n.one("select closes_at, extended_seconds from rounds where event_id = $1 and number = 1", [n.eventId]);
    expect(secs(after.closes_at, r1.closes_at)).toBe(300);
    expect(after.extended_seconds).toBe(300);
    expect(await n.call(n.lead, "extend_event", n.eventId, 5, 0)).toMatchObject({ ok: false, code: "STALE" });
  });
});

describe("advancing", () => {
  test("manual advance waits; advance when the timer expires moves on; an untimed phase waits for the organiser", async () => {
    const n = await Night.create(db.pool, 3);
    await n.advanceTo("CHECKIN");
    // Make Briefing untimed before it starts, and let Check-in's time run out.
    await n.org("set_timing", n.eventId, await version(n), JSON.stringify({ phases: { BRIEFING: null } }), true);
    await n.q("update phases set started_at = started_at - interval '46 minutes' where event_id = $1 and code = 'CHECKIN'", [n.eventId]);
    await n.q("select app.reproject($1)", [n.eventId]);
    expect((await n.org("tick", n.eventId)).actions).toEqual([]);
    expect(await n.phase()).toBe("CHECKIN"); // manual: waits
    await n.org("set_auto_advance", n.eventId, true, true);
    await n.org("tick", n.eventId);
    expect(await n.phase()).toBe("BRIEFING");
    const s = await n.call(n.lead, "event_status", n.eventId);
    expect(s).toMatchObject({ phase: "BRIEFING", phase_untimed: true, phase_ends_at: null, event_ends_after: "BRIEFING" });
    expect((await phaseRow(n, "BUILD")).starts_at).toBeNull(); // unknown until Briefing ends
    expect(await deadline(n, "PRD_LOCK")).toBeNull();
    await n.q("update phases set started_at = started_at - interval '10 hours' where event_id = $1 and code = 'BRIEFING'", [n.eventId]);
    await n.org("tick", n.eventId);
    expect(await n.phase()).toBe("BRIEFING"); // untimed: never ends by itself
    expect(await n.call(n.lead, "extend_event", n.eventId, 5, null)).toMatchObject({ ok: false, code: "UNTIMED" });
    // Giving it a duration again is earlier than "never": it needs confirming, and it must leave time to run.
    expect(await n.call(n.lead, "set_timing", n.eventId, null, JSON.stringify({ phases: { BRIEFING: 3600 } }), true)).toMatchObject({ ok: false, code: "TOO_SHORT" });
  });

  test("the preview of the next phase: what holds it, what moves, the open round's pending orders; nothing changes", async () => {
    const n = await Night.create(db.pool, 3);
    await n.advanceTo("BRIEFING");
    const held = await n.org("preview_advance", n.eventId, "BRIEFING");
    expect(held).toMatchObject({ next: "BUILD", can_advance: false, gate: expect.stringMatching(/lottery/i) });
    await n.org("run_lottery", n.eventId, SEED, "1");
    const p = await n.org("preview_advance", n.eventId, "BRIEFING");
    expect(p).toMatchObject({ from: "BRIEFING", next: "BUILD", can_advance: true, gate: null, refusal: null });
    expect(p.changes.map((c: { key: string }) => c.key)).toContain("deadline:PRD_LOCK");
    expect(await n.phase()).toBe("BRIEFING");
    expect(await n.q("select count(*)::int as n from audit_log where event_id = $1 and action = 'timing:end_phase' and after->'detail'->>'from' = 'BRIEFING'", [n.eventId])).toEqual([{ n: 0 }]);
    expect(await n.call(n.lead, "preview_advance", n.eventId, "SETUP")).toMatchObject({ ok: false, code: "STALE" });
    await expect(n.call(n.team(n.codes[0]!), "preview_advance", n.eventId, "BRIEFING")).rejects.toThrow(/organiser/);
  });
});

describe("closing a round early", () => {
  test("clear fills the pending orders; cancel cancels them; the next round starts from the actual close", async () => {
    const n = await Night.create(db.pool, 4);
    await toMarketBlind(n);
    await n.openRound(1);
    const me = n.codes[0]!;
    const target = (await n.q("select id from companies where event_id = $1 and founder_team_id <> $2 and rescuer_team_id <> $2 limit 1", [n.eventId, n.teamId(me)]))[0].id;
    expect((await n.call(n.team(me), "place_order", target, "BUY", 10)).ok).toBe(true);
    const preview = await n.org("preview_advance", n.eventId, "MARKET_BLIND");
    expect(preview).toMatchObject({ open_round: 1, pending_orders: 1 });

    expect(await n.call(n.lead, "close_round_now", n.eventId, 1, "LATER")).toMatchObject({ ok: false, code: "BAD_MODE" });
    const r = await n.org("close_round_now", n.eventId, 1, "CANCEL");
    expect(r).toMatchObject({ mode: "CANCEL", cancelled: 1 });
    expect(await n.q("select status from orders where team_id = $1", [n.teamId(me)])).toEqual([{ status: "CANCELLED" }]);
    expect(await n.q("select qty from holdings where team_id = $1 and company_id = $2", [n.teamId(me), target])).toEqual([]);
    const r1 = await n.one("select closed_at from rounds where event_id = $1 and number = 1", [n.eventId]);
    const r2 = await n.one("select opens_at from rounds where event_id = $1 and number = 2", [n.eventId]);
    expect(new Date(r2.opens_at).getTime()).toBe(new Date(r1.closed_at).getTime());
    expect((await n.one("select timing_change from events where id = $1", [n.eventId])).timing_change.action).toBe("close_round");

    // Round 2 opens at once (its time has come), and closing it with CLEAR fills the order.
    await n.org("tick", n.eventId);
    expect((await n.one("select status from rounds where event_id = $1 and number = 2", [n.eventId])).status).toBe("OPEN");
    expect((await n.call(n.team(me), "place_order", target, "BUY", 10)).ok).toBe(true);
    expect(await n.org("close_round_now", n.eventId, 2)).toMatchObject({ mode: "CLEAR", cancelled: 0 });
    expect(await n.q("select qty from holdings where team_id = $1 and company_id = $2", [n.teamId(me), target])).toEqual([{ qty: 10 }]);
    await n.checkInvariants();
  });
});
