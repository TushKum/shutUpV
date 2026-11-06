// Order entry, the "max quantity" helper and round clearing.
//
// Model:
//   • A fund's long position bought at the IPO or on the exchange is the EXCHANGE lot (max 4,000 per company).
//   • Its short position is the SHORT lot (max 2,000 per company); short proceeds are credited to cash.
//   • Collateral = Σ 150% × short qty × current price. It is a lock on cash, recalculated whenever prices change.
//   • Available cash = cash − collateral − reserves of pending orders.
//     A BUY reserves qty × price × 1.10; a SHORT reserves qty × price × 1.5 × 1.10.
//     SELL and COVER reserve nothing (covering releases more collateral than it costs) and are always allowed.
//   • If cash < collateral (a collateral deficit), new BUY and SHORT orders are blocked until it is fixed.

import { mul, mulRate } from "./money";
import { cappedNet, clearingPrice } from "./prices";
import { RULES } from "./rules";
import type { OrderType, Track } from "./types";

export type TradingState = "OPEN" | "HALTED" | "PAUSED";

export interface OrderRequest {
  companyId: string;
  type: OrderType;
  qty: number;
}

export interface PendingOrder extends OrderRequest {
  id: string;
  reserve: number;
}

export interface FundView {
  track: Track;
  cash: number;
  collateral: number;
  /** The company of the fund's own squad (insider rule). */
  squadCompanyId: string | null;
  /** Per company: EXCHANGE lot and SHORT lot quantities. */
  positions: Readonly<Record<string, { exchangeQty: number; shortQty: number }>>;
  /** This fund's pending orders in the open round. */
  pending: readonly PendingOrder[];
}

export interface OrderContext {
  trading: TradingState;
  fund: FundView;
  /** Current market price of every listed company (cents). */
  prices: Readonly<Record<string, number>>;
  /** When editing, the order being replaced (excluded from the pending totals). */
  replacingOrderId?: string;
}

export type OrderRejection =
  | "NOT_A_FUND"
  | "TRADING_PAUSED"
  | "TRADING_HALTED"
  | "BAD_QUANTITY"
  | "INSIDER"
  | "NOT_LISTED"
  | "COLLATERAL_DEFICIT"
  | "LONG_LIMIT"
  | "NOT_ENOUGH_SHARES"
  | "SHORT_LIMIT"
  | "SHORT_EXPOSURE"
  | "INSUFFICIENT_CASH"
  | "NOT_ENOUGH_SHORT";

export type OrderCheck =
  | { ok: true; reserve: number; entryPrice: number }
  | { ok: false; code: OrderRejection; message: string };

export const ORDER_MESSAGES: Record<OrderRejection, string> = {
  NOT_A_FUND: "Only Finance teams can trade.",
  TRADING_PAUSED: "Trading is paused.",
  TRADING_HALTED: "Trading is closed right now.",
  BAD_QUANTITY: "Enter a whole number of shares (1 to 100,000).",
  INSIDER: "A fund cannot trade its own squad's company.",
  NOT_LISTED: "That company is not trading.",
  COLLATERAL_DEFICIT: "Your collateral is short: buys and new shorts are blocked until cash covers it.",
  LONG_LIMIT: "That would take you over 4,000 shares of this company (including pending buys).",
  NOT_ENOUGH_SHARES: "You can only sell shares you own (minus pending sells).",
  SHORT_LIMIT: "That would take you over 2,000 shares short in this company (including pending shorts).",
  SHORT_EXPOSURE: "That would take your total short exposure over $250,000.",
  INSUFFICIENT_CASH: "Not enough available cash for this order.",
  NOT_ENOUGH_SHORT: "You can only cover shares you are short (minus pending covers).",
};

const reject = (code: OrderRejection): OrderCheck => ({ ok: false, code, message: ORDER_MESSAGES[code] });

/** Cash held back for a pending BUY: qty × price × 1.10. */
export function buyReserve(qty: number, price: number): number {
  return mulRate(mul(qty, price), RULES.RESERVE_PCT, 100);
}

/** Collateral held back for a pending SHORT: qty × price × 150% × 1.10 (rounded after each step). */
export function shortReserve(qty: number, price: number): number {
  return mulRate(mulRate(mul(qty, price), RULES.COLLATERAL_PCT, 100), RULES.RESERVE_PCT, 100);
}

/** Locked collateral for an open short: 150% × qty × price. */
export function shortCollateral(qty: number, price: number): number {
  return mulRate(mul(qty, price), RULES.COLLATERAL_PCT, 100);
}

export function collateralFor(
  positions: Readonly<Record<string, { shortQty: number }>>,
  prices: Readonly<Record<string, number>>,
): number {
  let total = 0;
  for (const [companyId, p] of Object.entries(positions)) {
    if (p.shortQty > 0) total += shortCollateral(p.shortQty, priceOf(prices, companyId));
  }
  return total;
}

function priceOf(prices: Readonly<Record<string, number>>, companyId: string): number {
  const p = prices[companyId];
  if (p === undefined) throw new Error(`no price for company ${companyId}`);
  return p;
}

export function availableCash(fund: FundView, replacingOrderId?: string): number {
  let reserved = 0;
  for (const o of fund.pending) if (o.id !== replacingOrderId) reserved += o.reserve;
  return fund.cash - fund.collateral - reserved;
}

function pendingQty(fund: FundView, companyId: string, type: OrderType, replacingOrderId?: string): number {
  let q = 0;
  for (const o of fund.pending) {
    if (o.id !== replacingOrderId && o.companyId === companyId && o.type === type) q += o.qty;
  }
  return q;
}

/** Validates an order at entry, counting pending orders. Order of checks is part of the contract (SQL mirrors it). */
export function validateOrder(ctx: OrderContext, order: OrderRequest): OrderCheck {
  const { fund, prices, replacingOrderId } = ctx;
  if (fund.track !== "FINANCE") return reject("NOT_A_FUND");
  if (ctx.trading === "PAUSED") return reject("TRADING_PAUSED");
  if (ctx.trading !== "OPEN") return reject("TRADING_HALTED");
  if (!Number.isInteger(order.qty) || order.qty < 1 || order.qty > 100_000) return reject("BAD_QUANTITY");
  if (order.companyId === fund.squadCompanyId) return reject("INSIDER");
  const price = prices[order.companyId];
  if (price === undefined) return reject("NOT_LISTED");

  const pos = fund.positions[order.companyId] ?? { exchangeQty: 0, shortQty: 0 };
  const pend = (t: OrderType) => pendingQty(fund, order.companyId, t, replacingOrderId);

  if ((order.type === "BUY" || order.type === "SHORT") && fund.cash < fund.collateral) {
    return reject("COLLATERAL_DEFICIT");
  }

  switch (order.type) {
    case "BUY": {
      if (pos.exchangeQty + pend("BUY") + order.qty > RULES.LONG_LIMIT) return reject("LONG_LIMIT");
      const reserve = buyReserve(order.qty, price);
      if (reserve > availableCash(fund, replacingOrderId)) return reject("INSUFFICIENT_CASH");
      return { ok: true, reserve, entryPrice: price };
    }
    case "SELL": {
      if (order.qty > pos.exchangeQty - pend("SELL")) return reject("NOT_ENOUGH_SHARES");
      return { ok: true, reserve: 0, entryPrice: price };
    }
    case "SHORT": {
      if (pos.shortQty + pend("SHORT") + order.qty > RULES.SHORT_LIMIT) return reject("SHORT_LIMIT");
      let exposure = mul(order.qty, price);
      const companies = new Set([...Object.keys(fund.positions), ...fund.pending.map((o) => o.companyId)]);
      for (const c of companies) {
        const q = (fund.positions[c]?.shortQty ?? 0) + pendingQty(fund, c, "SHORT", replacingOrderId);
        if (q > 0) exposure += mul(q, priceOf(prices, c));
      }
      if (exposure > RULES.SHORT_EXPOSURE_LIMIT) return reject("SHORT_EXPOSURE");
      const reserve = shortReserve(order.qty, price);
      if (reserve > availableCash(fund, replacingOrderId)) return reject("INSUFFICIENT_CASH");
      return { ok: true, reserve, entryPrice: price };
    }
    case "COVER": {
      if (order.qty > pos.shortQty - pend("COVER")) return reject("NOT_ENOUGH_SHORT");
      return { ok: true, reserve: 0, entryPrice: price };
    }
  }
}

/** Largest quantity that would pass validation right now (0 if none). */
export function maxQuantity(ctx: OrderContext, companyId: string, type: OrderType): number {
  const ok = (qty: number) => validateOrder(ctx, { companyId, type, qty }).ok;
  if (!ok(1)) return 0;
  let lo = 1;
  let hi = 100_000;
  if (ok(hi)) return hi;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

// ───────────────────────────── Clearing ─────────────────────────────

export interface FundPosition {
  exchangeQty: number;
  exchangeCost: number;
  shortQty: number;
  shortProceeds: number;
}

export interface FundBook {
  cash: number;
  positions: Record<string, FundPosition>;
}

export interface ClearingOrder extends OrderRequest {
  id: string;
  teamId: string;
}

export interface CompanyClearing {
  oldPrice: number;
  newPrice: number;
  buy: number;
  sell: number;
  short: number;
  cover: number;
  net: number;
  cappedNet: number;
}

export interface ClearingResult {
  companies: Record<string, CompanyClearing>;
  fills: { orderId: string; price: number }[];
  funds: Record<string, FundBook & { collateral: number }>;
  /** Cash the exchange receives (positive) or pays out (negative) this round. */
  exchangeCashDelta: number;
  /** Shares the exchange receives (positive) or hands out (negative), per company. */
  exchangeShareDelta: Record<string, number>;
}

const emptyPosition = (): FundPosition => ({ exchangeQty: 0, exchangeCost: 0, shortQty: 0, shortProceeds: 0 });

/**
 * One round, all companies at once. Every valid order fills at its company's new price; a price row is
 * produced for every listed company, traded or not. Per fund and company the fills are applied in a fixed
 * order (SELL, COVER, BUY, SHORT) so cost bases are deterministic: sells and covers leave at the average cost.
 */
export function clearRound(
  prices: Readonly<Record<string, number>>,
  orders: readonly ClearingOrder[],
  funds: Readonly<Record<string, FundBook>>,
): ClearingResult {
  const companies: Record<string, CompanyClearing> = {};
  for (const [companyId, oldPrice] of Object.entries(prices)) {
    companies[companyId] = { oldPrice, newPrice: oldPrice, buy: 0, sell: 0, short: 0, cover: 0, net: 0, cappedNet: 0 };
  }
  for (const o of orders) {
    const c = companies[o.companyId];
    if (!c) throw new Error(`order ${o.id} is for a company with no price`);
    if (o.type === "BUY") c.buy += o.qty;
    else if (o.type === "SELL") c.sell += o.qty;
    else if (o.type === "SHORT") c.short += o.qty;
    else c.cover += o.qty;
  }
  const newPrices: Record<string, number> = {};
  let exchangeCashDelta = 0;
  const exchangeShareDelta: Record<string, number> = {};
  for (const [companyId, c] of Object.entries(companies)) {
    c.net = c.buy + c.cover - (c.sell + c.short);
    c.cappedNet = cappedNet(c.net);
    c.newPrice = clearingPrice(c.oldPrice, c.net);
    newPrices[companyId] = c.newPrice;
    exchangeShareDelta[companyId] = -c.net;
    exchangeCashDelta += mul(c.net, c.newPrice);
  }

  // Aggregate per fund and company.
  const agg = new Map<string, Map<string, Record<OrderType, number>>>();
  for (const o of orders) {
    const byCompany = agg.get(o.teamId) ?? new Map<string, Record<OrderType, number>>();
    agg.set(o.teamId, byCompany);
    const a = byCompany.get(o.companyId) ?? { BUY: 0, SELL: 0, SHORT: 0, COVER: 0 };
    byCompany.set(o.companyId, a);
    a[o.type] += o.qty;
  }

  const outFunds: ClearingResult["funds"] = {};
  for (const [teamId, book] of Object.entries(funds)) {
    const positions: Record<string, FundPosition> = {};
    for (const [c, p] of Object.entries(book.positions)) positions[c] = { ...p };
    let cash = book.cash;
    for (const [companyId, a] of agg.get(teamId) ?? []) {
      const P = newPrices[companyId]!;
      const pos = (positions[companyId] ??= emptyPosition());
      if (a.SELL > pos.exchangeQty) throw new Error(`fund ${teamId} sells more ${companyId} than it holds`);
      if (a.COVER > pos.shortQty) throw new Error(`fund ${teamId} covers more ${companyId} than it is short`);
      if (a.SELL > 0) {
        const costOut = mulRate(pos.exchangeCost, a.SELL, pos.exchangeQty);
        pos.exchangeQty -= a.SELL;
        pos.exchangeCost -= costOut;
      }
      if (a.COVER > 0) {
        const proceedsOut = mulRate(pos.shortProceeds, a.COVER, pos.shortQty);
        pos.shortQty -= a.COVER;
        pos.shortProceeds -= proceedsOut;
      }
      pos.exchangeQty += a.BUY;
      pos.exchangeCost += mul(a.BUY, P);
      pos.shortQty += a.SHORT;
      pos.shortProceeds += mul(a.SHORT, P);
      cash += mul(a.SELL - a.BUY + a.SHORT - a.COVER, P);
    }
    outFunds[teamId] = { cash, positions, collateral: collateralFor(positions, newPrices) };
  }
  for (const teamId of agg.keys()) {
    if (!funds[teamId]) throw new Error(`order from ${teamId}, which is not a fund`);
  }

  return {
    companies,
    fills: orders.map((o) => ({ orderId: o.id, price: newPrices[o.companyId]! })),
    funds: outFunds,
    exchangeCashDelta,
    exchangeShareDelta,
  };
}

/** Profit and loss of a fund's position at a price (long: value − cost; short: proceeds − cost to cover). */
export function positionPnl(p: FundPosition, price: number): { long: number; short: number } {
  return {
    long: mul(p.exchangeQty, price) - p.exchangeCost,
    short: p.shortProceeds - mul(p.shortQty, price),
  };
}

