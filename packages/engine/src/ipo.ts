// The IPO: each fund requests 0–4,000 shares per company at the IPO price; oversubscribed books are
// scaled down pro rata and rounded down to the nearest 10 shares. Unallocated shares stay with the exchange.

import { floorDiv, mul } from "./money";
import { RULES } from "./rules";

export interface IpoBid {
  companyId: string;
  qty: number;
}

export type IpoRejection = "BAD_QUANTITY" | "INSIDER" | "NOT_LISTED" | "INSUFFICIENT_CASH";

export type IpoCheck =
  | { ok: true; totalCost: number }
  | { ok: false; code: IpoRejection; companyId?: string; message: string };

/**
 * Validates a fund's whole IPO book. Total requests at IPO prices may not exceed its cash.
 * @param bids one entry per company (a later entry for the same company replaces an earlier one)
 */
export function validateIpoBids(
  fund: { cash: number; squadCompanyId: string | null },
  bids: readonly IpoBid[],
  ipoPrices: Readonly<Record<string, number>>,
): IpoCheck {
  const book = new Map<string, number>();
  for (const b of bids) book.set(b.companyId, b.qty);
  let total = 0;
  for (const [companyId, qty] of book) {
    if (!Number.isInteger(qty) || qty < 0 || qty > RULES.IPO_MAX_PER_COMPANY) {
      return { ok: false, code: "BAD_QUANTITY", companyId, message: "Request 0 to 4,000 shares per company." };
    }
    if (qty === 0) continue;
    if (companyId === fund.squadCompanyId) {
      return { ok: false, code: "INSIDER", companyId, message: "A fund cannot bid for its own squad's company." };
    }
    const price = ipoPrices[companyId];
    if (price === undefined) return { ok: false, code: "NOT_LISTED", companyId, message: "That company has no IPO price." };
    total += mul(qty, price);
  }
  if (total > fund.cash) {
    return { ok: false, code: "INSUFFICIENT_CASH", message: "Your total requests cost more than your cash at IPO prices." };
  }
  return { ok: true, totalCost: total };
}

/**
 * Allocation for one company. If the book fits, everyone gets what they asked for; otherwise
 * allocation = request × available ÷ total requested, rounded down to the nearest 10 shares.
 */
export function allocateIpo<T extends { qty: number }>(
  requests: readonly T[],
  available: number = RULES.IPO_SHARES,
): (T & { allocated: number })[] {
  const total = requests.reduce((s, r) => s + r.qty, 0);
  return requests.map((r) => ({
    ...r,
    allocated:
      total <= available
        ? r.qty
        : floorDiv(mul(r.qty, available), mul(total, RULES.IPO_ROUND_TO)) * RULES.IPO_ROUND_TO,
  }));
}
