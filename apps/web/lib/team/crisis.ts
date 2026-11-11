// The crisis room (PRIMUS Rounds 2 and 3): which sub-round is under way, its timeline, whether hiring, writing and
// rating are open, what each side of an offer may do, and where the Round 3 draft stands. Pure: the page reads the
// rows (lib/team/crisis-data.ts) and these functions decide what it shows. The database enforces every rule again.

import { subroundName, type DeadlineCode, type PhaseCode } from "@msim/engine";
import { deadlinePassed, type PauseState } from "./squad";

export type Deadlines = Partial<Record<DeadlineCode, string>>;

/** The time of sub-round k's step (HIRE, DUE, RATE or REVEAL), or null. */
export function stepAt(d: Deadlines, step: "REVEAL" | "HIRE" | "DUE" | "RATE", k: number): string | null {
  return d[`${step}_${k}` as DeadlineCode] ?? null;
}

export interface SubroundRow {
  k: number;
  revealed_at: string | null;
  hiring_closed_at: string | null;
  due_closed_at: string | null;
  rated_at: string | null;
}

export interface OfferRow {
  id: string;
  k: number;
  company_id: string;
  firm_team_id: string;
  cash_cents: number;
  shares: number;
  note: string;
  status: "OPEN" | "ACCEPTED" | "DECLINED" | "WITHDRAWN" | "LAPSED";
  turn: "FIRM" | "COMPANY";
  company_counters: number;
  firm_counters: number;
  updated_at: string;
}

export interface EngagementRow {
  id: string;
  k: number;
  company_id: string;
  firm_team_id: string;
  cash_cents: number;
  shares: number;
  escrow: "HELD" | "RELEASED" | "REFUNDED";
  rating: number | null;
  rating_default: boolean;
  bonus_cents: number | null;
}

export interface DraftPickRow {
  company_id: string;
  pick_no: number;
  score_avg: number;
  opens_at: string;
  closes_at: string;
  statement_id: string | null;
  picked_at: string | null;
  by_default: boolean;
}

export const MAX_COUNTERS = 3;
/** A firm takes at most two clients per sub-round. */
export const FIRM_CLIENTS_PER_SUBROUND = 2;

/** The sub-round under way: in Round 2 the latest revealed crisis, in Round 3 the solution (5); else none. */
export function currentSubround(phase: PhaseCode, subrounds: readonly SubroundRow[]): number | null {
  if (phase === "SATURATION") return 5;
  if (phase !== "PRESSURE") return null;
  const revealed = subrounds.filter((s) => s.k >= 1 && s.k <= 4 && s.revealed_at !== null).map((s) => s.k);
  return revealed.length ? Math.max(...revealed) : null;
}

export interface TimelineStep {
  code: DeadlineCode;
  label: string;
  at: string | null;
  passed: boolean;
}

/** The sub-round's steps in order: the reveal (Round 3: the end of the draft), hiring, due, ratings. */
export function subroundTimeline(k: number, deadlines: Deadlines, nowMs: number, pause: PauseState): TimelineStep[] {
  const steps: [DeadlineCode, string][] = [
    [k === 5 ? "DRAFT" : (`REVEAL_${k}` as DeadlineCode), k === 5 ? "Draft ends" : "Crisis revealed"],
    [`HIRE_${k}` as DeadlineCode, "Hiring closes"],
    [`DUE_${k}` as DeadlineCode, k === 5 ? "Solution due" : "Plan and memo due"],
    [`RATE_${k}` as DeadlineCode, "Ratings close"],
  ];
  return steps.map(([code, label]) => {
    const at = deadlines[code] ?? null;
    return { code, label, at, passed: at !== null && deadlinePassed(at, nowMs, pause) };
  });
}

const passed = (d: Deadlines, code: DeadlineCode, nowMs: number, p: PauseState) => {
  const at = d[code];
  return at !== undefined && deadlinePassed(at, nowMs, p);
};

/** Hiring is open for sub-round k (app.hiring_subround): after the reveal (Round 3: after the draft), before HIRE_k. */
export function hiringOpen(k: number | null, phase: PhaseCode, deadlines: Deadlines, nowMs: number, p: PauseState): boolean {
  if (k === null) return false;
  if (k === 5) return phase === "SATURATION" && passed(deadlines, "DRAFT", nowMs, p) && !passed(deadlines, "HIRE_5", nowMs, p);
  return phase === "PRESSURE" && !passed(deadlines, `HIRE_${k}` as DeadlineCode, nowMs, p);
}

/** A company rates its firm after the due time and until ratings close. */
export function ratingOpen(k: number, deadlines: Deadlines, nowMs: number, p: PauseState): boolean {
  return passed(deadlines, `DUE_${k}` as DeadlineCode, nowMs, p) && !passed(deadlines, `RATE_${k}` as DeadlineCode, nowMs, p);
}

export type OfferSide = "COMPANY" | "FIRM";
export type OfferMove = "ACCEPT" | "DECLINE" | "COUNTER" | "WITHDRAW";

/** What this side may do with an offer now (respond_offer): the side whose turn it is answers; the company withdraws. */
export function offerMoves(o: OfferRow, side: OfferSide, hiring: boolean): OfferMove[] {
  if (o.status !== "OPEN" || !hiring) return [];
  const moves: OfferMove[] = [];
  if (o.turn === side) {
    moves.push("ACCEPT", "DECLINE");
    if (countersLeft(o, side) > 0) moves.push("COUNTER");
  }
  if (side === "COMPANY") moves.push("WITHDRAW");
  return moves;
}

export function countersLeft(o: OfferRow, side: OfferSide): number {
  return Math.max(0, MAX_COUNTERS - (side === "COMPANY" ? o.company_counters : o.firm_counters));
}

export const OFFER_STATUS_TONE = { OPEN: "amber", ACCEPTED: "green", DECLINED: "red", WITHDRAWN: "slate", LAPSED: "slate" } as const;

/** "$1,250.50" or "1250.5" → cents; null when it is not an amount. */
export function parseDollars(raw: unknown): number | null {
  const s = String(raw ?? "").replace(/[$,\s]/g, "");
  if (s === "") return 0;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** Whole shares from a field (empty is 0); null when it is not a whole number. */
export function parseShares(raw: unknown): number | null {
  const s = String(raw ?? "").replace(/[,\s]/g, "");
  if (s === "") return 0;
  return /^\d{1,9}$/.test(s) ? Number(s) : null;
}

/** Round 3 fees are worth 5–20% of the company's cash (app.offer_problem). */
export function feeBand(cashCents: number): { min: number; max: number } {
  return { min: Math.ceil(cashCents * 0.05), max: Math.floor(cashCents * 0.2) };
}

/** An offer's terms in words: "$500.00 + 100 shares". */
export function termsText(cash: string, shares: number): string {
  if (shares === 0) return cash;
  const sh = `${shares.toLocaleString("en-US")} ${shares === 1 ? "share" : "shares"}`;
  return cash === "$0.00" ? sh : `${cash} + ${sh}`;
}

export interface DraftState {
  /** The pick on the clock (the first without a statement), or null when the draft is over or not started. */
  current: DraftPickRow | null;
  mine: DraftPickRow | null;
  myTurn: boolean;
  /** Picks before mine still to be made. */
  ahead: number;
  done: boolean;
}

export function draftState(picks: readonly DraftPickRow[], myCompanyId: string | null): DraftState {
  const ordered = [...picks].sort((a, b) => a.pick_no - b.pick_no);
  const current = ordered.find((p) => p.statement_id === null) ?? null;
  const mine = myCompanyId ? (ordered.find((p) => p.company_id === myCompanyId) ?? null) : null;
  const ahead = mine && mine.statement_id === null ? ordered.filter((p) => p.statement_id === null && p.pick_no < mine.pick_no).length : 0;
  return { current, mine, myTurn: !!current && !!mine && current.company_id === mine.company_id, ahead, done: ordered.length > 0 && current === null };
}

/** How many companies picked each statement. */
export function statementCounts(picks: readonly DraftPickRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of picks) if (p.statement_id) m.set(p.statement_id, (m.get(p.statement_id) ?? 0) + 1);
  return m;
}

/** The sub-rounds to list in the history: every one before k that has started. */
export function pastSubrounds(k: number | null, subrounds: readonly SubroundRow[]): number[] {
  return subrounds
    .filter((s) => (k === null || s.k < k) && (s.revealed_at !== null || s.k === 5) && s.k !== k)
    .filter((s) => s.k < 5)
    .map((s) => s.k)
    .sort((a, b) => b - a);
}

export const subroundTitle = (k: number) => (k === 5 ? "Round 3 · the solution" : `Round 2 · ${subroundName(k)}`);
