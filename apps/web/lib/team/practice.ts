// The Round 1 practice market (migration 52): the tickers (the event's Product teams), the market's clock, and
// preparing it: the first Finance page read in Round 1 stores the scripted price paths (packages/engine
// candles.ts) with the service role. Preparing is idempotent and deterministic, so two fund pages racing to prepare
// store the same thing once.

import "server-only";
import { candleTicks, practiceCandles, PRACTICE } from "@msim/engine";
import { supabaseService } from "@/lib/supabase/service";

export interface PracticeTicker {
  id: string;
  code: string;
  name: string;
}

export interface PracticeMarket {
  startsAt: string;
  tickSeconds: number;
  steps: number;
  settledAt: string | null;
}

export interface PracticeResult {
  code: string;
  name: string;
  equity: number;
  edge: number;
  trades: number;
}

export async function practiceTickers(eventId: string): Promise<PracticeTicker[]> {
  const { data, error } = await supabaseService()
    .from("teams")
    .select("id, code, name")
    .eq("event_id", eventId)
    .eq("track", "PRODUCT")
    .order("code");
  if (error) throw new Error(`Could not read the practice companies: ${error.message}`);
  return (data ?? []) as PracticeTicker[];
}

export async function loadPracticeMarket(eventId: string): Promise<PracticeMarket | null> {
  const { data, error } = await supabaseService()
    .from("practice_markets")
    .select("starts_at, tick_seconds, steps, settled_at")
    .eq("event_id", eventId)
    .maybeSingle<{ starts_at: string; tick_seconds: number; steps: number; settled_at: string | null }>();
  if (error) throw new Error(`Could not read the practice market: ${error.message}`);
  return data ? { startsAt: data.starts_at, tickSeconds: data.tick_seconds, steps: data.steps, settledAt: data.settled_at } : null;
}

/** Stores the price paths if Round 1 has started and they are not there yet; returns the market. */
export async function ensurePracticeMarket(eventId: string, tickers: readonly PracticeTicker[]): Promise<PracticeMarket | null> {
  const existing = await loadPracticeMarket(eventId);
  if (existing || tickers.length === 0) return existing;
  const sb = supabaseService();
  const { data: phase } = await sb
    .from("phases")
    .select("started_at, starts_at")
    .eq("event_id", eventId)
    .eq("code", "BUILD")
    .maybeSingle<{ started_at: string | null; starts_at: string }>();
  const start = phase?.started_at ?? new Date().toISOString();
  const rows = tickers.map((t) => ({ ticker: t.id, prices: practiceCandles(`${eventId}:${t.code}`).flatMap((c) => candleTicks(c)) }));
  const { data, error } = await sb.rpc("practice_prepare", { p_event: eventId, p_starts_at: start, p_tick_seconds: PRACTICE.tickSeconds, p_rows: rows });
  const r = data as { ok?: boolean; message?: string } | null;
  if (error || !r?.ok) throw new Error(`Could not open the practice market: ${error?.message ?? r?.message ?? "refused"}`);
  // Not read back: the same read in the same render is memoised (it would return the empty answer from above). If
  // another page opened it first ("already"), its start is the same Round 1 start, so this is the same market.
  return { startsAt: start, tickSeconds: PRACTICE.tickSeconds, steps: rows[0]!.prices.length, settledAt: null };
}

/** Every fund's practice result once the market has closed, best first. */
export async function practiceResults(eventId: string): Promise<PracticeResult[]> {
  const { data } = await supabaseService()
    .from("practice_accounts")
    .select("equity_cents, edge_cents, trades, teams!inner(code, name)")
    .eq("event_id", eventId)
    .not("equity_cents", "is", null)
    .order("equity_cents", { ascending: false });
  return ((data ?? []) as unknown as { equity_cents: number; edge_cents: number; trades: number; teams: { code: string; name: string } }[]).map((r) => ({
    code: r.teams.code,
    name: r.teams.name,
    equity: Number(r.equity_cents),
    edge: Number(r.edge_cents ?? 0),
    trades: r.trades,
  }));
}
