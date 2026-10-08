"use server";

// Judge: sealing the 0 of every company with no on-time submission, and releasing a type's scores. Each action is one
// game function, run as the signed-in organiser; the database checks the caller, the deadline, the phase and that
// every company has a sealed score, and its refusal (NOT_READY, CALL_1_OPEN, WRONG_PHASE, TRADING_OPEN…) is shown.

import { rpc, type ActionResult } from "@/lib/rpc";
import { parseJudgeType, releaseMessage, sealMissingMessage } from "@/lib/admin/judge";

const badType: ActionResult = { ok: false, code: "BAD_TYPE", message: "Choose pitch, plan or flash." };

export async function sealMissingScores(eventId: string, type: string): Promise<ActionResult> {
  const t = parseJudgeType(type);
  if (!t) return badType;
  const r = await rpc("seal_missing_scores", { p_event: eventId, p_type: t });
  return r.ok ? { ...r, message: sealMissingMessage(t, Number(r.data?.sealed_missing ?? 0)) } : r;
}

export async function releaseScores(eventId: string, type: string): Promise<ActionResult> {
  const t = parseJudgeType(type);
  if (!t) return badType;
  const r = await rpc("release_scores", { p_event: eventId, p_type: t });
  return r.ok ? { ...r, message: releaseMessage(t, Number(r.data?.released ?? 0)) } : r;
}
