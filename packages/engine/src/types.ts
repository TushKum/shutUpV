// Shared vocabulary. These mirror the Postgres enums in supabase/migrations/*_foundation.sql.

export const ACCOUNT_ROLES = ["TEAM", "ORGANISER", "FAIRNESS", "DISPLAY"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/** In the order of the night; comparisons rely on this order (as the Postgres enum does). */
export const PHASE_CODES = [
  "SETUP",
  "CHECKIN",
  "BRIEFING",
  "BUILD",
  "JUDGING_1",
  "REVEAL_1",
  "CRISIS_QA",
  "RESCUE",
  "JUDGING_2",
  "MARKET_BLIND",
  "MARKET",
  "SETTLEMENT",
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

/** Rounds 1–2 trade before the 02:45 score reveal (MARKET_BLIND), rounds 3–9 after it (MARKET). */
export const TRADING_PHASES = ["MARKET_BLIND", "MARKET"] as const;
export type TradingPhase = (typeof TRADING_PHASES)[number];

export const DEADLINE_CODES = [
  "PROBLEM_DRAW",
  "TWIST",
  "PRD_LOCK",
  "QA_CLOSE",
  "SOLUTION_LOCK",
  "LEADERBOARD_FREEZE",
  "MARKET_CLOSE",
] as const;
export type DeadlineCode = (typeof DEADLINE_CODES)[number];

export const ORDER_TYPES = ["BUY", "SELL"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

/** PRD: Round 1, written by the founding team. SOLUTION: Round 2, written by the rescuing team. */
export const SUBMISSION_TYPES = ["PRD", "SOLUTION"] as const;
export type SubmissionType = (typeof SUBMISSION_TYPES)[number];

export const PRICE_KINDS = ["START", "CRISIS", "REVEAL", "CLEARING", "CLOSE", "APPEAL"] as const;
export type PriceKind = (typeof PRICE_KINDS)[number];

export const BULLETIN_KINDS = ["GENERAL", "TWIST", "CRISIS", "RUMOUR", "FAIRNESS", "SYSTEM"] as const;
export type BulletinKind = (typeof BULLETIN_KINDS)[number];

export const AWARD_CODES = ["WINNER", "RUNNER_UP", "THIRD", "BEST_PRD", "BEST_SOLUTION", "BEST_INVESTOR", "BEST_COMPANY"] as const;
export type AwardCode = (typeof AWARD_CODES)[number];
