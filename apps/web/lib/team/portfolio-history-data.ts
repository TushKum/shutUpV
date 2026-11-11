// Reads what the fund's value chart needs: its own ledger (RLS: a team reads only its own rows) and the public price
// steps of the event, with round numbers.

import { fetchAll } from "@/lib/fetch-all";
import { supabaseServer } from "@/lib/supabase/server";
import type { ChartPoint } from "@/lib/chart";
import { portfolioSeries, type PriceKind } from "./portfolio-history";

export async function loadPortfolioSeries(eventId: string, teamId: string): Promise<ChartPoint[]> {
  const sb = await supabaseServer();
  const [moves, steps, rounds] = await Promise.all([
    fetchAll<{ created_at: string; cash_delta_cents: number | string; company_id: string | null; share_delta: number; price_cents: number | null }>((from, to) =>
      sb.from("ledger_entries").select("created_at, cash_delta_cents, company_id, share_delta, price_cents").eq("team_id", teamId).order("id").range(from, to),
    ),
    fetchAll<{ created_at: string; kind: PriceKind; round_id: string | null; company_id: string; market_after: number }>((from, to) =>
      sb.from("round_prices").select("created_at, kind, round_id, company_id, market_after").eq("event_id", eventId).order("id").range(from, to),
    ),
    sb.from("rounds").select("id, number").eq("event_id", eventId),
  ]);
  if (rounds.error) throw new Error(`Could not read the rounds: ${rounds.error.message}`);
  const numbers = new Map((rounds.data ?? []).map((r) => [r.id as string, r.number as number]));
  return portfolioSeries(
    moves.map((m) => ({ at: m.created_at, cash: Number(m.cash_delta_cents), companyId: m.company_id, shares: m.share_delta, price: m.price_cents })),
    steps.map((s) => ({ at: s.created_at, kind: s.kind, roundNumber: s.round_id ? (numbers.get(s.round_id) ?? null) : null, companyId: s.company_id, price: Number(s.market_after) })),
  );
}
