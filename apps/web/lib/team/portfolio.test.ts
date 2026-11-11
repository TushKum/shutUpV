import { describe, expect, it } from "vitest";
import { collateralView, meterPct, portfolioTotals, positionLines } from "./portfolio";
import { buildOrderContext, type TradeCompanyRow } from "./trade";

const SNP = "s0000000-0000-0000-0000-000000000001";
const AQS = "a0000000-0000-0000-0000-000000000002";
const NEW = "n0000000-0000-0000-0000-000000000003";

const companies: TradeCompanyRow[] = [
  { id: SNP, ticker: "SNP", name: "SnapStudy", ipo_price: 1050, market_price: 1040, closing_price: 922 },
  { id: AQS, ticker: "AQS", name: "AquaSense", ipo_price: 1050, market_price: 1380, closing_price: 1263 },
  { id: NEW, ticker: "NEW", name: null, ipo_price: null, market_price: null, closing_price: null },
];

describe("positionLines", () => {
  it("acceptance test 6: 4,000 bought at $9.60 shows −$1,520 and a short of 2,000 at $10.30 shows +$2,160 at $9.22", () => {
    const lines = positionLines(
      [
        { company_id: SNP, lot: "EXCHANGE", qty: 4000, cost_cents: "3840000" },
        { company_id: SNP, lot: "SHORT", qty: 2000, cost_cents: 2_060_000 },
      ],
      companies,
      true,
    );
    expect(lines.map((l) => [l.lot, l.qty, l.avgCost, l.price, l.value, l.pnl])).toEqual([
      ["EXCHANGE", 4000, 960, 922, 3_688_000, -152_000],
      ["SHORT", 2000, 1030, 922, -1_844_000, 216_000],
    ]);
  });

  it("acceptance test 4: Delta's squad lot, 13,000 shares that cost $110,000, is worth $164,190 at $12.63", () => {
    const [l] = positionLines([{ company_id: AQS, lot: "SQUAD", qty: 13_000, cost_cents: 11_000_000 }], companies, true);
    expect(l).toMatchObject({ lot: "SQUAD", value: 16_419_000, pnl: 16_419_000 - 11_000_000, avgCost: 846 }); // $110,000 ÷ 13,000 = $8.4615…
  });

  it("before the close lines are valued at the market price", () => {
    const [l] = positionLines([{ company_id: SNP, lot: "EXCHANGE", qty: 100, cost_cents: 100_000 }], companies, false);
    expect(l).toMatchObject({ price: 1040, value: 104_000, pnl: 4_000 });
  });

  it("orders by ticker then EXCHANGE, SQUAD, SHORT; leaves out empty lots and lots that are not a fund's", () => {
    const lines = positionLines(
      [
        { company_id: SNP, lot: "SHORT", qty: 10, cost_cents: 10_000 },
        { company_id: AQS, lot: "SQUAD", qty: 5000, cost_cents: 5_000_000 },
        { company_id: SNP, lot: "EXCHANGE", qty: 0, cost_cents: 0 },
        { company_id: AQS, lot: "EXCHANGE", qty: 10, cost_cents: 10_500 },
        { company_id: AQS, lot: "RETAINED", qty: 60_000, cost_cents: 0 },
      ],
      companies,
      false,
    );
    expect(lines.map((l) => l.key)).toEqual([`${AQS}:EXCHANGE`, `${AQS}:SQUAD`, `${SNP}:SHORT`]);
  });

  it("a company without a price yet has no value", () => {
    const [l] = positionLines([{ company_id: NEW, lot: "SQUAD", qty: 5000, cost_cents: 5_000_000 }], companies, false);
    expect(l).toMatchObject({ price: null, value: null, pnl: null, avgCost: 1000 });
  });
});

describe("portfolioTotals", () => {
  it("cash + long − short, and the return on $500,000", () => {
    const lines = positionLines(
      [
        { company_id: SNP, lot: "EXCHANGE", qty: 4000, cost_cents: 3_840_000 },
        { company_id: SNP, lot: "SHORT", qty: 2000, cost_cents: 2_060_000 },
        { company_id: AQS, lot: "SQUAD", qty: 5000, cost_cents: 5_000_000 },
        { company_id: NEW, lot: "EXCHANGE", qty: 10, cost_cents: 10_000 },
      ],
      companies,
      false,
    );
    const t = portfolioTotals(40_000_000, lines);
    // Long: 4,000 × $10.40 + 5,000 × $13.80 = $41,600 + $69,000; short: 2,000 × $10.40 = $20,800.
    expect(t).toMatchObject({ cash: 40_000_000, longValue: 11_060_000, shortValue: 2_080_000, unpriced: 1, start: 50_000_000 });
    expect(t.value).toBe(40_000_000 + 11_060_000 - 2_080_000);
    expect(t.gain).toBe(t.value - 50_000_000);
    expect(t.returnBp).toBe(-204); // −$10,200 on $500,000 = −2.04%
    expect(t.unrealised).toBe(4_160_000 - 3_840_000 + (2_060_000 - 2_080_000) + (6_900_000 - 5_000_000));
  });

  it("an untouched fund is at 0%", () => {
    expect(portfolioTotals(50_000_000, [])).toMatchObject({ value: 50_000_000, returnBp: 0, gain: 0, unrealised: 0 });
  });
});

describe("collateralView", () => {
  it("locked vs required at current prices, and whether buys and shorts are blocked", () => {
    const ctx = buildOrderContext({
      trading: "OPEN",
      team: { track: "FINANCE", cash: 3_000_000, collateral: 3_120_000 },
      squadCompanyId: null,
      companies,
      holdings: [{ company_id: SNP, lot: "SHORT", qty: 2000, cost_cents: 2_060_000 }],
      orders: [],
      rounds: [],
    });
    // 150% × 2,000 × $10.40 = $31,200.
    expect(collateralView(ctx)).toEqual({ locked: 3_120_000, required: 3_120_000, cash: 3_000_000, deficit: 120_000, blocked: true });
  });
});

describe("meterPct", () => {
  it("whole percent, capped at 100", () => {
    expect(meterPct(0, 100)).toBe(0);
    expect(meterPct(12_500_000, 25_000_000)).toBe(50);
    expect(meterPct(30_000_000, 25_000_000)).toBe(100);
    expect(meterPct(5, 0)).toBe(0);
  });
});
