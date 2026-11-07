// Round 3's trading screens, pure logic: the engine's view of the team built from the rows it reads through RLS
// (exactly as the database's app.order_context builds it), the live order preview and the "Max" helper (the engine's
// validateOrder and maxQuantity, so the page agrees with the database), why trading is closed and when the next round
// opens, and the open orders and history. Buy and sell only; never the company the team built or the one it rescued;
// at most 5,000 shares of a company (owned plus pending buys); a buy reserves quantity × price × 1.10.
// Money is integer cents throughout; bigint columns arrive as numbers or strings and are converted exactly.

import {
  ORDER_MESSAGES,
  RULES,
  availableCash,
  maxQuantity,
  mul,
  phaseReached,
  validateOrder,
  type OrderContext,
  type OrderRejection,
  type OrderType,
  type PhaseCode,
  type TradingState,
} from "@msim/engine";
import { cents } from "@/lib/format";

// ───────────────────────────── Rows as read through RLS ─────────────────────────────

export type CentsValue = number | string;

export interface TradeCompanyRow {
  id: string;
  ticker: string | null;
  name: string | null;
  market_price: number | null;
  closing_price: number | null;
}

export interface HoldingRow {
  company_id: string;
  qty: number;
  cost_cents: CentsValue;
}

export type OrderStatus = "PENDING" | "FILLED" | "CANCELLED";

export interface OrderRow {
  id: string;
  round_id: string;
  company_id: string;
  type: OrderType;
  qty: number;
  status: OrderStatus;
  entry_price: number;
  reserve_cents: CentsValue;
  fill_price: number | null;
  created_at: string;
  filled_at: string | null;
  cancelled_at: string | null;
}

export type RoundStatus = "SCHEDULED" | "OPEN" | "CLOSED" | "CLEARED";

export interface RoundRow {
  id: string;
  number: number;
  phase: PhaseCode;
  status: RoundStatus;
  opens_at: string;
  closes_at: string;
}

// ───────────────────────────── Order types ─────────────────────────────

export const ORDER_TYPE_INFO: Record<OrderType, { label: string; hint: string; reserve: string }> = {
  BUY: {
    label: "Buy",
    hint: "Buy shares of any company except the one you built and the one you rescued.",
    reserve: "Cash reserved until the clearing: quantity × price × 1.10.",
  },
  SELL: {
    label: "Sell",
    hint: "Sell shares you own (no short selling).",
    reserve: "Nothing is reserved: selling shares you own is always allowed.",
  },
};

/** "BUY 1,000 MLBT". */
export function orderLabel(type: OrderType, qty: number, ticker: string): string {
  return `${type} ${qty.toLocaleString("en-US")} ${ticker}`;
}

/** The order in one plain sentence, at the current price (value in cents). */
export function orderSummary(type: OrderType, qty: number, ticker: string, valueCents: number): string {
  const n = qty.toLocaleString("en-US");
  const v = `$${(valueCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return type === "BUY" ? `You buy ${n} ${ticker} for about ${v}.` : `You sell ${n} ${ticker} for about ${v}.`;
}

/** Quick amounts on the ticket. */
export const QUICK_QUANTITIES = [100, 500, 1000, 2500] as const;

// ───────────────────────────── The team as the engine sees it ─────────────────────────────

export interface TraderInput {
  trading: TradingState;
  cash: number;
  builtCompanyId: string | null;
  rescuedCompanyId: string | null;
  companies: readonly TradeCompanyRow[];
  holdings: readonly HoldingRow[];
  /** The team's orders (any status); only those pending in an OPEN round count. */
  orders: readonly OrderRow[];
  rounds: readonly RoundRow[];
}

/**
 * The engine's OrderContext, built as the database's app.order_context builds it: the current market price of every
 * company, the team's holdings, and its pending orders in a round whose status is OPEN (oldest first). Plain data, so
 * it can be handed to a client component.
 */
export function buildOrderContext(input: TraderInput): OrderContext {
  const prices: Record<string, number> = {};
  for (const c of input.companies) if (c.market_price !== null && c.market_price !== undefined) prices[c.id] = c.market_price;
  const positions: Record<string, { qty: number; cost: number }> = {};
  for (const h of input.holdings) if (h.qty > 0) positions[h.company_id] = { qty: h.qty, cost: cents(h.cost_cents) };
  const openRounds = new Set(input.rounds.filter((r) => r.status === "OPEN").map((r) => r.id));
  const pending = input.orders
    .filter((o) => o.status === "PENDING" && openRounds.has(o.round_id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((o) => ({ id: o.id, companyId: o.company_id, type: o.type, qty: o.qty, reserve: cents(o.reserve_cents) }));
  return {
    trading: input.trading,
    trader: { cash: input.cash, builtCompanyId: input.builtCompanyId, rescuedCompanyId: input.rescuedCompanyId, positions, pending },
    prices,
  };
}

// ───────────────────────────── Quantities ─────────────────────────────

/**
 * Whole shares typed by a person: digits, optionally grouped with commas or spaces ("1,000"). Null when it is not a
 * whole number (a decimal, a sign, letters) or is blank. Out-of-range numbers are returned as they are; the rules
 * decide whether they are allowed.
 */
export function parseShares(text: string | null | undefined): number | null {
  const t = String(text ?? "").trim().replace(/[,\s]/g, "");
  if (!/^\d{1,9}$/.test(t)) return null;
  return Number(t);
}

// ───────────────────────────── Order preview ─────────────────────────────

export type OrderPreview =
  | { state: "EMPTY" }
  | { state: "REFUSED"; code: OrderRejection; message: string }
  | { state: "UNKNOWN"; message: string }
  | {
      state: "OK";
      qty: number;
      /** The current market price (the order fills at the round's clearing price). */
      price: number;
      /** qty × current price. */
      value: number;
      /** Cash a BUY locks until the clearing; 0 for a SELL. */
      reserve: number;
      /** Available cash once this order is placed. */
      availableAfter: number;
    };

/**
 * What the exchange will say about this order now, checked with the engine against the team's own view. With
 * `replacingOrderId` in the context, the order being edited is left out of the pending totals (as edit_order does).
 */
export function previewOrder(ctx: OrderContext, companyId: string, type: OrderType, qtyText: string): OrderPreview {
  if (!companyId || qtyText.trim() === "") return { state: "EMPTY" };
  const qty = parseShares(qtyText);
  if (qty === null) return { state: "REFUSED", code: "BAD_QUANTITY", message: ORDER_MESSAGES.BAD_QUANTITY };
  try {
    const check = validateOrder(ctx, { companyId, type, qty });
    if (!check.ok) return { state: "REFUSED", code: check.code, message: check.message };
    return {
      state: "OK",
      qty,
      price: check.entryPrice,
      value: mul(qty, check.entryPrice),
      reserve: check.reserve,
      availableAfter: availableCash(ctx.trader, ctx.replacingOrderId) - check.reserve,
    };
  } catch {
    return { state: "UNKNOWN", message: "This order cannot be checked on this screen; the exchange checks it when you place it." };
  }
}

/** The order context for editing one order: that order no longer counts in the pending totals. */
export function editContext(ctx: OrderContext, orderId: string): OrderContext {
  return { ...ctx, replacingOrderId: orderId };
}

/** The "Max" helper: the largest whole quantity the engine accepts right now, or 0 with the reason 1 share is refused. */
export function maxOrder(ctx: OrderContext, companyId: string, type: OrderType): { max: number; reason: string | null } {
  try {
    const max = maxQuantity(ctx, companyId, type);
    if (max > 0) return { max, reason: null };
    const check = validateOrder(ctx, { companyId, type, qty: 1 });
    return { max: 0, reason: check.ok ? null : check.message };
  } catch {
    return { max: 0, reason: "This order cannot be checked on this screen." };
  }
}

// ───────────────────────────── Per company and in all ─────────────────────────────

export interface CompanyPosition {
  price: number | null;
  owned: number;
  pending: Record<OrderType, number>;
  /** Shares that may still be bought: 5,000 − owned − pending buys. */
  room: number;
  /** Shares that may still be sold: owned − pending sells. */
  sellable: number;
}

export function companyPosition(ctx: OrderContext, companyId: string): CompanyPosition {
  const owned = ctx.trader.positions[companyId]?.qty ?? 0;
  const pending: Record<OrderType, number> = { BUY: 0, SELL: 0 };
  for (const o of ctx.trader.pending) if (o.companyId === companyId && o.id !== ctx.replacingOrderId) pending[o.type] += o.qty;
  return {
    price: ctx.prices[companyId] ?? null,
    owned,
    pending,
    room: Math.max(0, RULES.HOLD_LIMIT - owned - pending.BUY),
    sellable: Math.max(0, owned - pending.SELL),
  };
}

export interface CashSummary {
  cash: number;
  /** Reserves of the pending buys of the open round. */
  reserved: number;
  /** cash − reserved. */
  available: number;
}

export function cashSummary(ctx: OrderContext): CashSummary {
  const reserved = ctx.trader.pending.reduce((s, o) => s + o.reserve, 0);
  return { cash: ctx.trader.cash, reserved, available: ctx.trader.cash - reserved };
}

/** Why a company is not on the ticket for this team (or null when it can be traded). */
export function notTradable(ctx: OrderContext, companyId: string): string | null {
  if (companyId === ctx.trader.builtCompanyId) return "you built it";
  if (companyId === ctx.trader.rescuedCompanyId) return "you rescued it";
  if (ctx.prices[companyId] === undefined) return "no price yet";
  return null;
}

// ───────────────────────────── Client reference (idempotent retries) ─────────────────────────────

/** A random id for one order attempt (the browser's crypto; never Math.random). */
export function newNonce(c: Pick<Crypto, "getRandomValues"> & { randomUUID?: () => string } = globalThis.crypto): string {
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = c.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The order's client_ref: the attempt's nonce and what is being sent. Sending the same order again (a double click, a
 * retry after a dropped connection) repeats the reference, so place_order returns the order already placed instead of
 * placing a second one; a changed company, type or quantity is a new order.
 */
export function clientRef(nonce: string, companyId: string, type: OrderType, qty: number): string {
  return `${nonce}|${companyId}|${type}|${qty}`;
}

export const CLIENT_REF_RE = /^[0-9a-f-]{16,36}\|[0-9a-f-]{36}\|(BUY|SELL)\|\d{1,9}$/i;

// ───────────────────────────── Why trading is closed ─────────────────────────────

export interface TradingNotice {
  tone: "amber" | "blue" | "slate";
  text: string;
  /** The next round to open, if any (its opening time may move). */
  next: { number: number; opensAt: string; phase: PhaseCode } | null;
}

/** The next round that has not opened yet (lowest number). */
export function nextRound(rounds: readonly RoundRow[]): RoundRow | null {
  return [...rounds].sort((a, b) => a.number - b.number).find((r) => r.status === "SCHEDULED") ?? null;
}

/**
 * Why orders are refused right now and when the next round opens; null while a round is accepting orders. Mirrors the
 * database: PAUSED while the event is paused, OPEN only while a round of the current phase is open and before its
 * close, HALTED otherwise.
 */
export function tradingNotice(
  s: { phase: PhaseCode; trading: TradingState; paused: boolean; marketClosed: boolean; nowMs: number; gate: string | null },
  rounds: readonly RoundRow[],
): TradingNotice | null {
  if (s.trading === "OPEN" && !s.paused) return null;
  const nx = nextRound(rounds);
  const next = nx ? { number: nx.number, opensAt: nx.opens_at, phase: nx.phase } : null;
  if (s.marketClosed || phaseReached(s.phase, "SETTLEMENT")) {
    return { tone: "slate", text: "The market closed at 04:30. Your portfolio is valued at the closing prices; results at the awards.", next: null };
  }
  if (s.paused) {
    const interrupted = rounds.find((r) => r.status === "OPEN" && new Date(r.closes_at).getTime() > s.nowMs);
    return interrupted
      ? { tone: "amber", text: `The event is paused: orders are refused until it resumes. Round ${interrupted.number} carries on then, and its closing time moves later by the length of the pause.`, next: null }
      : { tone: "amber", text: "The event is paused: orders are refused until it resumes. The schedule moves later by the length of the pause.", next };
  }
  if (!phaseReached(s.phase, "MARKET_BLIND")) return { tone: "blue", text: "Trading (Round 3) starts at 02:15 with $100,000 for every team.", next };
  const closing = rounds.find((r) => (r.status === "OPEN" || r.status === "CLOSED") && new Date(r.closes_at).getTime() <= s.nowMs);
  if (closing) return { tone: "blue", text: `Round ${closing.number} has closed and is being cleared.`, next };
  if (next && next.number === 3 && s.phase === "MARKET_BLIND") {
    return { tone: "blue", text: `Round 3 opens after the 02:45 score reveal${s.gate ? " (waiting for every crisis-solution score)" : ""}.`, next };
  }
  if (next && new Date(next.opensAt).getTime() <= s.nowMs) return { tone: "blue", text: `Round ${next.number} opens in a moment.`, next };
  return { tone: "blue", text: "Trading is closed between rounds.", next };
}

// ───────────────────────────── Open orders and history ─────────────────────────────

export interface OrderLine {
  id: string;
  roundNumber: number;
  companyId: string;
  ticker: string;
  type: OrderType;
  qty: number;
  status: OrderStatus;
  entryPrice: number;
  reserve: number;
  fillPrice: number | null;
  /** Cash the fill moved: + for SELL, − for BUY (null until filled). */
  cash: number | null;
  createdAt: string;
  filledAt: string | null;
}

function lineOf(o: OrderRow, rounds: ReadonlyMap<string, RoundRow>, companies: ReadonlyMap<string, TradeCompanyRow>): OrderLine {
  const sign = o.type === "SELL" ? 1 : -1;
  return {
    id: o.id,
    roundNumber: rounds.get(o.round_id)?.number ?? 0,
    companyId: o.company_id,
    ticker: companies.get(o.company_id)?.ticker ?? "—",
    type: o.type,
    qty: o.qty,
    status: o.status,
    entryPrice: o.entry_price,
    reserve: cents(o.reserve_cents),
    fillPrice: o.fill_price,
    cash: o.status === "FILLED" && o.fill_price !== null ? sign * mul(o.qty, o.fill_price) : null,
    createdAt: o.created_at,
    filledAt: o.filled_at,
  };
}

/** The orders still pending in a round whose status is OPEN, oldest first, with the round they belong to. */
export function openOrders(orders: readonly OrderRow[], rounds: readonly RoundRow[], companies: readonly TradeCompanyRow[]): OrderLine[] {
  const rmap = new Map(rounds.map((r) => [r.id, r]));
  const cmap = new Map(companies.map((c) => [c.id, c]));
  return orders
    .filter((o) => o.status === "PENDING" && rmap.get(o.round_id)?.status === "OPEN")
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((o) => lineOf(o, rmap, cmap));
}

export type OpenOrdersState = "EDITABLE" | "PAUSED" | "CLEARING";

/** Editable while the round accepts orders, frozen while paused before its close, then waiting for the clearing. */
export function openOrdersState(s: { accepting: boolean; paused: boolean; closesAt: string; nowMs: number }): OpenOrdersState {
  if (s.nowMs >= new Date(s.closesAt).getTime()) return "CLEARING";
  if (s.accepting) return "EDITABLE";
  return s.paused ? "PAUSED" : "CLEARING";
}

export interface HistoryRound {
  number: number;
  status: RoundStatus | null;
  lines: OrderLine[];
  /** Σ cash moved by the round's fills. */
  cash: number;
}

/** Every order except those still pending in an open round, by round (newest first), newest order first. */
export function orderHistory(orders: readonly OrderRow[], rounds: readonly RoundRow[], companies: readonly TradeCompanyRow[]): HistoryRound[] {
  const rmap = new Map(rounds.map((r) => [r.id, r]));
  const cmap = new Map(companies.map((c) => [c.id, c]));
  const groups = new Map<number, HistoryRound>();
  for (const o of orders) {
    const round = rmap.get(o.round_id);
    if (o.status === "PENDING" && round?.status === "OPEN") continue;
    const line = lineOf(o, rmap, cmap);
    const g = groups.get(line.roundNumber) ?? { number: line.roundNumber, status: round?.status ?? null, lines: [], cash: 0 };
    groups.set(line.roundNumber, g);
    g.lines.push(line);
    g.cash += line.cash ?? 0;
  }
  const out = [...groups.values()].sort((a, b) => b.number - a.number);
  for (const g of out) g.lines.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}

export const STATUS_LABELS: Record<OrderStatus, string> = { PENDING: "Pending", FILLED: "Filled", CANCELLED: "Cancelled" };
