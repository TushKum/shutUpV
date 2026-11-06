// Consultant calls: BUY or SELL on each of 2 assigned companies, in three windows.
//   Call 1 (due 23:15): baseline IPO price,             judged at the round 4 clearing price
//   Call 2 (due 03:40): baseline price after plan tier,  judged at the price after the flash tier (04:20)
//   Call 3 (due 04:30): baseline price after flash tier, judged at the closing price
// BUY is correct if judged > baseline, SELL if judged < baseline. Equal or missing is wrong. $2,500 each.

import { RULES } from "./rules";

export type CallDirection = "BUY" | "SELL";

export function judgeCall(direction: CallDirection | null, baseline: number, judged: number): boolean {
  if (direction === "BUY") return judged > baseline;
  if (direction === "SELL") return judged < baseline;
  return false;
}

export function callEarnings(correct: boolean): number {
  return correct ? RULES.CALL_EARNING : 0;
}
