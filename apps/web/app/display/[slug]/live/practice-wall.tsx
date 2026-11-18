"use client";

// Round 1 on the live wall: the Finance teams' practice market moving live. Every ticker's price and its move since
// the open, and a spotlight chart changing every 15 seconds through the biggest movers. Ticks are read every 5
// seconds (only ticks whose time has come are readable).

import { useCallback, useEffect, useMemo, useState } from "react";
import { candlesFromTicks, PRACTICE } from "@msim/engine";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { money } from "@/lib/format";
import { TradingChart } from "@/components/ui/trading-chart";

const BOX = { width: 1180, height: 400, padLeft: 80, padRight: 96, padTop: 16, padBottom: 10 };

export function PracticeWall({
  eventId,
  tickers,
  startsAt,
  tickSeconds,
  steps,
}: {
  eventId: string;
  tickers: { id: string; code: string }[];
  startsAt: string;
  tickSeconds: number;
  steps: number;
}) {
  const [latest, setLatest] = useState<Record<string, number>>({});
  const [opening, setOpening] = useState<Record<string, number>>({});
  const [series, setSeries] = useState<{ id: string; prices: number[]; first: number } | null>(null);
  const [turn, setTurn] = useState(0);
  const start = new Date(startsAt).getTime();
  const per = PRACTICE.candleTicks;
  const code = useMemo(() => new Map(tickers.map((t) => [t.id, t.code])), [tickers]);

  const read = useCallback(async () => {
    const sb = supabaseBrowser();
    const k = Math.max(0, Math.min(steps - 1, Math.floor((Date.now() - start) / (tickSeconds * 1000))));
    const [now, open] = await Promise.all([
      sb.from("practice_ticks").select("ticker_team_id, step, price_cents").eq("event_id", eventId).in("step", [Math.max(0, k - 1), k]),
      Object.keys(opening).length ? Promise.resolve(null) : sb.from("practice_ticks").select("ticker_team_id, price_cents").eq("event_id", eventId).eq("step", 0),
    ]);
    if (now.data) {
      const best: Record<string, { step: number; price: number }> = {};
      for (const r of now.data as { ticker_team_id: string; step: number; price_cents: number }[]) {
        if (!best[r.ticker_team_id] || best[r.ticker_team_id]!.step < r.step) best[r.ticker_team_id] = { step: r.step, price: r.price_cents };
      }
      setLatest(Object.fromEntries(Object.entries(best).map(([id, v]) => [id, v.price])));
    }
    if (open?.data) setOpening(Object.fromEntries((open.data as { ticker_team_id: string; price_cents: number }[]).map((r) => [r.ticker_team_id, r.price_cents])));
  }, [eventId, opening, start, steps, tickSeconds]);

  useEffect(() => {
    const first = setTimeout(read, 0);
    const t = setInterval(read, tickSeconds * 1000);
    const r = setInterval(() => setTurn((x) => x + 1), 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      clearInterval(r);
    };
  }, [read, tickSeconds]);

  const change = (id: string) => (latest[id] && opening[id] ? ((latest[id]! - opening[id]!) / opening[id]!) * 100 : 0);
  const movers = useMemo(() => [...tickers].sort((a, b) => Math.abs(change(b.id)) - Math.abs(change(a.id))).slice(0, 8), [tickers, latest, opening]); // eslint-disable-line react-hooks/exhaustive-deps
  const focus = movers.length ? movers[turn % movers.length]!.id : (tickers[0]?.id ?? null);

  // The spotlight's ticks: the last 40 candles of the focused ticker, re-read with the prices.
  useEffect(() => {
    if (!focus) return;
    let stop = false;
    const load = async () => {
      const k = Math.max(0, Math.floor((Date.now() - start) / (tickSeconds * 1000)));
      const from = Math.max(0, Math.floor(k / per) * per - 40 * per);
      const { data } = await supabaseBrowser().from("practice_ticks").select("step, price_cents").eq("ticker_team_id", focus).gte("step", from).order("step").limit(1000);
      if (!stop && data) setSeries({ id: focus, prices: (data as { price_cents: number }[]).map((r) => r.price_cents), first: from });
    };
    const first = setTimeout(load, 0);
    const t = setInterval(load, tickSeconds * 1000);
    return () => {
      stop = true;
      clearTimeout(first);
      clearInterval(t);
    };
  }, [focus, start, tickSeconds, per]);

  const candles = useMemo(
    () =>
      series && series.id === focus
        ? candlesFromTicks(series.prices, per).map((c, i) => ({
            label: new Date(start + (series.first + i * per) * tickSeconds * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
            ...c,
          }))
        : [],
    [series, focus, per, start, tickSeconds],
  );

  return (
    <div className="flex min-h-0 flex-col gap-4" data-testid="live-practice">
      <section className="mx-panel rounded-xl bg-ink px-5 py-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-mono text-[24px] font-bold tracking-wide text-phosphor-mid">PRACTICE MARKET · LIVE</h2>
          <p className="font-mono text-[30px] font-bold text-paper">
            {focus ? code.get(focus) : ""} <span className="text-phosphor">{focus && latest[focus] ? money(latest[focus]!) : ""}</span>
          </p>
        </div>
        <TradingChart candles={candles} label="Practice price" box={BOX} live average={5} patternList={false} fontSize={18} />
      </section>
      <section className="grid min-h-0 grid-cols-10 content-start gap-1.5" data-testid="live-practice-tickers">
        {tickers.map((t) => {
          const ch = change(t.id);
          return (
            <div key={t.id} className={`mx-panel rounded-md bg-ink px-2 py-1 ${t.id === focus ? "ring-2 ring-phosphor" : ""}`}>
              <p className="font-mono text-[18px] leading-none font-bold text-paper">{t.code}</p>
              <p className="font-mono text-[17px] leading-tight tabular-nums text-phosphor">{latest[t.id] ? money(latest[t.id]!) : "—"}</p>
              <p className={`font-mono text-[15px] leading-none font-bold tabular-nums ${ch > 0 ? "text-phosphor" : ch < 0 ? "text-danger-soft" : "text-muted"}`}>
                {ch >= 0 ? "+" : ""}
                {ch.toFixed(1)}%
              </p>
            </div>
          );
        })}
      </section>
    </div>
  );
}
