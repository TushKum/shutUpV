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
  test("live event: durations from the planned night; untimed Setup, trading phases and awards", () => {
    const s = buildSchedule(1);
    const d = Object.fromEntries(s.phases.map((p) => [p.code, p.duration_seconds]));
    expect(d.SETUP).toBeNull();
    expect(d.BUILD).toBe(105 * 60); // 21:15–23:00
    expect(d.RESCUE).toBe(90 * 60); // 00:15–01:45
    expect(d.MARKET_BLIND).toBeNull();
    expect(d.MARKET).toBeNull();
    expect(d.AWARDS).toBeNull(); // open until an organiser ends the night
    expect(s.rounds).toHaveLength(9);
    expect(s.rounds.every((r) => r.duration_seconds === 900)).toBe(true);
    expect(s.twist_offset_seconds).toBe(60 * 60); // an hour into Build: 22:15
    expect(s.freeze_offset_seconds).toBe(45 * 60); // 45 minutes into Market: 03:30
  });

  test("rehearsal at 10x: every duration ten times shorter (never under 30 seconds)", () => {
    const s = buildSchedule(10);
    expect(s.rounds[0]!.duration_seconds).toBe(90);
    expect(s.phases.find((p) => p.code === "REVEAL_1")!.duration_seconds).toBe(90);
    expect(buildSchedule(100).rounds[0]!.duration_seconds).toBe(30);
    expect(() => buildSchedule(0)).toThrow();
  });

  test("the 20:00 start of the planned night in IST", () => {
    expect(eventStartIST("2026-11-20").toISOString()).toBe("2026-11-20T14:30:00.000Z");
    expect(realToEventMinute(eventStartIST("2026-11-20"), new Date("2026-11-20T18:15:00Z"))).toBe(225);
  });
});

test("phaseReached follows the order of the night", () => {
  expect(phaseReached("AWARDS", "AWARDS")).toBe(true);
  expect(phaseReached("SETTLEMENT", "AWARDS")).toBe(false);
  expect(phaseReached("MARKET", "JUDGING_2")).toBe(true);
});
