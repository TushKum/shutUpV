// The fund's trading screens, pure logic: the engine's view of the fund built from the rows it reads through RLS
// (exactly as the database's app.order_context builds it), the live order preview and the "Max" helper (the
// engine's validateOrder and maxQuantity, so the page agrees with the database), the IPO book preview (the engine's
// validateIpoBids), why trading is closed and when the next round opens, and the order history.
// Money is integer cents throughout; bigint columns arrive as numbers or strings and are converted exactly.

import {
  ORDER_MESSAGES,
  RULES,
  availableCash,
  floorDiv,
  maxQuantity,
  mul,
  phaseReached,
  validateIpoBids,
  validateOrder,
  type IpoRejection,
  type LotType,
  type OrderContext,
  type OrderRejection,
  type OrderType,
  type PhaseCode,
  type Track,
  type TradingState,
} from "@msim/engine";
import { cents } from "@/lib/format";

// ───────────────────────────── Rows as read through RLS ─────────────────────────────

export type CentsValue = number | string;

export interface TradeCompanyRow {
  id: string;
  ticker: string | null;
  name: string | null;
  ipo_price: number | null;
  market_price: number | null;
  closing_price: number | null;
}

export interface HoldingRow {
  company_id: string;
  lot: LotType;
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

export interface IpoBidRow {
  company_id: string;
  qty_requested: number;
  qty_allocated: number | null;
  price: number;
}

// ───────────────────────────── Order types ─────────────────────────────

export const ORDER_TYPE_INFO: Record<OrderType, { label: string; hint: string; reserve: string }> = {
  BUY: {
    label: "Buy",
    hint: "Buy shares on the exchange (your exchange lot).",
    reserve: "Cash reserved until the clearing: quantity × price × 1.10.",
  },
  SELL: {
    label: "Sell",
    hint: "Sell shares you own in your exchange lot.",
    reserve: "Nothing is reserved: selling shares you own is always allowed.",
  },
  SHORT: {
    label: "Short",
    hint: "Sell shares you do not own; buy them back later with Cover.",
    reserve: "Collateral reserved until the clearing: quantity × price × 150% × 1.10.",
  },
  COVER: {
    label: "Cover",
    hint: "Buy back shares you are short.",
    reserve: "Nothing is reserved: covering releases more collateral than it costs.",
  },
};

/** "BUY 1,000 ERA". */
export function orderLabel(type: OrderType, qty: number, ticker: string): string {
  return `${type} ${qty.toLocaleString("en-US")} ${ticker}`;
}

// ───────────────────────────── The fund as the engine sees it ─────────────────────────────

export interface FundInput {
  trading: TradingState;
  team: { track: Track; cash: number; collateral: number };
  /** The fund's own squad company (insider rule). */
  squadCompanyId: string | null;
  companies: readonly TradeCompanyRow[];
  holdings: readonly HoldingRow[];
  /** The fund's orders (any status); only those pending in an OPEN round count. */
  orders: readonly OrderRow[];
  rounds: readonly RoundRow[];
}

/**
 * The engine's OrderContext, built as the database's app.order_context builds it: the current market price of every
 * listed company, the EXCHANGE and SHORT lots, and the fund's pending orders in a round whose status is OPEN (oldest
 * first). Plain data, so it can be handed to a client component.
 */
export function buildOrderContext(input: FundInput): OrderContext {
  const prices: Record<string, number> = {};
  for (const c of input.companies) if (c.market_price !== null && c.market_price !== undefined) prices[c.id] = c.market_price;

  const positions: Record<string, { exchangeQty: number; shortQty: number }> = {};
  for (const h of input.holdings) {
    if (h.lot !== "EXCHANGE" && h.lot !== "SHORT") continue;
    const p = (positions[h.company_id] ??= { exchangeQty: 0, shortQty: 0 });
    if (h.lot === "EXCHANGE") p.exchangeQty += h.qty;
    else p.shortQty += h.qty;
  }

  const openRounds = new Set(input.rounds.filter((r) => r.status === "OPEN").map((r) => r.id));
  const pending = input.orders
    .filter((o) => o.status === "PENDING" && openRounds.has(o.round_id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((o) => ({ id: o.id, companyId: o.company_id, type: o.type, qty: o.qty, reserve: cents(o.reserve_cents) }));

  return {
    trading: input.trading,
    fund: {
      track: input.team.track,
      cash: input.team.cash,
      collateral: input.team.collateral,
      squadCompanyId: input.squadCompanyId,
      positions,
      pending,
    },
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
      /** Cash (BUY) or collateral (SHORT) the order locks until the clearing; 0 for SELL and COVER. */
      reserve: number;
      /** Available cash once this order is placed. */
      availableAfter: number;
    };

/**
 * What the exchange will say about this order now, checked with the engine against the fund's own view. With
 * `replacingOrderId`, the order being edited is left out of the pending totals (as edit_order does).
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
      availableAfter: availableCash(ctx.fund, ctx.replacingOrderId) - check.reserve,
    };
  } catch {
    return { state: "UNKNOWN", message: "This order cannot be checked on this screen; the exchange checks it when you place it." };
  }
}

/** The order context for editing one order: that order no longer counts in the pending totals. */
export function editContext(ctx: OrderContext, orderId: string): OrderContext {
  return { ...ctx, replacingOrderId: orderId };
}

/**
 * The "Max" helper: the largest whole quantity the engine accepts right now, or 0 with the reason the smallest order
 * (1 share) is refused.
 */
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

// ───────────────────────────── Per company and per fund ─────────────────────────────

export interface CompanyPosition {
  price: number | null;
  exchangeQty: number;
  shortQty: number;
  pending: Record<OrderType, number>;
  /** Shares that may still be bought: 4,000 − exchange lot − pending buys. */
  longRoom: number;
  /** Shares that may still be sold: exchange lot − pending sells. */
  sellable: number;
  /** Shares that may still be shorted: 2,000 − short lot − pending shorts. */
  shortRoom: number;
  /** Shares that may still be covered: short lot − pending covers. */
  coverable: number;
}

export function companyPosition(ctx: OrderContext, companyId: string): CompanyPosition {
  const pos = ctx.fund.positions[companyId] ?? { exchangeQty: 0, shortQty: 0 };
  const pending: Record<OrderType, number> = { BUY: 0, SELL: 0, SHORT: 0, COVER: 0 };
  for (const o of ctx.fund.pending) if (o.companyId === companyId && o.id !== ctx.replacingOrderId) pending[o.type] += o.qty;
  return {
    price: ctx.prices[companyId] ?? null,
    exchangeQty: pos.exchangeQty,
    shortQty: pos.shortQty,
    pending,
    longRoom: Math.max(0, RULES.LONG_LIMIT - pos.exchangeQty - pending.BUY),
    sellable: Math.max(0, pos.exchangeQty - pending.SELL),
    shortRoom: Math.max(0, RULES.SHORT_LIMIT - pos.shortQty - pending.SHORT),
    coverable: Math.max(0, pos.shortQty - pending.COVER),
  };
}

export interface FundSummary {
  cash: number;
  /** Collateral locked against open shorts (recalculated at every price change). */
  collateral: number;
  /** Reserves of the pending orders of the open round. */
  reserved: number;
  /** cash − collateral − reserved. */
  available: number;
  /** Cash below the collateral, if any: new buys and shorts are blocked while it is above 0. */
  deficit: number;
  blocked: boolean;
  /** Σ open short quantity × current price. */
  shortExposure: number;
  /** Σ (open + pending short quantity) × current price: what the $250,000 limit counts. */
  shortExposureWithPending: number;
  exposureCap: number;
}

export function fundSummary(ctx: OrderContext): FundSummary {
  const { fund, prices } = ctx;
  const reserved = fund.pending.reduce((s, o) => s + o.reserve, 0);
  let open = 0;
  let pendingShort = 0;
  for (const [companyId, p] of Object.entries(fund.positions)) if (p.shortQty > 0) open += mul(p.shortQty, prices[companyId] ?? 0);
  for (const o of fund.pending) if (o.type === "SHORT") pendingShort += mul(o.qty, prices[o.companyId] ?? 0);
  return {
    cash: fund.cash,
    collateral: fund.collateral,
    reserved,
    available: fund.cash - fund.collateral - reserved,
    deficit: Math.max(0, fund.collateral - fund.cash),
    blocked: fund.cash < fund.collateral,
    shortExposure: open,
    shortExposureWithPending: open + pendingShort,
    exposureCap: RULES.SHORT_EXPOSURE_LIMIT,
  };
}

// ───────────────────────────── Client reference (idempotent retries) ─────────────────────────────

/** A random id for one order attempt (the browser's crypto; never Math.random). */
export function newNonce(c: Pick<Crypto, "getRandomValues"> & { randomUUID?: () => string } = globalThis.crypto): string {
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = c.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The order's client_ref: the attempt's nonce and what is being sent. Sending the same order again (a double click,
 * a retry after a dropped connection) repeats the reference, so place_order returns the order already placed
 * instead of placing a second one; a changed company, type or quantity is a new order.
 */
export function clientRef(nonce: string, companyId: string, type: OrderType, qty: number): string {
  return `${nonce}|${companyId}|${type}|${qty}`;
}

export const CLIENT_REF_RE = /^[0-9a-f-]{16,36}\|[0-9a-f-]{36}\|(BUY|SELL|SHORT|COVER)\|\d{1,9}$/i;

// ───────────────────────────── IPO ─────────────────────────────

export interface IpoView {
  cash: number;
  squadCompanyId: string | null;
  /** Saved requests per company (qty_requested; 0 = withdrawn). */
  bids: Readonly<Record<string, number>>;
  /** IPO price per listed company. */
  prices: Readonly<Record<string, number>>;
}

export function ipoView(cash: number, squadCompanyId: string | null, bids: readonly IpoBidRow[], companies: readonly TradeCompanyRow[]): IpoView {
  const prices: Record<string, number> = {};
  for (const c of companies) if (c.ipo_price !== null && c.ipo_price !== undefined) prices[c.id] = c.ipo_price;
  return { cash, squadCompanyId, bids: Object.fromEntries(bids.map((b) => [b.company_id, b.qty_requested])), prices };
}

/** Cost of the saved book at IPO prices, and the cash it leaves. */
export function ipoBook(view: IpoView): { committed: number; remaining: number } {
  let committed = 0;
  for (const [companyId, qty] of Object.entries(view.bids)) if (qty > 0) committed += mul(qty, view.prices[companyId] ?? 0);
  return { committed, remaining: view.cash - committed };
}

export type IpoPreview =
  | { state: "EMPTY" }
  | { state: "REFUSED"; code: IpoRejection; message: string }
  | { state: "OK"; qty: number; cost: number; total: number; remaining: number; withdraw: boolean };

/** What place_ipo_bid will say about this request: the saved book with this company's request replaced. */
export function previewIpoBid(view: IpoView, companyId: string, qtyText: string): IpoPreview {
  if (qtyText.trim() === "") return { state: "EMPTY" };
  const qty = parseShares(qtyText);
  if (qty === null || qty > RULES.IPO_MAX_PER_COMPANY) {
    return { state: "REFUSED", code: "BAD_QUANTITY", message: "Request 0 to 4,000 shares per company." };
  }
  const book = [...Object.entries(view.bids).map(([c, q]) => ({ companyId: c, qty: q })), { companyId, qty }];
  const check = validateIpoBids({ cash: view.cash, squadCompanyId: view.squadCompanyId }, book, view.prices);
  if (!check.ok) return { state: "REFUSED", code: check.code, message: check.message };
  return {
    state: "OK",
    qty,
    cost: qty === 0 ? 0 : mul(qty, view.prices[companyId]!),
    total: check.totalCost,
    remaining: view.cash - check.totalCost,
    withdraw: qty === 0,
  };
}

/** The largest request for this company that the cash allows next to the other saved requests (0 to 4,000). */
export function ipoMax(view: IpoView, companyId: string): number {
  const price = view.prices[companyId];
  if (price === undefined || companyId === view.squadCompanyId) return 0;
  let others = 0;
  for (const [c, qty] of Object.entries(view.bids)) if (c !== companyId && qty > 0) others += mul(qty, view.prices[c] ?? 0);
  const left = view.cash - others;
  if (left <= 0) return 0;
  return Math.min(RULES.IPO_MAX_PER_COMPANY, floorDiv(left, price));
}

export interface IpoResultLine {
  companyId: string;
  ticker: string;
  name: string | null;
  requested: number;
  allocated: number | null;
  price: number;
  /** allocated × IPO price (0 before the allocation). */
  paid: number;
  scaledDown: boolean;
}

/** The fund's requests (withdrawn ones left out) and, after the allocation, the shares received and the cash paid. */
export function ipoResults(bids: readonly IpoBidRow[], companies: readonly TradeCompanyRow[]): { lines: IpoResultLine[]; requested: number; allocated: number; paid: number } {
  const byId = new Map(companies.map((c) => [c.id, c]));
  const lines = bids
    .filter((b) => b.qty_requested > 0)
    .map((b) => {
      const c = byId.get(b.company_id);
      const allocated = b.qty_allocated;
      return {
        companyId: b.company_id,
        ticker: c?.ticker ?? "—",
        name: c?.name ?? null,
        requested: b.qty_requested,
        allocated,
        price: b.price,
        paid: allocated === null ? 0 : mul(allocated, b.price),
        scaledDown: allocated !== null && allocated < b.qty_requested,
      };
    })
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
  return {
    lines,
    requested: lines.reduce((s, l) => s + l.requested, 0),
    allocated: lines.reduce((s, l) => s + (l.allocated ?? 0), 0),
    paid: lines.reduce((s, l) => s + l.paid, 0),
  };
}

export type IpoWindow = "NOT_YET" | "OPEN" | "PAUSED" | "CLOSED" | "ALLOCATED";

/** Where the IPO is for this fund, as place_ipo_bid decides it (phase IPO, not paused, before the deadline). */
export function ipoWindow(s: { phase: PhaseCode; paused: boolean; allocatedAt: string | null; deadline: string | null; nowMs: number }): IpoWindow {
  if (s.allocatedAt) return "ALLOCATED";
  if (!phaseReached(s.phase, "IPO")) return "NOT_YET";
  if (s.phase !== "IPO") return "CLOSED";
  if (s.paused) return "PAUSED";
  if (s.deadline && s.nowMs > new Date(s.deadline).getTime()) return "CLOSED";
  return "OPEN";
}

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
 * Why orders are refused right now and when the next round opens; null while a round is accepting orders. Mirrors
 * the database: trading is PAUSED while the event is paused or in the break, OPEN only while a round of the current
 * phase is open and before its close, and HALTED otherwise.
 */
export function tradingNotice(
  s: { phase: PhaseCode; trading: TradingState; paused: boolean; marketClosed: boolean; nowMs: number },
  rounds: readonly RoundRow[],
): TradingNotice | null {
  if (s.trading === "OPEN" && !s.paused) return null;
  const nx = nextRound(rounds);
  const next = nx ? { number: nx.number, opensAt: nx.opens_at, phase: nx.phase } : null;
  if (s.marketClosed || phaseReached(s.phase, "CLOSE")) {
    return { tone: "slate", text: "The market has closed. Every short was covered at the closing price; no more orders.", next: null };
  }
  if (s.paused) {
    // A round interrupted by the pause carries on when the event resumes (its close moves later); it comes first.
    const interrupted = rounds.find((r) => r.status === "OPEN" && new Date(r.closes_at).getTime() > s.nowMs);
    return interrupted
      ? {
          tone: "amber",
          text: `The event is paused: orders are refused until it resumes. Round ${interrupted.number} carries on then, and its closing time moves later by the length of the pause.`,
          next: null,
        }
      : {
          tone: "amber",
          text: "The event is paused: orders are refused until it resumes. Round opening times and the rest of the schedule move later by the length of the pause.",
          next,
        };
  }
  if (s.phase === "BREAK") return { tone: "amber", text: "Trading is paused for the break.", next };
  if (!phaseReached(s.phase, "ROUNDS_1_4")) return { tone: "blue", text: "Trading starts with round 1.", next };
  if (s.phase === "CRISIS") return { tone: "amber", text: "Trading is halted for the crisis: every price takes the −15% shock.", next };
  if (s.phase === "PLANS_PUBLISHED" || s.phase === "VERDICTS") {
    return { tone: "amber", text: "Trading is halted while the rescue plans are scored.", next };
  }
  const closing = rounds.find((r) => (r.status === "OPEN" || r.status === "CLOSED") && new Date(r.closes_at).getTime() <= s.nowMs);
  if (closing) return { tone: "blue", text: `Round ${closing.number} has closed and is being cleared.`, next };
  if (next && next.number === 18 && new Date(next.opensAt).getTime() <= s.nowMs) {
    return { tone: "blue", text: "Round 18 opens once the flash scores are released (the flash tier applies after round 17 clears).", next };
  }
  if (next && new Date(next.opensAt).getTime() <= s.nowMs) {
    return { tone: "blue", text: `Round ${next.number} opens in a moment.`, next };
  }
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
  /** Cash the fill moved: + for SELL and SHORT, − for BUY and COVER (null until filled). */
  cash: number | null;
  createdAt: string;
  filledAt: string | null;
}

function lineOf(o: OrderRow, rounds: ReadonlyMap<string, RoundRow>, companies: ReadonlyMap<string, TradeCompanyRow>): OrderLine {
  const sign = o.type === "SELL" || o.type === "SHORT" ? 1 : -1;
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

/**
 * The orders still pending in a round whose status is OPEN (accepting, or past its close and about to clear), oldest
 * first, with the round they belong to.
 */
export function openOrders(orders: readonly OrderRow[], rounds: readonly RoundRow[], companies: readonly TradeCompanyRow[]): OrderLine[] {
  const rmap = new Map(rounds.map((r) => [r.id, r]));
  const cmap = new Map(companies.map((c) => [c.id, c]));
  return orders
    .filter((o) => o.status === "PENDING" && rmap.get(o.round_id)?.status === "OPEN")
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((o) => lineOf(o, rmap, cmap));
}

export type OpenOrdersState = "EDITABLE" | "PAUSED" | "CLEARING";

/**
 * What can happen to the open round's orders now: editable while the round accepts orders, frozen while the event is
 * paused before the round's close (the round carries on after the pause), and waiting for the clearing once the
 * round has reached its closing time.
 */
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

/**
 * Every order except those still pending in an open round (they are the open orders), grouped by round, newest round
 * first and newest order first within it.
 */
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
