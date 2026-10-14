// Database functions the big screen and the public lottery record rely on (Phase 5): the rankings with team names
// (from AWARDS for teams and the display), the draw summary, and the lottery record once the seed is revealed.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sha256Hex } from "@msim/engine";
import { buildLotteryRecord, checkDraw, type LotteryRows } from "../../apps/web/lib/admin/lottery";
import { createTestDb } from "./pg";
import { anon, as, setPhase, user } from "./helpers";
import { Night } from "./night";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

const SEED = sha256Hex("display");
const display = (n: Night) => user(n.ev.staff.get("display@example.org")!);

/** A 3-squad event right after the 21:00 draw. */
async function drawn() {
  const n = await Night.create(db.pool, 3);
  await n.org("set_seed_commitment", n.eventId, sha256Hex(SEED));
  await n.advanceTo("SQUAD_DRAW");
  await n.org("run_lottery", n.eventId, SEED, "4");
  return n;
}

describe("draw_summary", () => {
  test("null before the draw; afterwards the commitment, dice, time and squad count, for the display and teams", async () => {
    const n = await Night.create(db.pool, 3);
    await n.org("set_seed_commitment", n.eventId, sha256Hex(SEED));
    expect(await n.call(display(n), "draw_summary", n.eventId)).toBeNull();
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, SEED, "4");
    const summary = await n.call(display(n), "draw_summary", n.eventId);
    expect(summary).toMatchObject({ commitment: sha256Hex(SEED), dice: "4", squads: 3 });
    expect(Date.parse(summary.drawn_at)).not.toBeNaN();
    const team = n.team([...n.ev.teams.keys()][0]!);
    expect(await n.call(team, "draw_summary", n.eventId)).toMatchObject({ squads: 3 });
  });

  test("another event's team cannot read it", async () => {
    const a = await drawn();
    const b = await Night.create(db.pool, 3);
    const outsider = b.team([...b.ev.teams.keys()][0]!);
    await expect(a.call(outsider, "draw_summary", a.eventId)).rejects.toThrow(/no such event/);
  });
});

describe("lottery_record_rows", () => {
  test("refused (null) until the seed is revealed at the crisis; then anyone can redo the whole draw", async () => {
    const n = await drawn();
    const slug = n.ev.plan.event.slug;
    expect(await n.call(anon, "lottery_record_rows", slug)).toBeNull();
    expect(await n.call(display(n), "lottery_record_rows", slug)).toBeNull();
    expect(await n.call(anon, "lottery_record_rows", "no-such-event")).toBeNull();

    await n.q("select app.apply_crisis($1)", [n.eventId]);
    const rows = (await n.call(anon, "lottery_record_rows", slug)) as LotteryRows;
    expect(rows).toMatchObject({ seed: SEED, dice: "4", commitment: sha256Hex(SEED) });
    expect(rows.teams).toHaveLength(9);
    expect(rows.squads).toHaveLength(3);
    expect(rows.coverage).toHaveLength(6);
    expect(rows.crisisCards?.length).toBeGreaterThan(0);
    // Only card numbers are public: no titles, sectors or bodies.
    expect(Object.keys(rows.problemCards[0]!).sort()).toEqual(["id", "number"]);

    const record = buildLotteryRecord(rows);
    expect(record.squads).toHaveLength(3);
    expect(record.crises).toHaveLength(3);
    expect(checkDraw(record)).toEqual({ seedMatches: true, problems: [] });
  });
});

describe("rankings", () => {
  /** Results and awards as settlement would write them (the full night is covered in night.test.ts). */
  async function settled() {
    const n = await drawn();
    const codes = [...n.ev.teams.keys()].sort();
    for (const [i, code] of codes.entries()) {
      const track = (await n.one("select track from teams where id = $1", [n.teamId(code)])).track;
      await n.q(
        "insert into results (event_id, team_id, track, final_value_cents, start_value_cents, return_bp, rank) values ($1, $2, $3, $4, $5, 0, $6)",
        [n.eventId, n.teamId(code), track, 1_000_000 + i, 1_000_000, (i % 3) + 1],
      );
    }
    await n.q("insert into awards (event_id, code, place, team_id, metric) values ($1, 'FINANCE_TOP3', 1, $2, '{}')", [n.eventId, n.teamId(codes[0]!)]);
    return { n, codes };
  }

  test("teams and the display get null before AWARDS; staff from SETTLEMENT; names included", async () => {
    const { n, codes } = await settled();
    const team = n.team(codes[1]!);
    await setPhase(db.pool, n.eventId, "SETTLEMENT");
    expect(await n.call(team, "rankings", n.eventId)).toBeNull();
    expect(await n.call(display(n), "rankings", n.eventId)).toBeNull();
    const staff = await n.call(n.lead, "rankings", n.eventId);
    expect(staff.results).toHaveLength(9);

    await setPhase(db.pool, n.eventId, "AWARDS");
    for (const caller of [team, display(n), n.fairness]) {
      const r = await n.call(caller, "rankings", n.eventId);
      expect(r.results).toHaveLength(9);
      // Every team's name is visible at the awards, not only the caller's own.
      expect(r.results.every((x: { teams: { code: string; name: string } }) => x.teams.code && x.teams.name)).toBe(true);
      expect(r.awards).toEqual([
        { code: "FINANCE_TOP3", place: 1, metric: {}, teams: expect.objectContaining({ code: codes[0] }), companies: null },
      ]);
    }
  });

  test("anon cannot call it; another event's team gets null", async () => {
    const { n } = await settled();
    await setPhase(db.pool, n.eventId, "AWARDS");
    await expect(as(db.pool, anon, (c) => c.query("select public.rankings($1)", [n.eventId]))).rejects.toThrow(/permission denied/);
    const b = await Night.create(db.pool, 3);
    expect(await b.call(b.team([...b.ev.teams.keys()][0]!), "rankings", n.eventId)).toBeNull();
  });
});

describe("event_status while paused", () => {
  test("the round open at the pause stays the open round, even past its planned close; it closes later after the resume", async () => {
    const n = await drawn();
    await setPhase(db.pool, n.eventId, "ROUNDS_1_4");
    await n.q(
      "update rounds set status = 'OPEN', opened_at = now(), opens_at = now() - interval '20 minutes', closes_at = now() + interval '10 minutes' where event_id = $1 and number = 1",
      [n.eventId],
    );
    expect(await n.call(display(n), "event_status", n.eventId)).toMatchObject({ trading: "OPEN", open_round: { number: 1 } });

    await n.org("pause_event", n.eventId);
    // Ten minutes of pause have gone by, and the round's planned close (5 minutes into the pause) has passed.
    await n.q("update events set paused_at = now() - interval '10 minutes' where id = $1", [n.eventId]);
    await n.q("update rounds set closes_at = now() - interval '5 minutes' where event_id = $1 and number = 1", [n.eventId]);
    const paused = await n.call(display(n), "event_status", n.eventId);
    expect(paused).toMatchObject({ paused: true, trading: "PAUSED", open_round: { number: 1 }, next_round: { number: 2 } });
    // What it had left when the pause began: 5 minutes.
    // (Within a millisecond: the times are stored in microseconds and read in milliseconds.)
    expect(Math.abs(Date.parse(paused.open_round.closes_at) - Date.parse(paused.paused_at) - 5 * 60_000)).toBeLessThanOrEqual(1);

    await n.org("resume_event", n.eventId);
    const resumed = await n.call(display(n), "event_status", n.eventId);
    expect(resumed).toMatchObject({ paused: false, trading: "OPEN", open_round: { number: 1 } });
    const left = Date.parse(resumed.open_round.closes_at) - Date.parse(resumed.server_time);
    expect(left).toBeGreaterThan(4.9 * 60_000);
    expect(left).toBeLessThanOrEqual(5 * 60_000);
  });
});
