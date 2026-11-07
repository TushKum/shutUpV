// The team's portfolio value after every price step of Round 3, for its own chart (never another team's): cash plus
// every share it holds at that step's price. Built from the team's own ledger (every cash and share move) and the
// public price steps; a step and the ledger moves it caused share one transaction, so one timestamp.

import type { ChartPoint } from "@/lib/chart";

export type PriceKind = "START" | "CRISIS" | "REVEAL" | "CLEARING" | "CLOSE" | "APPEAL";

export interface LedgerMove {
  at: string;
  cash: number;
  companyId: string | null;
  shares: number;
}

export interface PriceStep {
  at: string;
  kind: PriceKind;
  roundNumber: number | null;
  companyId: string;
  price: number;
}

const LABEL: Record<Exclude<PriceKind, "CLEARING">, string> = { START: "Start", CRISIS: "Crisis", REVEAL: "Score reveal", CLOSE: "Close", APPEAL: "Appeal" };
const MARKER: Partial<Record<PriceKind, string>> = { REVEAL: "Reveal", CLOSE: "Close" };
/** Within one transaction: the clearing first, then the reveal, then the close. */
const ORDER: Record<PriceKind, number> = { START: 0, CRISIS: 1, CLEARING: 2, REVEAL: 3, CLOSE: 4, APPEAL: 5 };
const ms = (iso: string) => new Date(iso).getTime();

/**
 * One point for the starting cash, then one per Round 3 price step (the clearings, the reveal and the close). Steps
 * before trading (the starting prices, the crisis) leave the value at the starting cash and are left out.
 */
export function portfolioSeries(moves: readonly LedgerMove[], steps: readonly PriceStep[]): ChartPoint[] {
  const sortedMoves = [...moves].sort((a, b) => ms(a.at) - ms(b.at));
  const prices = new Map<string, number>();
  // Steps before the first clearing only set prices (a team holds no shares before Round 3).
  const firstClearing = Math.min(...steps.filter((s) => s.kind === "CLEARING").map((s) => ms(s.at)));
  const groups = new Map<string, PriceStep[]>();
  for (const s of [...steps].sort((a, b) => ms(a.at) - ms(b.at) || ORDER[a.kind] - ORDER[b.kind])) {
    if (ms(s.at) < firstClearing) {
      prices.set(s.companyId, s.price);
      continue;
    }
    const key = `${ms(s.at)}|${s.kind}|${s.roundNumber ?? ""}`;
    const g = groups.get(key);
    if (g) g.push(s);
    else groups.set(key, [s]);
  }
  const ordered = [...groups.values()].sort((a, b) => ms(a[0]!.at) - ms(b[0]!.at) || ORDER[a[0]!.kind] - ORDER[b[0]!.kind]);

  let cash = 0;
  const shares = new Map<string, number>();
  let m = 0;
  const applyUntil = (t: number) => {
    for (; m < sortedMoves.length && ms(sortedMoves[m]!.at) <= t; m++) {
      const mv = sortedMoves[m]!;
      cash += mv.cash;
      if (mv.companyId && mv.shares) shares.set(mv.companyId, (shares.get(mv.companyId) ?? 0) + mv.shares);
    }
  };
  const value = () => {
    let v = cash;
    for (const [c, q] of shares) v += q * (prices.get(c) ?? 0);
    return v;
  };

  const out: ChartPoint[] = [];
  if (sortedMoves.length) {
    applyUntil(ordered.length ? ms(ordered[0]![0]!.at) - 1 : Number.POSITIVE_INFINITY);
    out.push({ label: "Start", value: value(), marker: null });
  }
  for (const g of ordered) {
    for (const s of g) prices.set(s.companyId, s.price);
    applyUntil(ms(g[0]!.at));
    const kind = g[0]!.kind;
    out.push({ label: kind === "CLEARING" ? `Round ${g[0]!.roundNumber ?? "?"}` : LABEL[kind], value: value(), marker: MARKER[kind] ?? null });
  }
  return out;
}
