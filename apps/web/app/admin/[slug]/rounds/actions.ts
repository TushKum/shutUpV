"use server";

// Rounds: closing the open round now is one game function (close_round_now), run as the signed-in organiser.

import { closeRoundGuard } from "@/lib/admin/rounds";
import { count } from "@/lib/format";
import { rpc, type ActionResult } from "@/lib/rpc";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Clears round `round` now. close_round_now clears whichever round is open, so the button checks first that it is
 * still the round the organiser saw: a click on "Close round 3 now" never closes round 4 that opened meanwhile.
 */
export async function closeRound(eventId: string, round: number): Promise<ActionResult> {
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from("rounds")
    .select("number")
    .eq("event_id", eventId)
    .eq("status", "OPEN")
    .order("number")
    .limit(1)
    .maybeSingle<{ number: number }>();
  if (error) return { ok: false, code: "ERROR", message: error.message };
  const guard = closeRoundGuard(round, data?.number ?? null);
  if (!guard.ok) return guard;
  const r = await rpc("close_round_now", { p_event: eventId });
  if (!r.ok) return r;
  if (r.data?.already) return { ...r, message: `Round ${round} had already cleared.` };
  return { ...r, message: `Round ${r.data?.round ?? round} cleared: ${count(r.data?.orders as number | undefined)} orders filled.` };
}
