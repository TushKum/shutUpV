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
  PITCH: "Pitch",
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
};

export const TRACK_LABELS: Record<Track, string> = {
  PRODUCT: "Product",
  CONSULTING: "Consulting",
  FINANCE: "Finance",
};
