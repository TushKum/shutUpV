// A fund's value after every step of the night, for its own chart (never another team's): cash plus every share it
// holds at that step's price. Built from the fund's own ledger (every cash and share move, shorts as negative shares)
// and the public price steps; a step and the ledger moves it caused share one transaction, so one timestamp. At the
// close the shorts are covered at the closing price in the same transaction, so the last point is the final value.

import type { ChartPoint } from "@/lib/chart";

export type PriceKind = "IPO" | "CLEARING" | "CRISIS" | "PLAN_TIER" | "FLASH_TIER" | "CLOSE" | "APPEAL";

export interface LedgerMove {
  at: string;
  cash: number;
  companyId: string | null;
  shares: number;
  /** The price of the move, if it moved shares (the seed's $10.00 values them before the IPO). */
  price: number | null;
}

export interface PriceStep {
  at: string;
  kind: PriceKind;
  roundNumber: number | null;
  companyId: string;
  price: number;
}

const LABEL: Record<Exclude<PriceKind, "CLEARING">, string> = {
  IPO: "IPO",
  CRISIS: "Crisis",
  PLAN_TIER: "Plan verdicts",
  FLASH_TIER: "Flash verdicts",
  CLOSE: "Close",
  APPEAL: "Appeal",
};
const MARKER: Partial<Record<PriceKind, string>> = { IPO: "IPO", CRISIS: "Crisis", PLAN_TIER: "Plan", FLASH_TIER: "Flash", CLOSE: "Close" };

const ms = (iso: string) => new Date(iso).getTime();
/** Within one transaction: the clearing first, then the crisis or a tier, then the close. */
const ORDER: Record<PriceKind, number> = { IPO: 0, CLEARING: 1, CRISIS: 2, PLAN_TIER: 2, FLASH_TIER: 2, CLOSE: 3, APPEAL: 4 };

export function portfolioSeries(moves: readonly LedgerMove[], steps: readonly PriceStep[]): ChartPoint[] {
  const sortedMoves = [...moves].sort((a, b) => ms(a.at) - ms(b.at));
  // One point per price step. A step's rows share its transaction's time, but one transaction can hold two steps (the
  // tick that clears round 4 also applies the crisis; the last clearing and the close share one): split by kind, in
  // the order of the night.
  const groups = new Map<string, PriceStep[]>();
  for (const s of steps) {
    const key = `${ms(s.at)}|${s.kind}|${s.roundNumber ?? ""}`;
    const g = groups.get(key);
    if (g) g.push(s);
    else groups.set(key, [s]);
  }
  const ordered = [...groups.values()].sort((a, b) => ms(a[0]!.at) - ms(b[0]!.at) || ORDER[a[0]!.kind] - ORDER[b[0]!.kind]);

  let cash = 0;
  const shares = new Map<string, number>();
  const prices = new Map<string, number>();
  let m = 0;
  const applyUntil = (t: number) => {
    for (; m < sortedMoves.length && ms(sortedMoves[m]!.at) <= t; m++) {
      const mv = sortedMoves[m]!;
      cash += mv.cash;
      if (mv.companyId && mv.shares) {
        shares.set(mv.companyId, (shares.get(mv.companyId) ?? 0) + mv.shares);
        if (mv.price !== null && !prices.has(mv.companyId)) prices.set(mv.companyId, mv.price);
      }
    }
  };
  const value = () => {
    let v = cash;
    for (const [c, q] of shares) v += q * (prices.get(c) ?? 0);
    return v;
  };

  const out: ChartPoint[] = [];
  const first = ordered.length ? ms(ordered[0]![0]!.at) : null;
  if (sortedMoves.length && (first === null || ms(sortedMoves[0]!.at) < first)) {
    applyUntil(first === null ? Number.POSITIVE_INFINITY : first - 1);
    out.push({ label: "Start", value: value(), marker: null });
  }
  for (const g of ordered) {
    for (const s of g) prices.set(s.companyId, s.price);
    applyUntil(ms(g[0]!.at));
    const kind = g[0]!.kind;
    out.push({
      label: kind === "CLEARING" ? `Round ${g[0]!.roundNumber ?? "?"}` : LABEL[kind],
      value: value(),
      marker: MARKER[kind] ?? null,
    });
  }
  return out;
}
