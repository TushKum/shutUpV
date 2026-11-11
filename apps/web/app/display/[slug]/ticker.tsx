// The news ticker along the bottom of the price board (public data only; see lib/display/ticker.ts). Its speed is set
// by its length, so every item stays on screen long enough to read from the back of the hall.

import { phaseReached, type DeadlineCode } from "@msim/engine";
import type { EventStatus } from "@/lib/event-status";
import type { DisplayEvent } from "@/lib/display/frame";
import { tickerItems, type TickerItem } from "@/lib/display/ticker";
import { clock } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";

const TONE: Record<TickerItem["tone"], string> = {
  up: "bg-emerald-500 text-black",
  down: "bg-red-500 text-white",
  news: "bg-amber-400 text-black",
  info: "bg-white/20 text-white",
};

export async function NewsTicker({ event, status }: { event: DisplayEvent; status: EventStatus }) {
  if (!phaseReached(status.phase, "READING") || phaseReached(status.phase, "AWARDS")) return null;
  const sb = await supabaseServer();
  const [round, bulletins, deals, companies, deadlines] = await Promise.all([
    sb
      .from("rounds")
      .select("number, round_prices(market_before, market_after, companies(ticker))")
      .eq("event_id", event.id)
      .eq("status", "CLEARED")
      .eq("round_prices.kind", "CLEARING")
      .order("number", { ascending: false })
      .limit(1)
      .maybeSingle<{ number: number; round_prices: { market_before: number | null; market_after: number; companies: { ticker: string | null } | null }[] }>(),
    sb.from("bulletins").select("kind, title").eq("event_id", event.id).not("published_at", "is", null).order("published_at", { ascending: false }).limit(3),
    sb.from("public_ledger").select("id", { count: "exact", head: true }).eq("event_id", event.id).eq("kind", "DEAL"),
    sb.from("companies").select("id", { count: "exact", head: true }).eq("event_id", event.id),
    sb.from("deadlines").select("code, at").eq("event_id", event.id),
  ]);
  for (const r of [round, bulletins, deals, companies, deadlines]) if (r.error) throw new Error(`Could not read the ticker: ${r.error.message}`);
  const items = tickerItems({
    phase: status.phase,
    nowMs: Date.parse(status.server_time),
    lastRound: round.data
      ? {
          number: round.data.number,
          moves: round.data.round_prices
            .filter((p) => p.companies?.ticker && p.market_before !== null)
            .map((p) => ({ ticker: p.companies!.ticker!, before: Number(p.market_before), after: Number(p.market_after) })),
        }
      : null,
    bulletins: (bulletins.data ?? []) as { kind: string; title: string }[],
    dealsSigned: deals.count ?? 0,
    squads: companies.count ?? 0,
    deadlines: (deadlines.data ?? []) as { code: DeadlineCode; at: string }[],
    clock: (iso) => clock(iso),
  });
  if (items.length === 0) return null;
  const strip = items.map((it) => (
    <span key={it.key} className="mr-16 inline-flex items-center gap-4 whitespace-nowrap">
      <span className={`rounded-md px-3 py-0.5 text-[24px] font-black ${TONE[it.tone]}`}>{it.tag}</span>
      <span>{it.text}</span>
    </span>
  ));
  const seconds = Math.max(30, Math.round(items.reduce((n, it) => n + it.tag.length + it.text.length, 0) / 6));
  return (
    <div className="h-[72px] shrink-0 overflow-hidden border-t-4 border-white/20 bg-black/60" role="marquee" aria-label="News ticker" data-testid="news-ticker">
      <div className="msim-ticker-track flex h-full w-max items-center text-[32px] font-semibold" style={{ ["--ticker-seconds" as string]: `${seconds}s` }}>
        <div className="flex min-w-[1920px] items-center pl-12">{strip}</div>
        <div className="flex min-w-[1920px] items-center pl-12" aria-hidden>
          {strip}
        </div>
      </div>
    </div>
  );
}
