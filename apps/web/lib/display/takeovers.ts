// What the full-screen takeovers show, worked out from public rows: the seed commitment split so the hall can read
// it, the verdicts' top movers, the closing bell's gainers and losers, the awards grouped by track and place, and
// which page of a long list is on screen. Pure, so the choices (ties, short lists, nobody moving) are unit-tested.
// Changes are basis points rounded half-up (divRoundHalfUp); no floating point decides a number on the screen.

import { divRoundHalfUp, TRACK_LABELS, type Track } from "@msim/engine";
import { bp, money } from "@/lib/format";

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

// ───────────── Crisis ─────────────

/** The crisis card's title when it says more than its category (a deck may repeat the category as the title). */
export function crisisTitle(category: string | null | undefined, title: string | null | undefined): string | null {
  const t = (title ?? "").trim();
  if (!t || t.toLowerCase() === (category ?? "").trim().toLowerCase()) return null;
  return t;
}

// ───────────── Verdicts ─────────────

export interface VerdictRow {
  ticker: string;
  name: string | null;
  /** The released final score (0–100). */
  score: number | null;
  /** The tier applied, in basis points. */
  tierBp: number;
  /** Market price before → after the tier (null for the pitch, which sets the IPO price). */
  before: number | null;
  after: number | null;
}

export interface Movers<T> {
  /** Up to `limit` companies whose tier moved them up: highest tier, then highest score, then ticker. */
  risers: T[];
  /** Up to `limit` companies whose tier moved them down: lowest tier, then lowest score, then ticker. */
  fallers: T[];
  up: number;
  down: number;
  unchanged: number;
}

/** The verdict release's top movers (plan and flash). A tier of 0% is neither a riser nor a faller. */
export function verdictMovers<T extends VerdictRow>(rows: readonly T[], limit = 5): Movers<T> {
  const up = rows.filter((r) => r.tierBp > 0);
  const down = rows.filter((r) => r.tierBp < 0);
  return {
    risers: [...up].sort((a, b) => b.tierBp - a.tierBp || (b.score ?? -1) - (a.score ?? -1) || byTicker(a, b)).slice(0, limit),
    fallers: [...down].sort((a, b) => a.tierBp - b.tierBp || (a.score ?? 101) - (b.score ?? 101) || byTicker(a, b)).slice(0, limit),
    up: up.length,
    down: down.length,
    unchanged: rows.length - up.length - down.length,
  };
}

export interface PitchRow {
  ticker: string;
  name: string | null;
  score: number | null;
  ipoPrice: number | null;
}

export interface PitchSummary<T> {
  /** Companies with an IPO price. */
  listed: number;
  low: number | null;
  high: number | null;
  /** The highest IPO prices: highest score first, then the higher price, then ticker. */
  top: T[];
  /** Companies left out of `top` that share the last shown company's score (a tie across the cut). */
  moreTied: number;
}

/** The pitch release: how many companies are listed, the range of IPO prices and the top `limit`. */
export function pitchSummary<T extends PitchRow>(rows: readonly T[], limit = 5): PitchSummary<T> {
  const listed = rows.filter((r) => r.ipoPrice !== null);
  const prices = listed.map((r) => r.ipoPrice!);
  const sorted = [...listed].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.ipoPrice! - a.ipoPrice! || byTicker(a, b));
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
  return scores.map((score, i) => scores.indexOf(score) === i ? i + 1 : scores.indexOf(score) + 1);
}

// ───────────── Closing bell ─────────────

export interface ClosingRow {
  ticker: string;
  name: string | null;
  ipoPrice: number | null;
  closingPrice: number | null;
}

export interface ClosingMovers<T> {
  /** Biggest rises from the IPO price to the closing price (then ticker). */
  gainers: (T & { changeBp: number })[];
  /** Biggest falls (then ticker). */
  losers: (T & { changeBp: number })[];
  /** Companies that closed exactly at their IPO price. */
  flat: number;
}

export function closingMovers<T extends ClosingRow>(rows: readonly T[], limit = 5): ClosingMovers<T> {
  const withChange = rows.flatMap((r) => {
    const c = changeBp(r.ipoPrice, r.closingPrice);
    return c === null ? [] : [{ ...r, changeBp: c }];
  });
  return {
    gainers: withChange.filter((r) => r.changeBp > 0).sort((a, b) => b.changeBp - a.changeBp || byTicker(a, b)).slice(0, limit),
    losers: withChange.filter((r) => r.changeBp < 0).sort((a, b) => a.changeBp - b.changeBp || byTicker(a, b)).slice(0, limit),
    flat: withChange.filter((r) => r.changeBp === 0).length,
  };
}

// ───────────── Awards ─────────────

/** One row of public.rankings(event).awards. */
export interface AwardRow {
  code: string;
  place: number;
  metric: Record<string, unknown> | null;
  teams: { code: string; name: string } | null;
  companies: { ticker: string; name: string | null } | null;
}

export interface Podium {
  track: Track;
  label: string;
  /** Places 1–3 that have a winner, in order; tied teams share a place (1, 2, 2 leaves no third). */
  places: { place: number; winners: AwardRow[] }[];
}

const TRACKS: Track[] = ["PRODUCT", "CONSULTING", "FINANCE"];

const byWinner = (a: AwardRow, b: AwardRow) => {
  const x = a.teams?.code ?? a.companies?.ticker ?? "";
  const y = b.teams?.code ?? b.companies?.ticker ?? "";
  return x < y ? -1 : x > y ? 1 : 0;
};

function byPlace(rows: AwardRow[]): { place: number; winners: AwardRow[] }[] {
  const places = new Map<number, AwardRow[]>();
  for (const r of rows) places.set(r.place, [...(places.get(r.place) ?? []), r]);
  return [...places]
    .sort(([a], [b]) => a - b)
    .map(([place, winners]) => ({ place, winners: winners.sort(byWinner) }));
}

/** The top 3 of each track (Product, Consulting, Finance), grouped by place. */
export function podiums(awards: readonly AwardRow[]): Podium[] {
  return TRACKS.map((track) => ({
    track,
    label: TRACK_LABELS[track],
    places: byPlace(awards.filter((a) => a.code === `${track}_TOP3` && a.place >= 1 && a.place <= 3)),
  }));
}

/**
 * At most `max` teams on one podium (ties could in theory put many teams on it): the first `max` in place order are
 * shown, and `more` counts the tied teams that are not.
 */
export function capPodium(places: Podium["places"], max = 6): { places: Podium["places"]; more: number } {
  let room = max;
  let more = 0;
  const out: Podium["places"] = [];
  for (const p of places) {
    const shown = p.winners.slice(0, Math.max(0, room));
    if (shown.length > 0) out.push({ place: p.place, winners: shown });
    more += p.winners.length - shown.length;
    room -= shown.length;
  }
  return { places: out, more };
}

/** How densely a podium is set: up to 3 teams large, up to 5 compact, more dense. */
export function podiumDensity(teams: number): "large" | "compact" | "dense" {
  return teams <= 3 ? "large" : teams <= 5 ? "compact" : "dense";
}

export const SPECIAL_AWARDS = [
  { code: "BEST_TURNAROUND", label: "Best turnaround", description: "The biggest rise from the post-crisis price to the closing price" },
  { code: "BEST_RESCUE_PLAN", label: "Best rescue plan", description: "The highest rescue plan score" },
  { code: "BEST_JUDGING_FUND", label: "Best judging fund", description: "The best portfolio valued at the AI's prices" },
] as const;

export type SpecialAwardCode = (typeof SPECIAL_AWARDS)[number]["code"];

/** The three special awards in a fixed order, each with its winners (a tie may give two; none: not awarded). */
export function specialAwards(awards: readonly AwardRow[]) {
  return SPECIAL_AWARDS.map((s) => ({ ...s, winners: awards.filter((a) => a.code === s.code).sort(byWinner) }));
}

/** A whole number from a jsonb metric (numbers, or the string form of a bigint); null otherwise. */
function int(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isSafeInteger(n) ? n : null;
}

/** The award's metric in plain English. */
export function awardMetric(a: AwardRow): string {
  const m = a.metric ?? {};
  switch (a.code) {
    case "BEST_TURNAROUND": {
      const post = int(m.post_crisis_price);
      const close = int(m.closing_price);
      const change = changeBp(post, close);
      return `${money(post)} after the crisis → ${money(close)} at the close${change === null ? "" : ` (${bp(change)})`}`;
    }
    case "BEST_RESCUE_PLAN":
      return `Plan score ${int(m.score) ?? "—"} / 100`;
    case "BEST_JUDGING_FUND":
      return `${money(int(m.ai_value))} at AI prices (${bp(int(m.return_bp))})`;
    default:
      return `${money(int(m.final_value))} (${bp(int(m.return_bp))})`;
  }
}

/** The final value and return of a top-3 award (money and basis points), for the podium. */
export function podiumNumbers(a: AwardRow): { value: string; change: string; changeBp: number | null } {
  const m = a.metric ?? {};
  const r = int(m.return_bp);
  return { value: money(int(m.final_value)), change: bp(r), changeBp: r };
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
