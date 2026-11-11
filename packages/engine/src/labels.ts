// Names shown on screens for phases, deadlines and tracks (shared by the control panel, the team portal and the
// big screen).

import type { DeadlineCode, PhaseCode, Track } from "./types";

export const PHASE_LABELS: Record<PhaseCode, string> = {
  SETUP: "Setup",
  CHECKIN: "Check-in",
  BRIEFING: "Briefing",
  SQUAD_DRAW: "Squad draw",
  BUILD: "Build",
  READING: "Reading",
  IPO: "IPO",
  PRESSURE: "Round 2: Pressure",
  SATURATION: "Round 3: Saturation",
  ROUNDS_1_4: "Rounds 1–4",
  CRISIS: "Crisis",
  RESCUE_1: "Rescue 1",
  BREAK: "Break",
  RESCUE_2: "Rescue 2",
  PLANS_PUBLISHED: "Plans published",
  VERDICTS: "Verdicts",
  ROUNDS_13_21: "Rounds 13–21",
  CLOSE: "Close",
  SETTLEMENT: "Settlement",
  APPEALS: "Appeals",
  AWARDS: "Awards",
};

export const DEADLINE_LABELS: Record<DeadlineCode, string> = {
  PROBLEM_PICK: "Problem card pick",
  PITCH: "PRD and crisis memo",
  CALL_1: "Consultant call 1",
  IPO_BIDS: "IPO bids",
  FEE: "Advisor fee",
  DEAL_BONUS: "Deal bonus cut-off",
  DEAL: "Rescue deal",
  PLAN: "Rescue plan",
  CALL_2: "Consultant call 2",
  FLASH_BULLETIN: "Flash bulletin",
  FLASH: "Flash answer",
  FLASH_TIER: "Flash tier",
  CALL_3: "Consultant call 3",
  ...subroundDeadlineLabels(),
};

type SubroundDeadline = Extract<DeadlineCode, `REVEAL_${string}` | `HIRE_${string}` | `DUE_${string}` | `RATE_${string}` | "DRAFT">;

export function subroundDeadlineLabels(): Record<SubroundDeadline, string> {
  const out: Record<string, string> = {};
  for (let k = 1; k <= 4; k++) {
    out[`REVEAL_${k}`] = `Crisis ${k} revealed`;
    out[`HIRE_${k}`] = `Hiring closes (crisis ${k})`;
    out[`DUE_${k}`] = `Crisis ${k} plan and memos due`;
    out[`RATE_${k}`] = `Consultant ratings close (crisis ${k})`;
  }
  out.DRAFT = "Problem statement draft ends";
  out.HIRE_5 = "Round 3 negotiation closes";
  out.DUE_5 = "Round 3 solution and memos due";
  out.RATE_5 = "Consultant ratings close (Round 3)";
  return out as Record<SubroundDeadline, string>;
}

export const TRACK_LABELS: Record<Track, string> = {
  PRODUCT: "Product",
  CONSULTING: "Consulting",
  FINANCE: "Finance",
};
