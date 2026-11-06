// Round 3 points, totals, ranking with tie-breaks, the live leaderboard and who may see rankings.

import { clamp, divRoundHalfUp, mul } from "./money";
import { RULES } from "./rules";
import { phaseReached, type AccountRole, type PhaseCode } from "./types";

/** Portfolio value = cash + Σ shares × price. */
export function portfolioValue(cash: number, holdings: Readonly<Record<string, number>>, prices: Readonly<Record<string, number>>): number {
  let v = cash;
  for (const [companyId, qty] of Object.entries(holdings)) {
    if (qty === 0) continue;
    const p = prices[companyId];
    if (p === undefined) throw new Error(`no price for ${companyId}`);
    v += mul(qty, p);
  }
  return v;
}

/** Return in basis points (+1078 = +10.78%), rounded half-up; for display and the 0.01% award comparisons. */
export function returnBp(value: number, start: number = RULES.START_CASH): number {
  return divRoundHalfUp(BigInt(value - start) * 10_000n, BigInt(start));
}

/**
 * Round 3 points = 50 + 2.5 × return %, computed exactly from the portfolio value (no intermediate rounding), kept
 * between 0 and 100 and rounded half-up: 50 + 250 × (value − start) ÷ start.
 */
export function round3Points(value: number, start: number = RULES.START_CASH): number {
  const num = BigInt(RULES.R3_BASE_POINTS) * BigInt(start) + 250n * BigInt(value - start);
  return clamp(divRoundHalfUp(num, BigInt(start)), 0, 100);
}

// ───────────────────────────── Ranking ─────────────────────────────

/**
 * Competition ranking (1, 2, 2, 4) by a comparator where a negative result means `a` ranks higher.
 * Ineligible (disqualified) entries are left out and get rank null.
 */
export function rankBy<T extends { eligible: boolean }>(items: readonly T[], better: (a: T, b: T) => number): (T & { rank: number | null })[] {
  const eligible = items.filter((i) => i.eligible);
  return items.map((item) => ({
    ...item,
    rank: item.eligible ? 1 + eligible.filter((o) => better(o, item) < 0).length : null,
  }));
}

export interface ResultEntry {
  teamId: string;
  r1: number;
  r2: number;
  r3: number;
  /** Portfolio value in cents (everyone starts with the same cash, so this orders the exact return). */
  portfolio: number;
  eligible: boolean;
}

export function total(e: { r1: number; r2: number; r3: number }): number {
  return e.r1 + e.r2 + e.r3;
}

/** Higher total; then higher Round 2 score; then higher Round 1 score; then higher exact return. */
export function compareResults(a: ResultEntry, b: ResultEntry): number {
  return total(b) - total(a) || b.r2 - a.r2 || b.r1 - a.r1 || b.portfolio - a.portfolio;
}

export function rankResults<T extends ResultEntry>(entries: readonly T[]) {
  return rankBy(entries, compareResults);
}

// ───────────────────────────── Leaderboard ─────────────────────────────

/**
 * The live leaderboard's total so far: Round 1 points once the PRD scores are revealed (23:30), Round 2 points once
 * the solution scores are revealed (02:45), and Round 3 points at current market prices once trading has begun.
 */
export function liveTotal(i: {
  r1: number | null;
  r2: number | null;
  /** Portfolio value at current market prices, or null before trading starts. */
  portfolio: number | null;
}): { r1: number; r2: number; r3: number; total: number } {
  const r1 = i.r1 ?? 0;
  const r2 = i.r2 ?? 0;
  const r3 = i.portfolio === null ? 0 : round3Points(i.portfolio);
  return { r1, r2, r3, total: r1 + r2 + r3 };
}

/**
 * Who may read the leaderboard/rankings. Staff always. Teams and the projector: the live board until it freezes at
 * 03:30, then nothing (403) until AWARDS, when the final results are public.
 */
export function canViewRankings(role: AccountRole, phase: PhaseCode, frozen: boolean): boolean {
  if (role === "ORGANISER" || role === "FAIRNESS") return true;
  if (phaseReached(phase, "AWARDS")) return true;
  return !frozen;
}

/** A judge's score is visible to organisers once sealed; to everyone else only once revealed (PRD 23:30, SOLUTION 02:45). */
export function canViewScore(role: AccountRole, status: "PENDING" | "SCORING" | "SEALED" | "REVEALED"): boolean {
  if (status === "REVEALED") return true;
  return role === "ORGANISER" && status === "SEALED";
}
