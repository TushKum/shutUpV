"use server";

// Judge, as the signed-in organiser: switching a round to its backup model, retrying failed readings, a technical
// re-run of one company's judging (with a written reason), approving or dismissing a re-judged score after its reveal
// (a second organiser), and calibration (uploading the repository's samples, judging them). Scores are sealed by the
// judge worker from three readings; nobody types one in. The database checks every rule again.

import { rpc, type ActionResult } from "@/lib/rpc";
import { JUDGE_TYPE_LABELS, parseJudgeType, type JudgeSlot } from "@/lib/admin/judge";
import { loadCalibrationSamples, uploadPayload } from "@/lib/judge/calibration";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const badType: ActionResult = { ok: false, code: "BAD_TYPE", message: "Choose the PRD or the crisis-solution judge." };
const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

export async function setModelSlot(eventId: string, type: string, slot: JudgeSlot): Promise<ActionResult> {
  const t = parseJudgeType(type);
  if (!t) return badType;
  const r = await rpc("set_model_slot", { p_event: eventId, p_type: t, p_slot: slot });
  return r.ok
    ? { ...r, message: `${JUDGE_TYPE_LABELS[t]}: readings claimed from now on use the ${slot === "PRIMARY" ? "primary" : "backup"} model.` }
    : r;
}

export async function retryFailed(eventId: string, type: string): Promise<ActionResult> {
  const t = parseJudgeType(type);
  if (!t) return badType;
  const r = await rpc("retry_failed_runs", { p_event: eventId, p_type: t });
  return r.ok ? { ...r, message: `${Number(r.data?.retried ?? 0)} failed readings are back in the queue.` } : r;
}

export async function rerunJudging(companyId: string, type: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const t = parseJudgeType(type);
  if (!t) return badType;
  if (!UUID.test(companyId)) return { ok: false, code: "BAD_COMPANY", message: "Choose a company." };
  const reason = text(form, "reason").slice(0, 1000);
  const r = await rpc("rerun_judging", { p_company: companyId, p_type: t, p_reason: reason });
  if (!r.ok) return r;
  return {
    ...r,
    message:
      r.data?.after_reveal === true
        ? "Three new readings are queued. The revealed score stands until a second organiser approves the new one."
        : "Three new readings are queued; the new median replaces the score when they are in.",
  };
}

export async function applyAppeal(appealId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  if (!UUID.test(appealId)) return { ok: false, code: "BAD_APPEAL", message: "Choose an appeal." };
  const r = await rpc("apply_appeal", { p_appeal: appealId, p_note: text(form, "note").slice(0, 1000) || null });
  return r.ok ? { ...r, message: `The new score (${Number(r.data?.final)}) is applied, with its price effect.` } : r;
}

export async function dismissAppeal(appealId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  if (!UUID.test(appealId)) return { ok: false, code: "BAD_APPEAL", message: "Choose an appeal." };
  const r = await rpc("dismiss_appeal", { p_appeal: appealId, p_note: text(form, "note").slice(0, 1000) });
  return r.ok ? { ...r, message: "Dismissed: the revealed score stands." } : r;
}

export async function uploadCalibration(eventId: string): Promise<ActionResult> {
  let samples;
  try {
    samples = loadCalibrationSamples();
  } catch (e) {
    return { ok: false, code: "BAD_SAMPLES", message: e instanceof Error ? e.message : String(e) };
  }
  const r = await rpc("upload_calibration_samples", { p_event: eventId, p_samples: uploadPayload(samples) });
  return r.ok ? { ...r, message: `Batch ${Number(r.data?.batch)}: ${Number(r.data?.samples)} samples uploaded. Judge them next.` } : r;
}

export async function startCalibration(eventId: string, batch: number): Promise<ActionResult> {
  const r = await rpc("start_calibration", { p_event: eventId, p_batch: batch });
  return r.ok ? { ...r, message: `${Number(r.data?.queued)} readings queued. Keep "Run the judge here" on to judge them.` } : r;
}
