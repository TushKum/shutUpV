// The ticker board on the big screen: one tile per listed company (ticker, name, price, change since the IPO price,
// and an arrow for the last cleared round's move), in ticker order, 25 tiles to a page, a new page every 20 seconds
// by the server clock (so every projector shows the same page and a reload does not start again at page 1). Pure.
// Prices are integer cents; changes are basis points rounded half-up, never floating point.

import { divRoundHalfUp } from "@msim/engine";

export const BOARD_PAGE_SIZE = 25;
export const BOARD_PAGE_MS = 20_000;
/** How long tiles that moved stay highlighted after a round clears. */
export const BOARD_HIGHLIGHT_MS = 6_000;

/** A company as the display reads it (public from READING). */
export interface BoardCompany {
  id: string;
  ticker: string | null;
  name: string | null;
  ipo_price: number | null;
  market_price: number | null;
  closing_price: number | null;
}

/** A clearing row of the last cleared round. */
export interface BoardMoveRow {
  company_id: string;
  market_before: number | null;
  market_after: number;
}

export type Move = "UP" | "DOWN" | "FLAT";

export interface BoardTile {
  id: string;
  ticker: string;
  name: string;
  /** The price shown: the market price, or the closing price after the close. Null while the IPO price is pending. */
  price: number | null;
  /** True when `price` is the closing price. */
  closing: boolean;
  /** Change of `price` since the IPO price, in basis points (half-up). Null while the IPO price is pending. */
  changeBp: number | null;
  /** The last cleared round's move; null before any round has cleared. */
  move: Move | null;
}

/** (price − ipo) × 10,000 ÷ ipo, rounded half-up (ties away from zero). Null without an IPO price or a price. */
export function changeSinceIpoBp(ipo: number | null, price: number | null): number | null {
  if (ipo === null || price === null) return null;
  if (!Number.isSafeInteger(ipo) || !Number.isSafeInteger(price) || ipo <= 0) throw new Error("prices are positive whole cents");
  return divRoundHalfUp((price - ipo) * 10_000, ipo);
}

/** Which way a round moved the price; null when the move is unknown. */
export function moveOf(before: number | null | undefined, after: number | null | undefined): Move | null {
  if (before === null || before === undefined || after === null || after === undefined) return null;
  return after > before ? "UP" : after < before ? "DOWN" : "FLAT";
}

/** Code-unit order (as the database's collate "C"): tickers are A–Z only, so this is plain alphabetical. */
const byTicker = (a: BoardTile, b: BoardTile) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0);

/**
 * The tiles in ticker order. After the market close (`closed`) a company with a closing price shows that price and
 * its change since the IPO is to the closing price. `lastRound` is the last cleared round's clearing rows (empty
 * before any round has cleared).
 */
export function boardTiles(companies: readonly BoardCompany[], lastRound: readonly BoardMoveRow[], closed: boolean): BoardTile[] {
  const moves = new Map(lastRound.map((r) => [r.company_id, r]));
  return companies
    .filter((c): c is BoardCompany & { ticker: string } => !!c.ticker)
    .map((c): BoardTile => {
      const closing = closed && c.closing_price !== null;
      const price = c.ipo_price === null ? null : closing ? c.closing_price : c.market_price;
      const m = moves.get(c.id);
      return {
        id: c.id,
        ticker: c.ticker,
        name: c.name ?? c.ticker,
        price,
        closing: closing && price !== null,
        changeBp: changeSinceIpoBp(c.ipo_price, price),
        move: m ? moveOf(m.market_before, m.market_after) : null,
      };
    })
    .sort(byTicker);
}

// ───────────────────────────── Paging ─────────────────────────────

/** Pages needed for `n` tiles (at least one, so an empty board still has a page). */
export function pageCount(n: number, size = BOARD_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(n / size));
}

/** The page on screen at server time `nowMs`: a new page every `periodMs`, the same on every screen. */
export function pageIndex(nowMs: number, pages: number, periodMs = BOARD_PAGE_MS): number {
  if (pages <= 1) return 0;
  const slot = Math.floor(nowMs / periodMs);
  return ((slot % pages) + pages) % pages;
}

/** The tiles of page `index` (0-based). */
export function pageOf<T>(items: readonly T[], index: number, size = BOARD_PAGE_SIZE): T[] {
  return items.slice(index * size, (index + 1) * size);
}

// ───────────────────────────── Showing ─────────────────────────────

export const MOVE_ARROWS: Record<Move, string> = { UP: "▲", DOWN: "▼", FLAT: "▬" };

/** Emerald for up, red for down, grey for unchanged. */
export function toneOf(sign: number | null): "up" | "down" | "flat" {
  return sign === null || sign === 0 ? "flat" : sign > 0 ? "up" : "down";
}

export const MOVE_TONE: Record<Move, "up" | "down" | "flat"> = { UP: "up", DOWN: "down", FLAT: "flat" };

export type PriceRowFit = "normal" | "small" | "smaller";

/**
 * How large the price and the change are set on a tile, by the length of the text shown: a price over $100 or a
 * change past ±100% gets smaller type, so the row never runs out of its tile (5 tiles across 1920 px).
 */
export function priceRowFit(price: string, change: string): PriceRowFit {
  const n = price.length + change.length;
  return n <= 13 ? "normal" : n === 14 ? "small" : "smaller";
}

/** Until when the tiles that moved in a round stay highlighted (null: no highlight). */
export function highlightUntil(clearedAt: string | null | undefined): number | null {
  if (!clearedAt) return null;
  const at = Date.parse(clearedAt);
  return Number.isNaN(at) ? null : at + BOARD_HIGHLIGHT_MS;
}
