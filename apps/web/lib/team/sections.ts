// The team portal's sections, per track: what each team can do on the night (the brief's /team list).

import type { Track } from "@msim/engine";

export interface TeamSection {
  path: string;
  label: string;
}

const HOME = { path: "", label: "Home" };
const COMMON: TeamSection[] = [
  { path: "/market", label: "Market" },
  { path: "/qa", label: "Q&A" },
  { path: "/ledger", label: "Ledger" },
  { path: "/bulletins", label: "Bulletins" },
];

export const TEAM_SECTIONS: Record<Track, readonly TeamSection[]> = {
  PRODUCT: [HOME, { path: "/squad", label: "Squad" }, { path: "/rescue", label: "Rescue" }, ...COMMON],
  CONSULTING: [
    HOME,
    { path: "/squad", label: "Squad" },
    { path: "/rescue", label: "Rescue" },
    { path: "/calls", label: "Calls" },
    { path: "/earnings", label: "Earnings" },
    ...COMMON,
  ],
  FINANCE: [HOME, { path: "/trade", label: "Trade" }, { path: "/rescue", label: "Rescue" }, ...COMMON],
};

/** May this track open this section? (Pages also check, so a typed address shows a clear notice.) */
export function sectionAllowed(track: Track, path: string): boolean {
  return TEAM_SECTIONS[track].some((s) => s.path === path);
}
