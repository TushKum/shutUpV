// The price strip under the team header, like a terminal's market wire: every listed company's ticker, price and
// change since its IPO price, scrolling (still on screens that ask for less motion). Companies are public to the
// event, so this is one small read per page; before the IPO prices are set there is no strip.

import { changeSinceIpoBp, toneOf } from "@/lib/display/board";
import { bp, money } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";

const TONE = { up: "text-[#46f097]", down: "text-rose-400", flat: "text-slate-400" } as const;
const ARROW = { up: "▲", down: "▼", flat: "▬" } as const;

export interface StripQuote {
  ticker: string;
  price: number;
  changeBp: number | null;
}

export async function MarketStrip({ eventId }: { eventId: string }) {
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from("companies")
    .select("ticker, ipo_price, market_price, closing_price")
    .eq("event_id", eventId)
    .not("ticker", "is", null)
    .not("market_price", "is", null)
    .order("ticker");
  // The strip is decoration: a failed read leaves it out instead of failing the page.
  if (error) {
    console.error("team market strip:", error.message);
    return null;
  }
  const rows = (data ?? []) as { ticker: string; ipo_price: number | null; market_price: number; closing_price: number | null }[];
  return (
    <QuoteStrip
      quotes={rows.map((r) => {
        const price = Number(r.closing_price ?? r.market_price);
        return { ticker: r.ticker, price, changeBp: changeSinceIpoBp(r.ipo_price === null ? null : Number(r.ipo_price), price) };
      })}
    />
  );
}

export function QuoteStrip({ quotes }: { quotes: StripQuote[] }) {
  if (quotes.length === 0) return null;
  const strip = quotes.map((q) => {
    const tone = toneOf(q.changeBp);
    return (
      <span key={q.ticker} className="mr-6 inline-flex items-baseline gap-1.5 whitespace-nowrap">
        <span className="font-bold text-amber-300">{q.ticker}</span>
        <span className="text-slate-100 tabular-nums">{money(q.price)}</span>
        <span className={`tabular-nums ${TONE[tone]}`}>
          {ARROW[tone]}
          {bp(q.changeBp)}
        </span>
      </span>
    );
  });
  const seconds = Math.max(40, quotes.length * 3);
  return (
    <div className="h-7 overflow-hidden border-t border-white/10 bg-black/25 text-xs backdrop-blur-md" role="marquee" aria-label="Prices since the IPO price" data-testid="market-strip">
      <div className="msim-ticker-track flex h-full w-max items-center" style={{ ["--ticker-seconds" as string]: `${seconds}s` }}>
        <div className="flex min-w-[100vw] items-center pl-4">{strip}</div>
        <div className="flex min-w-[100vw] items-center pl-4" aria-hidden>
          {strip}
        </div>
      </div>
    </div>
  );
}
