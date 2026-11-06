// Settlement: consultant bonuses, final values per track, rankings with tie-breaks, and who may see them.

import { clamp, divRoundHalfUp, mul } from "./money";
import { RULES } from "./rules";
import { phaseReached, type AccountRole, type PhaseCode, type Track } from "./types";

/** $500 × (plan score − 50), from −$10,000 to +$25,000. */
export function planBonus(planScore: number): number {
  return clamp(RULES.PLAN_BONUS_PER_POINT * (planScore - 50), RULES.PLAN_BONUS_MIN, RULES.PLAN_BONUS_MAX);
}

/** Product: retained shares × closing price + cash. */
export function productValue(p: { retainedShares: number; cash: number; closingPrice: number }): number {
  return mul(p.retainedShares, p.closingPrice) + p.cash;
}

/** Reporting only: 60,000 shares at the IPO price + $50,000 seed money. */
export function productStartValue(ipoPrice: number): number {
  return mul(RULES.RETAINED_SHARES, ipoPrice) + mul(RULES.SEED_SHARES, RULES.SEED_PRICE);
}

/** Consulting: cash (fee cash + bonuses paid at settlement) + fee shares × closing price. */
export function consultingValue(c: { cash: number; feeShares: number; closingPrice: number }): number {
  return c.cash + mul(c.feeShares, c.closingPrice);
}

export interface Holding {
  companyId: string;
  /** Long shares in all lots (exchange + squad). */
  longQty: number;
  shortQty: number;
}

/** Finance: cash + long shares × price − short shares × price. */
export function financeValue(cash: number, holdings: readonly Holding[], prices: Readonly<Record<string, number>>): number {
  let v = cash;
  for (const h of holdings) {
    const p = prices[h.companyId];
    if (p === undefined) throw new Error(`no price for ${h.companyId}`);
    v += mul(h.longQty, p) - mul(h.shortQty, p);
  }
  return v;
}

/** Finance tie-break: the largest single position, |qty × closing price| over long and short. */
export function largestPosition(holdings: readonly Holding[], prices: Readonly<Record<string, number>>): number {
  let max = 0;
  for (const h of holdings) {
    const p = prices[h.companyId]!;
    max = Math.max(max, mul(h.longQty, p), mul(h.shortQty, p));
  }
  return max;
}

/** Return in basis points (+1234 = +12.34%), rounded half-up. */
export function returnBp(finalValue: number, startValue: number): number {
  return divRoundHalfUp(BigInt(finalValue - startValue) * 10_000n, BigInt(startValue));
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

export interface RankEntry {
  teamId: string;
  track: Track;
  finalValue: number;
  eligible: boolean;
  /** PRODUCT: own plan score. CONSULTING: the squad company's plan score. */
  planScore?: number;
  /** FINANCE: largest single position (smaller wins a tie). */
  largestPosition?: number;
}

/** Ranks one track: by final value (Finance: return on $500,000, the same order), then the track's tie-break. */
export function rankTrack(entries: readonly RankEntry[]): (RankEntry & { rank: number | null })[] {
  return rankBy(entries, (a, b) => {
    if (a.finalValue !== b.finalValue) return b.finalValue - a.finalValue;
    if (a.track === "FINANCE") return (a.largestPosition ?? 0) - (b.largestPosition ?? 0);
    return (b.planScore ?? 0) - (a.planScore ?? 0);
  });
}

/** Rankings are computed at settlement; staff may review them then, everyone else only from AWARDS. */
export function canViewRankings(role: AccountRole, phase: PhaseCode): boolean {
  if (role === "ORGANISER" || role === "FAIRNESS") return phaseReached(phase, "SETTLEMENT");
  return phaseReached(phase, "AWARDS");
}
