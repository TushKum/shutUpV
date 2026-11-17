// Reads every listed company's price steps and the rounds' ranges as the signed-in team, for the order screen's chart.

import type { Candle } from "@/lib/chart";
import { supabaseServer } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { tradeCandles, type RangeRow, type StepRow } from "./trade-candles";

export async function loadTradeCandles(eventId: string): Promise<{ candles: Record<string, Candle[]>; ranges: RangeRow[] }> {
  try {
    return await read(eventId);
  } catch {
    // A database without migration 52 (round_ranges): the order screen still works, with an empty chart.
    return { candles: {}, ranges: [] };
  }
}

async function read(eventId: string): Promise<{ candles: Record<string, Candle[]>; ranges: RangeRow[] }> {
  const sb = await supabaseServer();
  const [steps, ranges, rounds] = await Promise.all([
    fetchAll<StepRow>((from, to) =>
      sb
        .from("round_prices")
        .select("company_id, kind, round_id, market_before, market_after, buy_qty, sell_qty, short_qty, cover_qty")
        .eq("event_id", eventId)
        .order("id")
        .range(from, to),
    ),
    fetchAll<RangeRow>((from, to) =>
      sb.from("round_ranges").select("round_id, company_id, open_cents, high_cents, low_cents, last_cents").eq("event_id", eventId).order("round_id").order("company_id").range(from, to),
    ),
    sb.from("rounds").select("id, number").eq("event_id", eventId).then((r) => (r.data ?? []) as { id: string; number: number }[]),
  ]);
  const number = new Map(rounds.map((r) => [r.id, r.number]));
  const byCompany = new Map<string, StepRow[]>();
  for (const s of steps) (byCompany.get(s.company_id) ?? byCompany.set(s.company_id, []).get(s.company_id)!).push(s);
  const candles: Record<string, Candle[]> = {};
  for (const [id, rows] of byCompany) {
    candles[id] = tradeCandles(rows, ranges.filter((r) => r.company_id === id), (rid) => number.get(rid) ?? null);
  }
  return { candles, ranges };
}
