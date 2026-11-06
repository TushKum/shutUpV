// Price rules: the starting price, the crisis, the score reveal, round clearing and the close.
//
// Every company has two prices:
//   market price       moved by the crisis, the 02:45 reveal and every trading round
//   score-based price  moved only by the judges: start × 0.85 × reveal factor (trading never touches it)
// The closing price is half of each.

import { avgHalfUp, clamp, mul, mulRate } from "./money";
import { RULES } from "./rules";
import type { OrderType } from "./types";

export function assertScore(score: number): void {
  if (!Number.isInteger(score) || score < 0 || score > 100) throw new Error(`score must be 0–100, got ${score}`);
}

// ───────────────────────────── Round 1 ─────────────────────────────

/** Starting share price = $10.00 + $0.10 × (PRD score − 50): $5.00 for 0, $10.00 for 50, $15.00 for 100. */
export function startPrice(prdScore: number): number {
  assertScore(prdScore);
  return RULES.START_BASE + RULES.START_PER_POINT * (prdScore - 50);
}

// ───────────────────────────── The crisis ─────────────────────────────

/** The crisis: × 0.85, rounded half-up. Applies to both the market price and the score-based price. */
export function crisisShock(price: number): number {
  return mulRate(price, RULES.CRISIS_PCT, 100);
}

// ───────────────────────────── Round 2 ─────────────────────────────

/** The reveal factor in basis points: 10,000 + 50 × (crisis score − 50); 84 → 11,700 (+17%), 45 → 9,750 (−2.5%). */
export function revealFactorBp(crisisScore: number): number {
  assertScore(crisisScore);
  return 10_000 + RULES.REVEAL_BP_PER_POINT * (crisisScore - 50);
}

/** price × (1 + 0.5% × (crisis score − 50)), rounded half-up. */
export function applyReveal(price: number, crisisScore: number): number {
  return mulRate(price, revealFactorBp(crisisScore), 10_000);
}

/** Score-based price = start × 0.85 × reveal factor (before the reveal: start × 0.85), rounding after each step. */
export function scorePrice(start: number, crisisScore: number | null): number {
  const afterCrisis = crisisShock(start);
  return crisisScore === null ? afterCrisis : applyReveal(afterCrisis, crisisScore);
}

// ───────────────────────────── Clearing ─────────────────────────────

export const PRICE_EFFECT: Record<OrderType, 1 | -1> = { BUY: 1, SELL: -1 };

/** Net demand in shares: bought − sold. */
export function netDemand(q: { buy: number; sell: number }): number {
  return q.buy - q.sell;
}

/** change = clamp(1% × net ÷ 1,000, −10%, +10%), expressed as a capped net in shares. */
export function cappedNet(net: number): number {
  return clamp(net, -RULES.NET_CAP, RULES.NET_CAP);
}

/** new price = old × (1 + change), rounded half-up to the cent. */
export function clearingPrice(oldPrice: number, net: number): number {
  return mulRate(oldPrice, RULES.CLEARING_DEN + cappedNet(net), RULES.CLEARING_DEN);
}

// ───────────────────────────── The close ─────────────────────────────

/** Market price at the close = the average of the round 8 and round 9 clearing prices. */
export function closingMarketPrice(round8: number, round9: number): number {
  return avgHalfUp(round8, round9);
}

/** Closing price = ½ market price + ½ score-based price, rounded half-up. */
export function closingPrice(market: number, scoreBased: number): number {
  return avgHalfUp(market, scoreBased);
}

/** value = qty × price (exact). */
export function value(qty: number, price: number): number {
  return mul(qty, price);
}
