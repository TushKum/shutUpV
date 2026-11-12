import { describe, expect, test } from "vitest";
import { badgeFactsFromRow, badgesFor, scoreNow, type BadgeFacts } from "./badges";

const base: BadgeFacts = {
  track: "PRODUCT",
  submitted: [],
  scores: {},
  feeAgreed: false,
  dealEarly: false,
  callsCorrect: 0,
  questionsAsked: 0,
  answersGiven: 0,
  ipoBids: 0,
  trades: 0,
  companiesHeld: 0,
  messages: 0,
  company: null,
  valueNow: null,
};
const earned = (f: BadgeFacts) => badgesFor(f).filter((b) => b.earned).map((b) => b.key);
const keys = (f: BadgeFacts) => badgesFor(f).map((b) => b.key);

describe("badges", () => {
  test("each track has its own set, and nothing is earned at the start", () => {
    expect(keys(base)).toEqual(["TEAM_TALK", "LAUNCH", "STAR_PITCH", "RESCUE_HERO", "QUICK_THINKER", "GOOD_LISTENER", "COMEBACK", "VALUE_MAKER", "EARLY_DEAL"]);
    expect(keys({ ...base, track: "CONSULTING" })).toEqual(["TEAM_TALK", "LAUNCH", "STAR_PITCH", "RESCUE_HERO", "QUICK_THINKER", "FAIR_FEE", "SHARP_EYE", "FORTUNE_TELLER", "EARLY_DEAL"]);
    expect(keys({ ...base, track: "FINANCE" })).toEqual(["TEAM_TALK", "EARLY_DEAL", "CURIOUS", "FIRST_BID", "FIRST_TRADE", "BASKET", "GROWING", "BIG_WIN"]);
    for (const track of ["PRODUCT", "CONSULTING", "FINANCE"] as const) expect(earned({ ...base, track })).toEqual([]);
    for (const b of badgesFor(base)) expect(b.how.length).toBeGreaterThan(10);
  });

  test("the squad's writing: on time, then by score (thresholds included)", () => {
    expect(earned({ ...base, submitted: ["PITCH"], scores: { PITCH: 80, PLAN: 79, FLASH: 70 } })).toEqual(["LAUNCH", "STAR_PITCH", "QUICK_THINKER"]);
    expect(earned({ ...base, track: "CONSULTING", scores: { PLAN: 92 } })).toEqual(["RESCUE_HERO"]);
  });

  test("Product: answers, a comeback of 10% from the post-crisis price, and a close above the IPO price", () => {
    const company = { ipo: 1100, market: 1086, postCrisis: 987, closing: null };
    expect(earned({ ...base, answersGiven: 3, company })).toEqual(["GOOD_LISTENER", "COMEBACK"]); // 1086 ≥ 987 × 1.1
    expect(earned({ ...base, company: { ...company, market: 1085 } })).toEqual([]);
    expect(earned({ ...base, company: { ...company, closing: 1145 } })).toEqual(["COMEBACK", "VALUE_MAKER"]);
  });

  test("Consulting: an agreed fee, correct calls, the early deal; earned badges come first", () => {
    const f = { ...base, track: "CONSULTING" as const, feeAgreed: true, callsCorrect: 4, dealEarly: true };
    expect(earned(f)).toEqual(["FAIR_FEE", "SHARP_EYE", "FORTUNE_TELLER", "EARLY_DEAL"]);
    expect(badgesFor(f)[0]!.key).toBe("FAIR_FEE");
  });

  test("Finance: questions, the IPO, trades, a basket of 5, and the fund's growth", () => {
    const f = { ...base, track: "FINANCE" as const, questionsAsked: 3, ipoBids: 1, trades: 2, companiesHeld: 5, messages: 5 };
    expect(earned({ ...f, valueNow: 50_000_000 })).toEqual(["TEAM_TALK", "CURIOUS", "FIRST_BID", "FIRST_TRADE", "BASKET"]);
    expect(earned({ ...f, valueNow: 50_000_001 })).toContain("GROWING");
    expect(earned({ ...f, valueNow: 54_999_999 })).not.toContain("BIG_WIN");
    expect(earned({ ...f, valueNow: 55_000_000 })).toContain("BIG_WIN");
  });

  test("the database row maps to the facts (counts come back as numbers or strings)", () => {
    const f = badgeFactsFromRow(
      {
        track: "FINANCE",
        submitted: [],
        scores: {},
        fee_agreed: false,
        deal_early: true,
        calls_correct: 0,
        questions_asked: "3" as unknown as number,
        answers_given: 0,
        ipo_bids: 1,
        trades: 0,
        companies_held: 0,
        messages: 0,
        company: null,
      },
      51_000_000,
    );
    expect(f).toMatchObject({ dealEarly: true, questionsAsked: 3, ipoBids: 1, valueNow: 51_000_000, company: null });
  });
});

describe("score now", () => {
  test("a fund: cash + shares against $500,000", () => {
    expect(scoreNow("FINANCE", 45_000_000, 6_195_100, null)).toEqual({ value: 51_195_100, start: 50_000_000, changeBp: 239 });
    expect(scoreNow("FINANCE", 45_000_000, null, null)).toEqual({ value: null, start: 50_000_000, changeBp: null }); // before the IPO
  });

  test("a company: retained shares + cash against 60,000 × IPO price + the $50,000 seed", () => {
    // IPO $11.00: start $660,000 + $50,000 = $710,000. Now $107,000 cash + 49,500 × $11.45.
    expect(scoreNow("PRODUCT", 10_700_000, 56_677_500, 1100)).toEqual({ value: 67_377_500, start: 71_000_000, changeBp: -510 });
    expect(scoreNow("PRODUCT", 5_000_000, null, null)).toEqual({ value: null, start: null, changeBp: null });
  });

  test("a consultancy starts at $0: the value is what it has earned, with no percentage", () => {
    expect(scoreNow("CONSULTING", 1_500_000, null, null)).toEqual({ value: 1_500_000, start: 0, changeBp: null });
    expect(scoreNow("CONSULTING", 1_500_000, 1_717_500, null)).toEqual({ value: 3_217_500, start: 0, changeBp: null });
  });

  test("a PRIMUS event has its own badges: crises, hiring and stars instead of the rescue and the flash", () => {
    const p: BadgeFacts = { ...base, format: "PRIMUS" };
    expect(keys(p)).toEqual(["TEAM_TALK", "LAUNCH", "STAR_PITCH", "GOOD_LISTENER", "VALUE_MAKER", "FIRST_HIRE", "CRISIS_TAMER", "UNBREAKABLE", "PROBLEM_SOLVER"]);
    expect(earned({ ...p, hires: 1, scores: { CRISIS_2: 84 }, submitted: ["CRISIS_1", "CRISIS_2", "CRISIS_3", "CRISIS_4"] })).toEqual(["FIRST_HIRE", "CRISIS_TAMER", "UNBREAKABLE"]);
    const firm: BadgeFacts = { ...p, track: "CONSULTING" };
    expect(keys(firm)).not.toContain("FAIR_FEE");
    expect(earned({ ...firm, clients: 5, fiveStars: 1, ratings: 3, ratingAvg: 4.33 })).toEqual(["FIRST_CLIENT", "IN_DEMAND", "FIVE_STARS", "TRUSTED"]);
    expect(earned({ ...firm, clients: 2, ratings: 2, ratingAvg: 5 })).toEqual(["FIRST_CLIENT"]);
  });
});
