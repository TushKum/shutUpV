// Who may read the rankings, and when. Pure, so acceptance test 10 is a unit test; the route handler and the
// database's row-level security both enforce the same rule.

import { canViewRankings, PHASE_CODES, type AccountRole, type PhaseCode } from "@msim/engine";

export type RankingsDecision =
  | { ok: true }
  | { ok: false; status: 400 | 401 | 403 | 404; error: string };

export function decideRankingsAccess(role: AccountRole | null, phase: string | null): RankingsDecision {
  if (role === null) return { ok: false, status: 401, error: "Sign in to see the rankings." };
  if (phase === null) return { ok: false, status: 404, error: "No such event." };
  if (!(PHASE_CODES as readonly string[]).includes(phase)) return { ok: false, status: 400, error: "Unknown phase." };
  if (!canViewRankings(role, phase as PhaseCode)) {
    return { ok: false, status: 403, error: "Rankings are revealed at the awards." };
  }
  return { ok: true };
}
