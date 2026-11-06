import { describe, expect, test } from "vitest";
import {
  DEFAULT_DEADLINES,
  DEFAULT_PHASES,
  DEFAULT_ROUNDS,
  buildSchedule,
  eventStartIST,
  formatEventMinute,
  realToEventMinute,
} from "../src/schedule";
import { PHASE_CODES, phaseReached } from "../src/types";

const at = (code: string) => DEFAULT_DEADLINES.find((d) => d.code === code)!.at;
const phase = (code: string) => DEFAULT_PHASES.find((p) => p.code === code)!;

describe("default timetable matches the brief", () => {
  test("phases are in enum order and contiguous", () => {
    expect(DEFAULT_PHASES.map((p) => p.code)).toEqual([...PHASE_CODES]);
    for (let i = 1; i < DEFAULT_PHASES.length; i++) {
      expect(DEFAULT_PHASES[i]!.start).toBe(DEFAULT_PHASES[i - 1]!.end);
    }
  });

  test.each([
    ["CHECKIN", "20:00", "20:45"],
    ["BRIEFING", "20:45", "21:15"],
    ["BUILD", "21:15", "23:00"],
    ["JUDGING_1", "23:00", "23:30"],
    ["REVEAL_1", "23:30", "23:45"],
    ["CRISIS_QA", "23:45", "00:15"],
    ["RESCUE", "00:15", "01:45"],
    ["JUDGING_2", "01:45", "02:15"],
    ["MARKET_BLIND", "02:15", "02:45"],
    ["MARKET", "02:45", "04:30"],
    ["SETTLEMENT", "04:30", "05:15"],
    ["AWARDS", "05:15", "06:00"],
  ])("%s runs %s–%s", (code, start, end) => {
    expect(formatEventMinute(phase(code).start)).toBe(start);
    expect(formatEventMinute(phase(code).end)).toBe(end);
  });

  test("nine rounds of 15 minutes, 02:15–04:30, inside their phases; rounds 1–2 before the 02:45 reveal", () => {
    expect(DEFAULT_ROUNDS.map((r) => r.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const r of DEFAULT_ROUNDS) {
      expect(r.end - r.start).toBe(15);
      const p = phase(r.phase);
      expect(r.start).toBeGreaterThanOrEqual(p.start);
      expect(r.end).toBeLessThanOrEqual(p.end);
    }
    expect(DEFAULT_ROUNDS.map((r) => r.phase)).toEqual(["MARKET_BLIND", "MARKET_BLIND", ...Array(7).fill("MARKET")]);
    expect(formatEventMinute(DEFAULT_ROUNDS[0]!.start)).toBe("02:15");
    expect(formatEventMinute(DEFAULT_ROUNDS[2]!.start)).toBe("02:45");
    expect(formatEventMinute(DEFAULT_ROUNDS[8]!.end)).toBe("04:30");
  });

  test.each([
    ["PROBLEM_DRAW", "21:15"],
    ["TWIST", "22:15"],
    ["PRD_LOCK", "23:00"],
    ["QA_CLOSE", "00:15"],
    ["SOLUTION_LOCK", "01:45"],
    ["LEADERBOARD_FREEZE", "03:30"],
    ["MARKET_CLOSE", "04:30"],
  ])("deadline %s is at %s", (code, time) => {
    expect(formatEventMinute(at(code))).toBe(time);
  });
});

describe("buildSchedule", () => {
  test("live event: 20:00 IST on 20 November is 14:30 UTC", () => {
    const start = eventStartIST("2026-11-20");
    expect(start.toISOString()).toBe("2026-11-20T14:30:00.000Z");
    const s = buildSchedule(start, 1);
    expect(s.deadlines.find((d) => d.code === "PRD_LOCK")!.at).toBe("2026-11-20T17:30:00.000Z"); // 23:00 IST
    expect(s.deadlines.find((d) => d.code === "SOLUTION_LOCK")!.at).toBe("2026-11-20T20:15:00.000Z"); // 01:45 IST
    expect(s.rounds).toHaveLength(9);
  });

  test("rehearsal at 10× compresses the night into one hour", () => {
    const start = new Date("2026-11-19T10:00:00Z");
    const s = buildSchedule(start, 10);
    const awards = s.phases.find((p) => p.code === "AWARDS")!;
    expect(new Date(awards.ends_at).getTime() - start.getTime()).toBe(60 * 60_000);
    const r1 = s.rounds[0]!;
    expect(new Date(r1.closes_at).getTime() - new Date(r1.opens_at).getTime()).toBe(90_000);
    expect(realToEventMinute(start, new Date(r1.opens_at), 10)).toBe(375);
  });
});

test("phaseReached follows the order of the night", () => {
  expect(phaseReached("AWARDS", "AWARDS")).toBe(true);
  expect(phaseReached("SETTLEMENT", "AWARDS")).toBe(false);
  expect(phaseReached("MARKET", "JUDGING_2")).toBe(true);
});
