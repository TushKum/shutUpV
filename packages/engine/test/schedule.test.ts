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
    ["CHECKIN", "20:00", "20:30"],
    ["BRIEFING", "20:30", "21:00"],
    ["SQUAD_DRAW", "21:00", "21:10"],
    ["BUILD", "21:10", "22:30"],
    ["READING", "22:30", "23:15"],
    ["IPO", "23:15", "23:30"],
    ["ROUNDS_1_4", "23:30", "00:30"],
    ["CRISIS", "00:30", "00:45"],
    ["RESCUE_1", "00:45", "01:45"],
    ["BREAK", "01:45", "02:00"],
    ["RESCUE_2", "02:00", "03:00"],
    ["PLANS_PUBLISHED", "03:00", "03:30"],
    ["VERDICTS", "03:30", "03:30"],
    ["ROUNDS_13_21", "03:30", "05:00"],
    ["CLOSE", "05:00", "05:00"],
    ["SETTLEMENT", "05:00", "05:30"],
    ["APPEALS", "05:30", "05:40"],
    ["AWARDS", "05:40", "06:00"],
  ])("%s runs %s–%s", (code, start, end) => {
    expect(formatEventMinute(phase(code).start)).toBe(start);
    expect(formatEventMinute(phase(code).end)).toBe(end);
  });

  test("21 rounds: 1–12 are 15 minutes, 13–21 are 10 minutes, inside their phases", () => {
    expect(DEFAULT_ROUNDS.map((r) => r.number)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
    for (const r of DEFAULT_ROUNDS) {
      expect(r.end - r.start).toBe(r.number <= 12 ? 15 : 10);
      const p = phase(r.phase);
      expect(r.start).toBeGreaterThanOrEqual(p.start);
      expect(r.end).toBeLessThanOrEqual(p.end);
    }
    expect(formatEventMinute(DEFAULT_ROUNDS[0]!.start)).toBe("23:30");
    expect(formatEventMinute(DEFAULT_ROUNDS[16]!.end)).toBe("04:20"); // round 17 clears at 04:20
    expect(formatEventMinute(DEFAULT_ROUNDS[20]!.end)).toBe("05:00");
  });

  test.each([
    ["PROBLEM_PICK", "21:10"],
    ["PITCH", "22:30"],
    ["CALL_1", "23:15"],
    ["IPO_BIDS", "23:30"],
    ["FEE", "01:05"],
    ["DEAL_BONUS", "02:45"],
    ["DEAL", "03:00"],
    ["PLAN", "03:00"],
    ["CALL_2", "03:40"],
    ["FLASH_BULLETIN", "04:00"],
    ["FLASH", "04:15"],
    ["FLASH_TIER", "04:20"],
    ["CALL_3", "04:30"],
  ])("deadline %s is at %s", (code, time) => {
    expect(formatEventMinute(at(code))).toBe(time);
  });
});

describe("buildSchedule", () => {
  test("live event: 20:00 IST is 14:30 UTC", () => {
    const start = eventStartIST("2026-11-14");
    expect(start.toISOString()).toBe("2026-11-14T14:30:00.000Z");
    const s = buildSchedule(start, 1);
    expect(s.phases.find((p) => p.code === "BUILD")!.ends_at).toBe("2026-11-14T17:00:00.000Z"); // 22:30 IST
    expect(s.deadlines.find((d) => d.code === "PLAN")!.at).toBe("2026-11-14T21:30:00.000Z"); // 03:00 IST next day
    expect(s.rounds).toHaveLength(21);
  });

  test("rehearsal at 10× compresses the night into one hour", () => {
    const start = new Date("2026-11-13T10:00:00Z");
    const s = buildSchedule(start, 10);
    const awards = s.phases.find((p) => p.code === "AWARDS")!;
    expect(new Date(awards.ends_at).getTime() - start.getTime()).toBe(60 * 60_000);
    const r1 = s.rounds[0]!;
    expect(new Date(r1.closes_at).getTime() - new Date(r1.opens_at).getTime()).toBe(90_000);
    expect(realToEventMinute(start, new Date(r1.opens_at), 10)).toBe(210);
  });
});

test("phaseReached follows the order of the night", () => {
  expect(phaseReached("AWARDS", "AWARDS")).toBe(true);
  expect(phaseReached("APPEALS", "AWARDS")).toBe(false);
  expect(phaseReached("CRISIS", "READING")).toBe(true);
});
