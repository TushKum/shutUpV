// Who may read the rankings, and when (acceptance test 13: after the 03:30 freeze and before AWARDS, teams get 403).
// Pure, so it is a unit test; the route handler and the database's leaderboard function both enforce the same rule.

import { canViewRankings, PHASE_CODES, type AccountRole, type PhaseCode } from "@msim/engine";

export type RankingsDecision =
  | { ok: true }
  | { ok: false; status: 400 | 401 | 403 | 404; error: string };

export function decideRankingsAccess(role: AccountRole | null, phase: string | null, frozen: boolean): RankingsDecision {
  if (role === null) return { ok: false, status: 401, error: "Sign in to see the rankings." };
  if (phase === null) return { ok: false, status: 404, error: "No such event." };
  if (!(PHASE_CODES as readonly string[]).includes(phase)) return { ok: false, status: 400, error: "Unknown phase." };
  if (!canViewRankings(role, phase as PhaseCode, frozen)) {
    return { ok: false, status: 403, error: "The leaderboard is frozen until the awards." };
  }
  return { ok: true };
}
