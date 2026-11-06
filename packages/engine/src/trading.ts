// Order entry, the "max quantity" helper and round clearing (Round 3).
//
// Model:
//   • Every team trades with its own cash ($100,000 at the start). Buy and sell only: no short selling.
//   • A team may not trade the company it built (founded) or the company it rescued.
//   • At most 5,000 shares of any one company: shares owned plus pending buys.
//   • A pending BUY reserves qty × price × 1.10 of cash, so it can still be paid after a 10% rise.
//     Available cash = cash − reserves of pending buys. A SELL reserves nothing.
//   • Every valid order in a round fills at its company's new price when the round clears.

import { mul, mulRate } from "./money";
import { cappedNet, clearingPrice } from "./prices";
import { RULES } from "./rules";
import type { OrderType } from "./types";

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

export interface Position {
  qty: number;
  /** What the shares held cost (cents; the average cost basis × qty). */
  cost: number;
}

export interface TraderView {
  cash: number;
  /** The company this team built (Round 1): never tradable by it. */
  builtCompanyId: string | null;
  /** The company this team rescued (Round 2): never tradable by it. */
  rescuedCompanyId: string | null;
  positions: Readonly<Record<string, Position>>;
  /** This team's pending orders in the open round. */
  pending: readonly PendingOrder[];
}

export interface OrderContext {
  trading: TradingState;
  trader: TraderView;
  /** Current market price of every listed company (cents). */
  prices: Readonly<Record<string, number>>;
  /** When editing, the order being replaced (excluded from the pending totals). */
  replacingOrderId?: string;
}

export type OrderRejection =
  | "TRADING_PAUSED"
  | "TRADING_HALTED"
  | "BAD_QUANTITY"
  | "OWN_COMPANY"
  | "RESCUED_COMPANY"
  | "NOT_LISTED"
  | "HOLD_LIMIT"
  | "NOT_ENOUGH_SHARES"
  | "INSUFFICIENT_CASH";

export type OrderCheck =
  | { ok: true; reserve: number; entryPrice: number }
  | { ok: false; code: OrderRejection; message: string };

export const ORDER_MESSAGES: Record<OrderRejection, string> = {
  TRADING_PAUSED: "Trading is paused.",
  TRADING_HALTED: "Trading is closed right now.",
  BAD_QUANTITY: "Enter a whole number of shares (1 to 5,000).",
  OWN_COMPANY: "You cannot trade the company you built.",
  RESCUED_COMPANY: "You cannot trade the company you rescued.",
  NOT_LISTED: "That company is not trading.",
  HOLD_LIMIT: "That would take you over 5,000 shares of this company (including pending buys).",
  NOT_ENOUGH_SHARES: "You can only sell shares you own (minus pending sells).",
  INSUFFICIENT_CASH: "Not enough available cash for this order (a buy holds back its value plus 10%).",
};

const reject = (code: OrderRejection): OrderCheck => ({ ok: false, code, message: ORDER_MESSAGES[code] });

/** Cash held back for a pending BUY: qty × price × 1.10, rounded half-up. */
export function buyReserve(qty: number, price: number): number {
  return mulRate(mul(qty, price), RULES.RESERVE_PCT, 100);
}

export function availableCash(trader: TraderView, replacingOrderId?: string): number {
  let reserved = 0;
  for (const o of trader.pending) if (o.id !== replacingOrderId) reserved += o.reserve;
  return trader.cash - reserved;
}

function pendingQty(trader: TraderView, companyId: string, type: OrderType, replacingOrderId?: string): number {
  let q = 0;
  for (const o of trader.pending) {
    if (o.id !== replacingOrderId && o.companyId === companyId && o.type === type) q += o.qty;
  }
  return q;
}

/** Validates an order at entry, counting pending orders. The order of the checks is part of the contract (SQL mirrors it). */
export function validateOrder(ctx: OrderContext, order: OrderRequest): OrderCheck {
  const { trader, prices, replacingOrderId } = ctx;
  if (ctx.trading === "PAUSED") return reject("TRADING_PAUSED");
  if (ctx.trading !== "OPEN") return reject("TRADING_HALTED");
  if (!Number.isInteger(order.qty) || order.qty < 1 || order.qty > RULES.HOLD_LIMIT) return reject("BAD_QUANTITY");
  if (order.companyId === trader.builtCompanyId) return reject("OWN_COMPANY");
  if (order.companyId === trader.rescuedCompanyId) return reject("RESCUED_COMPANY");
  const price = prices[order.companyId];
  if (price === undefined) return reject("NOT_LISTED");

  const owned = trader.positions[order.companyId]?.qty ?? 0;
  if (order.type === "BUY") {
    if (owned + pendingQty(trader, order.companyId, "BUY", replacingOrderId) + order.qty > RULES.HOLD_LIMIT) {
      return reject("HOLD_LIMIT");
    }
    const reserve = buyReserve(order.qty, price);
    if (reserve > availableCash(trader, replacingOrderId)) return reject("INSUFFICIENT_CASH");
    return { ok: true, reserve, entryPrice: price };
  }
  if (order.qty > owned - pendingQty(trader, order.companyId, "SELL", replacingOrderId)) return reject("NOT_ENOUGH_SHARES");
  return { ok: true, reserve: 0, entryPrice: price };
}

/** Largest quantity that would pass validation right now (0 if none). */
export function maxQuantity(ctx: OrderContext, companyId: string, type: OrderType): number {
  const ok = (qty: number) => validateOrder(ctx, { companyId, type, qty }).ok;
  if (!ok(1)) return 0;
  let lo = 1;
  let hi: number = RULES.HOLD_LIMIT;
  if (ok(hi)) return hi;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

// ───────────────────────────── Clearing ─────────────────────────────

export interface TraderBook {
  cash: number;
  positions: Record<string, Position>;
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
  net: number;
  cappedNet: number;
}

export interface ClearingResult {
  companies: Record<string, CompanyClearing>;
  fills: { orderId: string; price: number }[];
  traders: Record<string, TraderBook>;
  /** Cash the exchange receives (positive) or pays out (negative) this round. */
  exchangeCashDelta: number;
}

/**
 * One round, all companies at once. Every valid order fills at its company's new price; a price row is produced for
 * every listed company, traded or not. Per team and company, sells are applied before buys, so the shares sold leave
 * at the average cost and the cost basis is deterministic.
 */
export function clearRound(
  prices: Readonly<Record<string, number>>,
  orders: readonly ClearingOrder[],
  traders: Readonly<Record<string, TraderBook>>,
): ClearingResult {
  const companies: Record<string, CompanyClearing> = {};
  for (const [companyId, oldPrice] of Object.entries(prices)) {
    companies[companyId] = { oldPrice, newPrice: oldPrice, buy: 0, sell: 0, net: 0, cappedNet: 0 };
  }
  for (const o of orders) {
    const c = companies[o.companyId];
    if (!c) throw new Error(`order ${o.id} is for a company with no price`);
    if (o.type === "BUY") c.buy += o.qty;
    else c.sell += o.qty;
  }
  const newPrices: Record<string, number> = {};
  let exchangeCashDelta = 0;
  for (const [companyId, c] of Object.entries(companies)) {
    c.net = c.buy - c.sell;
    c.cappedNet = cappedNet(c.net);
    c.newPrice = clearingPrice(c.oldPrice, c.net);
    newPrices[companyId] = c.newPrice;
    exchangeCashDelta += mul(c.net, c.newPrice);
  }

  // Aggregate per team and company.
  const agg = new Map<string, Map<string, { BUY: number; SELL: number }>>();
  for (const o of orders) {
    if (!traders[o.teamId]) throw new Error(`order from ${o.teamId}, which has no book`);
    const byCompany = agg.get(o.teamId) ?? new Map<string, { BUY: number; SELL: number }>();
    agg.set(o.teamId, byCompany);
    const a = byCompany.get(o.companyId) ?? { BUY: 0, SELL: 0 };
    byCompany.set(o.companyId, a);
    a[o.type] += o.qty;
  }

  const out: Record<string, TraderBook> = {};
  for (const [teamId, book] of Object.entries(traders)) {
    const positions: Record<string, Position> = {};
    for (const [c, p] of Object.entries(book.positions)) positions[c] = { ...p };
    let cash = book.cash;
    for (const [companyId, a] of agg.get(teamId) ?? []) {
      const P = newPrices[companyId]!;
      const pos = (positions[companyId] ??= { qty: 0, cost: 0 });
      if (a.SELL > pos.qty) throw new Error(`team ${teamId} sells more of ${companyId} than it holds`);
      if (a.SELL > 0) {
        const costOut = mulRate(pos.cost, a.SELL, pos.qty);
        pos.qty -= a.SELL;
        pos.cost -= costOut;
      }
      pos.qty += a.BUY;
      pos.cost += mul(a.BUY, P);
      cash += mul(a.SELL - a.BUY, P);
    }
    out[teamId] = { cash, positions };
  }

  return {
    companies,
    fills: orders.map((o) => ({ orderId: o.id, price: newPrices[o.companyId]! })),
    traders: out,
    exchangeCashDelta,
  };
}

/** Profit or loss of a position at a price: value − cost. */
export function positionPnl(p: Position, price: number): number {
  return mul(p.qty, price) - p.cost;
}
