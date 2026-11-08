// The market as every team sees it: the companies with their prices, the last round's move and a trend line, each
// company's price history (round_prices: the starting price, the crisis, the 02:45 reveal, every round, the close) with
// its market and score-based prices, and what is public about it (the PRD from 23:30, the crisis card from 23:45, the
// crisis solution from 02:15, its scores once revealed). Pure. Prices are integer cents; changes are computed exactly
// (basis points, rounded half-up) and never through floating point.

import type { ChartPoint } from "@/lib/chart";
import { TEMPLATES, divRoundHalfUp, phaseReached, trimAscii, type PhaseCode, type SubmissionType } from "@msim/engine";
import { bp, count, money, signedCount } from "@/lib/format";

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
  start_price: number | null;
  market_price: number | null;
  score_price: number | null;
  closing_price: number | null;
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
  start: number | null;
  price: number | null;
  scorePrice: number | null;
  closing: number | null;
  /** The last cleared round's move (null before the first clearing). */
  change: { before: number; after: number; bp: number } | null;
  /** The market price after every step so far, for the trend line. */
  trend: number[];
}

/** The companies in ticker order (never by price or score) with the last cleared round's move and their trend. */
export function marketLines(companies: readonly ListedCompany[], lastRound: readonly ClearingRow[], trends: Readonly<Record<string, readonly number[]>>): MarketLine[] {
  const moves = new Map(lastRound.map((r) => [r.company_id, r]));
  return companies
    .filter((c) => c.ticker)
    .map((c) => {
      const m = moves.get(c.id);
      return {
        id: c.id,
        ticker: c.ticker!,
        name: c.name ?? c.ticker!,
        start: c.start_price,
        price: c.market_price,
        scorePrice: c.score_price,
        closing: c.closing_price,
        change: m && m.market_before !== null ? { before: m.market_before, after: m.market_after, bp: changeBp(m.market_before, m.market_after) } : null,
        trend: [...(trends[c.id] ?? [])],
      };
    })
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

// ───────────────────────────── Price history ─────────────────────────────

export type PriceKind = "START" | "CRISIS" | "REVEAL" | "CLEARING" | "CLOSE" | "APPEAL";

export interface PriceRow {
  id: number | string;
  kind: PriceKind;
  round_number: number | null;
  market_before: number | null;
  market_after: number;
  score_before: number | null;
  score_after: number | null;
  buy_qty: number;
  sell_qty: number;
  net_qty: number;
  factor_bp: number | null;
  created_at: string;
}

export interface HistoryLine {
  key: string;
  kind: PriceKind;
  label: string;
  at: string;
  /** The market price after this step (for CLOSE: the closing price). */
  price: number;
  change: string;
  changeSign: -1 | 0 | 1;
  /** The score-based price after this step, when the row carries it. */
  scorePrice: number | null;
  detail: string;
}

/** For steps recorded in the same transaction: the order of the night. */
const KIND_ORDER: Record<PriceKind, number> = { START: 0, CRISIS: 1, CLEARING: 2, REVEAL: 3, CLOSE: 4, APPEAL: 5 };

/** Every price change of one company, in the order it happened (the starting price first, the close last). */
export function historyLines(rows: readonly PriceRow[]): HistoryLine[] {
  return [...rows]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || Number(a.id) - Number(b.id))
    .map((r): HistoryLine => {
      const base = { key: String(r.id), kind: r.kind, at: r.created_at, price: r.market_after, scorePrice: r.score_after };
      const moved = (before: number | null) => ({
        change: changeText(before, r.market_after),
        changeSign: before === null ? (0 as const) : sign(r.market_after - before),
      });
      switch (r.kind) {
        case "START":
          return { ...base, label: "Starting price", change: "—", changeSign: 0, detail: "$10.00 + $0.10 × (PRD score − 50)" };
        case "CRISIS":
          return { ...base, ...moved(r.market_before), label: "Crisis", detail: "−15% on the market and score-based prices" };
        case "REVEAL":
          return {
            ...base,
            ...moved(r.market_before),
            label: "Score reveal",
            detail: `× ${r.factor_bp === null ? "?" : (r.factor_bp / 10_000).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")} on both prices (crisis-solution score)`,
          };
        case "CLEARING":
          return { ...base, ...moved(r.market_before), label: `Round ${r.round_number ?? "?"}`, detail: `Net ${signedCount(r.net_qty)} (buy ${count(r.buy_qty)} · sell ${count(r.sell_qty)})` };
        case "CLOSE":
          return { ...base, label: "Closing price", change: "—", changeSign: 0, detail: `(market ${money(r.market_before)} + score-based ${money(r.score_after)}) ÷ 2` };
        case "APPEAL":
          return { ...base, ...moved(r.market_before), label: "Technical appeal", detail: `Score-based price ${money(r.score_before)} → ${money(r.score_after)}` };
      }
    });
}

const MARKERS: Partial<Record<PriceKind, string>> = { START: "Start", CRISIS: "Crisis", REVEAL: "Reveal", CLOSE: "Close" };

/**
 * The chart of a company's history: the market price step by step, the score-based price dashed (it moves only with
 * the crisis and the reveal, so it is carried forward between them), and a tag on the steps that are not rounds.
 */
export function chartPoints(lines: readonly HistoryLine[]): ChartPoint[] {
  let second: number | null = null;
  return lines.map((l) => {
    if (l.scorePrice !== null) second = l.scorePrice;
    return { label: l.label, value: l.price, second, marker: MARKERS[l.kind] ?? null };
  });
}

// ───────────────────────────── What is public ─────────────────────────────

/** Which submissions are public now (the submissions policy): the PRD from 23:30, the crisis solution from 02:15. */
export function publicTypes(phase: PhaseCode): SubmissionType[] {
  const out: SubmissionType[] = [];
  if (phaseReached(phase, "REVEAL_1")) out.push("PRD");
  if (phaseReached(phase, "MARKET_BLIND")) out.push("SOLUTION");
  return out;
}

export const SUBMISSION_TITLES: Record<SubmissionType, string> = { PRD: "PRD", SOLUTION: "Crisis solution" };

export const PUBLIC_FROM: Record<SubmissionType, string> = {
  PRD: "PRDs go public with the starting prices, at the PRD reveal.",
  SOLUTION: "Crisis solutions go public when trading starts, without their scores (the scores are revealed at the score reveal).",
};

/** The template parts of a submission, in order, with the text as locked ("" when a part was left empty). */
export function submissionSections(type: SubmissionType, content: Readonly<Record<string, unknown>>): { key: string; label: string; text: string }[] {
  return TEMPLATES[type].map((f) => {
    const v = content[f.key];
    return { key: f.key, label: f.label, text: typeof v === "string" ? trimAscii(v) : "" };
  });
}

/** "The market opens at 23:30 with the starting prices." */
export function marketOpensText(): string {
  return "The market list opens at the PRD reveal, when the scores set every company's starting price. Trading (Round 3) starts after Round 2.";
}
