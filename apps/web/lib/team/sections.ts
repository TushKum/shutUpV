// The team portal's sections, in the order of the night (the brief's /team list). Every team plays all three rounds,
// so every team has the same sections; a section that is not in use yet says when it opens.

import { phaseReached, type PhaseCode } from "@msim/engine";

export interface TeamSection {
  path: string;
  label: string;
  /** The phase from which the section has something to show (it opens before then with a note). */
  from: PhaseCode;
}

export const TEAM_SECTIONS: readonly TeamSection[] = [
  { path: "", label: "Home", from: "SETUP" },
  { path: "/build", label: "Round 1: PRD", from: "BRIEFING" },
  { path: "/rescue", label: "Round 2: Rescue", from: "CRISIS_QA" },
  { path: "/qa", label: "Q&A", from: "CRISIS_QA" },
  { path: "/market", label: "Market", from: "REVEAL_1" },
  { path: "/trade", label: "Round 3: Trade", from: "MARKET_BLIND" },
  { path: "/ledger", label: "Ledger", from: "MARKET_BLIND" },
  { path: "/leaderboard", label: "Leaderboard", from: "REVEAL_1" },
  { path: "/bulletins", label: "News", from: "SETUP" },
  { path: "/judging", label: "How judging works", from: "SETUP" },
];

/** Sections in use now come first in the row; the rest keep their order (the row stays the same all night). */
export function sectionLive(section: TeamSection, phase: PhaseCode): boolean {
  return phaseReached(phase, section.from);
}
