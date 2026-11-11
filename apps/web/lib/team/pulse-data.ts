// Reads the last cleared trading round's prices and volumes (public to every team of the event) for the Home's
// market pulse. Any read problem gives no pulse rather than a broken Home.

import { supabaseServer } from "@/lib/supabase/server";
import { marketPulse, type Pulse } from "./pulse";

export async function loadPulse(eventId: string): Promise<Pulse | null> {
  const sb = await supabaseServer();
  const { data: round, error: e1 } = await sb
    .from("rounds")
    .select("id, number")
    .eq("event_id", eventId)
    .eq("status", "CLEARED")
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; number: number }>();
  if (e1 || !round) return null;
  const [prices, companies] = await Promise.all([
    sb.from("round_prices").select("company_id, market_before, market_after, buy_qty, sell_qty, short_qty, cover_qty").eq("round_id", round.id).eq("kind", "CLEARING"),
    sb.from("companies").select("id, ticker, name").eq("event_id", eventId),
  ]);
  if (prices.error || companies.error) {
    console.error("pulse: could not read the round:", prices.error?.message ?? companies.error?.message);
    return null;
  }
  const byId = new Map((companies.data ?? []).map((c) => [c.id as string, c as { ticker: string | null; name: string | null }]));
  return marketPulse(
    round.number,
    (prices.data ?? []).map((p) => ({
      ticker: byId.get(p.company_id as string)?.ticker ?? null,
      name: byId.get(p.company_id as string)?.name ?? null,
      before: p.market_before === null ? null : Number(p.market_before),
      after: Number(p.market_after),
      volume: Number(p.buy_qty) + Number(p.sell_qty) + Number(p.short_qty) + Number(p.cover_qty),
    })),
  );
}
