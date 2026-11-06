// Organiser controls (pause, resume, extend, gates), who may call which function, and the full-size draw: 150 teams,
// 50 problem cards, 10 crisis types × 15 companies, one rescue circle.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestDb } from "./pg";
import { anon, as, seedEvent } from "./helpers";
import { COMMITMENT, Night, SEED } from "./night";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

describe("pause, resume and extend", () => {
  test("a pause freezes trading and every countdown; resume gives the exact time back; extend moves what is ahead", async () => {
    const n = await Night.create(db.pool, 4);
    await n.advanceTo("BRIEFING");
    await n.org("run_lottery", n.eventId, SEED, "2");
    await n.advanceTo("BUILD");
    const lockBefore = (await n.one("select at from deadlines where event_id = $1 and code = 'PRD_LOCK'", [n.eventId])).at as Date;

    await n.org("pause_event", n.eventId);
    expect(await n.call(n.lead, "pause_event", n.eventId)).toMatchObject({ ok: false, code: "ALREADY_PAUSED" });
    // While paused nobody can write, and the phase cannot be advanced.
    expect(await n.save(n.codes[0]!, "PRD", { problem: "x" })).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
    expect(await n.call(n.lead, "advance_phase", n.eventId, "BUILD")).toMatchObject({ ok: false, code: "PAUSED" });
    // Pretend the pause lasted ten minutes.
    await n.q("update events set paused_at = paused_at - interval '10 minutes' where id = $1", [n.eventId]);
    await n.org("resume_event", n.eventId);
    const lockAfter = (await n.one("select at from deadlines where event_id = $1 and code = 'PRD_LOCK'", [n.eventId])).at as Date;
    const moved = lockAfter.getTime() - lockBefore.getTime();
    expect(moved).toBeGreaterThanOrEqual(600_000);
    expect(moved).toBeLessThan(605_000);
    expect((await n.save(n.codes[0]!, "PRD", { problem: "x" })).ok).toBe(true);

    await n.org("extend_event", n.eventId, 5);
    const lockExtended = (await n.one("select at from deadlines where event_id = $1 and code = 'PRD_LOCK'", [n.eventId])).at as Date;
    expect(lockExtended.getTime() - lockAfter.getTime()).toBe(300_000);
    await expect(n.call(n.lead, "extend_event", n.eventId, 0)).rejects.toThrow(/1 to 120/);
  });

  test("pausing during a round shows TRADING_PAUSED to an order", async () => {
    const n = await Night.create(db.pool, 4);
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
    await n.openRound(1);
    const target = (await n.q("select id from companies where event_id = $1 and founder_team_id <> $2 and rescuer_team_id <> $2 limit 1", [n.eventId, n.teamId(n.codes[0]!)]))[0].id;
    await n.org("pause_event", n.eventId);
    expect(await n.call(n.team(n.codes[0]!), "place_order", target, "BUY", 10)).toMatchObject({ ok: false, code: "TRADING_PAUSED" });
    await n.org("resume_event", n.eventId);
    expect((await n.call(n.team(n.codes[0]!), "place_order", target, "BUY", 10)).ok).toBe(true);
    // The gate: MARKET_BLIND → MARKET needs every solution score sealed (they are) and clears rounds 1–2 first.
    await n.advanceTo("MARKET");
    expect(await n.q("select number, status from rounds where event_id = $1 and number <= 2 order by number", [n.eventId])).toEqual([
      { number: 1, status: "CLEARED" },
      { number: 2, status: "CLEARED" },
    ]);
    await n.checkInvariants();
  });
});

describe("who may call what", () => {
  test("anon can call no game function; a team cannot call organiser functions; nobody but the worker seals", async () => {
    const n = await Night.create(db.pool, 3);
    for (const sql of [
      "select public.save_draft('PRD', '{}', 0)",
      "select public.place_order(gen_random_uuid(), 'BUY', 1)",
      `select public.tick('${n.eventId}')`,
      `select public.leaderboard('${n.eventId}')`,
      `select public.run_lottery('${n.eventId}', '${SEED}', '1')`,
    ]) {
      await expect(as(db.pool, anon, (c) => c.query(sql)), sql).rejects.toThrow(/permission denied/);
    }
    const team = n.team(n.codes[0]!);
    for (const [fn, args] of [
      ["advance_phase", [n.eventId, "SETUP"]],
      ["pause_event", [n.eventId]],
      ["publish_bulletin", [n.eventId, "RUMOUR", "x", "y"]],
      ["set_seed_commitment", [n.eventId, COMMITMENT]],
      ["tick", [n.eventId]],
    ] as const) {
      await expect(n.call(team, fn, ...args), fn).rejects.toThrow(/organiser/);
    }
    await expect(n.call(n.lead, "decide_flag", "00000000-0000-0000-0000-000000000000", "CLEARED", "reason")).rejects.toThrow(/fairness/);
    await expect(as(db.pool, team, (c) => c.query("select public.seal_score(gen_random_uuid(), 'PRD')"))).rejects.toThrow(/permission denied/);
    // Internal functions are not callable by signed-in users.
    await expect(as(db.pool, team, (c) => c.query(`select app.apply_crisis('${n.eventId}')`))).rejects.toThrow(/permission denied/);
    // The commitment is fixed once the event has started.
    await n.advanceTo("CHECKIN");
    await expect(n.call(n.lead, "set_seed_commitment", n.eventId, COMMITMENT)).rejects.toThrow(/fixed/);
  });
});

describe("the full-size draw", () => {
  test("150 teams: problem cards ≤ 3 per card, 10 crisis types × 15 companies, a circle with one rescuer each", async () => {
    const ev = await seedEvent(db.pool, {
      teamCount: 150,
      seedCommitment: COMMITMENT,
      problemCards: Array.from({ length: 50 }, (_, i) => ({ number: i + 1, sector: "FMCG", title: `Problem ${i + 1}`, body: "." })),
    });
    const n = new Night(db.pool, ev);
    await n.advanceTo("BRIEFING");
    await n.org("run_lottery", n.eventId, SEED, "6");
    const perCard = await n.q("select problem_card_id, count(*)::int as n from companies where event_id = $1 group by 1", [n.eventId]);
    expect(perCard).toHaveLength(50);
    expect(perCard.every((r) => r.n === 3)).toBe(true);

    await n.advanceTo("BUILD");
    await n.deadlinePassed("PRD_LOCK");
    await n.ok(n.lead, "tick", n.eventId); // nobody wrote: 150 missing PRDs, sealed at 0
    await n.advanceTo("CRISIS_QA");
    const perCrisis = await n.q("select crisis_card_id, count(*)::int as n from companies where event_id = $1 group by 1", [n.eventId]);
    expect(perCrisis).toHaveLength(10);
    expect(perCrisis.every((r) => r.n === 15)).toBe(true);
    const circle = await n.q("select founder_team_id, rescuer_team_id from companies where event_id = $1", [n.eventId]);
    expect(circle.every((c) => c.rescuer_team_id && c.rescuer_team_id !== c.founder_team_id)).toBe(true);
    expect(new Set(circle.map((c) => c.rescuer_team_id)).size).toBe(150);
    // One single circle through all 150 teams.
    const next = new Map(circle.map((c) => [c.rescuer_team_id, c.founder_team_id]));
    let t = circle[0]!.rescuer_team_id;
    const seen = new Set<string>();
    while (!seen.has(t)) {
      seen.add(t);
      t = next.get(t)!;
    }
    expect(seen.size).toBe(150);
    // Every price: $5.00 (no PRD) × 0.85 = $4.25.
    expect(await n.q("select distinct market_price from companies where event_id = $1", [n.eventId])).toEqual([{ market_price: 425 }]);
  }, 120_000);
});
