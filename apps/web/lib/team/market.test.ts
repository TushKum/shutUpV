import { describe, expect, test } from "vitest";
import {
  BOOK_PUBLIC_FROM,
  PUBLIC_FROM,
  changeBp,
  changeText,
  chartPoints,
  historyLines,
  marketLines,
  marketOpensText,
  openBooks,
  parseBookKind,
  publicTypes,
  submissionSections,
  verdict,
  type PriceRow,
  type ScoreRow,
} from "./market";

describe("price changes, exactly", () => {
  test("basis points rounded half-up; the brief's clearing and cap", () => {
    expect(changeBp(1050, 1082)).toBe(305); // 32 / 1050 = 3.047…%
    expect(changeBp(1000, 1100)).toBe(1000); // the +10% cap
    expect(changeBp(1125, 956)).toBe(-1502); // the crisis −15% after rounding the price
    expect(changeBp(1000, 1000)).toBe(0);
    expect(() => changeBp(0, 100)).toThrow();
    expect(changeText(1050, 1082)).toBe("+$0.32 (+3.05%)");
    expect(changeText(1000, 900)).toBe("−$1.00 (−10%)");
    expect(changeText(null, 1050)).toBe("—");
  });
});

describe("the listing", () => {
  test("ticker order (never by price), with the last cleared round's move; unlisted companies are left out", () => {
    const lines = marketLines(
      [
        { id: "z", name: "Zeta", ticker: "ZZZ", ipo_price: 900, market_price: 1500 },
        { id: "a", name: null, ticker: "AQS", ipo_price: 1050, market_price: 1082 },
        { id: "n", name: "Unnamed", ticker: null, ipo_price: null, market_price: null },
      ],
      [{ company_id: "a", market_before: 1050, market_after: 1082 }],
    );
    expect(lines.map((l) => l.ticker)).toEqual(["AQS", "ZZZ"]);
    expect(lines[0]).toEqual({ id: "a", ticker: "AQS", name: "AQS", ipo: 1050, price: 1082, change: { before: 1050, after: 1082, bp: 305 } });
    expect(lines[1]!.change).toBeNull();
  });
});

describe("price history", () => {
  const row = (r: Partial<PriceRow> & Pick<PriceRow, "id" | "kind" | "market_after" | "created_at">): PriceRow => ({
    round_number: null,
    market_before: null,
    ai_before: null,
    ai_after: null,
    buy_qty: 0,
    sell_qty: 0,
    short_qty: 0,
    cover_qty: 0,
    net_qty: 0,
    tier_bp: null,
    ...r,
  });
  test("IPO first, every round and adjustment in order, the close last; AquaSense's numbers", () => {
    const lines = historyLines([
      row({ id: 9, kind: "CLOSE", market_before: 1400, market_after: 1263, ai_after: 1126, created_at: "2026-10-08T23:30:00Z" }),
      row({ id: 3, kind: "CRISIS", market_before: 1125, market_after: 956, ai_after: 893, created_at: "2026-10-08T19:00:00Z" }),
      row({ id: 1, kind: "IPO", market_after: 1050, ai_after: 1050, tier_bp: 500, created_at: "2026-10-08T17:45:00Z" }),
      row({
        id: 2,
        kind: "CLEARING",
        round_number: 1,
        market_before: 1050,
        market_after: 1082,
        ai_after: 1050,
        buy_qty: 3500,
        sell_qty: 500,
        net_qty: 3000,
        created_at: "2026-10-08T18:15:00Z",
      }),
      row({ id: 4, kind: "PLAN_TIER", market_before: 920, market_after: 1104, ai_after: 1072, tier_bp: 2000, created_at: "2026-10-08T22:00:00Z" }),
    ]);
    expect(lines.map((l) => l.label)).toEqual(["IPO price", "Round 1", "Crisis shock", "Plan tier", "Closing price"]);
    expect(lines[0]).toMatchObject({ price: 1050, change: "—", detail: "Pitch tier +5% on $10.00" });
    expect(lines[1]).toMatchObject({ change: "+$0.32 (+3.05%)", changeSign: 1, detail: "Net +3,000 (buy 3,500 · sell 500 · short 0 · cover 0)" });
    expect(lines[2]).toMatchObject({ price: 956, changeSign: -1, ai: 893 });
    expect(lines[3]).toMatchObject({ change: "+$1.84 (+20%)", detail: "+20% on the market and AI prices" });
    expect(lines[4]).toMatchObject({ price: 1263, detail: "(market $14.00 + AI $11.26) ÷ 2" });
  });
  test("the chart: market price per step, the AI price carried forward, tags on the IPO, crisis, tiers and close", () => {
    const points = chartPoints(
      historyLines([
        row({ id: 1, kind: "IPO", market_after: 1050, ai_after: 1050, tier_bp: 500, created_at: "2026-10-08T17:45:00Z" }),
        row({ id: 2, kind: "CLEARING", round_number: 1, market_before: 1050, market_after: 1082, ai_after: null, created_at: "2026-10-08T18:15:00Z" }),
        row({ id: 3, kind: "CRISIS", market_before: 1082, market_after: 920, ai_after: 893, created_at: "2026-10-08T19:00:00Z" }),
        row({ id: 4, kind: "PLAN_TIER", market_before: 920, market_after: 1104, ai_after: 1072, tier_bp: 2000, created_at: "2026-10-08T22:00:00Z" }),
        row({ id: 5, kind: "CLOSE", market_before: 1400, market_after: 1263, ai_after: 1126, created_at: "2026-10-08T23:30:00Z" }),
      ]),
    );
    expect(points).toEqual([
      { label: "IPO price", value: 1050, second: 1050, marker: "IPO" },
      { label: "Round 1", value: 1082, second: 1050, marker: null },
      { label: "Crisis shock", value: 920, second: 893, marker: "Crisis" },
      { label: "Plan tier", value: 1104, second: 1072, marker: "Plan" },
      { label: "Closing price", value: 1263, second: 1126, marker: "Close" },
    ]);
  });
  test("a technical appeal: after the close it moves the closing price; before it only the AI price", () => {
    const close = row({ id: 9, kind: "CLOSE", market_before: 780, market_after: 815, ai_after: 850, created_at: "2026-10-08T23:30:00Z" });
    const after = historyLines([
      row({ id: 12, kind: "APPEAL", market_before: 815, market_after: 773, ai_before: 850, ai_after: 765, tier_bp: -1000, created_at: "2026-10-09T00:35:00Z" }),
      close,
    ]);
    expect(after.map((l) => l.label)).toEqual(["Closing price", "Technical appeal"]);
    expect(after[1]).toMatchObject({ price: 773, changeSign: -1, ai: 765, detail: "AI price $8.50 → $7.65 (tier −10%); closing price $8.15 → $7.73" });
    const before = historyLines([
      row({ id: 5, kind: "APPEAL", market_before: 790, market_after: 790, ai_before: 850, ai_after: 765, tier_bp: -1000, created_at: "2026-10-08T22:10:00Z" }),
      row({ id: 6, kind: "CLEARING", round_number: 13, market_before: 790, market_after: 800, created_at: "2026-10-08T22:20:00Z" }),
    ]);
    expect(before.map((l) => l.label)).toEqual(["Technical appeal", "Round 13"]);
    expect(before[0]).toMatchObject({ price: 790, change: "—", detail: "AI price $8.50 → $7.65 (tier −10%)" });
  });
});

describe("what is public", () => {
  test("pitch from Reading, plan from Plans published, flash once its scores are released", () => {
    const none = { PITCH: false, PLAN: false, FLASH: false };
    expect(publicTypes("BUILD", none)).toEqual([]);
    expect(publicTypes("READING", none)).toEqual(["PITCH"]);
    expect(publicTypes("RESCUE_2", { ...none, PITCH: true })).toEqual(["PITCH"]);
    expect(publicTypes("PLANS_PUBLISHED", none)).toEqual(["PITCH", "PLAN"]);
    expect(publicTypes("ROUNDS_13_21", { PITCH: true, PLAN: true, FLASH: true })).toEqual(["PITCH", "PLAN", "FLASH"]);
  });
  test("books: the pitch book from Reading, crisis cards from the crisis, plans, then flash answers; ?type= is checked", () => {
    const none = { PITCH: false, PLAN: false, FLASH: false };
    expect(openBooks("BUILD", none)).toEqual([]);
    expect(openBooks("READING", none)).toEqual(["PITCH"]);
    expect(openBooks("CRISIS", { ...none, PITCH: true })).toEqual(["PITCH", "CRISIS"]);
    expect(openBooks("PLANS_PUBLISHED", { ...none, PITCH: true })).toEqual(["PITCH", "CRISIS", "PLAN"]);
    expect(openBooks("AWARDS", { PITCH: true, PLAN: true, FLASH: true })).toEqual(["PITCH", "CRISIS", "PLAN", "FLASH"]);
    expect(parseBookKind("crisis")).toBe("CRISIS");
    expect(parseBookKind(["plan", "x"])).toBe("PLAN");
    expect(parseBookKind("JUDGE_RUNS")).toBe("PITCH");
    expect(parseBookKind(undefined)).toBe("PITCH");
    expect(BOOK_PUBLIC_FROM.CRISIS).toMatch(/at the crisis/);
    expect(BOOK_PUBLIC_FROM.PLAN).toBe(PUBLIC_FROM.PLAN);
  });
  test("template sections in order; a missing or non-text section is empty", () => {
    const s = submissionSections("PITCH", { problem: "  Dirty water.  ", solution: 42, company_name: "AquaSense" });
    expect(s.map((x) => x.label)).toEqual(["The problem", "The solution", "Customers", "How we make money", "Our advantage", "Use of seed money"]);
    expect(s[0]!.text).toBe("Dirty water.");
    expect(s[1]!.text).toBe("");
  });
  test("before Reading, when the market opens", () => {
    expect(marketOpensText("2026-10-08T17:00:00Z")).toMatch(/^The market opens at 22:30 \(Reading\)/);
    expect(marketOpensText(null)).toMatch(/^The market opens at Reading/);
  });
});

describe("verdicts", () => {
  const score = (s: Partial<ScoreRow>): ScoreRow => ({
    company_id: "a",
    type: "PLAN",
    final_score: 88,
    median: 88,
    tier_bp: 2000,
    capped: false,
    late: false,
    missing: false,
    penalty: 0,
    ...s,
  });
  test("final score and tier, with the reasons: capped (CampusCart), late, missing, the injection penalty", () => {
    expect(verdict(score({}))).toEqual({ title: "Rescue plan", score: "88/100", tier: "+20% on the price", tierSign: 1, notes: [], lines: [], rationale: null });
    expect(verdict(score({ type: "PITCH", final_score: 66, median: 66, tier_bp: 500 })).tier).toBe("+5% on the IPO price");
    const capped = verdict(score({ final_score: 50, median: 78, tier_bp: 0, capped: true }));
    expect(capped).toMatchObject({ score: "50/100", tier: "0% on the price", tierSign: 0 });
    expect(capped.notes[0]).toMatch(/^Capped at 50: .*judges' median 78/);
    expect(verdict(score({ final_score: 0, tier_bp: -2000, late: true })).notes).toEqual(["Submitted late: scored 0."]);
    expect(verdict(score({ final_score: 0, tier_bp: -2000, missing: true })).tierSign).toBe(-1);
    expect(verdict(score({ final_score: 35, penalty: 10, tier_bp: -2000 })).notes[0]).toMatch(/^−10 points/);
  });
});

describe("verdict detail", () => {
  test("the published run's points per rubric line and its rationale", () => {
    const v = verdict({
      company_id: "c",
      type: "FLASH",
      final_score: 70,
      median: 70,
      tier_bp: 500,
      capped: false,
      late: false,
      missing: false,
      penalty: 0,
      breakdown: { responds_to_news: 35, realistic: "20", clear: 15 },
      rationale: "  Answers the news. Plausible. Clear.  ",
    });
    expect(v.lines).toEqual([
      { label: "Responds directly to the news", points: 35, max: 50 },
      { label: "Realistic", points: 20, max: 30 },
      { label: "Clear", points: 15, max: 20 },
    ]);
    expect(v.rationale).toBe("Answers the news. Plausible. Clear.");
  });

  test("a missing submission has no breakdown", () => {
    const v = verdict({ company_id: "c", type: "PLAN", final_score: 0, median: 0, tier_bp: -2000, capped: false, late: false, missing: true, penalty: 0, breakdown: null, rationale: null });
    expect(v.lines).toEqual([]);
    expect(v.rationale).toBeNull();
  });
});
