// Awards, all decided by formula at settlement. Disqualified teams are left out. Exact ties share an award.

import { divRoundHalfUp, mul } from "./money";
import { rankBy, rankResults, type ResultEntry } from "./scoring";
import type { AwardCode } from "./types";

export interface CompanyResult {
  companyId: string;
  founderTeamId: string;
  rescuerTeamId: string;
  postCrisisPrice: number;
  closingPrice: number;
}

/** Rise from the post-crisis price to the closing price in basis points (+2151 = +21.51%), rounded half-up. */
export function riseBp(postCrisisPrice: number, closingPrice: number): number {
  return divRoundHalfUp(BigInt(closingPrice - postCrisisPrice) * 10_000n, BigInt(postCrisisPrice));
}

/** Higher closing ÷ post-crisis first, compared exactly by cross-multiplying. */
export function compareRise(a: CompanyResult, b: CompanyResult): number {
  return mul(b.closingPrice, a.postCrisisPrice) - mul(a.closingPrice, b.postCrisisPrice);
}

export interface Award {
  code: AwardCode;
  teamId: string;
  companyId?: string;
}

/**
 * WINNER, RUNNER_UP and THIRD by rank (1, 2, 3 after every tie-break; teams still exactly tied share the rank);
 * BEST_PRD: highest Round 1 score; BEST_SOLUTION: highest Round 2 score; BEST_INVESTOR: highest portfolio value;
 * BEST_COMPANY: biggest rise from post-crisis to closing price, given to the founder and the rescuer. A company
 * counts only if both of its teams are eligible.
 */
export function computeAwards(results: readonly ResultEntry[], companies: readonly CompanyResult[]): Award[] {
  const out: Award[] = [];
  const ranked = rankResults(results);
  const place: [AwardCode, number][] = [
    ["WINNER", 1],
    ["RUNNER_UP", 2],
    ["THIRD", 3],
  ];
  for (const [code, rank] of place) {
    for (const r of ranked) if (r.rank === rank) out.push({ code, teamId: r.teamId });
  }
  const best = (code: AwardCode, key: (r: ResultEntry) => number) => {
    for (const r of rankBy(results, (a, b) => key(b) - key(a))) if (r.rank === 1) out.push({ code, teamId: r.teamId });
  };
  best("BEST_PRD", (r) => r.r1);
  best("BEST_SOLUTION", (r) => r.r2);
  best("BEST_INVESTOR", (r) => r.portfolio);

  const eligible = new Map(results.map((r) => [r.teamId, r.eligible]));
  const cs = companies.map((c) => ({
    ...c,
    eligible: (eligible.get(c.founderTeamId) ?? false) && (eligible.get(c.rescuerTeamId) ?? false),
  }));
  for (const c of rankBy(cs, compareRise)) {
    if (c.rank !== 1) continue;
    out.push({ code: "BEST_COMPANY", teamId: c.founderTeamId, companyId: c.companyId });
    out.push({ code: "BEST_COMPANY", teamId: c.rescuerTeamId, companyId: c.companyId });
  }
  return out;
}
