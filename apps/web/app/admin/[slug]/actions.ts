"use server";

// Phase control: each action is one game function, run as the signed-in organiser.

import type { PhaseCode } from "@msim/engine";
import { rpc, type ActionResult } from "@/lib/rpc";

export async function advancePhase(eventId: string, from: PhaseCode): Promise<ActionResult> {
  return rpc("advance_phase", { p_event: eventId, p_from: from });
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

export async function setAutoAdvance(eventId: string, on: boolean): Promise<ActionResult> {
  return rpc("set_auto_advance", { p_event: eventId, p_on: on });
}

