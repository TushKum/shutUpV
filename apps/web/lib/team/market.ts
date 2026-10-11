// The market as every team sees it: listed companies with their prices and last-round move, each company's price
// history (round_prices), and what has gone public about it (the pitch, the rescue plan, the verdicts, the crisis
// card, the flash answer). Pure. Prices are integer cents; changes are computed exactly (basis points, rounded
// half-up) and never through floating point.

import {
  TEMPLATES,
  divRoundHalfUp,
  phaseReached,
  trimAscii,
  type PhaseCode,
  type SubmissionType,
} from "@msim/engine";
import { bp, clock, count, money, signedCount } from "@/lib/format";

/** after − before as basis points of before (rounded half-up, ties away from zero). */
export function changeBp(before: number, after: number): number {
  if (!Number.isSafeInteger(before) || !Number.isSafeInteger(after) || before <= 0) throw new Error("prices are positive whole cents");
  return divRoundHalfUp((after - before) * 10_000, before);
}

/** "+$0.32 (+3.05%)", "−$1.05 (−10%)", "$0.00 (0%)". */
export function changeText(before: number | null, after: number): string {
  if (before === null) return "—";
  const d = after - before;
  return `${d > 0 ? "+" : ""}${money(d)} (${bp(changeBp(before, after))})`;
}

export const sign = (n: number): -1 | 0 | 1 => (n > 0 ? 1 : n < 0 ? -1 : 0);

// ───────────────────────────── Listing ─────────────────────────────

export interface ListedCompany {
  id: string;
  name: string | null;
  ticker: string | null;
  ipo_price: number | null;
  market_price: number | null;
}

export interface ClearingRow {
  company_id: string;
  market_before: number | null;
  market_after: number;
}

export interface MarketLine {
  id: string;
  ticker: string;
  name: string;
  ipo: number | null;
  price: number | null;
  /** The last cleared round's move (null before the first clearing). */
  change: { before: number; after: number; bp: number } | null;
}

/** The listed companies in ticker order (never by price or score: no rankings) with the last cleared round's move. */
export function marketLines(companies: readonly ListedCompany[], lastRound: readonly ClearingRow[]): MarketLine[] {
  const moves = new Map(lastRound.map((r) => [r.company_id, r]));
  return companies
    .filter((c) => c.ticker)
    .map((c) => {
      const m = moves.get(c.id);
      return {
        id: c.id,
        ticker: c.ticker!,
        name: c.name ?? c.ticker!,
        ipo: c.ipo_price,
        price: c.market_price,
        change: m && m.market_before !== null ? { before: m.market_before, after: m.market_after, bp: changeBp(m.market_before, m.market_after) } : null,
      };
    })
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

// ───────────────────────────── Price history ─────────────────────────────

export type PriceKind = "IPO" | "CLEARING" | "CRISIS" | "PLAN_TIER" | "FLASH_TIER" | "CLOSE";

export interface PriceRow {
  id: number | string;
  kind: PriceKind;
  round_number: number | null;
  market_before: number | null;
  market_after: number;
  ai_before: number | null;
  ai_after: number | null;
  buy_qty: number;
  sell_qty: number;
  short_qty: number;
  cover_qty: number;
  net_qty: number;
  tier_bp: number | null;
  created_at: string;
}

export interface HistoryLine {
  key: string;
  label: string;
  at: string;
  /** The market price after this step (for CLOSE: the closing price). */
  price: number;
  change: string;
  changeSign: -1 | 0 | 1;
  /** The AI price after this step, when it is part of the row. */
  ai: number | null;
  detail: string;
}

const KIND_ORDER: Record<PriceKind, number> = { IPO: 0, CLEARING: 1, CRISIS: 1, PLAN_TIER: 1, FLASH_TIER: 1, CLOSE: 2 };

/** Every price change of one company, in the order it happened (IPO first, the close last). */
export function historyLines(rows: readonly PriceRow[]): HistoryLine[] {
  return [...rows]
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || Number(a.id) - Number(b.id))
    .map((r): HistoryLine => {
      const base = { key: String(r.id), at: r.created_at, price: r.market_after, ai: r.ai_after };
      const moved = (before: number | null) => ({
        change: changeText(before, r.market_after),
        changeSign: before === null ? (0 as const) : sign(r.market_after - before),
      });
      switch (r.kind) {
        case "IPO":
          return { ...base, label: "IPO price", change: "—", changeSign: 0, detail: `Pitch tier ${bp(r.tier_bp ?? 0)} on $10.00` };
        case "CLEARING": {
          const parts = [`buy ${count(r.buy_qty)}`, `sell ${count(r.sell_qty)}`, `short ${count(r.short_qty)}`, `cover ${count(r.cover_qty)}`];
          return { ...base, ...moved(r.market_before), label: `Round ${r.round_number ?? "?"}`, detail: `Net ${signedCount(r.net_qty)} (${parts.join(" · ")})` };
        }
        case "CRISIS":
          return { ...base, ...moved(r.market_before), label: "Crisis shock", detail: "−15% on the market and AI prices" };
        case "PLAN_TIER":
          return { ...base, ...moved(r.market_before), label: "Plan tier", detail: `${bp(r.tier_bp ?? 0)} on the market and AI prices` };
        case "FLASH_TIER":
          return { ...base, ...moved(r.market_before), label: "Flash tier", detail: `${bp(r.tier_bp ?? 0)} on the market and AI prices` };
        case "CLOSE":
          return {
            ...base,
            label: "Closing price",
            change: "—",
            changeSign: 0,
            detail: `(market ${money(r.market_before)} + AI ${money(r.ai_after)}) ÷ 2`,
          };
      }
    });
}

// ───────────────────────────── What is public ─────────────────────────────

export type Released = Record<SubmissionType, boolean>;

/**
 * Which submissions are public now (the same rule as the submissions policy): the pitch from Reading, the rescue
 * plan from Plans published, the flash answer once flash scores are released. A squad can read its own drafts and
 * submissions earlier, but the market shows only what everyone can see.
 */
export function publicTypes(phase: PhaseCode, released: Released): SubmissionType[] {
  const out: SubmissionType[] = [];
  if (phaseReached(phase, "READING")) out.push("PITCH");
  if (phaseReached(phase, "PLANS_PUBLISHED")) out.push("PLAN");
  if (released.FLASH) out.push("FLASH");
  return out;
}

export const SUBMISSION_TITLES: Record<SubmissionType, string> = { PITCH: "Pitch", PLAN: "Rescue plan", FLASH: "Flash answer" };

/** When each kind of submission goes public, for a page that is waiting for it. */
export const PUBLIC_FROM: Record<SubmissionType, string> = {
  PITCH: "The pitch book goes public when Reading starts.",
  PLAN: "Rescue plans go public when Plans published starts.",
  FLASH: "Flash answers go public once the flash scores are released.",
};

// ───────────────────────────── Books ─────────────────────────────

/** A book: every company's public submission of one type, or every company's crisis card. */
export type BookKind = SubmissionType | "CRISIS";
export const BOOK_KINDS: readonly BookKind[] = ["PITCH", "CRISIS", "PLAN", "FLASH"];
export const BOOK_TITLES: Record<BookKind, string> = { PITCH: "Pitch book", CRISIS: "Crisis cards", PLAN: "Rescue plans", FLASH: "Flash answers" };

/** The books that are public now, in the order of the night (crisis cards from the crisis, as the crisis_cards policy). */
export function openBooks(phase: PhaseCode, released: Released): BookKind[] {
  const types = publicTypes(phase, released);
  return BOOK_KINDS.filter((k) => (k === "CRISIS" ? phaseReached(phase, "CRISIS") : types.includes(k)));
}

/** The book named in the address (?type=), the pitch book by default. */
export function parseBookKind(raw: string | string[] | undefined): BookKind {
  const v = (Array.isArray(raw) ? raw[0] : raw)?.trim().toUpperCase() ?? "";
  return (BOOK_KINDS as readonly string[]).includes(v) ? (v as BookKind) : "PITCH";
}

/** When a book goes public, for a page that is waiting for it. */
export const BOOK_PUBLIC_FROM: Record<BookKind, string> = { ...PUBLIC_FROM, CRISIS: "Crisis cards go public at the crisis, when every company gets one." };

/** The template sections of a submission, in order, with the text as submitted ("" when a section was left empty). */
export function submissionSections(type: SubmissionType, content: Readonly<Record<string, unknown>>): { key: string; label: string; text: string }[] {
  return TEMPLATES[type].map((f) => {
    const v = content[f.key];
    return { key: f.key, label: f.label, text: typeof v === "string" ? trimAscii(v) : "" };
  });
}

// ───────────────────────────── Verdicts ─────────────────────────────

export interface ScoreRow {
  company_id: string;
  type: SubmissionType;
  final_score: number | null;
  median: number | null;
  tier_bp: number | null;
  capped: boolean;
  late: boolean;
  missing: boolean;
  penalty: number;
}

export interface Verdict {
  title: string;
  score: string;
  tier: string;
  tierSign: -1 | 0 | 1;
  notes: string[];
}

/** A released score as the market sees it: the final score, its tier and why it is what it is. */
export function verdict(s: ScoreRow): Verdict {
  const notes: string[] = [];
  if (s.missing) notes.push("No submission on time: scored 0.");
  if (s.late) notes.push("Submitted late: scored 0.");
  if (s.capped) notes.push(`Capped at 50: the rescue deal was not fully signed by the deal deadline${s.median !== null ? ` (judges' median ${s.median})` : ""}.`);
  if (s.penalty > 0) notes.push(`−${s.penalty} points: a second attempt to instruct the judge.`);
  const tier = s.tier_bp ?? 0;
  return {
    title: SUBMISSION_TITLES[s.type],
    score: s.final_score === null ? "—" : `${s.final_score}/100`,
    tier: s.type === "PITCH" ? `${bp(tier)} on the IPO price` : `${bp(tier)} on the price`,
    tierSign: sign(tier),
    notes,
  };
}

/** "The market opens at 22:30, when the pitch book goes public." */
export function marketOpensText(readingStartsAt: string | null | undefined): string {
  return readingStartsAt
    ? `The market opens at ${clock(readingStartsAt)} (Reading), when the pitch book goes public. Prices follow at the IPO.`
    : "The market opens at Reading, when the pitch book goes public. Prices follow at the IPO.";
}
