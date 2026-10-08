"use server";

// Ledger corrections (two people). Each action is one game function, run as the signed-in staff member: an organiser
// requests (request_correction), a different organiser or the fairness officer approves or rejects
// (decide_correction). The amounts are converted to integer cents exactly before they are sent; the game functions
// check the entries again and their refusals are shown as they come.

import { rpc, type ActionResult } from "@/lib/rpc";
import { correctionFromForm, readCorrectionForm } from "@/lib/admin/ledger-corrections";

/** A refusal from the database, said plainly. */
const refused = (r: ActionResult): ActionResult => (r.code === "ERROR" ? { ...r, message: `Refused: ${r.message}` } : r);

export async function requestCorrection(eventId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = correctionFromForm(readCorrectionForm(form));
  if (!parsed.ok) return { ok: false, code: "ERROR", message: parsed.message };
  const r = await rpc("request_correction", { p_event: eventId, p_reason: parsed.value.reason, p_entries: parsed.value.entries });
  if (!r.ok) return refused(r);
  const n = parsed.value.entries.length;
  return {
    ...r,
    message: `Correction requested (${n} ${n === 1 ? "entry" : "entries"}). A second organiser or the fairness officer must approve it before it is applied.`,
  };
}

export async function decideCorrection(correctionId: string, approve: boolean, note: string): Promise<ActionResult> {
  const r = await rpc("decide_correction", { p_correction: correctionId, p_approve: approve, p_note: note.trim() || null });
  if (!r.ok) return refused(r);
  const txn = typeof r.data?.txn_id === "string" ? r.data.txn_id.slice(0, 8) : null;
  return { ...r, message: approve ? `Correction approved and applied${txn ? ` as transaction ${txn}` : ""}; it is published in the public ledger.` : "Correction rejected." };
}
