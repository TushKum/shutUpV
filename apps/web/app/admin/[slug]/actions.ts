"use server";

// Phase control: each action is one game function, run as the signed-in organiser.

import { PHASE_LABELS, type PhaseCode } from "@msim/engine";
import { rpc, type ActionResult } from "@/lib/rpc";

export async function advancePhase(eventId: string, from: PhaseCode): Promise<ActionResult> {
  const r = await rpc("advance_phase", { p_event: eventId, p_from: from });
  // Another organiser (or auto-advance) moved the event first: nothing changed, and the page refreshes.
  if (r.code === "STALE") return { ...r, message: `The event has already left ${PHASE_LABELS[from]}; nothing changed. Check the page and try again.` };
  return r;
}

export async function pauseEvent(eventId: string): Promise<ActionResult> {
  return rpc("pause_event", { p_event: eventId });
}

export async function resumeEvent(eventId: string): Promise<ActionResult> {
  return rpc("resume_event", { p_event: eventId });
}

export async function extendEvent(eventId: string, minutes: number): Promise<ActionResult> {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) return { ok: false, code: "BAD_MINUTES", message: "Extend by 1 to 120 minutes." };
  return rpc("extend_event", { p_event: eventId, p_minutes: minutes });
}

export async function extendEventForm(eventId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  return extendEvent(eventId, Number(form.get("minutes")));
}

/** `advanceNow` is the confirmed second click when the planned end has passed; without it the database refuses. */
export async function setAutoAdvance(eventId: string, on: boolean, advanceNow = false): Promise<ActionResult> {
  const r = await rpc("set_auto_advance", { p_event: eventId, p_on: on, p_advance_now: advanceNow });
  if (r.code === "OVERDUE") return { ...r, message: "The planned end has passed: with auto-advance on, the event advances at once. Click the button twice to confirm." };
  return r;
}

