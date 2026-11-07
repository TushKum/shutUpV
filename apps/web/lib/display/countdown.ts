// The big screen before the 23:30 reveal: a large countdown to the next moment of the night, and the evening's
// schedule with what has passed struck through. Pure.

import { DEADLINE_LABELS, type DeadlineCode, type PhaseCode } from "@msim/engine";

export interface Moment {
  key: string;
  label: string;
  at: string;
}

/** The moments shown before the reveal, in night order (a missing time is left out). */
export function eveningMoments(deadlines: Partial<Record<DeadlineCode, string>>, phaseStarts: Partial<Record<PhaseCode, string>>): Moment[] {
  const items: (Moment | null)[] = [
    phaseStarts.BRIEFING ? { key: "BRIEFING", label: "The briefing", at: phaseStarts.BRIEFING } : null,
    deadlines.PROBLEM_DRAW ? { key: "PROBLEM_DRAW", label: "Problem cards dealt", at: deadlines.PROBLEM_DRAW } : null,
    deadlines.TWIST ? { key: "TWIST", label: DEADLINE_LABELS.TWIST, at: deadlines.TWIST } : null,
    deadlines.PRD_LOCK ? { key: "PRD_LOCK", label: DEADLINE_LABELS.PRD_LOCK, at: deadlines.PRD_LOCK } : null,
    phaseStarts.REVEAL_1 ? { key: "REVEAL_1", label: "PRD scores and starting prices", at: phaseStarts.REVEAL_1 } : null,
  ];
  return items.filter((m): m is Moment => m !== null).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** The first moment still ahead (null when all have passed: the screen waits for the reveal). */
export function nextMoment(moments: readonly Moment[], nowMs: number): Moment | null {
  return moments.find((m) => Date.parse(m.at) > nowMs) ?? null;
}
