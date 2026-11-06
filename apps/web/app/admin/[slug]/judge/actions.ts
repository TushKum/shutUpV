"use server";

// Judge: switching a round's judge to its backup model (set_model_slot), run as the signed-in organiser. Scores are
// sealed by the judge worker (service role) from three readings; nobody types one in.

import { rpc, type ActionResult } from "@/lib/rpc";
import { JUDGE_TYPE_LABELS, parseJudgeType, type JudgeSlot } from "@/lib/admin/judge";

export async function setModelSlot(eventId: string, type: string, slot: JudgeSlot): Promise<ActionResult> {
  const t = parseJudgeType(type);
  if (!t) return { ok: false, code: "BAD_TYPE", message: "Choose the PRD or the crisis-solution judge." };
  const r = await rpc("set_model_slot", { p_event: eventId, p_type: t, p_slot: slot });
  return r.ok
    ? { ...r, message: `${JUDGE_TYPE_LABELS[t]}: readings claimed from now on use the ${slot === "PRIMARY" ? "primary" : "backup"} model.` }
    : r;
}
