// What the price board reads, as the display account (companies, rounds and round prices are public to the event):
// the companies, and the last cleared round with its clearing rows embedded (a round_prices row with a round is a
// CLEARING row). Until the 03:30 freeze, the live leaderboard (team codes and points so far; the database refuses
// once it is frozen).

import { supabaseServer } from "@/lib/supabase/server";
import type { BoardCompany, BoardMoveRow } from "@/lib/display/board";

export interface BoardRound {
  number: number;
  cleared_at: string | null;
  round_prices: BoardMoveRow[];
}

export interface BoardData {
  companies: BoardCompany[];
  /** The most recently cleared round (null before any round has cleared). */
  round: BoardRound | null;
}

export async function loadBoard(eventId: string): Promise<BoardData> {
  const sb = await supabaseServer();
  const [companies, round] = await Promise.all([
    sb.from("companies").select("id, ticker, name, start_price, market_price, closing_price").eq("event_id", eventId).not("ticker", "is", null),
    sb
      .from("rounds")
      .select("number, cleared_at, round_prices(company_id, market_before, market_after)")
      .eq("event_id", eventId)
      .eq("status", "CLEARED")
      .eq("round_prices.kind", "CLEARING")
      .order("number", { ascending: false })
      .limit(1)
      .maybeSingle<BoardRound>(),
  ]);
  for (const r of [companies, round]) if (r.error) throw new Error(`Could not read the board: ${r.error.message}`);
  return { companies: (companies.data ?? []) as BoardCompany[], round: round.data ?? null };
}

export interface LiveRow {
  team_id: string;
  code: string;
  r1: number;
  r2: number;
  r3: number;
  total: number;
  rank: number | null;
}

/** The live leaderboard, or null when it is frozen (03:30 until the awards) or final. */
export async function loadLiveLeaderboard(eventId: string): Promise<LiveRow[] | null> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("leaderboard", { p_event: eventId });
  if (error) {
    if (error.code === "42501") return null; // frozen
    throw new Error(`Could not read the leaderboard: ${error.message}`);
  }
  const b = data as { final?: boolean; frozen?: boolean; rows?: LiveRow[] };
  return b.final || b.frozen ? null : (b.rows ?? []);
}
