"use server";

// Judge: starting a type's judging, sending its failed runs back to the queue, the backup-model switch, sealing the 0
// of every company with no on-time submission, releasing a type's scores, a technical re-run of one submission, and
// applying or dismissing an appeal of a released score. Each action is one game function, run as the signed-in
// organiser; the database checks the caller, the deadline, the phase and the state of the runs, scores and appeals,
// and its refusal (NOT_READY, ALREADY_RELEASED, IN_PROGRESS, PITCH_RELEASED, CALL_1_OPEN, TOO_LATE…) is shown.

import { rpc, type ActionResult } from "@/lib/rpc";
import { judgeConfig } from "@/lib/judge/config";
import {
  applyMessage,
  dismissMessage,
  modelMessage,
  parseEffects,
  parseJudgeType,
  releaseMessage,
  rerunMessage,
  retryMessage,
  sealMissingMessage,
  startMessage,
  type JudgeSlot,
} from "@/lib/admin/judge";

const badType: ActionResult = { ok: false, code: "BAD_TYPE", message: "Choose pitch, plan or flash." };
const REASON_MIN = 5;

/** The reason typed in a form, trimmed; null when it is shorter than the database accepts. */
function reasonOf(form: FormData): string | null {
  const v = String(form.get("reason") ?? "").trim();
  return v.length >= REASON_MIN ? v : null;
}
const noReason: ActionResult = { ok: false, code: "ERROR", message: `Give a reason (at least ${REASON_MIN} characters).` };

export async function startJudging(eventId: string, type: string): Promise<ActionResult> {
  const t = parseJudgeType(type);
  if (!t) return badType;
  const r = await rpc("start_judging", { p_event: eventId, p_type: t });
  return r.ok ? { ...r, message: startMessage(t, Number(r.data?.queued ?? 0), Number(r.data?.companies ?? 0)) } : r;
}

export async function retryFailedRuns(eventId: string, type: string): Promise<ActionResult> {
  const t = parseJudgeType(type);
  if (!t) return badType;
  const r = await rpc("retry_failed_runs", { p_event: eventId, p_type: t });
  return r.ok ? { ...r, message: retryMessage(Number(r.data?.retried ?? 0)) } : r;
}

export async function setJudgeModel(eventId: string, slot: JudgeSlot): Promise<ActionResult> {
  if (slot !== "PRIMARY" && slot !== "BACKUP") return { ok: false, code: "ERROR", message: "Choose the primary or the backup model." };
  const r = await rpc("set_judge_model", { p_event: eventId, p_slot: slot });
  if (!r.ok) return r;
  let model: string | null = null;
  try {
    model = judgeConfig().models[slot];
  } catch {
    // The settings are wrong (the console says so); the switch itself is done.
  }
  return { ...r, message: modelMessage(slot, model) };
}

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

export async function rerunJudging(companyId: string, type: string, label: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const t = parseJudgeType(type);
  if (!t) return badType;
  const reason = reasonOf(form);
  if (!reason) return noReason;
  const r = await rpc("rerun_judging", { p_company: companyId, p_type: t, p_reason: reason });
  return r.ok ? { ...r, message: rerunMessage(label, t, r.data?.after_release === true, Number(r.data?.generation ?? 0)) } : r;
}

export async function applyAppeal(appealId: string, label: string, type: string): Promise<ActionResult> {
  const t = parseJudgeType(type);
  if (!t) return badType;
  const r = await rpc("apply_appeal", { p_appeal: appealId });
  return r.ok ? { ...r, message: applyMessage(label, t, parseEffects(r.data?.effects)) } : r;
}

export async function dismissAppeal(appealId: string, label: string, type: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const t = parseJudgeType(type);
  if (!t) return badType;
  const reason = reasonOf(form);
  if (!reason) return noReason;
  const r = await rpc("dismiss_appeal", { p_appeal: appealId, p_note: reason });
  return r.ok ? { ...r, message: dismissMessage(label, t) } : r;
}
