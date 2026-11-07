// When a team may write its PRD and its crisis solution, as the database's app.writing_open decides it, and what the
// editor says when it is closed. Pure; guidance only (save_draft decides again).
//   PRD:      from the problem-card draw (21:15) until the lock (23:00), in Briefing or Build.
//   SOLUTION: from the crisis (23:45) until the lock (01:45), in Crisis & Q&A or Rescue.

import { PHASE_LABELS, type PhaseCode, type SubmissionType } from "@msim/engine";
import { clock } from "@/lib/format";
import { deadlinePassed } from "./time";

export interface WritingFacts {
  phase: PhaseCode;
  paused: boolean;
  pausedAt: string | null;
  nowMs: number;
  drawnAt: string | null;
  prdsLockedAt: string | null;
  crisisAppliedAt: string | null;
  solutionsLockedAt: string | null;
  /** The lock of this draft (PRD_LOCK or SOLUTION_LOCK). */
  lock: string | null;
}

export function writingOpen(type: SubmissionType, f: WritingFacts): boolean {
  if (f.paused || deadlinePassed(f.lock, f.nowMs)) return false;
  return type === "PRD"
    ? !!f.drawnAt && !f.prdsLockedAt && (f.phase === "BRIEFING" || f.phase === "BUILD")
    : !!f.crisisAppliedAt && !f.solutionsLockedAt && (f.phase === "CRISIS_QA" || f.phase === "RESCUE");
}

/** Why the editor is read-only (when writingOpen is false). */
export function closedNote(type: SubmissionType, f: WritingFacts): string {
  const locked = type === "PRD" ? f.prdsLockedAt : f.solutionsLockedAt;
  const what = type === "PRD" ? "PRD" : "crisis solution";
  if (f.paused) return "The event is paused: writing resumes when it does (the lock moves later by the length of the pause).";
  if (locked || deadlinePassed(f.lock, f.nowMs)) return `The ${what} is locked${f.lock ? ` (${clock(f.lock)})` : ""}: the version saved before then is the one judged.`;
  if (type === "PRD" && !f.drawnAt) return "The PRD opens when the problem cards are dealt at 21:15.";
  if (type === "SOLUTION" && !f.crisisAppliedAt) return "The crisis solution opens at the crisis (23:45), when you learn which company you rescue.";
  return `Writing is closed in ${PHASE_LABELS[f.phase]}.`;
}
