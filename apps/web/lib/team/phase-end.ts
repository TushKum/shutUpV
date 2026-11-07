// What the team header says about the end of the current phase. Before its planned end, a countdown; after it, the
// phase may be waiting (for scores, the draw, the fairness officer) or about to move on: say which, in team words.

import { PHASE_LABELS, type PhaseCode } from "@msim/engine";

const WAITING: Partial<Record<PhaseCode, string>> = {
  SETUP: "waiting to start",
  BRIEFING: "waiting for the problem cards",
  JUDGING_1: "waiting for every PRD score",
  MARKET_BLIND: "waiting for every crisis-solution score",
  SETTLEMENT: "waiting for the fairness officer",
};

/** A phase with no end time: the night has not started, it is over, or an organiser ends this phase by hand. */
export function phaseOpenText(phase: PhaseCode, ended: boolean): string {
  if (ended) return "the night is over";
  if (phase === "SETUP") return "waiting for the organisers to start";
  if (phase === "AWARDS") return "until the organisers close the night";
  return "until the organisers end it";
}

/** The text after the planned end has passed (null: keep the countdown). */
export function phaseOverText(phase: PhaseCode, gate: string | null, next: PhaseCode | null): string {
  if (phase === "AWARDS" || !next) return "the event is over";
  if (gate) return WAITING[phase] ?? "waiting for the organisers";
  return `${PHASE_LABELS[next]} next`;
}
