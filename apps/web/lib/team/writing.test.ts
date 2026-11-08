import { describe, expect, test } from "vitest";
import { closedNote, writingOpen, type WritingFacts } from "./writing";
import { deadlinePassed } from "./time";

const lock = "2026-11-20T17:30:00Z"; // 23:00 IST
const base: WritingFacts = {
  phase: "BUILD",
  paused: false,
  pausedAt: null,
  nowMs: Date.parse(lock) - 1000,
  drawnAt: "2026-11-20T15:45:00Z",
  prdsLockedAt: null,
  crisisAppliedAt: null,
  solutionsLockedAt: null,
  lock,
};

describe("the PRD window", () => {
  test("open from the draw until 23:00:00 (exclusive), in Briefing or Build, not while paused", () => {
    expect(writingOpen("PRD", base)).toBe(true);
    expect(writingOpen("PRD", { ...base, phase: "BRIEFING" })).toBe(true);
    expect(writingOpen("PRD", { ...base, nowMs: Date.parse(lock) })).toBe(false); // 23:00:00
    expect(writingOpen("PRD", { ...base, nowMs: Date.parse(lock) + 1000 })).toBe(false); // 23:00:01
    expect(writingOpen("PRD", { ...base, drawnAt: null })).toBe(false);
    expect(writingOpen("PRD", { ...base, prdsLockedAt: lock })).toBe(false);
    expect(writingOpen("PRD", { ...base, phase: "JUDGING_1" })).toBe(false);
    expect(writingOpen("PRD", { ...base, paused: true, pausedAt: "2026-11-20T17:00:00Z" })).toBe(false);
  });

  test("the closed editor says why", () => {
    expect(closedNote("PRD", { ...base, drawnAt: null })).toBe("The PRD opens when the problem cards are dealt.");
    expect(closedNote("PRD", { ...base, nowMs: Date.parse(lock) + 1 })).toBe("The PRD is locked (23:00): the version saved before then is the one judged.");
    expect(closedNote("PRD", { ...base, paused: true, pausedAt: lock })).toMatch(/paused/);
  });
});

describe("the solution window", () => {
  const sol = { ...base, phase: "RESCUE" as const, crisisAppliedAt: "2026-11-20T18:15:00Z", lock: "2026-11-20T20:15:00Z", nowMs: Date.parse("2026-11-20T19:00:00Z") };
  test("open from the crisis until 01:45, in Crisis & Q&A or Rescue", () => {
    expect(writingOpen("SOLUTION", sol)).toBe(true);
    expect(writingOpen("SOLUTION", { ...sol, phase: "CRISIS_QA" })).toBe(true);
    expect(writingOpen("SOLUTION", { ...sol, crisisAppliedAt: null })).toBe(false);
    expect(writingOpen("SOLUTION", { ...sol, phase: "JUDGING_2" })).toBe(false);
    expect(closedNote("SOLUTION", { ...sol, crisisAppliedAt: null })).toMatch(/opens at the crisis/);
  });
});

test("deadlinePassed mirrors app.deadline_passed (at the deadline it has passed; frozen while paused)", () => {
  expect(deadlinePassed(lock, Date.parse(lock))).toBe(true);
  expect(deadlinePassed(lock, Date.parse(lock) - 1)).toBe(false);
  expect(deadlinePassed(null, 0)).toBe(false);
  expect(deadlinePassed(lock, Date.parse(lock) + 5000, { paused: true, pausedAt: "2026-11-20T17:29:00Z" })).toBe(false);
});
