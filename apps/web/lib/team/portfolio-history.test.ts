import { describe, expect, test } from "vitest";
import { portfolioSeries, type LedgerMove, type PriceStep } from "./portfolio-history";

const T = (min: number) => new Date(Date.UTC(2026, 10, 14, 14, 30 + min)).toISOString();
const step = (min: number, kind: PriceStep["kind"], prices: Record<string, number>, roundNumber: number | null = null): PriceStep[] =>
  Object.entries(prices).map(([companyId, price]) => ({ at: T(min), kind, roundNumber, companyId, price }));

describe("portfolioSeries", () => {
  // Delta: $500,000; 5,000 seed shares of AQS at $10.00; 1,000 IPO shares of CCRT at $10.00; a 500-share short of
  // SNAP in round 1; the crisis; then the close covers the short at the closing price.
  const moves: LedgerMove[] = [
    { at: T(0), cash: 50_000_000, companyId: null, shares: 0, price: null },
    { at: T(60), cash: -5_000_000, companyId: "AQS", shares: 5000, price: 1000 },
    { at: T(195), cash: -1_000_000, companyId: "CCRT", shares: 1000, price: 1000 },
    { at: T(225), cash: 1000 * 500, companyId: "SNAP", shares: -500, price: 1000 },
    { at: T(540), cash: -900 * 500, companyId: "SNAP", shares: 500, price: 900 },
  ];
  const steps: PriceStep[] = [
    ...step(195, "IPO", { AQS: 1050, CCRT: 1000, SNAP: 1000 }),
    ...step(225, "CLEARING", { AQS: 1100, CCRT: 1000, SNAP: 1000 }, 1),
    ...step(270, "CRISIS", { AQS: 935, CCRT: 850, SNAP: 850 }),
    ...step(540, "CLOSE", { AQS: 1263, CCRT: 815, SNAP: 900 }),
  ];
  const s = portfolioSeries(moves, steps);

  test("a start point (seed shares at their $10.00), then one point per step, tagged", () => {
    expect(s.map((p) => [p.label, p.marker])).toEqual([
      ["Start", null],
      ["IPO", "IPO"],
      ["Round 1", null],
      ["Crisis", "Crisis"],
      ["Close", "Close"],
    ]);
    expect(s[0]!.value).toBe(50_000_000);
  });

  test("cash plus shares at each step's price; a short counts against the value", () => {
    // IPO: 45,000,000 + 5,000 × 10.50 + 1,000 × 10.00
    expect(s[1]!.value).toBe(44_000_000 + 5000 * 1050 + 1000 * 1000);
    // Round 1: the short's cash is in, the short is −500 × 10.00
    expect(s[2]!.value).toBe(44_500_000 + 5000 * 1100 + 1000 * 1000 - 500 * 1000);
    // Crisis: every price −15%
    expect(s[3]!.value).toBe(44_500_000 + 5000 * 935 + 1000 * 850 - 500 * 850);
    // Close: the short covered at $9.00 in the same transaction; the final value
    expect(s[4]!.value).toBe(44_050_000 + 5000 * 1263 + 1000 * 815);
  });

  test("two steps in one transaction (round 4 and the crisis; round 21 and the close) are two points, in order", () => {
    const pts = portfolioSeries(
      [{ at: T(0), cash: 1000, companyId: "AQS", shares: 10, price: 1000 }],
      [...step(270, "CRISIS", { AQS: 850 }), ...step(270, "CLEARING", { AQS: 1000 }, 4), ...step(540, "CLOSE", { AQS: 900 }), ...step(540, "CLEARING", { AQS: 950 }, 21)],
    );
    expect(pts.map((p) => [p.label, p.marker, p.value])).toEqual([
      ["Start", null, 1000 + 10 * 1000],
      ["Round 4", null, 1000 + 10 * 1000],
      ["Crisis", "Crisis", 1000 + 10 * 850],
      ["Round 21", null, 1000 + 10 * 950],
      ["Close", "Close", 1000 + 10 * 900],
    ]);
  });

  test("nothing yet: no points; no ledger before the first step: no start point", () => {
    expect(portfolioSeries([], [])).toEqual([]);
    const later = portfolioSeries([{ at: T(195), cash: 100, companyId: null, shares: 0, price: null }], step(195, "IPO", { AQS: 1050 }));
    expect(later.map((p) => p.label)).toEqual(["IPO"]);
  });
});
