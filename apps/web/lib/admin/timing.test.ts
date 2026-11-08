import { describe, expect, test } from "vitest";
import { draftChanges, elapsedMs, logSummary, parseMinutes, span, timelineSegments, toMinutes, type PhaseTiming, type RoundTiming } from "./timing";

const phase = (code: PhaseTiming["code"], seq: number, extra: Partial<PhaseTiming> = {}): PhaseTiming => ({
  code,
  seq,
  duration_seconds: 1800,
  starts_at: null,
  ends_at: null,
  started_at: null,
  ended_at: null,
  paused_seconds: 0,
  extended_seconds: 0,
  ...extra,
});
const round = (number: number, extra: Partial<RoundTiming> = {}): RoundTiming => ({
  number,
  phase: number <= 2 ? "MARKET_BLIND" : "MARKET",
  status: "SCHEDULED",
  duration_seconds: 900,
  opens_at: null,
  closes_at: null,
  opened_at: null,
  closed_at: null,
  paused_seconds: 0,
  extended_seconds: 0,
  ...extra,
});

const phases = [
  phase("SETUP", 0, { duration_seconds: null, ended_at: "2026-11-20T14:30:00Z", started_at: "2026-11-20T13:00:00Z" }),
  phase("CHECKIN", 1, { started_at: "2026-11-20T14:30:00Z", starts_at: "2026-11-20T14:30:00Z", ends_at: "2026-11-20T15:00:00Z", paused_seconds: 60 }),
  phase("BRIEFING", 2),
  phase("MARKET_BLIND", 9, { duration_seconds: null }),
  phase("AWARDS", 12, { duration_seconds: null }),
];
const rounds = [round(1), round(2, { extended_seconds: 300 }), round(3, { status: "CLEARED" })];
const offsets = { twist_offset_seconds: 3600, freeze_offset_seconds: 2700 };

describe("minutes", () => {
  test("typed minutes become seconds within the limits", () => {
    expect(parseMinutes("45", { min: 0.5, max: 720 })).toEqual({ seconds: 2700 });
    expect(parseMinutes("1,5", { min: 0.5, max: 720 })).toEqual({ seconds: 90 });
    expect(parseMinutes("0.1", { min: 0.5, max: 720 })).toEqual({ error: "From 0.5 to 720 minutes." });
    expect(parseMinutes("ten", { min: 0.5, max: 720 })).toEqual({ error: "Enter minutes, like 45 or 1.5." });
    expect(toMinutes(5400)).toBe("90");
    expect(toMinutes(90)).toBe("1.5");
    expect(toMinutes(null)).toBe("");
  });
});

describe("the draft", () => {
  test("only what differs is sent; untimed is null; ended phases, Setup and trading phases are never sent", () => {
    const r = draftChanges(
      { phases: { CHECKIN: "30", BRIEFING: null, SETUP: "10", MARKET_BLIND: "60", AWARDS: null }, rounds: { "1": "10", "2": "15", "3": "5" }, twist: "60", freeze: "30" },
      phases,
      rounds,
      offsets,
    );
    expect(r.errors).toEqual({});
    expect(r.changes).toEqual({ phases: { BRIEFING: null }, rounds: { "1": 600 }, freeze_offset_seconds: 1800 });
    expect(r.count).toBe(3);
  });

  test("a bad entry is an error on its row and is not sent", () => {
    const r = draftChanges({ phases: { BRIEFING: "abc" }, rounds: { "1": "500" } }, phases, rounds, offsets);
    expect(Object.keys(r.errors)).toEqual(["phase:BRIEFING", "round:1"]);
    // An emptied box is being typed in: an error, never "untimed".
    expect(draftChanges({ phases: { BRIEFING: "" }, rounds: {} }, phases, rounds, offsets).errors).toEqual({ "phase:BRIEFING": "Enter minutes, like 45 or 1.5." });
    expect(r.count).toBe(0);
  });
});

describe("the readout", () => {
  test("elapsed does not count pauses", () => {
    expect(elapsedMs(phases[1], Date.parse("2026-11-20T14:40:00Z"))).toBe(540_000);
    expect(elapsedMs(phases[2], Date.now())).toBeNull();
    // An ended phase (the awards after the end of the night) stops counting at its end.
    expect(elapsedMs({ started_at: "2026-11-20T23:45:00Z", ended_at: "2026-11-20T23:57:00Z", paused_seconds: 0 }, Date.parse("2026-11-21T01:00:00Z"))).toBe(720_000);
    expect(span(540_000)).toBe("9:00");
    expect(span(3_909_000)).toBe("1:05:09");
    expect(span(null)).toBe("—");
  });

  test("the timeline: actual length when done, rounds for trading, null when untimed, progress for the current", () => {
    const s = timelineSegments(phases, rounds, "CHECKIN", Date.parse("2026-11-20T14:45:00Z"));
    expect(s.map((x) => x.code)).toEqual(["CHECKIN", "BRIEFING", "MARKET_BLIND", "AWARDS"]);
    expect(s[0]).toMatchObject({ state: "current", seconds: 1860, progress: 0.5 });
    expect(s[2]).toMatchObject({ state: "ahead", seconds: 900 + 1200 });
    expect(s[3]!.seconds).toBeNull();
  });
});

test("the log in a few words", () => {
  expect(logSummary({ at: "", action: "timing:end_phase", actor_role: "ORGANISER", after: { detail: { from: "BUILD", to: "JUDGING_1" } } })).toBe(
    "Ended a phase: Round 1: Build → Judging the PRDs",
  );
  expect(logSummary({ at: "", action: "timing:extend", actor_role: null, after: { detail: { extend_seconds: 300 } } })).toBe("Extended by 5 min");
  expect(logSummary({ at: "", action: "timing:close_round", actor_role: null, after: { detail: { round: 4, mode: "CANCEL", cancelled: 3 } } })).toBe(
    "Closed a round early: round 4 (cancelled 3 pending orders)",
  );
  expect(logSummary({ at: "", action: "timing:resume", actor_role: null, after: { detail: { paused_seconds: 125 } } })).toBe("Resumed after 2:05");
});
