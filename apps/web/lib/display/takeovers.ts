// What the full-screen takeovers show, worked out from public rows: the seed commitment split so the hall can read
// it, the top PRDs and starting prices, the rescue circle, the reveal's risers and fallers, the closing bell's
// gainers and losers, the awards one by one, and which page of a long list is on screen. Pure, so the choices (ties, short lists, nobody moving) are unit-tested.
// Changes are basis points rounded half-up (divRoundHalfUp); no floating point decides a number on the screen.

import { divRoundHalfUp, type AwardCode } from "@msim/engine";

// ───────────── Lottery ─────────────

/** A hex digest in groups (a 64-character SHA-256: 4 groups of 16), lower case, for reading from the hall. */
export function hexGroups(hex: string | null | undefined, size = 16): string[] {
  const clean = (hex ?? "").trim().toLowerCase();
  const out: string[] = [];
  for (let i = 0; i < clean.length; i += size) out.push(clean.slice(i, i + size));
  return out;
}

const HOST = /^[A-Za-z0-9.-]+(:\d{1,5})?$|^\[[0-9A-Fa-f:]+\](:\d{1,5})?$/;

/**
 * Where anyone can download the public lottery record: an absolute address when the request's host is known (so the
 * hall can type it), otherwise the path. Plain http only for a local host.
 */
export function lotteryRecordUrl(slug: string, host: string | null | undefined, proto: string | null | undefined): string {
  const path = `/api/lottery-record?event=${encodeURIComponent(slug)}`;
  const h = host?.split(",")[0]?.trim();
  if (!h || !HOST.test(h)) return path;
  const local = /^(localhost|127\.|\[::1\])/.test(h);
  const p = proto?.split(",")[0]?.trim().toLowerCase();
  const scheme = p === "http" || p === "https" ? p : local ? "http" : "https";
  return `${scheme}://${h}${path}`;
}

// ───────────── Prices ─────────────

/** The change from one price to another in basis points, half-up; null without both prices. */
export function changeBp(from: number | null | undefined, to: number | null | undefined): number | null {
  if (from === null || from === undefined || to === null || to === undefined || from <= 0) return null;
  return divRoundHalfUp(BigInt(to - from) * 10_000n, BigInt(from));
}

const byTicker = (a: { ticker: string }, b: { ticker: string }) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0);

// ───────────── 23:30: starting prices ─────────────

export interface PrdRow {
  ticker: string;
  name: string | null;
  score: number | null;
  startPrice: number | null;
}

export interface PrdSummary<T> {
  /** Companies with a starting price. */
  listed: number;
  low: number | null;
  high: number | null;
  /** The best PRDs: highest score first, then ticker. */
  top: T[];
  /** Companies left out of `top` that share the last shown company's score (a tie across the cut). */
  moreTied: number;
}

/** The 23:30 reveal: how many companies are listed, the range of starting prices and the top `limit` PRDs. */
export function prdSummary<T extends PrdRow>(rows: readonly T[], limit = 5): PrdSummary<T> {
  const listed = rows.filter((r) => r.startPrice !== null);
  const prices = listed.map((r) => r.startPrice!);
  const sorted = [...listed].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || byTicker(a, b));
  const top = sorted.slice(0, limit);
  const last = top.at(-1);
  return {
    listed: listed.length,
    low: prices.length ? Math.min(...prices) : null,
    high: prices.length ? Math.max(...prices) : null,
    top,
    moreTied: last ? sorted.slice(limit).filter((r) => r.score === last.score).length : 0,
  };
}

/**
 * Competition ranks (1, 1, 1, 4) for rows already sorted best first: equal scores share a number, so a tie never
 * reads as a winner chosen by ticker.
 */
export function competitionRanks(scores: readonly (number | null)[]): number[] {
  return scores.map((score, i) => (scores.indexOf(score) === i ? i + 1 : scores.indexOf(score) + 1));
}

// ───────────── 23:45: the rescue circle ─────────────

export interface CircleCompany {
  id: string;
  ticker: string | null;
  founder_team_id: string;
  rescuer_team_id: string | null;
}

/**
 * Who rescues whom, as tickers only (no team is named): the team that built X rescues Y, written X → Y. The rescue
 * lottery gives every team another team's company, so following the arrows makes one or more closed circles. Each
 * circle starts at its alphabetically first ticker; circles are listed by that ticker. A company whose rescuer built
 * nothing listed (should not happen) ends its chain.
 */
export function rescueCircles(companies: readonly CircleCompany[]): string[][] {
  const tickerOf = (c: CircleCompany) => c.ticker ?? "?";
  const builtBy = new Map(companies.map((c) => [c.founder_team_id, c]));
  /** X → the company X's founders rescue. */
  const next = new Map<string, CircleCompany>();
  for (const c of companies) {
    if (!c.rescuer_team_id) continue;
    const rescuerCompany = builtBy.get(c.rescuer_team_id);
    if (rescuerCompany) next.set(rescuerCompany.id, c);
  }
  const seen = new Set<string>();
  const out: string[][] = [];
  const sorted = [...companies].sort((a, b) => (tickerOf(a) < tickerOf(b) ? -1 : tickerOf(a) > tickerOf(b) ? 1 : 0));
  for (const start of sorted) {
    if (seen.has(start.id) || !next.has(start.id)) continue;
    const chain: string[] = [];
    let c: CircleCompany | undefined = start;
    while (c && !seen.has(c.id)) {
      seen.add(c.id);
      chain.push(tickerOf(c));
      c = next.get(c.id);
    }
    // Back at the start: a closed circle, written with its first ticker again at the end.
    if (c && c.id === start.id) chain.push(tickerOf(start));
    out.push(chain);
  }
  return out;
}

/** Cuts the circles into lines of at most `perLine` tickers, so a circle of 150 wraps on screen. */
export function circleLines(circles: readonly string[][], perLine = 10): string[][] {
  const out: string[][] = [];
  for (const c of circles) for (let i = 0; i < c.length; i += perLine) out.push(c.slice(i, i + perLine));
  return out;
}

// ───────────── 02:45: the score reveal ─────────────

export interface RevealRow {
  ticker: string;
  name: string | null;
  /** The crisis-solution score (0–100). */
  score: number | null;
  /** The reveal factor, in basis points (11,700 = × 1.17). */
  factorBp: number;
  before: number | null;
  after: number | null;
}

export interface RevealMovers<T> {
  /** Up to `limit` biggest risers: highest factor, then ticker. */
  risers: T[];
  /** Up to `limit` biggest fallers: lowest factor, then ticker. */
  fallers: T[];
  up: number;
  down: number;
  unchanged: number;
}

/** The reveal's biggest risers and fallers. A score of exactly 50 (factor 10,000) is neither. */
export function revealMovers<T extends RevealRow>(rows: readonly T[], limit = 5): RevealMovers<T> {
  const up = rows.filter((r) => r.factorBp > 10_000);
  const down = rows.filter((r) => r.factorBp < 10_000);
  return {
    risers: [...up].sort((a, b) => b.factorBp - a.factorBp || byTicker(a, b)).slice(0, limit),
    fallers: [...down].sort((a, b) => a.factorBp - b.factorBp || byTicker(a, b)).slice(0, limit),
    up: up.length,
    down: down.length,
    unchanged: rows.length - up.length - down.length,
  };
}

// ───────────── 04:30: the closing bell ─────────────

export interface ClosingRow {
  ticker: string;
  name: string | null;
  startPrice: number | null;
  closingPrice: number | null;
}

export interface ClosingMovers<T> {
  /** Biggest rises from the starting price to the closing price (then ticker). */
  gainers: (T & { changeBp: number })[];
  /** Biggest falls (then ticker). */
  losers: (T & { changeBp: number })[];
  /** Companies that closed exactly at their starting price. */
  flat: number;
}

export function closingMovers<T extends ClosingRow>(rows: readonly T[], limit = 5): ClosingMovers<T> {
  const withChange = rows.flatMap((r) => {
    const c = changeBp(r.startPrice, r.closingPrice);
    return c === null ? [] : [{ ...r, changeBp: c }];
  });
  return {
    gainers: withChange.filter((r) => r.changeBp > 0).sort((a, b) => b.changeBp - a.changeBp || byTicker(a, b)).slice(0, limit),
    losers: withChange.filter((r) => r.changeBp < 0).sort((a, b) => a.changeBp - b.changeBp || byTicker(a, b)).slice(0, limit),
    flat: withChange.filter((r) => r.changeBp === 0).length,
  };
}

// ───────────── 05:15: the awards, one by one ─────────────

/** The order of the ceremony: the special awards first, the podium last, the winner at the very end. */
export const CEREMONY_ORDER: readonly AwardCode[] = ["BEST_PRD", "BEST_SOLUTION", "BEST_INVESTOR", "BEST_COMPANY", "THIRD", "RUNNER_UP", "WINNER"];

/** How long each award has the screen before the next is revealed, at the night's real speed. */
export const AWARD_STEP_SECONDS = 45;

/**
 * How many awards are revealed at `nowMs`: the first at once, then one more every AWARD_STEP_SECONDS (shorter in a
 * rehearsal, never below 5 s), until all `total` are up. By the server clock, so every screen and a reload agree.
 */
export function awardsRevealed(awardsAt: string, nowMs: number, total: number, clockSpeed = 1): number {
  const start = Date.parse(awardsAt);
  if (Number.isNaN(start) || total <= 0 || nowMs < start) return 0;
  const speed = Number.isFinite(clockSpeed) && clockSpeed > 1 ? clockSpeed : 1;
  const step = Math.max(5, AWARD_STEP_SECONDS / speed) * 1000;
  return Math.min(total, 1 + Math.floor((nowMs - start) / step));
}

/** When the next award is revealed (null once all are up). */
export function nextAwardAt(awardsAt: string, nowMs: number, total: number, clockSpeed = 1): string | null {
  const shown = awardsRevealed(awardsAt, nowMs, total, clockSpeed);
  if (shown >= total) return null;
  const speed = Number.isFinite(clockSpeed) && clockSpeed > 1 ? clockSpeed : 1;
  const step = Math.max(5, AWARD_STEP_SECONDS / speed) * 1000;
  return new Date(Date.parse(awardsAt) + shown * step).toISOString();
}

/** The award lines in ceremony order (only the awards given). */
export function ceremony<T extends { code: AwardCode }>(lines: readonly T[]): T[] {
  return CEREMONY_ORDER.flatMap((c) => lines.filter((l) => l.code === c));
}

// ───────────── Paging ─────────────

/** Splits a list into pages of at most `max`, as even as possible (50 at up to 20 a page: 17, 17, 16). */
export function evenPages<T>(items: readonly T[], max: number): T[][] {
  if (items.length === 0) return [[]];
  const pages = Math.ceil(items.length / max);
  const per = Math.ceil(items.length / pages);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += per) out.push(items.slice(i, i + per));
  return out;
}

/** Which page is on screen at `nowMs` (server time): each page shows for `everyMs`, in turn. */
export function pageAt(nowMs: number, pages: number, everyMs = 20_000): number {
  if (pages <= 1 || !Number.isFinite(nowMs)) return 0;
  return Math.floor(nowMs / everyMs) % pages;
}
