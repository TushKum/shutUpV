// Names shown on screens for phases and deadlines (shared by the control panel, the team portal and the big screen).

import type { DeadlineCode, PhaseCode, SubmissionType } from "./types";

export const PHASE_LABELS: Record<PhaseCode, string> = {
  SETUP: "Setup",
  CHECKIN: "Check-in",
  BRIEFING: "Briefing",
  BUILD: "Round 1: Build",
  JUDGING_1: "Judging the PRDs",
  REVEAL_1: "PRD reveal",
  CRISIS_QA: "The crisis",
  RESCUE: "Round 2: Rescue",
  JUDGING_2: "Judging the solutions",
  MARKET_BLIND: "Round 3: Invest",
  MARKET: "Round 3: Invest",
  SETTLEMENT: "Closing bell",
  AWARDS: "Awards",
};

export const DEADLINE_LABELS: Record<DeadlineCode, string> = {
  PROBLEM_DRAW: "Problem cards",
  TWIST: "The twist",
  PRD_LOCK: "PRD form locks",
  QA_CLOSE: "Q&A board closes",
  SOLUTION_LOCK: "Crisis solution form locks",
  LEADERBOARD_FREEZE: "Leaderboard freezes",
  MARKET_CLOSE: "Closing bell",
};

export const SUBMISSION_LABELS: Record<SubmissionType, string> = {
  PRD: "PRD",
  SOLUTION: "Crisis solution",
};
