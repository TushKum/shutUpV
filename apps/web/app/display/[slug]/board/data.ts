// What the ticker board reads, as the display account (RLS: companies are public from READING; rounds, round prices
// and phases always). Two queries in parallel: the companies, and the last cleared round with its clearing rows
// embedded (a round_prices row with a round is a CLEARING row). Before READING only the planned start of READING.

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
    sb.from("companies").select("id, ticker, name, ipo_price, market_price, closing_price").eq("event_id", eventId).not("ticker", "is", null),
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

/** When READING is planned to start (phases.starts_at; it moves with a pause or an extension). */
export async function loadReadingStart(eventId: string): Promise<string | null> {
  const sb = await supabaseServer();
  const { data, error } = await sb.from("phases").select("starts_at").eq("event_id", eventId).eq("code", "READING").maybeSingle<{ starts_at: string }>();
  if (error) throw new Error(`Could not read the schedule: ${error.message}`);
  return data?.starts_at ?? null;
}
