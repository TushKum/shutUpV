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

/** The text after the planned end has passed (null: keep the countdown). */
export function phaseOverText(phase: PhaseCode, gate: string | null, next: PhaseCode | null): string {
  if (phase === "AWARDS" || !next) return "the event is over";
  if (gate) return WAITING[phase] ?? "waiting for the organisers";
  return `${PHASE_LABELS[next]} next`;
}
