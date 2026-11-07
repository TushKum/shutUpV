import { describe, expect, it } from "vitest";
import { portfolioTotals, positionLines } from "./portfolio";
import type { TradeCompanyRow } from "./trade";

const CMP = "c0000000-0000-0000-0000-000000000001";
const AQS = "a0000000-0000-0000-0000-000000000002";
const NEW = "e0000000-0000-0000-0000-000000000003";

const companies: TradeCompanyRow[] = [
  { id: CMP, ticker: "CMP", name: "Campus", market_price: 1040, closing_price: 922 },
  { id: AQS, ticker: "AQS", name: "AquaSense", market_price: 1380, closing_price: 1263 },
  { id: NEW, ticker: "NEW", name: null, market_price: null, closing_price: null },
];

describe("positionLines", () => {
  it("4,000 bought for $38,400 shows −$1,520 at a $9.22 closing price", () => {
    const [l] = positionLines([{ company_id: CMP, qty: 4000, cost_cents: "3840000" }], companies, true);
    expect(l).toMatchObject({ ticker: "CMP", qty: 4000, avgCost: 960, price: 922, value: 3_688_000, pnl: -152_000 });
  });

  it("average cost rounds half-up to the cent", () => {
    const [l] = positionLines([{ company_id: AQS, qty: 3000, cost_cents: 2_538_500 }], companies, false);
    expect(l!.avgCost).toBe(846); // $25,385 ÷ 3,000 = $8.4617
  });

  it("before the close lines are valued at the market price; sorted by ticker; empty holdings left out", () => {
    const lines = positionLines(
      [
        { company_id: CMP, qty: 100, cost_cents: 100_000 },
        { company_id: AQS, qty: 0, cost_cents: 0 },
        { company_id: NEW, qty: 10, cost_cents: 10_000 },
      ],
      companies,
      false,
    );
    expect(lines.map((l) => [l.ticker, l.price, l.value, l.pnl])).toEqual([
      ["CMP", 1040, 104_000, 4_000],
      ["NEW", null, null, null],
    ]);
  });
});

describe("portfolioTotals", () => {
  it("value, return, gain and the Round 3 points it would give", () => {
    const lines = positionLines([{ company_id: AQS, qty: 2000, cost_cents: 2_000_000 }], companies, false);
    const t = portfolioTotals(8_000_000, lines);
    // 80,000 + 2,000 × 13.80 = 107,600: +7.6% → 50 + 2.5 × 7.6 = 69
    expect(t).toEqual({ cash: 8_000_000, sharesValue: 2_760_000, value: 10_760_000, start: 10_000_000, gain: 760_000, returnBp: 760, points: 69, unrealised: 760_000, unpriced: 0 });
  });

  it("points stay between 0 and 100; unpriced lines are counted apart", () => {
    expect(portfolioTotals(0, []).points).toBe(0);
    expect(portfolioTotals(40_000_000, []).points).toBe(100);
    const lines = positionLines([{ company_id: NEW, qty: 10, cost_cents: 10_000 }], companies, false);
    expect(portfolioTotals(10_000_000, lines)).toMatchObject({ value: 10_000_000, points: 50, unpriced: 1 });
  });
});
