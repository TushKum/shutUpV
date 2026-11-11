// The team portal's sections, per track: what each team can do on the night (the brief's /team list), and the judge's
// published prompts (Judging) and the squad chat (Chat) for every track.

import type { Track } from "@msim/engine";

export interface TeamSection {
  path: string;
  label: string;
}

const HOME = { path: "", label: "Home" };
const RESCUE = { path: "/rescue", label: "Rescue" };
/** The squad chat, for all three teams of a squad. */
const CHAT = { path: "/chat", label: "Chat" };
/** PRIMUS Rounds 2 and 3: crisis cards, hiring, the response plan, the advice memo and the Round 3 draft. */
const CRISIS_ROOM = { path: "/crisis", label: "Crisis room" };
/** PRIMUS: the Consulting firm directory and every firm's profile (Product teams hire from it; firms see the field). */
const FIRMS = { path: "/firms", label: "Firms" };
/** PRIMUS: the one-on-one chat between a company and each firm it hired. */
const HIRE_CHAT = { path: "/messages", label: "Hire chat" };
const COMMON: TeamSection[] = [
  { path: "/market", label: "Market" },
  { path: "/qa", label: "Q&A" },
  { path: "/ledger", label: "Ledger" },
  { path: "/bulletins", label: "Bulletins" },
  { path: "/judging", label: "Judging" },
];

export const TEAM_SECTIONS: Record<Track, readonly TeamSection[]> = {
  PRODUCT: [HOME, { path: "/squad", label: "Squad" }, CRISIS_ROOM, FIRMS, HIRE_CHAT, RESCUE, CHAT, ...COMMON],
  CONSULTING: [
    HOME,
    { path: "/squad", label: "Squad" },
    CRISIS_ROOM,
    FIRMS,
    HIRE_CHAT,
    RESCUE,
    CHAT,
    { path: "/calls", label: "Calls" },
    { path: "/earnings", label: "Earnings" },
    ...COMMON,
  ],
  FINANCE: [HOME, { path: "/trade", label: "Trade" }, CRISIS_ROOM, RESCUE, CHAT, ...COMMON],
};

/** May this track open this section? (Pages also check, so a typed address shows a clear notice.) */
export function sectionAllowed(track: Track, path: string): boolean {
  return TEAM_SECTIONS[track].some((s) => s.path === path);
}
