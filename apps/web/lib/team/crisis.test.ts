import { describe, expect, test } from "vitest";
import {
  countersLeft,
  currentSubround,
  draftState,
  feeBand,
  hiringOpen,
  offerMoves,
  parseDollars,
  parseShares,
  pastSubrounds,
  ratingOpen,
  statementCounts,
  subroundTimeline,
  termsText,
  type DraftPickRow,
  type OfferRow,
  type SubroundRow,
} from "./crisis";

const NOPAUSE = { paused: false, pausedAt: null };
const T = (m: number) => new Date(Date.UTC(2026, 10, 14, 20, m)).toISOString();
const NOW = Date.parse(T(30));
const sub = (k: number, revealed: boolean): SubroundRow => ({ k, revealed_at: revealed ? T(0) : null, hiring_closed_at: null, due_closed_at: null, rated_at: null });

describe("current sub-round", () => {
  test("Round 2: the latest revealed crisis; Round 3: 5; otherwise none", () => {
    expect(currentSubround("PRESSURE", [sub(1, true), sub(2, true), sub(3, false)])).toBe(2);
    expect(currentSubround("PRESSURE", [sub(1, false)])).toBeNull();
    expect(currentSubround("SATURATION", [])).toBe(5);
    expect(currentSubround("IPO", [sub(1, true)])).toBeNull();
  });
  test("history lists the earlier revealed crises, newest first", () => {
    expect(pastSubrounds(3, [sub(1, true), sub(2, true), sub(3, true), sub(4, false)])).toEqual([2, 1]);
    expect(pastSubrounds(5, [sub(1, true), sub(4, true), sub(5, false)])).toEqual([4, 1]);
  });
});

describe("windows", () => {
  const d = { REVEAL_1: T(0), HIRE_1: T(20), DUE_1: T(25), RATE_1: T(40), DRAFT: T(10), HIRE_5: T(45) } as const;
  test("hiring is open until HIRE_k in Round 2, and between the draft and HIRE_5 in Round 3", () => {
    expect(hiringOpen(1, "PRESSURE", d, Date.parse(T(10)), NOPAUSE)).toBe(true);
    expect(hiringOpen(1, "PRESSURE", d, NOW, NOPAUSE)).toBe(false);
    expect(hiringOpen(5, "SATURATION", d, NOW, NOPAUSE)).toBe(true);
    expect(hiringOpen(5, "SATURATION", d, Date.parse(T(5)), NOPAUSE)).toBe(false);
    expect(hiringOpen(null, "PRESSURE", d, NOW, NOPAUSE)).toBe(false);
  });
  test("rating is open between DUE_k and RATE_k", () => {
    expect(ratingOpen(1, d, NOW, NOPAUSE)).toBe(true);
    expect(ratingOpen(1, d, Date.parse(T(21)), NOPAUSE)).toBe(false);
    expect(ratingOpen(1, d, Date.parse(T(41)), NOPAUSE)).toBe(false);
  });
  test("the timeline marks the steps passed", () => {
    const steps = subroundTimeline(1, d, NOW, NOPAUSE);
    expect(steps.map((s) => [s.code, s.passed])).toEqual([
      ["REVEAL_1", true],
      ["HIRE_1", true],
      ["DUE_1", true],
      ["RATE_1", false],
    ]);
    expect(subroundTimeline(5, d, NOW, NOPAUSE)[0]!.code).toBe("DRAFT");
  });
});

describe("offers", () => {
  const offer = (o: Partial<OfferRow> = {}): OfferRow => ({
    id: "o",
    k: 1,
    company_id: "c",
    firm_team_id: "f",
    cash_cents: 50000,
    shares: 0,
    note: "",
    status: "OPEN",
    turn: "FIRM",
    company_counters: 0,
    firm_counters: 0,
    updated_at: T(0),
    ...o,
  });
  test("the side whose turn it is answers; the company may always withdraw", () => {
    expect(offerMoves(offer(), "FIRM", true)).toEqual(["ACCEPT", "DECLINE", "COUNTER"]);
    expect(offerMoves(offer(), "COMPANY", true)).toEqual(["WITHDRAW"]);
    expect(offerMoves(offer({ turn: "COMPANY" }), "COMPANY", true)).toEqual(["ACCEPT", "DECLINE", "COUNTER", "WITHDRAW"]);
  });
  test("three counters each, nothing once closed or after hiring", () => {
    expect(offerMoves(offer({ firm_counters: 3 }), "FIRM", true)).toEqual(["ACCEPT", "DECLINE"]);
    expect(countersLeft(offer({ company_counters: 2 }), "COMPANY")).toBe(1);
    expect(offerMoves(offer({ status: "ACCEPTED" }), "FIRM", true)).toEqual([]);
    expect(offerMoves(offer(), "FIRM", false)).toEqual([]);
  });
  test("amounts and terms", () => {
    expect(parseDollars("$1,250.5")).toBe(125050);
    expect(parseDollars("")).toBe(0);
    expect(parseDollars("12.345")).toBeNull();
    expect(parseDollars("-5")).toBeNull();
    expect(parseShares("1,000")).toBe(1000);
    expect(parseShares("1.5")).toBeNull();
    expect(termsText("$500.00", 0)).toBe("$500.00");
    expect(termsText("$0.00", 1)).toBe("1 share");
    expect(termsText("$800.00", 100)).toBe("$800.00 + 100 shares");
    expect(feeBand(1_000_000)).toEqual({ min: 50_000, max: 200_000 });
  });
});

describe("the Round 3 draft", () => {
  const pick = (company_id: string, pick_no: number, statement_id: string | null = null): DraftPickRow => ({
    company_id,
    pick_no,
    score_avg: 50,
    opens_at: T(0),
    closes_at: T(1),
    statement_id,
    picked_at: null,
    by_default: false,
  });
  test("whose turn it is and how many are ahead", () => {
    const picks = [pick("a", 1, "s1"), pick("b", 2), pick("c", 3)];
    expect(draftState(picks, "b")).toMatchObject({ myTurn: true, ahead: 0, done: false });
    expect(draftState(picks, "c")).toMatchObject({ myTurn: false, ahead: 1 });
    expect(draftState([pick("a", 1, "s1")], "a")).toMatchObject({ current: null, done: true });
    expect(statementCounts([pick("a", 1, "s1"), pick("b", 2, "s1"), pick("c", 3, "s2")])).toEqual(new Map([["s1", 2], ["s2", 1]]));
  });
});
