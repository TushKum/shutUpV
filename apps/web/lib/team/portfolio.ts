// The team's portfolio in Round 3, pure logic: one line per company it holds, with the average cost, the price, the
// market value and the profit or loss (the engine's positionPnl); the portfolio's value, its return on the $100,000
// start and the Round 3 points that would give (the engine's round3Points). Before the close lines are valued at the
// market price; after it at the closing price, which is what the final Round 3 points use.

import { RULES, divRoundHalfUp, mul, positionPnl, returnBp, round3Points } from "@msim/engine";
import { cents } from "@/lib/format";
import type { HoldingRow, TradeCompanyRow } from "./trade";

export interface PositionLine {
  companyId: string;
  ticker: string;
  name: string | null;
  qty: number;
  /** What the shares held cost, in cents. */
  cost: number;
  /** cost ÷ qty, rounded half-up to the cent. */
  avgCost: number;
  /** Market price, or the closing price after the close; null before the company has a price. */
  price: number | null;
  value: number | null;
  pnl: number | null;
}

/** Lines with shares, by ticker. */
export function positionLines(holdings: readonly HoldingRow[], companies: readonly TradeCompanyRow[], closed: boolean): PositionLine[] {
  const byId = new Map(companies.map((c) => [c.id, c]));
  return holdings
    .filter((h) => h.qty > 0)
    .map((h) => {
      const c = byId.get(h.company_id);
      const cost = cents(h.cost_cents);
      const price = (closed ? (c?.closing_price ?? c?.market_price) : c?.market_price) ?? null;
      return {
        companyId: h.company_id,
        ticker: c?.ticker ?? "—",
        name: c?.name ?? null,
        qty: h.qty,
        cost,
        avgCost: divRoundHalfUp(cost, h.qty),
        price,
        value: price === null ? null : mul(h.qty, price),
        pnl: price === null ? null : positionPnl({ qty: h.qty, cost }, price),
      };
    })
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

export interface PortfolioTotals {
  cash: number;
  /** Σ shares × price. */
  sharesValue: number;
  /** cash + shares value. */
  value: number;
  start: number;
  /** value − $100,000. */
  gain: number;
  /** Return on the $100,000 start, in basis points. */
  returnBp: number;
  /** 50 + 2.5 × return %, kept between 0 and 100, rounded half-up. */
  points: number;
  /** Σ profit and loss of the priced lines. */
  unrealised: number;
  /** Lines without a price yet (left out of the value). */
  unpriced: number;
}

export function portfolioTotals(cash: number, lines: readonly PositionLine[]): PortfolioTotals {
  const priced = lines.filter((l) => l.value !== null);
  const sharesValue = priced.reduce((s, l) => s + l.value!, 0);
  const value = cash + sharesValue;
  const start = RULES.START_CASH;
  return {
    cash,
    sharesValue,
    value,
    start,
    gain: value - start,
    returnBp: returnBp(value, start),
    points: round3Points(value, start),
    unrealised: priced.reduce((s, l) => s + l.pnl!, 0),
    unpriced: lines.length - priced.length,
  };
}
