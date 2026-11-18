// The live wall's three bodies: before Round 1 (the night's plan), Round 1 (the practice market) and the market from
// Reading (every company, the sector race, the movers, a spotlight chart and the news). Read as the display account:
// public data only.

import { PHASE_LABELS, type PhaseCode } from "@msim/engine";
import type { EventStatus } from "@/lib/event-status";
import type { DisplayEvent } from "@/lib/display/frame";
import { supabaseServer } from "@/lib/supabase/server";
import { loadBoard } from "../board/data";
import { loadSectorRace } from "@/lib/team/sectors-data";
import { pctText, sectorStyle } from "@/lib/team/sectors";
import { loadTradeCandles } from "@/lib/team/trade-candles-data";
import { liveCandle } from "@/lib/team/trade-candles";
import { clock, money } from "@/lib/format";
import { MiniCandles } from "@/components/ui/candle-chart";
import { loadPracticeMarket, practiceTickers } from "@/lib/team/practice";
import { Spotlight, type SpotlightCompany } from "./spotlight";
import { PracticeWall } from "./practice-wall";

const bpOf = (from: number | null, to: number | null) => (from && to ? Math.round(((to - from) * 10_000) / from) : null);
const toneText = (bp: number | null) => (bp === null || bp === 0 ? "text-muted" : bp > 0 ? "text-phosphor" : "text-danger-soft");

function Box({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`mx-panel flex min-h-0 flex-col rounded-xl bg-ink px-5 py-3 ${className}`}>
      <h2 className="mb-2 font-mono text-[22px] font-bold tracking-wide text-phosphor-mid">{title}</h2>
      {children}
    </section>
  );
}

// ───────────────────────────── Before Round 1 ─────────────────────────────

export async function WelcomeWall({ event, status }: { event: DisplayEvent; status: EventStatus }) {
  const sb = await supabaseServer();
  const { data } = await sb.from("phases").select("code, starts_at").eq("event_id", event.id).order("seq");
  const phases = ((data ?? []) as { code: PhaseCode; starts_at: string }[]).filter((p) => !["SETUP", "SETTLEMENT", "APPEALS"].includes(p.code));
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1fr_760px] gap-8 px-12 py-8">
      <div className="mx-panel flex flex-col justify-center rounded-2xl bg-ink px-16">
        <p className="text-[34px] text-muted">Welcome to</p>
        <p className="text-[96px] leading-none font-black glow">{event.name}</p>
        <p className="mt-8 text-[38px] leading-snug text-paper">
          One night, three teams in every squad: a startup, its consultants and its investors, in one live stock market. An AI judge scores every
          answer; the scores move the prices.
        </p>
        <p className="mt-8 text-[32px] text-phosphor-mid">Sign in with the card on your table: scan its QR code.</p>
      </div>
      <Box title="TONIGHT">
        <ol className="space-y-2 text-[30px]">
          {phases.map((p) => (
            <li key={p.code} className={`flex justify-between gap-6 ${p.code === status.phase ? "text-phosphor glow" : "text-paper"}`}>
              <span>{PHASE_LABELS[p.code]}</span>
              <span className="font-mono tabular-nums text-muted">{clock(p.starts_at)}</span>
            </li>
          ))}
        </ol>
      </Box>
    </div>
  );
}

// ───────────────────────────── Round 1: the practice market ─────────────────────────────

export async function PracticeWallSection({ event }: { event: DisplayEvent; status: EventStatus }) {
  const [market, tickers] = await Promise.all([loadPracticeMarket(event.id).catch(() => null), practiceTickers(event.id).catch(() => [])]);
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1fr_620px] gap-6 px-10 py-6">
      {market ? (
        <PracticeWall eventId={event.id} tickers={tickers.map((t) => ({ id: t.id, code: t.code }))} startsAt={market.startsAt} tickSeconds={market.tickSeconds} steps={market.steps} />
      ) : (
        <div className="mx-panel flex items-center justify-center rounded-2xl bg-ink px-16 text-center">
          <p className="text-[48px] leading-tight font-bold">The practice market opens as soon as the first Finance team starts trading.</p>
        </div>
      )}
      <div className="flex min-h-0 flex-col gap-6">
        <Box title="ROUND 1 · RIGHT NOW">
          <ul className="space-y-4 text-[30px] leading-snug text-paper">
            <li>
              <b className="text-phosphor">Product</b> writes its company&apos;s PRD: 7 sections, 800 words. Its score sets the IPO price.
            </li>
            <li>
              <b className="text-phosphor">Consulting</b> answers the ElevenLabs case: winning India&apos;s voices.
            </li>
            <li>
              <b className="text-phosphor">Finance</b> trades the practice market: every profit (up to $50,000) is added to its real fund at the IPO.
            </li>
          </ul>
        </Box>
        <Box title="READ THE CANDLES" className="flex-1">
          <ul className="space-y-3 text-[26px] leading-snug text-paper">
            <li>
              <span className="text-phosphor">▲ Hammer</span> after a fall: often a turn up.
            </li>
            <li>
              <span className="text-danger-soft">▼ Shooting star</span> after a rise: often a turn down.
            </li>
            <li>
              <span className="text-phosphor">▲ Engulfing</span>: a big candle swallows the last one; the new side has taken over.
            </li>
            <li>
              <span className="text-warn">◆ Doji</span>: indecision. Watch the next candle.
            </li>
            <li>
              <span className="text-phosphor">Breakout</span>: out of a tight range, the move often carries on.
            </li>
          </ul>
        </Box>
      </div>
    </div>
  );
}

// ───────────────────────────── From Reading: the market ─────────────────────────────

export async function MarketWall({ event, status }: { event: DisplayEvent; status: EventStatus }) {
  const sb = await supabaseServer();
  const [{ companies, round }, race, chart, bulletins, rounds] = await Promise.all([
    loadBoard(event.id),
    loadSectorRace(event.id),
    loadTradeCandles(event.id),
    sb.from("bulletins").select("id, kind, title, body, published_at").eq("event_id", event.id).not("published_at", "is", null).order("published_at", { ascending: false }).limit(2),
    sb.from("rounds").select("id, number").eq("event_id", event.id),
  ]);
  const listed = companies.filter((c) => c.ticker).sort((a, b) => (a.ticker ?? "").localeCompare(b.ticker ?? ""));
  const openRoundId = status.open_round ? (((rounds.data ?? []) as { id: string; number: number }[]).find((r) => r.number === status.open_round!.number)?.id ?? null) : null;
  const live = (id: string, price: number | null) =>
    openRoundId && price ? liveCandle(status.open_round!.number, price, chart.ranges.find((r) => r.round_id === openRoundId && r.company_id === id) ?? null) : null;
  const candlesOf = (id: string, price: number | null) => {
    const past = chart.candles[id] ?? [];
    const l = live(id, price);
    return l ? [...past, l] : past;
  };
  const priceNow = (id: string, price: number | null) => live(id, price)?.close ?? price;
  const moves = (round?.round_prices ?? [])
    .map((r) => ({ c: listed.find((x) => x.id === r.company_id), bp: bpOf(r.market_before, r.market_after) }))
    .filter((m): m is { c: (typeof listed)[number]; bp: number } => !!m.c && m.bp !== null);
  const up = [...moves].sort((a, b) => b.bp - a.bp).slice(0, 3).filter((m) => m.bp > 0);
  const down = [...moves].sort((a, b) => a.bp - b.bp).slice(0, 3).filter((m) => m.bp < 0);
  // The spotlight shows the companies that moved most since the IPO first.
  const spotlight: SpotlightCompany[] = [...listed]
    .sort((a, b) => Math.abs(bpOf(b.ipo_price, b.market_price) ?? 0) - Math.abs(bpOf(a.ipo_price, a.market_price) ?? 0))
    .slice(0, 12)
    .map((c) => ({ id: c.id, ticker: c.ticker!, name: c.name, candles: candlesOf(c.id, c.market_price) }))
    .filter((c) => c.candles.length >= 2);
  const maxAbs = Math.max(1, ...(race ?? []).map((r) => Math.abs(r.avgBp)));
  const cols = listed.length > 40 ? 5 : listed.length > 18 ? 4 : 3;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1fr_660px] gap-6 px-8 py-5">
      {/* Every company. */}
      <section className="grid min-h-0 content-start gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} data-testid="live-prices">
        {listed.length === 0 ? (
          <p className="mx-panel col-span-full rounded-2xl bg-ink px-12 py-10 text-[44px] font-bold">The companies are listed at the IPO.</p>
        ) : (
          listed.map((c) => {
            const p = priceNow(c.id, c.closing_price ?? c.market_price);
            const bp = bpOf(c.ipo_price, p);
            const steps = candlesOf(c.id, c.market_price).map((k) => k.close);
            return (
              <div key={c.id} className="mx-panel flex items-center justify-between gap-3 rounded-lg bg-ink px-3 py-1.5" data-testid={`live-tile-${c.ticker}`}>
                <div className="min-w-0">
                  <p className="font-mono text-[24px] leading-none font-bold text-paper">{c.ticker}</p>
                  <p className="font-mono text-[22px] leading-tight tabular-nums text-phosphor">{p ? money(p) : "—"}</p>
                </div>
                <div className="flex flex-col items-end">
                  <MiniCandles values={steps.slice(-16)} label={`${c.ticker} price steps`} width={84} height={26} />
                  <span className={`font-mono text-[18px] font-bold tabular-nums ${toneText(bp)}`}>{bp === null ? "—" : pctText(bp)}</span>
                </div>
              </div>
            );
          })
        )}
      </section>

      <div className="flex min-h-0 flex-col gap-4">
        {race ? (
          <Box title="SECTOR RACE · SINCE THE IPO">
            <ul className="space-y-2" data-testid="live-race">
              {race.map((r, i) => (
                <li key={r.sector} className="grid grid-cols-[200px_1fr_120px] items-center gap-3 text-[26px]">
                  <span className={`truncate font-bold ${sectorStyle(r.sector).text}`}>
                    {i + 1}. {r.sector}
                  </span>
                  <span className="h-5 rounded bg-raised">
                    <span className={`block h-5 rounded ${r.avgBp >= 0 ? "bg-phosphor" : "bg-danger"}`} style={{ width: `${(Math.abs(r.avgBp) / maxAbs) * 100}%` }} />
                  </span>
                  <span className={`text-right font-mono font-bold tabular-nums ${toneText(r.avgBp)}`}>{pctText(r.avgBp)}</span>
                </li>
              ))}
            </ul>
          </Box>
        ) : null}

        {up.length || down.length ? (
          <Box title={`MOVERS · ROUND ${round?.number ?? ""}`}>
            <div className="grid grid-cols-2 gap-4 text-[26px]" data-testid="live-movers">
              <ul>
                {up.map((m) => (
                  <li key={m.c.id} className="flex justify-between font-mono">
                    <span className="font-bold">▲ {m.c.ticker}</span>
                    <span className="text-phosphor tabular-nums">{pctText(m.bp)}</span>
                  </li>
                ))}
              </ul>
              <ul>
                {down.map((m) => (
                  <li key={m.c.id} className="flex justify-between font-mono">
                    <span className="font-bold">▼ {m.c.ticker}</span>
                    <span className="text-danger-soft tabular-nums">{pctText(m.bp)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Box>
        ) : null}

        {spotlight.length ? <Spotlight companies={spotlight} /> : null}

        {(bulletins.data ?? []).length ? (
          <Box title="LATEST NEWS" className="flex-1 overflow-hidden">
            <ul className="space-y-2" data-testid="live-news">
              {((bulletins.data ?? []) as { id: string; kind: string; title: string; body: string; published_at: string }[]).map((b) => (
                <li key={b.id} className="text-[24px] leading-snug">
                  <span className="font-mono text-muted">{clock(b.published_at)}</span> <b className={b.kind === "FLASH" ? "text-warn" : "text-paper"}>{b.title}</b>
                  <span className="block truncate text-[20px] text-muted">{b.body}</span>
                </li>
              ))}
            </ul>
          </Box>
        ) : null}
      </div>
    </div>
  );
}
