"use server";

// The fairness officer's decision on a collusion flag (decide_flag): clear it, or disqualify the teams involved, with
// a reason that is logged. Run as the signed-in fairness officer; the game function refuses anyone else.

import { rpc, type ActionResult } from "@/lib/rpc";
import { flagDecisionFromForm } from "@/lib/admin/fairness";

export async function decideFlag(flagId: string, teamCodes: string[], _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const d = flagDecisionFromForm({ decision: form.get("decision"), reason: form.get("reason") });
  if (!d.ok) return { ok: false, code: "ERROR", message: d.message };
  const r = await rpc("decide_flag", { p_flag: flagId, p_status: d.value.status, p_reason: d.value.reason });
  if (!r.ok) return r.code === "ERROR" ? { ...r, message: `Refused: ${r.message}` } : r;
  return {
    ...r,
    message:
      d.value.status === "CLEARED"
        ? "Flag cleared."
        : `Disqualified ${teamCodes.join(", ")}: excluded from the awards while this decision stands.`,
  };
}
