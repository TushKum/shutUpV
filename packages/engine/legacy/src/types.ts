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

export const TRADING_PHASES = ["ROUNDS_1_4", "RESCUE_1", "RESCUE_2", "ROUNDS_13_21"] as const;
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
] as const;
export type DeadlineCode = (typeof DEADLINE_CODES)[number];

export const ORDER_TYPES = ["BUY", "SELL", "SHORT", "COVER"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const LOT_TYPES = ["RETAINED", "SQUAD", "EXCHANGE", "SHORT", "FEE"] as const;
export type LotType = (typeof LOT_TYPES)[number];

export const SUBMISSION_TYPES = ["PITCH", "PLAN", "FLASH"] as const;
export type SubmissionType = (typeof SUBMISSION_TYPES)[number];
