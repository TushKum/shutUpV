// Collusion flags generated at settlement, for the fairness officer only.
//   1. Reciprocal buying: two teams each bought shares of the company the other built.
//   2. A team holding at least 4,000 shares of one company whose closing price is below its average cost.
//   3. Five or more teams reaching the 5,000-share limit on the same company in the same round.

import { mul } from "./money";
import { RULES } from "./rules";
import type { OrderType } from "./types";

export interface Flag {
  kind: 1 | 2 | 3;
  companyId: string | null;
  teamIds: string[];
  details: Record<string, unknown>;
}

export interface Fill {
  teamId: string;
  companyId: string;
  type: OrderType;
  qty: number;
  roundNumber: number;
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Flag 1. @param founders company id → the team that built it */
export function flagReciprocalBuying(fills: readonly Fill[], founders: Readonly<Record<string, string>>): Flag[] {
  // bought[a][b] = shares team a bought of team b's company
  const bought = new Map<string, Map<string, number>>();
  for (const f of fills) {
    if (f.type !== "BUY") continue;
    const founder = founders[f.companyId];
    if (founder === undefined || founder === f.teamId) continue;
    const m = bought.get(f.teamId) ?? new Map<string, number>();
    bought.set(f.teamId, m);
    m.set(founder, (m.get(founder) ?? 0) + f.qty);
  }
  const companyOf = new Map(Object.entries(founders).map(([c, t]) => [t, c]));
  const out: Flag[] = [];
  for (const a of [...bought.keys()].sort(byId)) {
    for (const [b, qtyAB] of [...bought.get(a)!].sort((x, y) => byId(x[0], y[0]))) {
      if (byId(a, b) >= 0) continue;
      const qtyBA = bought.get(b)?.get(a);
      if (!qtyBA) continue;
      out.push({
        kind: 1,
        companyId: null,
        teamIds: [a, b],
        details: { [a]: { company: companyOf.get(b), bought: qtyAB }, [b]: { company: companyOf.get(a), bought: qtyBA } },
      });
    }
  }
  return out;
}

/** Flag 2: qty ≥ 4,000 and qty × closing price < cost (closing price below the average cost). */
export function flagLossPositions(
  holdings: readonly { teamId: string; companyId: string; qty: number; cost: number }[],
  closingPrices: Readonly<Record<string, number>>,
): Flag[] {
  const out: Flag[] = [];
  for (const h of [...holdings].sort((a, b) => byId(a.teamId, b.teamId) || byId(a.companyId, b.companyId))) {
    const p = closingPrices[h.companyId];
    if (p === undefined || h.qty < RULES.FLAG_LARGE_POSITION) continue;
    if (mul(h.qty, p) < h.cost) {
      out.push({ kind: 2, companyId: h.companyId, teamIds: [h.teamId], details: { qty: h.qty, cost: h.cost, closingPrice: p } });
    }
  }
  return out;
}

/**
 * Flag 3. @param positions every team's holding of each company before and after each round's clearing; a team
 * "reaches" the limit in a round when it holds fewer than 5,000 before and exactly 5,000 after.
 */
export function flagCapRush(
  positions: readonly { roundNumber: number; teamId: string; companyId: string; before: number; after: number }[],
): Flag[] {
  const groups = new Map<string, { roundNumber: number; companyId: string; teams: string[] }>();
  for (const p of positions) {
    if (!(p.before < RULES.HOLD_LIMIT && p.after === RULES.HOLD_LIMIT)) continue;
    const k = `${p.roundNumber}|${p.companyId}`;
    const g = groups.get(k) ?? { roundNumber: p.roundNumber, companyId: p.companyId, teams: [] };
    groups.set(k, g);
    g.teams.push(p.teamId);
  }
  return [...groups.values()]
    .filter((g) => g.teams.length >= RULES.FLAG_CAP_TEAMS)
    .sort((a, b) => a.roundNumber - b.roundNumber || byId(a.companyId, b.companyId))
    .map((g) => ({
      kind: 3 as const,
      companyId: g.companyId,
      teamIds: g.teams.sort(byId),
      details: { roundNumber: g.roundNumber, teams: g.teams.length },
    }));
}
