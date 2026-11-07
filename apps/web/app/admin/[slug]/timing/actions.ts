"use server";

// Event timing: each action is one game function, run as the signed-in organiser. Every change carries the timing
// version the organiser's page showed, so a second console (or a stale page) is refused instead of applied twice.

import { PHASE_LABELS, type PhaseCode } from "@msim/engine";
import { count } from "@/lib/format";
import { rpc, type ActionResult } from "@/lib/rpc";
import type { TimingChanges } from "@/lib/admin/timing";

const STALE = "The timing was changed on another console. The page now shows the new times: check them and try again.";

function stale(r: ActionResult): ActionResult {
  return r.code === "STALE" ? { ...r, message: r.message?.startsWith("The event is already") ? r.message : STALE } : r;
}

export async function startEvent(eventId: string, version: number): Promise<ActionResult> {
  const r = stale(await rpc("start_event", { p_event: eventId, p_expected_version: version }));
  return r.ok ? { ...r, message: "The night has started: Check-in is running." } : r;
}

export async function endEvent(eventId: string, version: number): Promise<ActionResult> {
  const r = stale(await rpc("end_event", { p_event: eventId, p_expected_version: version }));
  return r.ok ? { ...r, message: "The night has ended. Nothing changes from now on." } : r;
}

/** What ending the current phase would do: the next phase, what holds it, the times that move, the open round. */
export async function previewAdvance(eventId: string, from: PhaseCode): Promise<ActionResult> {
  return rpc("preview_advance", { p_event: eventId, p_from: from });
}

export async function endPhase(eventId: string, from: PhaseCode): Promise<ActionResult> {
  const r = await rpc("advance_phase", { p_event: eventId, p_from: from });
  if (r.code === "STALE") return { ...r, message: `The event has already left ${PHASE_LABELS[from]}; nothing changed. Check the page and try again.` };
  return r.ok ? { ...r, message: `${PHASE_LABELS[from]} ended; ${PHASE_LABELS[r.data?.phase as PhaseCode] ?? "the next phase"} has started.` } : r;
}

export async function pause(eventId: string): Promise<ActionResult> {
  return rpc("pause_event", { p_event: eventId });
}

export async function resume(eventId: string): Promise<ActionResult> {
  return rpc("resume_event", { p_event: eventId });
}

export async function extend(eventId: string, minutes: number, version: number): Promise<ActionResult> {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) return { ok: false, code: "BAD_MINUTES", message: "Extend by 1 to 120 minutes." };
  const r = stale(await rpc("extend_event", { p_event: eventId, p_minutes: minutes, p_expected_version: version }));
  return r.ok ? { ...r, message: `Extended by ${minutes} min: everything after it moved later.` } : r;
}

export async function previewTiming(eventId: string, changes: TimingChanges): Promise<ActionResult> {
  return rpc("preview_timing", { p_event: eventId, p_changes: changes });
}

/** Applies a timing change; one that brings any time earlier is refused with CONFIRM until `confirm` is true. */
export async function applyTiming(eventId: string, version: number, changes: TimingChanges, confirm: boolean): Promise<ActionResult> {
  const r = stale(await rpc("set_timing", { p_event: eventId, p_expected_version: version, p_changes: changes, p_confirm: confirm }));
  if (r.ok) return { ...r, message: "Applied. Every screen shows the new times, and teams are told which deadlines moved." };
  return r;
}

export async function setMode(eventId: string, auto: boolean, advanceNow = false): Promise<ActionResult> {
  const r = await rpc("set_auto_advance", { p_event: eventId, p_on: auto, p_advance_now: advanceNow });
  if (r.code === "OVERDUE") return { ...r, message: "This phase's time is already up: with Advance when timer expires, the next phase starts at once. Click again to confirm." };
  return r.ok ? { ...r, message: auto ? "Advance when timer expires: on." : "Manual advance: phases wait for you." } : r;
}

/** CLEAR fills the round's pending orders at its clearing price; CANCEL cancels them. Names the round seen. */
export async function closeRound(eventId: string, round: number, mode: "CLEAR" | "CANCEL"): Promise<ActionResult> {
  if (!Number.isInteger(round) || round < 1) return { ok: false, code: "BAD_ROUND", message: "No such round." };
  const r = await rpc("close_round_now", { p_event: eventId, p_round: round, p_mode: mode });
  if (!r.ok) return r;
  if (r.data?.already) return { ...r, message: `Round ${round} had already cleared.` };
  return {
    ...r,
    message:
      mode === "CANCEL"
        ? `Round ${round} closed: ${count(r.data?.cancelled as number | undefined)} pending orders cancelled.`
        : `Round ${round} closed and cleared: ${count(r.data?.orders as number | undefined)} orders filled.`,
  };
}
