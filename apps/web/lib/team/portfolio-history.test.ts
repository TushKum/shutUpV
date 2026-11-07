import { describe, expect, test } from "vitest";
import { portfolioSeries, type LedgerMove, type PriceStep } from "./portfolio-history";

const T = (min: number) => new Date(Date.UTC(2026, 10, 20, 23, 30 + min)).toISOString();
const step = (min: number, kind: PriceStep["kind"], prices: Record<string, number>, roundNumber: number | null = null): PriceStep[] =>
  Object.entries(prices).map(([companyId, price]) => ({ at: T(min), kind, roundNumber, companyId, price }));

describe("portfolioSeries", () => {
  // $100,000 at 02:15; 1,000 CMP bought in round 1 at $10.00; 400 sold in round 2 at $12.00; the reveal at 02:45; the
  // close at 04:30.
  const moves: LedgerMove[] = [
    { at: T(165), cash: 10_000_000, companyId: null, shares: 0 },
    { at: T(180), cash: -1_000_000, companyId: "CMP", shares: 1000 },
    { at: T(195), cash: 400 * 1200, companyId: "CMP", shares: -400 },
  ];
  const steps: PriceStep[] = [
    ...step(0, "START", { CMP: 900, DLV: 1100 }),
    ...step(60, "CRISIS", { CMP: 800, DLV: 1000 }),
    ...step(180, "CLEARING", { CMP: 1000, DLV: 1000 }, 1),
    ...step(195, "CLEARING", { CMP: 1200, DLV: 1000 }, 2),
    ...step(195, "REVEAL", { CMP: 1500, DLV: 900 }),
    ...step(300, "CLOSE", { CMP: 1300, DLV: 950 }),
  ];
  const s = portfolioSeries(moves, steps);

  test("a start point, then one point per Round 3 step (the start prices and the crisis are left out)", () => {
    expect(s.map((p) => [p.label, p.marker])).toEqual([
      ["Start", null],
      ["Round 1", null],
      ["Round 2", null],
      ["Score reveal", "Reveal"],
      ["Close", "Close"],
    ]);
    expect(s[0]!.value).toBe(10_000_000);
  });

  test("cash plus shares at each step's price; the clearing comes before the reveal in one transaction", () => {
    expect(s[1]!.value).toBe(9_000_000 + 1000 * 1000);
    expect(s[2]!.value).toBe(9_480_000 + 600 * 1200);
    expect(s[3]!.value).toBe(9_480_000 + 600 * 1500);
    expect(s[4]!.value).toBe(9_480_000 + 600 * 1300);
  });

  test("nothing yet: no points; no ledger: only the steps", () => {
    expect(portfolioSeries([], [])).toEqual([]);
    expect(portfolioSeries([], step(180, "CLEARING", { CMP: 1000 }, 1)).map((p) => [p.label, p.value])).toEqual([["Round 1", 0]]);
  });
});
