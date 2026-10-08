"use server";

// Rounds: closing the open round now is one game function (close_round_now), run as the signed-in organiser.

import { count } from "@/lib/format";
import { rpc, type ActionResult } from "@/lib/rpc";

/**
 * Clears round `round` now. The database refuses (ROUND_CHANGED, NO_OPEN_ROUND) when it is no longer the open round,
 * so a click on "Close round 3 now" never closes round 4 that opened meanwhile.
 */
export async function closeRound(eventId: string, round: number): Promise<ActionResult> {
  if (!Number.isInteger(round) || round < 1) return { ok: false, code: "BAD_ROUND", message: "No such round." };
  const r = await rpc("close_round_now", { p_event: eventId, p_round: round });
  if (!r.ok) return r;
  if (r.data?.already) return { ...r, message: `Round ${round} had already cleared.` };
  return { ...r, message: `Round ${r.data?.round ?? round} cleared: ${count(r.data?.orders as number | undefined)} orders filled.` };
}
