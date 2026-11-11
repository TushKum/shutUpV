// Price rules: score tiers, IPO price, round clearing, the crisis shock, the AI price and the close.

import { avgHalfUp, clamp, mul, mulRate } from "./money";
import { RULES } from "./rules";
import type { OrderType, SubmissionType } from "./types";

// ───────────────────────────── Score tiers ─────────────────────────────

/** Score bands (lower bound) and price change in basis points, from the brief's tier table. */
const TIER_TABLE: Record<SubmissionType, readonly (readonly [minScore: number, bp: number])[]> = {
  PITCH: [[90, 1000], [80, 1000], [70, 500], [60, 500], [50, 0], [40, -500], [0, -1000]],
  PLAN: [[90, 2500], [80, 2000], [70, 1000], [60, 500], [50, 0], [40, -1000], [0, -2000]],
  FLASH: [[90, 500], [80, 500], [70, 500], [60, 0], [50, 0], [40, -500], [0, -500]],
};

export function assertScore(score: number): void {
  if (!Number.isInteger(score) || score < 0 || score > 100) throw new Error(`score must be 0–100, got ${score}`);
}

/** Price change for a final score, in basis points (+2000 = +20%). */
export function tierBp(type: SubmissionType, score: number): number {
  assertScore(score);
  for (const [min, bp] of TIER_TABLE[type]) if (score >= min) return bp;
  throw new Error("unreachable");
}

/** price × (1 + tier), rounded half-up. */
export function applyTier(price: number, bp: number): number {
  return mulRate(price, 10_000 + bp, 10_000);
}

/** IPO price = $10.00 × (1 + pitch tier). */
export function ipoPrice(pitchScore: number): number {
  return applyTier(RULES.BASE_PRICE, tierBp("PITCH", pitchScore));
}

// ───────────────────────────── Clearing ─────────────────────────────

/** Net demand in shares: (BUY + COVER) − (SELL + SHORT). */
export function netDemand(q: { buy: number; sell: number; short: number; cover: number }): number {
  return q.buy + q.cover - (q.sell + q.short);
}

/** change = clamp(1% × net ÷ 1,000, −10%, +10%) → expressed as a capped net in shares. */
export function cappedNet(net: number): number {
  return clamp(net, -RULES.NET_CAP, RULES.NET_CAP);
}

/** new price = old × (1 + change), rounded half-up to the cent. */
export function clearingPrice(oldPrice: number, net: number): number {
  return mulRate(oldPrice, RULES.CLEARING_DEN + cappedNet(net), RULES.CLEARING_DEN);
}

export const PRICE_EFFECT: Record<OrderType, 1 | -1> = { BUY: 1, COVER: 1, SELL: -1, SHORT: -1 };

// ───────────────────────────── Crisis, AI price and close ─────────────────────────────

/** Crisis: × 0.85, rounded half-up. Applies to both the market price and the AI price. */
export function crisisShock(price: number): number {
  return mulRate(price, RULES.CRISIS_PCT, 100);
}

/** AI price = IPO × 0.85 × (1 + plan tier) × (1 + flash tier), rounding after each step. */
export function aiPrice(ipo: number, planBp: number | null, flashBp: number | null): number {
  let p = crisisShock(ipo);
  if (planBp !== null) p = applyTier(p, planBp);
  if (flashBp !== null) p = applyTier(p, flashBp);
  return p;
}

/** Market price at the close = average of the round 20 and round 21 clearing prices. */
export function marketClose(round20: number, round21: number): number {
  return avgHalfUp(round20, round21);
}

/** Closing price = (market price + AI price) ÷ 2, rounded half-up. */
export function closingPrice(market: number, ai: number): number {
  return avgHalfUp(market, ai);
}

/** value = qty × price (exact). */
export function value(qty: number, price: number): number {
  return mul(qty, price);
}
