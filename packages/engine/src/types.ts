// Shared vocabulary. These mirror the Postgres enums in supabase/migrations/*_foundation.sql.

export const TRACKS = ["PRODUCT", "CONSULTING", "FINANCE"] as const;
export type Track = (typeof TRACKS)[number];

export const ACCOUNT_ROLES = ["TEAM", "ORGANISER", "FAIRNESS", "DISPLAY"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/** In the order of the night; comparisons rely on this order (as the Postgres enum does). */
export const PHASE_CODES = [
  "SETUP",
  "CHECKIN",
  "BRIEFING",
  "SQUAD_DRAW",
  "BUILD",
  "READING",
  "IPO",
  // PRIMUS Rounds 2 and 3 (docs/PRIMUS.md). A PRIMUS event goes IPO → PRESSURE → SATURATION → CLOSE.
  "PRESSURE",
  "SATURATION",
  "ROUNDS_1_4",
  "CRISIS",
  "RESCUE_1",
  "BREAK",
  "RESCUE_2",
  "PLANS_PUBLISHED",
  "VERDICTS",
  "ROUNDS_13_21",
  "CLOSE",
  "SETTLEMENT",
  "APPEALS",
  "AWARDS",
] as const;
export type PhaseCode = (typeof PHASE_CODES)[number];

export function phaseIndex(phase: PhaseCode): number {
  return PHASE_CODES.indexOf(phase);
}

/** True when `current` is at or after `target`. */
export function phaseReached(current: PhaseCode, target: PhaseCode): boolean {
  return phaseIndex(current) >= phaseIndex(target);
}

export const TRADING_PHASES = ["ROUNDS_1_4", "RESCUE_1", "RESCUE_2", "ROUNDS_13_21", "PRESSURE", "SATURATION"] as const;
export type TradingPhase = (typeof TRADING_PHASES)[number];

export const DEADLINE_CODES = [
  "PROBLEM_PICK",
  "PITCH",
  "CALL_1",
  "IPO_BIDS",
  "FEE",
  "DEAL_BONUS",
  "DEAL",
  "PLAN",
  "CALL_2",
  "FLASH_BULLETIN",
  "FLASH",
  "FLASH_TIER",
  "CALL_3",
  // PRIMUS sub-rounds: k = 1–4 in Round 2, 5 = Round 3 (docs/PRIMUS.md).
  "REVEAL_1", "HIRE_1", "DUE_1", "RATE_1",
  "REVEAL_2", "HIRE_2", "DUE_2", "RATE_2",
  "REVEAL_3", "HIRE_3", "DUE_3", "RATE_3",
  "REVEAL_4", "HIRE_4", "DUE_4", "RATE_4",
  "DRAFT", "HIRE_5", "DUE_5", "RATE_5",
] as const;
export type DeadlineCode = (typeof DEADLINE_CODES)[number];

export const ORDER_TYPES = ["BUY", "SELL", "SHORT", "COVER"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const LOT_TYPES = ["RETAINED", "SQUAD", "EXCHANGE", "SHORT", "FEE"] as const;
export type LotType = (typeof LOT_TYPES)[number];

/** CLASSIC: the original one-night game. PRIMUS: the three-round event of docs/PRIMUS.md. */
export const EVENT_FORMATS = ["CLASSIC", "PRIMUS"] as const;
export type EventFormat = (typeof EVENT_FORMATS)[number];

export const SUBMISSION_TYPES = [
  "PITCH",
  "PLAN",
  "FLASH",
  "MEMO",
  // PRIMUS Round 2 (sub-rounds 1–4) and Round 3 (sub-round 5): docs/PRIMUS.md.
  "CRISIS_1",
  "CRISIS_2",
  "CRISIS_3",
  "CRISIS_4",
  "SOLUTION",
  "ADVICE_1",
  "ADVICE_2",
  "ADVICE_3",
  "ADVICE_4",
  "ADVICE_5",
] as const;
export type SubmissionType = (typeof SUBMISSION_TYPES)[number];

/**
 * What a submission is, whatever its sub-round: the PRD (PITCH), the classic rescue plan and flash answer, the Round 1
 * crisis memo, a Round 2 crisis response plan, the Round 3 solution, or a hired firm's memo to its client (ADVICE).
 */
export const SUBMISSION_KINDS = ["PITCH", "PLAN", "FLASH", "MEMO", "CRISIS", "SOLUTION", "ADVICE"] as const;
export type SubmissionKind = (typeof SUBMISSION_KINDS)[number];

export function submissionKind(type: SubmissionType): SubmissionKind {
  if (type.startsWith("CRISIS_")) return "CRISIS";
  if (type.startsWith("ADVICE_")) return "ADVICE";
  return type as SubmissionKind;
}

/** The PRIMUS sub-round of a submission (1–4: Round 2, 5: Round 3), or null for the others. */
export function subroundOf(type: SubmissionType): number | null {
  if (type === "SOLUTION") return 5;
  const m = /^(?:CRISIS|ADVICE)_(\d)$/.exec(type);
  return m ? Number(m[1]) : null;
}

/** The Product plan of sub-round k (CRISIS_k, or SOLUTION in Round 3), and the hired firm's memo of sub-round k. */
export const planOf = (k: number): SubmissionType => (k === 5 ? "SOLUTION" : (`CRISIS_${k}` as SubmissionType));
export const adviceOf = (k: number): SubmissionType => `ADVICE_${k}` as SubmissionType;

/** A value for every submission type, given one per kind. */
export function byKind<V>(perKind: Record<SubmissionKind, V>): Record<SubmissionType, V> {
  return Object.fromEntries(SUBMISSION_TYPES.map((t) => [t, perKind[submissionKind(t)]])) as Record<SubmissionType, V>;
}

/** The deadline that closes a submission type (a classic plan also waits for the deal deadline when judged). */
export function submissionDeadline(type: SubmissionType): DeadlineCode {
  if (type === "MEMO") return "PITCH"; // the memo closes with the PRD
  const k = subroundOf(type);
  if (k !== null) return `DUE_${k}` as DeadlineCode;
  return type as DeadlineCode;
}

/** Build a full per-type record from a function of the type (labels, paths, initial flags). */
export function perType<V>(fn: (type: SubmissionType) => V): Record<SubmissionType, V> {
  return Object.fromEntries(SUBMISSION_TYPES.map((t) => [t, fn(t)])) as Record<SubmissionType, V>;
}

/** "Crisis 2" / "Round 3": which PRIMUS sub-round a CRISIS_k, ADVICE_k or SOLUTION belongs to. */
export function subroundName(k: number): string {
  return k === 5 ? "Round 3" : `Crisis ${k}`;
}

/** One type per kind (PITCH, PLAN, FLASH, MEMO, CRISIS_1, SOLUTION, ADVICE_1): one judge prompt each. */
export const PROMPT_TYPES: readonly SubmissionType[] = SUBMISSION_KINDS.map((k) => SUBMISSION_TYPES.find((t) => submissionKind(t) === k)!);
