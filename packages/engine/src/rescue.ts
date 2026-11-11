// After the crisis: the advisor's fee (Product + Consulting) and the rescue deal (all three squad teams).

import { floorDiv, mul } from "./money";
import { RULES } from "./rules";

// ───────────────────────────── Fee ─────────────────────────────

export interface FeeTerms {
  cash: number; // cents
  shares: number;
}

export type FeeRejection = "BAD_TERMS" | "FEE_RANGE" | "TOO_MANY_SHARES" | "NOT_ENOUGH_CASH" | "NOT_ENOUGH_SHARES";

export type FeeCheck = { ok: true; value: number } | { ok: false; code: FeeRejection; message: string };

/** Fee value = cash + shares × IPO price; must be $10,000–$35,000, with at most 3,000 shares. */
export function validateFee(
  terms: FeeTerms,
  ctx: { ipoPrice: number; companyCash: number; retainedShares: number },
): FeeCheck {
  if (!Number.isInteger(terms.cash) || !Number.isInteger(terms.shares) || terms.cash < 0 || terms.shares < 0) {
    return { ok: false, code: "BAD_TERMS", message: "Cash and shares must be whole, non-negative amounts." };
  }
  if (terms.shares > RULES.FEE_MAX_SHARES) {
    return { ok: false, code: "TOO_MANY_SHARES", message: "At most 3,000 shares can be part of the fee." };
  }
  const value = terms.cash + mul(terms.shares, ctx.ipoPrice);
  if (value < RULES.FEE_MIN || value > RULES.FEE_MAX) {
    return { ok: false, code: "FEE_RANGE", message: "The fee must be worth $10,000 to $35,000 (shares at the IPO price)." };
  }
  if (terms.cash > ctx.companyCash) {
    return { ok: false, code: "NOT_ENOUGH_CASH", message: "The company does not have that much cash." };
  }
  if (terms.shares > ctx.retainedShares) {
    return { ok: false, code: "NOT_ENOUGH_SHARES", message: "The company does not hold that many shares." };
  }
  return { ok: true, value };
}

/** If the fee is not confirmed by both teams by 01:05: $22,500 cash. */
export const DEFAULT_FEE: FeeTerms = { cash: RULES.FEE_DEFAULT, shares: 0 };

// ───────────────────────────── Deal ─────────────────────────────

export interface DealTerms {
  amount: number; // cents the fund intends to invest
  price: number; // cents per share
}

/** Allowed price per share: 50%–100% of the post-crisis price (the minimum rounds up to a whole cent). */
export function dealPriceBand(postCrisisPrice: number): { min: number; max: number } {
  return { min: floorDiv(postCrisisPrice + 1, 2), max: postCrisisPrice };
}

export type DealRejection =
  | "BAD_TERMS"
  | "AMOUNT_RANGE"
  | "PRICE_RANGE"
  | "NO_SHARES"
  | "FUND_CASH"
  | "COMPANY_SHARES";

export type DealCheck =
  | { ok: true; shares: number; cashMoved: number }
  | { ok: false; code: DealRejection; message: string };

/** shares = floor(amount ÷ price); cash moved = shares × price. */
export function dealShares(terms: DealTerms): { shares: number; cashMoved: number } {
  const shares = floorDiv(terms.amount, terms.price);
  return { shares, cashMoved: mul(shares, terms.price) };
}

/** Terms only (used while negotiating). */
export function validateDealTerms(terms: DealTerms, postCrisisPrice: number): DealCheck {
  if (!Number.isInteger(terms.amount) || !Number.isInteger(terms.price) || terms.price <= 0) {
    return { ok: false, code: "BAD_TERMS", message: "Amount and price must be whole numbers of cents." };
  }
  if (terms.amount < RULES.DEAL_MIN || terms.amount > RULES.DEAL_MAX) {
    return { ok: false, code: "AMOUNT_RANGE", message: "The rescue amount must be $40,000 to $80,000." };
  }
  // 50% ≤ price ÷ post-crisis ≤ 100%, compared in integers.
  if (terms.price * 2 < postCrisisPrice || terms.price > postCrisisPrice) {
    return { ok: false, code: "PRICE_RANGE", message: "The price must be 50%–100% of the post-crisis price." };
  }
  const { shares, cashMoved } = dealShares(terms);
  if (shares < 1) return { ok: false, code: "NO_SHARES", message: "The deal must transfer at least one share." };
  return { ok: true, shares, cashMoved };
}

/** Terms plus the balances needed to execute (checked again when the last team signs). */
export function validateDeal(
  terms: DealTerms,
  ctx: { postCrisisPrice: number; fundAvailableCash: number; companyRetainedShares: number },
): DealCheck {
  const t = validateDealTerms(terms, ctx.postCrisisPrice);
  if (!t.ok) return t;
  if (t.cashMoved > ctx.fundAvailableCash) {
    return { ok: false, code: "FUND_CASH", message: "The fund does not have that much available cash." };
  }
  if (t.shares > ctx.companyRetainedShares) {
    return { ok: false, code: "COMPANY_SHARES", message: "The company does not hold that many shares." };
  }
  return t;
}

/** The consultant's $5,000 deal bonus: fully signed at or before 02:45. */
export function dealBonusEarned(fullySignedAt: Date | null, bonusDeadline: Date): boolean {
  return fullySignedAt !== null && fullySignedAt.getTime() <= bonusDeadline.getTime();
}

/** A plan without a deal fully signed at 03:00 is capped at 50. */
export function dealSignedInTime(fullySignedAt: Date | null, dealDeadline: Date): boolean {
  return fullySignedAt !== null && fullySignedAt.getTime() <= dealDeadline.getTime();
}

/** A submission strictly after its deadline is late (03:00:00 is on time, 03:00:01 is late). */
export function isLate(submittedAt: Date, deadline: Date): boolean {
  return submittedAt.getTime() > deadline.getTime();
}
