// The fund's positions, pure logic: one line per company and lot (EXCHANGE: bought at the IPO and on the exchange;
// SQUAD: the seed shares and the rescue deal's shares; SHORT: shares sold short) with the average cost, the price,
// the market value and the unrealised profit and loss (the engine's positionPnl); the portfolio's value and its
// return on the $500,000 start (the engine's financeValue and returnBp); and the collateral and short-exposure
// limits. Before the close lines are valued at the market price; after it at the closing price (shorts were covered).

import {
  RULES,
  collateralFor,
  divRoundHalfUp,
  financeValue,
  floorDiv,
  mul,
  positionPnl,
  returnBp,
  type Holding,
  type OrderContext,
} from "@msim/engine";
import { cents } from "@/lib/format";
import type { HoldingRow, TradeCompanyRow } from "./trade";

export type FundLot = "EXCHANGE" | "SQUAD" | "SHORT";

const LOT_ORDER: Record<FundLot, number> = { EXCHANGE: 0, SQUAD: 1, SHORT: 2 };

export const FUND_LOT_LABELS: Record<FundLot, string> = {
  EXCHANGE: "Exchange",
  SQUAD: "Squad lot",
  SHORT: "Short",
};

export const FUND_LOT_HINTS: Record<FundLot, string> = {
  EXCHANGE: "Bought at the IPO and on the exchange; counts towards the 4,000-share limit.",
  SQUAD: "Seed shares and the rescue deal's shares in your squad's company; never traded, outside the 4,000-share limit.",
  SHORT: "Sold short; covered with Cover orders, or at the closing price at the close.",
};

export interface PositionLine {
  key: string;
  companyId: string;
  ticker: string;
  name: string | null;
  lot: FundLot;
  qty: number;
  /** What the lot cost (EXCHANGE, SQUAD) or what the short sale brought in (SHORT), in cents. */
  cost: number;
  /** cost ÷ qty, rounded half-up to the cent. */
  avgCost: number;
  /** Current market price, or the closing price after the close; null before the company has a price. */
  price: number | null;
  /** qty × price; negative for a short (what it would cost to cover). */
  value: number | null;
  /** Long: value − cost. Short: proceeds − cost to cover. */
  pnl: number | null;
}

/** Lines with shares, ordered by ticker and then EXCHANGE, SQUAD, SHORT. */
export function positionLines(holdings: readonly HoldingRow[], companies: readonly TradeCompanyRow[], closed: boolean): PositionLine[] {
  const byId = new Map(companies.map((c) => [c.id, c]));
  const lines: PositionLine[] = [];
  for (const h of holdings) {
    if (h.qty <= 0 || (h.lot !== "EXCHANGE" && h.lot !== "SQUAD" && h.lot !== "SHORT")) continue;
    const c = byId.get(h.company_id);
    const cost = cents(h.cost_cents);
    const price = (closed ? (c?.closing_price ?? c?.market_price) : c?.market_price) ?? null;
    const short = h.lot === "SHORT";
    let value: number | null = null;
    let pnl: number | null = null;
    if (price !== null) {
      value = short ? -mul(h.qty, price) : mul(h.qty, price);
      const p = short
        ? positionPnl({ exchangeQty: 0, exchangeCost: 0, shortQty: h.qty, shortProceeds: cost }, price)
        : positionPnl({ exchangeQty: h.qty, exchangeCost: cost, shortQty: 0, shortProceeds: 0 }, price);
      pnl = short ? p.short : p.long;
    }
    lines.push({
      key: `${h.company_id}:${h.lot}`,
      companyId: h.company_id,
      ticker: c?.ticker ?? "—",
      name: c?.name ?? null,
      lot: h.lot,
      qty: h.qty,
      cost,
      avgCost: divRoundHalfUp(cost, h.qty),
      price,
      value,
      pnl,
    });
  }
  return lines.sort((a, b) => a.ticker.localeCompare(b.ticker) || LOT_ORDER[a.lot] - LOT_ORDER[b.lot]);
}

export interface PortfolioTotals {
  cash: number;
  /** Σ long shares × price (exchange and squad lots). */
  longValue: number;
  /** Σ short shares × price (what covering every short would cost). */
  shortValue: number;
  /** cash + long value − short value (the brief's Finance value). */
  value: number;
  start: number;
  /** value − $500,000. */
  gain: number;
  /** Return on the $500,000 start, in basis points. */
  returnBp: number;
  /** Σ unrealised profit and loss of the priced lines. */
  unrealised: number;
  /** Lines without a price yet (left out of the value). */
  unpriced: number;
}

export function portfolioTotals(cash: number, lines: readonly PositionLine[]): PortfolioTotals {
  const priced = lines.filter((l) => l.price !== null);
  const byCompany = new Map<string, Holding>();
  const prices: Record<string, number> = {};
  for (const l of priced) {
    const h = byCompany.get(l.companyId) ?? { companyId: l.companyId, longQty: 0, shortQty: 0 };
    byCompany.set(l.companyId, h);
    if (l.lot === "SHORT") h.shortQty += l.qty;
    else h.longQty += l.qty;
    prices[l.companyId] = l.price!;
  }
  const value = financeValue(cash, [...byCompany.values()], prices);
  const start = RULES.START_CASH_FINANCE;
  return {
    cash,
    longValue: priced.filter((l) => l.lot !== "SHORT").reduce((s, l) => s + l.value!, 0),
    shortValue: priced.filter((l) => l.lot === "SHORT").reduce((s, l) => s - l.value!, 0),
    value,
    start,
    gain: value - start,
    returnBp: returnBp(value, start),
    unrealised: priced.reduce((s, l) => s + l.pnl!, 0),
    unpriced: lines.length - priced.length,
  };
}

export interface CollateralView {
  /** Locked now (recalculated by the database at every price change). */
  locked: number;
  /** 150% of every open short at the current prices (the engine's collateralFor). */
  required: number;
  cash: number;
  /** cash − locked, when negative. */
  deficit: number;
  /** New buys and shorts are refused while cash is below the locked collateral. */
  blocked: boolean;
}

export function collateralView(ctx: OrderContext): CollateralView {
  const { fund, prices } = ctx;
  let required = 0;
  try {
    required = collateralFor(fund.positions, prices);
  } catch {
    required = fund.collateral;
  }
  return {
    locked: fund.collateral,
    required,
    cash: fund.cash,
    deficit: Math.max(0, fund.collateral - fund.cash),
    blocked: fund.cash < fund.collateral,
  };
}

/** A share of a limit as a whole percentage for a meter (display only, never money): 0–100. */
export function meterPct(used: number, cap: number): number {
  if (cap <= 0 || used <= 0) return 0;
  return Math.min(100, floorDiv(mul(used, 100), cap));
}
