// Awards beyond the top 3 per track. All decided by formula; disqualified teams are excluded.

import { mul } from "./money";
import { rankBy } from "./scoring";

/** Best turnaround: highest closing price ÷ post-crisis price (compared exactly by cross-multiplying). */
export function bestTurnaround<
  T extends { closingPrice: number; postCrisisPrice: number; finalPlanScore: number; eligible: boolean },
>(companies: readonly T[]) {
  return rankBy(companies, (a, b) => {
    const lhs = mul(b.closingPrice, a.postCrisisPrice);
    const rhs = mul(a.closingPrice, b.postCrisisPrice);
    if (lhs !== rhs) return lhs - rhs; // negative when a's ratio is higher
    return b.finalPlanScore - a.finalPlanScore;
  });
}

/** Best rescue plan: highest final plan score; a tie goes to the higher raw median, then the ticker (A before Z). */
export function bestRescuePlan<
  T extends { finalPlanScore: number; medianPlanScore: number; ticker: string; eligible: boolean },
>(companies: readonly T[]) {
  return rankBy(
    companies,
    (a, b) =>
      b.finalPlanScore - a.finalPlanScore ||
      b.medianPlanScore - a.medianPlanScore ||
      (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0),
  );
}

/**
 * Best-judging fund: highest return when the portfolio is valued at AI prices only
 * (cash before shorts are covered + long shares × AI price − short shares × AI price).
 * A tie goes to the smaller largest position.
 */
export function bestJudgingFund<T extends { aiValue: number; largestPosition: number; eligible: boolean }>(funds: readonly T[]) {
  return rankBy(funds, (a, b) => b.aiValue - a.aiValue || a.largestPosition - b.largestPosition);
}
