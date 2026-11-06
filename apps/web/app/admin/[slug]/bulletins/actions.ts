"use server";

// Bulletins: the composer (publish_bulletin: general, rumour, fairness), the twist (publish_twist; the phase clock
// also publishes it at 22:15) and Q&A moderation (hide_question). Each action is one game function, run as the
// signed-in organiser.

import type { PhaseCode } from "@msim/engine";
import { rpc, type ActionResult } from "@/lib/rpc";
import { bulletinFromForm } from "@/lib/admin/content-bulletins";

export async function publishBulletin(eventId: string, phase: PhaseCode, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const b = bulletinFromForm({ kind: form.get("kind"), title: form.get("title"), body: form.get("body") }, phase);
  if (!b.ok) return { ok: false, code: "BAD_BULLETIN", message: b.message };
  const r = await rpc("publish_bulletin", { p_event: eventId, p_kind: b.value.kind, p_title: b.value.title, p_body: b.value.body });
  return r.ok ? { ...r, message: `Published “${b.value.title}” to every screen.` } : r;
}

export async function publishTwist(eventId: string): Promise<ActionResult> {
  const r = await rpc("publish_twist", { p_event: eventId });
  if (r.ok && r.data?.already) return { ...r, message: "The twist had already been published." };
  return r.ok ? { ...r, message: "The twist is on every screen." } : r;
}

export async function hideQuestion(questionId: string, hidden: boolean): Promise<ActionResult> {
  const r = await rpc("hide_question", { p_question: questionId, p_hidden: hidden });
  return r.ok ? { ...r, message: hidden ? "Question hidden from the board." : "Question shown again." } : r;
}
