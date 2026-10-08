// The rounds view's pure logic: which round to show, the open round's order book (per company and per order), the
// clearing preview (the engine's clearRound on the current prices, the pending orders and the funds' books), the
// IPO book with its allocation preview (the engine's allocateIpo), and the history of cleared rounds.
// Money stays integer cents throughout: bigint columns arrive as numbers or strings and are converted exactly.

import {
  RULES,
  allocateIpo,
  cappedNet,
  clearRound,
  divRoundHalfUp,
  netDemand,
  type ClearingOrder,
  type FundBook,
  type OrderType,
} from "@msim/engine";
import { count, money } from "@/lib/format";

// ───────────────────────────── Rows as read through RLS ─────────────────────────────

export type Cents = number | string;

export interface RoundRow {
  id: string;
  number: number;
  phase: string;
  status: "SCHEDULED" | "OPEN" | "CLOSED" | "CLEARED";
  opens_at: string;
  closes_at: string;
  cleared_at: string | null;
}

export interface CompanyRow {
  id: string;
  ticker: string | null;
  name: string | null;
  market_price: number | null;
  ipo_price: number | null;
}

export interface TeamRow {
  id: string;
  code: string;
  track: "PRODUCT" | "CONSULTING" | "FINANCE";
  cash_cents: Cents;
  collateral_cents: Cents;
}

export interface HoldingRow {
  team_id: string;
  company_id: string;
  lot: string;
  qty: number;
  cost_cents: Cents;
}

export interface PendingOrderRow {
  id: string;
  team_id: string;
  company_id: string;
  type: OrderType;
  qty: number;
  reserve_cents: Cents;
  created_at: string;
}

export interface ClearingPriceRow {
  round_id: string;
  company_id: string;
  market_before: number | null;
  market_after: number;
  buy_qty: number;
  sell_qty: number;
  short_qty: number;
  cover_qty: number;
  net_qty: number;
  capped_net: number;
}

export interface IpoBidRow {
  team_id: string;
  company_id: string;
  qty_requested: number;
  qty_allocated: number | null;
  price: number;
}

// ───────────────────────────── Conversions ─────────────────────────────

/** Integer cents from a bigint column (a number or its string form). Refuses anything that is not a whole number. */
export function cents(v: Cents | bigint | null | undefined): number {
  if (v === null || v === undefined || v === "") throw new Error("missing amount");
  if (typeof v === "string" && !/^-?\d+$/.test(v.trim())) throw new Error(`not a whole number of cents: ${v}`);
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`not a whole number of cents: ${String(v)}`);
  return n;
}

/** "+3,000", "−500", "0". */
export function signedCount(n: number): string {
  return n > 0 ? `+${count(n)}` : n < 0 ? `−${count(-n)}` : "0";
}

/** "+$5,330.00", "−$21,320.00", "$0.00". */
export function signedMoney(c: number): string {
  return c > 0 ? `+${money(c)}` : money(c);
}

const tickerOf = (companies: ReadonlyMap<string, CompanyRow>, id: string) => companies.get(id)?.ticker ?? "—";
const byTicker = (a: { ticker: string }, b: { ticker: string }) => a.ticker.localeCompare(b.ticker);
const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code);

export function companyMap(companies: readonly CompanyRow[]): Map<string, CompanyRow> {
  return new Map(companies.map((c) => [c.id, c]));
}

/** Current market price of every listed company (the companies a clearing prices). */
export function listedPrices(companies: readonly CompanyRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of companies) if (c.market_price !== null && c.market_price !== undefined) out[c.id] = c.market_price;
  return out;
}

/** Every fund's book as the clearing sees it: cash, collateral, and the EXCHANGE and SHORT lots. */
export function fundBooks(teams: readonly TeamRow[], holdings: readonly HoldingRow[]): Record<string, FundBook & { collateral: number }> {
  const books: Record<string, FundBook & { collateral: number }> = {};
  for (const t of teams) {
    if (t.track === "FINANCE") books[t.id] = { cash: cents(t.cash_cents), collateral: cents(t.collateral_cents), positions: {} };
  }
  for (const h of holdings) {
    const book = books[h.team_id];
    if (!book || (h.lot !== "EXCHANGE" && h.lot !== "SHORT")) continue;
    const pos = (book.positions[h.company_id] ??= { exchangeQty: 0, exchangeCost: 0, shortQty: 0, shortProceeds: 0 });
    if (h.lot === "EXCHANGE") {
      pos.exchangeQty = h.qty;
      pos.exchangeCost = cents(h.cost_cents);
    } else {
      pos.shortQty = h.qty;
      pos.shortProceeds = cents(h.cost_cents);
    }
  }
  return books;
}

// ───────────────────────────── Which round ─────────────────────────────

export type RoundFocus =
  | { kind: "OPEN"; round: RoundRow; overdue: boolean }
  | { kind: "NEXT"; round: RoundRow }
  | null;

/**
 * The round the page is about: the open round (status OPEN, lowest number, even if its closing time has passed and
 * the heartbeat has not cleared it yet), otherwise the next scheduled one.
 */
export function focusRound(rounds: readonly RoundRow[], nowMs: number): RoundFocus {
  const sorted = [...rounds].sort((a, b) => a.number - b.number);
  const open = sorted.find((r) => r.status === "OPEN");
  if (open) return { kind: "OPEN", round: open, overdue: new Date(open.closes_at).getTime() <= nowMs };
  const next = sorted.find((r) => r.status === "SCHEDULED");
  return next ? { kind: "NEXT", round: next } : null;
}

/** The server action's guard: "Close round N now" closes round N or nothing (the open round may have changed). */
export function closeRoundGuard(expected: number, openNow: number | null): { ok: true } | { ok: false; code: string; message: string } {
  if (openNow === null) return { ok: false, code: "NO_OPEN_ROUND", message: `Round ${expected} is no longer open; nothing was closed.` };
  if (openNow !== expected) {
    return {
      ok: false,
      code: "ROUND_CHANGED",
      message: `Round ${expected} is no longer open (round ${openNow} is); nothing was closed. Check the page and try again.`,
    };
  }
  return { ok: true };
}

// ───────────────────────────── Order book ─────────────────────────────

export interface CompanyBook {
  companyId: string;
  ticker: string;
  name: string;
  buy: number;
  sell: number;
  short: number;
  cover: number;
  net: number;
  cappedNet: number;
  price: number | null;
  orders: number;
}

/** Pending orders per company (only companies with orders), by ticker. */
export function aggregateOrders(orders: readonly PendingOrderRow[], companies: readonly CompanyRow[]): CompanyBook[] {
  const byId = companyMap(companies);
  const books = new Map<string, CompanyBook>();
  for (const o of orders) {
    let b = books.get(o.company_id);
    if (!b) {
      const c = byId.get(o.company_id);
      b = {
        companyId: o.company_id,
        ticker: c?.ticker ?? "—",
        name: c?.name ?? "",
        buy: 0,
        sell: 0,
        short: 0,
        cover: 0,
        net: 0,
        cappedNet: 0,
        price: c?.market_price ?? null,
        orders: 0,
      };
      books.set(o.company_id, b);
    }
    b.orders += 1;
    if (o.type === "BUY") b.buy += o.qty;
    else if (o.type === "SELL") b.sell += o.qty;
    else if (o.type === "SHORT") b.short += o.qty;
    else b.cover += o.qty;
  }
  for (const b of books.values()) {
    b.net = netDemand(b);
    b.cappedNet = cappedNet(b.net);
  }
  return [...books.values()].sort(byTicker);
}

export interface OrderLine {
  id: string;
  code: string;
  ticker: string;
  type: OrderType;
  qty: number;
  reserve: number;
  createdAt: string;
}

/** Every pending order with its team code and ticker, oldest first. */
export function orderLines(orders: readonly PendingOrderRow[], teams: readonly TeamRow[], companies: readonly CompanyRow[]): OrderLine[] {
  const codes = new Map(teams.map((t) => [t.id, t.code]));
  const byId = companyMap(companies);
  return [...orders]
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .map((o) => ({
      id: o.id,
      code: codes.get(o.team_id) ?? "—",
      ticker: tickerOf(byId, o.company_id),
      type: o.type,
      qty: o.qty,
      reserve: cents(o.reserve_cents),
      createdAt: o.created_at,
    }));
}

// ───────────────────────────── Clearing preview ─────────────────────────────

export interface PreviewCompany {
  companyId: string;
  ticker: string;
  oldPrice: number;
  newPrice: number;
  net: number;
  cappedNet: number;
}

export interface PreviewFund {
  teamId: string;
  code: string;
  orders: number;
  cashBefore: number;
  cashAfter: number;
  cashChange: number;
  collateralBefore: number;
  collateralAfter: number;
}

export type ClearingPreview =
  | { ok: true; companies: PreviewCompany[]; unchanged: number; funds: PreviewFund[]; exchangeCashDelta: number }
  | { ok: false; message: string };

/**
 * What the clearing would do if the round cleared now, computed with the engine's clearRound (the database's
 * clearing is a port of it): every company whose price moves or that has orders, and every fund whose cash or
 * collateral changes. A book the engine refuses (a sell larger than the position) is reported, not thrown: the
 * database would refuse to clear it too.
 */
export function previewClearing(
  companies: readonly CompanyRow[],
  orders: readonly PendingOrderRow[],
  teams: readonly TeamRow[],
  holdings: readonly HoldingRow[],
): ClearingPreview {
  try {
    const prices = listedPrices(companies);
    const books = fundBooks(teams, holdings);
    const clearing: ClearingOrder[] = orders.map((o) => ({ id: o.id, teamId: o.team_id, companyId: o.company_id, type: o.type, qty: o.qty }));
    const result = clearRound(prices, clearing, books);
    const byId = companyMap(companies);
    const moved: PreviewCompany[] = [];
    let unchanged = 0;
    for (const [companyId, c] of Object.entries(result.companies)) {
      const traded = c.buy + c.sell + c.short + c.cover > 0;
      if (!traded && c.newPrice === c.oldPrice) {
        unchanged += 1;
        continue;
      }
      moved.push({ companyId, ticker: tickerOf(byId, companyId), oldPrice: c.oldPrice, newPrice: c.newPrice, net: c.net, cappedNet: c.cappedNet });
    }
    const codes = new Map(teams.map((t) => [t.id, t.code]));
    const orderCount = new Map<string, number>();
    for (const o of orders) orderCount.set(o.team_id, (orderCount.get(o.team_id) ?? 0) + 1);
    const funds: PreviewFund[] = [];
    for (const [teamId, after] of Object.entries(result.funds)) {
      const before = books[teamId]!;
      const n = orderCount.get(teamId) ?? 0;
      if (n === 0 && after.cash === before.cash && after.collateral === before.collateral) continue;
      funds.push({
        teamId,
        code: codes.get(teamId) ?? "—",
        orders: n,
        cashBefore: before.cash,
        cashAfter: after.cash,
        cashChange: after.cash - before.cash,
        collateralBefore: before.collateral,
        collateralAfter: after.collateral,
      });
    }
    return { ok: true, companies: moved.sort(byTicker), unchanged, funds: funds.sort(byCode), exchangeCashDelta: result.exchangeCashDelta };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// ───────────────────────────── IPO book ─────────────────────────────

export interface IpoBidLine {
  teamId: string;
  code: string;
  requested: number;
  allocated: number;
}

export interface IpoCompanyBook {
  companyId: string;
  ticker: string;
  name: string;
  ipoPrice: number | null;
  bidders: number;
  requested: number;
  available: number;
  /** Requested as a whole percentage of the shares on offer (rounded half-up). */
  subscribedPct: number;
  oversubscribed: boolean;
  allocated: number;
  bids: IpoBidLine[];
}

/**
 * The IPO book per company (every company with an IPO price), with the allocation the engine's allocateIpo would
 * give each bid if the IPO were allocated now. Zero requests are withdrawn bids and are left out.
 */
export function ipoBook(
  companies: readonly CompanyRow[],
  bids: readonly IpoBidRow[],
  teams: readonly TeamRow[],
  available: number = RULES.IPO_SHARES,
): IpoCompanyBook[] {
  const codes = new Map(teams.map((t) => [t.id, t.code]));
  const out: IpoCompanyBook[] = [];
  for (const c of companies) {
    if (c.ipo_price === null || c.ipo_price === undefined) continue;
    const live = bids
      .filter((b) => b.company_id === c.id && b.qty_requested > 0)
      .map((b) => ({ teamId: b.team_id, code: codes.get(b.team_id) ?? "—", qty: b.qty_requested }));
    const allocated = allocateIpo(live, available);
    const requested = live.reduce((s, b) => s + b.qty, 0);
    out.push({
      companyId: c.id,
      ticker: c.ticker ?? "—",
      name: c.name ?? "",
      ipoPrice: c.ipo_price,
      bidders: live.length,
      requested,
      available,
      subscribedPct: divRoundHalfUp(requested * 100, available),
      oversubscribed: requested > available,
      allocated: allocated.reduce((s, b) => s + b.allocated, 0),
      bids: allocated
        .map((b) => ({ teamId: b.teamId, code: b.code, requested: b.qty, allocated: b.allocated }))
        .sort((a, b) => b.requested - a.requested || a.code.localeCompare(b.code)),
    });
  }
  return out.sort(byTicker);
}

// ───────────────────────────── History ─────────────────────────────

export interface ClearedRound {
  number: number;
  clearedAt: string | null;
  traded: number;
  rows: (ClearingPriceRow & { ticker: string })[];
}

/** The cleared rounds, latest first, each with one row per company (by ticker). */
export function roundHistory(prices: readonly ClearingPriceRow[], rounds: readonly RoundRow[], companies: readonly CompanyRow[]): ClearedRound[] {
  const byId = companyMap(companies);
  const roundById = new Map(rounds.map((r) => [r.id, r]));
  const groups = new Map<string, ClearedRound>();
  for (const p of prices) {
    const r = roundById.get(p.round_id);
    if (!r) continue;
    let g = groups.get(r.id);
    if (!g) {
      g = { number: r.number, clearedAt: r.cleared_at, traded: 0, rows: [] };
      groups.set(r.id, g);
    }
    g.rows.push({ ...p, ticker: tickerOf(byId, p.company_id) });
    if (p.buy_qty + p.sell_qty + p.short_qty + p.cover_qty > 0) g.traded += 1;
  }
  for (const g of groups.values()) g.rows.sort(byTicker);
  return [...groups.values()].sort((a, b) => b.number - a.number);
}

// ───────────────────────────── Paging ─────────────────────────────

/** PostgREST returns at most this many rows per request. */
export const PAGE_SIZE = 1000;

/**
 * Reads every row of a query in pages (PostgREST caps a response at 1,000 rows). `page(from, to)` must apply a
 * stable order and `.range(from, to)`.
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
}
