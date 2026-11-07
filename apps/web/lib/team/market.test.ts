import { describe, expect, test } from "vitest";
import { changeBp, changeText, chartPoints, historyLines, marketLines, publicTypes, sign, submissionSections, type PriceRow } from "./market";

describe("changes", () => {
  test("exact basis points, half-up; text with the money change", () => {
    expect(changeBp(1050, 1082)).toBe(305);
    expect(changeBp(1280, 1088)).toBe(-1500);
    expect(changeText(1000, 1100)).toBe("+$1.00 (+10%)");
    expect(changeText(null, 1100)).toBe("—");
    expect(sign(-3)).toBe(-1);
    expect(() => changeBp(0, 1)).toThrow();
  });
});

describe("the list", () => {
  test("ticker order, the last round's move and the trend line", () => {
    const lines = marketLines(
      [
        { id: "b", name: "Chai Co", ticker: "CHAI", start_price: 1000, market_price: 1082, score_price: 850, closing_price: null },
        { id: "a", name: "Masala Labs", ticker: "MLBT", start_price: 1280, market_price: 1088, score_price: 1088, closing_price: null },
        { id: "c", name: null, ticker: null, start_price: null, market_price: null, score_price: null, closing_price: null },
      ],
      [{ company_id: "b", market_before: 1050, market_after: 1082 }],
      { a: [1280, 1088], b: [1000, 850, 1050, 1082] },
    );
    expect(lines.map((l) => l.ticker)).toEqual(["CHAI", "MLBT"]);
    expect(lines[0]).toMatchObject({ change: { before: 1050, after: 1082, bp: 305 }, trend: [1000, 850, 1050, 1082] });
    expect(lines[1]).toMatchObject({ change: null, start: 1280, scorePrice: 1088 });
  });
});

describe("price history", () => {
  const row = (r: Partial<PriceRow> & Pick<PriceRow, "id" | "kind" | "market_after" | "created_at">): PriceRow => ({
    round_number: null,
    market_before: null,
    score_before: null,
    score_after: null,
    buy_qty: 0,
    sell_qty: 0,
    net_qty: 0,
    factor_bp: null,
    ...r,
  });
  const rows = [
    row({ id: 4, kind: "REVEAL", market_before: 1100, market_after: 1287, score_before: 1088, score_after: 1273, factor_bp: 11700, created_at: "2026-11-20T21:15:00Z" }),
    row({ id: 1, kind: "START", market_after: 1280, score_after: 1280, created_at: "2026-11-20T18:00:00Z" }),
    row({ id: 2, kind: "CRISIS", market_before: 1280, market_after: 1088, score_before: 1280, score_after: 1088, created_at: "2026-11-20T18:15:00Z" }),
    row({ id: 3, kind: "CLEARING", round_number: 1, market_before: 1088, market_after: 1100, buy_qty: 1500, sell_qty: 400, net_qty: 1100, score_after: 1088, created_at: "2026-11-20T21:00:00Z" }),
    row({ id: 5, kind: "CLOSE", market_before: 1370, market_after: 1322, score_after: 1273, created_at: "2026-11-20T23:00:00Z" }),
  ];

  test("in the order of the night, each step explained (Team Alpha's MLBT)", () => {
    const lines = historyLines(rows);
    expect(lines.map((l) => [l.label, l.price, l.change])).toEqual([
      ["Starting price", 1280, "—"],
      ["Crisis", 1088, "−$1.92 (−15%)"],
      ["Round 1", 1100, "+$0.12 (+1.1%)"],
      ["Score reveal", 1287, "+$1.87 (+17%)"],
      ["Closing price", 1322, "—"],
    ]);
    expect(lines[2]!.detail).toBe("Net +1,100 (buy 1,500 · sell 400)");
    expect(lines[3]!.detail).toBe("× 1.17 on both prices (crisis-solution score)");
    expect(lines[4]!.detail).toBe("(market $13.70 + score-based $12.73) ÷ 2");
  });

  test("the chart: market price, the score-based price carried forward, and tags", () => {
    expect(chartPoints(historyLines(rows)).map((p) => [p.value, p.second, p.marker])).toEqual([
      [1280, 1280, "Start"],
      [1088, 1088, "Crisis"],
      [1100, 1088, null],
      [1287, 1273, "Reveal"],
      [1322, 1273, "Close"],
    ]);
  });
});

test("what is public: PRDs from 23:30, solutions from 02:15", () => {
  expect(publicTypes("JUDGING_1")).toEqual([]);
  expect(publicTypes("REVEAL_1")).toEqual(["PRD"]);
  expect(publicTypes("JUDGING_2")).toEqual(["PRD"]);
  expect(publicTypes("MARKET_BLIND")).toEqual(["PRD", "SOLUTION"]);
});

test("a submission's parts in template order", () => {
  expect(submissionSections("SOLUTION", { diagnosis: "  Pouch ban. ", risks: 4 }).map((s) => [s.label, s.text])).toEqual([
    ["Diagnosis", "Pouch ban."],
    ["Three options", ""],
    ["Recommendation", ""],
    ["Per-pack maths", ""],
    ["Timeline", ""],
    ["Risks", ""],
  ]);
});
