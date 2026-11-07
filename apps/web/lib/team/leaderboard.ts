// The leaderboard as a team sees it, pure logic: the leaderboard function's answer turned into what the page shows.
// Live until 03:30 (the total so far: Round 1 points from 23:30, Round 2 from 02:45, Round 3 at current market prices
// from 02:15); frozen and hidden from 03:30 until the awards (the function refuses); the final results at AWARDS.

import { phaseReached, type PhaseCode } from "@msim/engine";
import type { ActionResult } from "@/lib/rpc";

export interface BoardRow {
  team_id: string;
  code: string;
  name?: string | null;
  r1: number;
  r2: number;
  r3: number;
  total: number;
  rank: number | null;
  return_bp?: number;
  eligible?: boolean;
}

export type BoardView =
  | { state: "LIVE"; rows: BoardRow[]; mine: BoardRow | null; parts: { r1: boolean; r2: boolean; r3: boolean } }
  | { state: "FROZEN" }
  | { state: "FINAL"; rows: BoardRow[]; mine: BoardRow | null }
  | { state: "ERROR"; message: string };

/** Which parts of the live total count yet. */
export function liveParts(phase: PhaseCode) {
  return { r1: phaseReached(phase, "REVEAL_1"), r2: phaseReached(phase, "MARKET"), r3: phaseReached(phase, "MARKET_BLIND") };
}

export function boardView(r: ActionResult, phase: PhaseCode, teamId: string): BoardView {
  if (!r.ok) {
    if (r.code === "NOT_ALLOWED" && !phaseReached(phase, "AWARDS")) return { state: "FROZEN" };
    return { state: "ERROR", message: r.message ?? "The leaderboard could not be read." };
  }
  const rows = (Array.isArray(r.data?.rows) ? r.data.rows : []) as BoardRow[];
  const mine = rows.find((x) => x.team_id === teamId) ?? null;
  if (r.data?.final === true) return { state: "FINAL", rows, mine };
  if (r.data?.frozen === true) return { state: "FROZEN" };
  return { state: "LIVE", rows, mine, parts: liveParts(phase) };
}

/** "3rd of 40" (ties share the rank); "not ranked" for a disqualified team. */
export function rankText(row: BoardRow | null, of: number): string {
  if (!row) return "—";
  if (row.rank === null) return "not ranked";
  const n = row.rank;
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${suffix} of ${of}`;
}
