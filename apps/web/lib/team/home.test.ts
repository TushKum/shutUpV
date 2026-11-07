import { describe, expect, test } from "vitest";
import type { PhaseCode } from "@msim/engine";
import { homePlan, idleText, nowTasks, upcoming, type HomeFacts, type HomeProgress } from "./home";

// The night of 20–21 Nov 2026 in IST (UTC+5:30).
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const day = h < 12 ? 21 : 20;
  return new Date(Date.UTC(2026, 10, day, h, m) - 330 * 60_000).toISOString();
};

const progress = (p: Partial<HomeProgress> = {}): HomeProgress => ({ prdVersion: 0, solutionVersion: 0, asked: 0, unanswered: 0, pendingOrders: 0, ...p });

function facts(phase: PhaseCode, now: string, extra: Partial<HomeFacts> = {}): HomeFacts {
  return {
    phase,
    paused: false,
    pausedAt: null,
    nowMs: new Date(at(now)).getTime(),
    drawnAt: null,
    prdsLockedAt: null,
    pricesStartedAt: null,
    crisisAppliedAt: null,
    solutionsLockedAt: null,
    scoresRevealedAt: null,
    marketClosedAt: null,
    leaderboardFrozen: false,
    deadlines: {
      PROBLEM_DRAW: at("21:15"),
      TWIST: at("22:15"),
      PRD_LOCK: at("23:00"),
      QA_CLOSE: at("00:15"),
      SOLUTION_LOCK: at("01:45"),
      LEADERBOARD_FREEZE: at("03:30"),
      MARKET_CLOSE: at("04:30"),
    },
    phaseStarts: { REVEAL_1: at("23:30"), CRISIS_QA: at("23:45"), MARKET_BLIND: at("02:15"), MARKET: at("02:45"), AWARDS: at("05:15") },
    openRound: null,
    nextRound: null,
    builtTicker: "CMP",
    rescuedTicker: null,
    progress: progress(),
    ...extra,
  };
}

const keys = (f: HomeFacts) => nowTasks(f).map((t) => t.key);

describe("now", () => {
  test("Round 1: the PRD from the draw until the lock", () => {
    expect(keys(facts("BRIEFING", "21:00"))).toEqual([]);
    const f = facts("BUILD", "22:00", { drawnAt: at("21:15") });
    const [prd] = nowTasks(f);
    expect(prd).toMatchObject({ key: "PRD", title: "Write your PRD for CMP", href: "/team/build", due: at("23:00"), state: "todo" });
    expect(nowTasks({ ...f, progress: progress({ prdVersion: 4 }) })[0]!.detail).toContain("Saved as you type");
    expect(keys({ ...f, nowMs: new Date(at("23:00")).getTime() })).toEqual([]);
    expect(keys({ ...f, paused: true, pausedAt: at("21:50") })).toEqual([]);
  });

  test("the crisis: ask, answer and write, soonest to close first", () => {
    const f = facts("CRISIS_QA", "23:50", { drawnAt: at("21:15"), crisisAppliedAt: at("23:45"), rescuedTicker: "DLV", progress: progress({ unanswered: 2 }) });
    expect(keys(f)).toEqual(["ASK", "ANSWER", "SOLUTION"]);
    const [ask, answer, sol] = nowTasks(f);
    expect(ask).toMatchObject({ title: "Ask DLV's founders about their company", state: "todo", due: at("00:15") });
    expect(answer).toMatchObject({ title: "Answer 2 questions about CMP", due: at("01:45") });
    expect(sol).toMatchObject({ title: "Write the crisis solution for DLV", href: "/team/rescue" });
    expect(nowTasks({ ...f, progress: progress({ asked: 1 }) })[0]).toMatchObject({ key: "ASK", state: "done", title: "You asked DLV's founders 1 question" });
    // After 00:15 in Rescue: no more asking, still answering and writing.
    expect(keys({ ...f, phase: "RESCUE", nowMs: new Date(at("00:30")).getTime() })).toEqual(["ANSWER", "SOLUTION"]);
  });

  test("Round 3: an open round", () => {
    const f = facts("MARKET", "03:00", { openRound: { number: 4, closes_at: at("03:15") } });
    expect(nowTasks(f)).toEqual([expect.objectContaining({ key: "TRADE", title: "Round 4 is open: place your orders", state: "todo", due: at("03:15") })]);
    expect(nowTasks({ ...f, progress: progress({ pendingOrders: 3 }) })[0]).toMatchObject({ state: "done" });
    expect(keys({ ...f, paused: true, pausedAt: at("03:01") })).toEqual([]);
  });
});

describe("coming up", () => {
  test("the moments ahead, soonest first, without what is already in Now", () => {
    const f = facts("BUILD", "22:00", { drawnAt: at("21:15") });
    expect(upcoming(f, nowTasks(f)).map((u) => u.key)).toEqual(["TWIST", "REVEAL_1", "CRISIS_QA", "QA_CLOSE", "SOLUTION_LOCK"]);
    const late = facts("MARKET", "03:20", { nextRound: { number: 5, opens_at: at("03:30") } });
    expect(upcoming(late, []).map((u) => u.key)).toEqual(["ROUND_5", "LEADERBOARD_FREEZE", "MARKET_CLOSE", "AWARDS"]);
  });
});

describe("idle", () => {
  test("says what the team is waiting for", () => {
    expect(idleText(facts("JUDGING_1", "23:10"))).toContain("23:30");
    expect(idleText(facts("JUDGING_2", "02:00"))).toContain("02:15");
    expect(idleText(facts("MARKET", "03:16", { nextRound: { number: 5, opens_at: at("03:30") } }))).toMatch(/^Between rounds: round 5 opens at/);
    expect(idleText(facts("AWARDS", "05:20"))).toBe("The results are out: see the leaderboard.");
    expect(idleText(facts("BUILD", "22:00", { paused: true }))).toContain("paused");
  });
  test("homePlan puts them together", () => {
    const p = homePlan(facts("SETUP", "19:00"));
    expect(p.now).toEqual([]);
    expect(p.next[0]!.key).toBe("PROBLEM_DRAW");
  });
});
