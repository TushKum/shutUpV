// Collusion flags generated at settlement, for the fairness officer only.
//   1. A company whose plan scored below 50 where 3 or more funds hold the 4,000-share long cap.
//   2. A pair of funds whose order vectors (round, ticker, signed qty) have cosine similarity ≥ 0.9,
//      with at least 5 orders each.
//   3. A fee of $33,000 or more, or a deal price ≤ 55% of the post-crisis price, where the plan scored below 50.

import { PRICE_EFFECT } from "./prices";
import { RULES } from "./rules";
import type { OrderType } from "./types";

export interface Flag {
  kind: 1 | 2 | 3;
  companyId: string | null;
  teamIds: string[];
  details: Record<string, unknown>;
}

/**
 * @param capHolders per company, the funds whose exchange lot is exactly at the 4,000 cap at settlement
 */
export function flagCapHolders(
  companies: readonly { companyId: string; productTeamId: string; finalPlanScore: number }[],
  capHolders: Readonly<Record<string, readonly string[]>>,
): Flag[] {
  const out: Flag[] = [];
  for (const c of companies) {
    const funds = [...(capHolders[c.companyId] ?? [])].sort();
    if (c.finalPlanScore < RULES.FLAG_PLAN_BELOW && funds.length >= RULES.FLAG_CAP_FUNDS) {
      out.push({
        kind: 1,
        companyId: c.companyId,
        teamIds: [c.productTeamId, ...funds],
        details: { planScore: c.finalPlanScore, fundsAtCap: funds.length },
      });
    }
  }
  return out;
}

export interface FundOrder {
  roundNumber: number;
  companyId: string;
  type: OrderType;
  qty: number;
}

/** Order vector: one dimension per (round, company); value = Σ signed qty (BUY/COVER +, SELL/SHORT −). */
export function orderVector(orders: readonly FundOrder[]): Map<string, number> {
  const v = new Map<string, number>();
  for (const o of orders) {
    const k = `${o.roundNumber}|${o.companyId}`;
    v.set(k, (v.get(k) ?? 0) + PRICE_EFFECT[o.type] * o.qty);
  }
  return v;
}

/** cosine(a, b) ≥ 9/10, decided exactly: dot > 0 and 100·dot² ≥ 81·|a|²·|b|². */
export function cosineAtLeast(a: Map<string, number>, b: Map<string, number>, num = RULES.FLAG_COSINE.NUM, den = RULES.FLAG_COSINE.DEN): boolean {
  let dot = 0n;
  let na = 0n;
  let nb = 0n;
  for (const [k, x] of a) {
    na += BigInt(x) * BigInt(x);
    const y = b.get(k);
    if (y !== undefined) dot += BigInt(x) * BigInt(y);
  }
  for (const y of b.values()) nb += BigInt(y) * BigInt(y);
  if (dot <= 0n || na === 0n || nb === 0n) return false;
  return BigInt(den * den) * dot * dot >= BigInt(num * num) * na * nb;
}

/** Cosine similarity as a number, for display only. */
export function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, x] of a) {
    na += x * x;
    dot += x * (b.get(k) ?? 0);
  }
  for (const y of b.values()) nb += y * y;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function flagSimilarFunds(funds: readonly { teamId: string; orders: readonly FundOrder[] }[]): Flag[] {
  const eligible = funds
    .filter((f) => f.orders.length >= RULES.FLAG_MIN_ORDERS)
    .map((f) => ({ teamId: f.teamId, orders: f.orders.length, vector: orderVector(f.orders) }))
    .sort((a, b) => (a.teamId < b.teamId ? -1 : 1));
  const out: Flag[] = [];
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i]!;
      const b = eligible[j]!;
      if (cosineAtLeast(a.vector, b.vector)) {
        out.push({
          kind: 2,
          companyId: null,
          teamIds: [a.teamId, b.teamId],
          details: { cosine: Math.round(cosine(a.vector, b.vector) * 1000) / 1000, orders: [a.orders, b.orders] },
        });
      }
    }
  }
  return out;
}

export function flagRescueTerms(
  squads: readonly {
    companyId: string;
    teamIds: readonly string[];
    finalPlanScore: number;
    feeValue: number | null;
    dealPrice: number | null;
    postCrisisPrice: number;
  }[],
): Flag[] {
  const out: Flag[] = [];
  for (const s of squads) {
    if (s.finalPlanScore >= RULES.FLAG_PLAN_BELOW) continue;
    const bigFee = s.feeValue !== null && s.feeValue >= RULES.FLAG_FEE;
    const cheapDeal = s.dealPrice !== null && s.dealPrice * 100 <= RULES.FLAG_DEAL_PCT * s.postCrisisPrice;
    if (bigFee || cheapDeal) {
      out.push({
        kind: 3,
        companyId: s.companyId,
        teamIds: [...s.teamIds],
        details: { planScore: s.finalPlanScore, feeValue: s.feeValue, dealPrice: s.dealPrice, postCrisisPrice: s.postCrisisPrice, bigFee, cheapDeal },
      });
    }
  }
  return out;
}
