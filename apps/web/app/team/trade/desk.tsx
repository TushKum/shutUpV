"use client";

// The order screen's chart, beside the ticket: pick a company (the ticket follows the pick), read its candles (each
// trading round's real high and low, crisis and score moves marked as their own candles), the candlestick patterns,
// and, while a round is open, its live indicative candle, read every 5 seconds.

import { useEffect, useMemo, useState } from "react";
import type { OrderContext } from "@msim/engine";
import type { ActionResult } from "@/lib/rpc";
import type { Candle } from "@/lib/chart";
import { liveCandle, type RangeRow } from "@/lib/team/trade-candles";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { money } from "@/lib/format";
import { TradingChart } from "@/components/ui/trading-chart";
import { Countdown } from "@/components/ui/countdown";
import { Panel } from "@/components/ui/ui";
import { OrderTicket } from "./ticket";

export interface DeskCompany {
  id: string;
  ticker: string;
  name: string | null;
  price: number;
}

export function TradeDesk({
  companies,
  candles,
  openRound,
  initialRanges,
  ticket,
  embedded = false,
}: {
  companies: DeskCompany[];
  candles: Record<string, Candle[]>;
  openRound: { id: string; number: number } | null;
  initialRanges: RangeRow[];
  embedded?: boolean;
  /** The order ticket while a round accepts orders (it trades the company picked on the chart). */
  ticket: {
    ctx: OrderContext;
    round: { number: number; closesAt: string };
    action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
    ownTicker: string | null;
  } | null;
}) {
  const [picked, setPicked] = useState(companies[0]?.id ?? "");
  const [snapshot, setSnapshot] = useState<{ roundId: string; ranges: RangeRow[] }>();
  const roundId = openRound?.id ?? null;
  const ranges = roundId && snapshot?.roundId === roundId
    ? snapshot.ranges
    : roundId ? initialRanges.filter((range) => range.round_id === roundId) : [];

  useEffect(() => {
    if (!roundId) return;
    const sb = supabaseBrowser();
    let stop = false;
    const read = async () => {
      const { data } = await sb.from("round_ranges").select("round_id, company_id, open_cents, high_cents, low_cents, last_cents").eq("round_id", roundId);
      if (!stop && data) setSnapshot({ roundId, ranges: data as RangeRow[] });
    };
    void read();
    const t = setInterval(read, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [roundId]);

  const company = companies.find((c) => c.id === picked) ?? companies[0] ?? null;
  const live = openRound && company ? liveCandle(openRound.number, company.price, ranges.find((r) => r.company_id === company.id) ?? null) : null;
  const shown = useMemo(() => {
    const past = company ? (candles[company.id] ?? []) : [];
    return live ? [...past, live] : past;
  }, [company, candles, live]);
  const indicative = (id: string) => {
    const r = ranges.find((x) => x.company_id === id);
    return r ? Number(r.last_cents) : null;
  };

  if (!company) return null;
  const now = live ? live.close : company.price;
  const move = now - company.price;

  return (
    // Laptop screens: the chart and the ticket use the full width of the window, not the team pages' reading column.
    <div
      className={`${embedded ? "min-w-0" : "relative left-1/2 w-[calc(100vw-3rem)] max-w-[1700px] -translate-x-1/2"} ${ticket ? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]" : ""}`}
    >
      <section className={embedded ? "min-w-0" : "min-w-0 rounded-md bg-panel p-3 ring-1 ring-inset ring-line"} data-testid="trade-chart-panel">
        {embedded ? (
          <label className="mb-3 flex flex-wrap items-center gap-2 text-sm text-paper">
            Company chart
            <select value={company.id} onChange={(event) => setPicked(event.target.value)}
              className="max-w-full rounded border border-line px-2 py-1 font-mono text-sm">
              {companies.map((c) => <option key={c.id} value={c.id}>{c.ticker} · {c.name}</option>)}
            </select>
          </label>
        ) : <div className="mb-2 flex flex-wrap gap-1" role="tablist" aria-label="Company chart">
          {companies.map((c) => {
            const ind = indicative(c.id);
            const d = ind !== null ? ind - c.price : 0;
            return (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={c.id === company.id}
                onClick={() => setPicked(c.id)}
                data-testid={`chart-pick-${c.ticker}`}
                className={`rounded px-2 py-1 font-mono text-xs ring-1 ring-inset ${c.id === company.id ? "bg-phosphor-deep text-phosphor ring-phosphor-dim" : "text-paper ring-line hover:bg-raised"}`}
              >
                {c.ticker} {money(ind ?? c.price)}
                {d !== 0 ? <span className={d > 0 ? "text-phosphor" : "text-danger-soft"}> {d > 0 ? "▲" : "▼"}</span> : null}
              </button>
            );
          })}
        </div>}
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-mono text-base font-semibold text-paper">
            {company.ticker} <span className="text-sm font-normal text-muted">{company.name}</span>
          </h2>
          {live ? (
            <span className="text-sm" data-testid="indicative-price">
              <span className="text-muted">Round {openRound!.number} would clear at </span>
              <b className="font-mono text-phosphor">{money(now)}</b>
              <span className={move > 0 ? "text-phosphor" : move < 0 ? "text-danger-soft" : "text-muted"}>
                {" "}
                ({move >= 0 ? "+" : "−"}
                {((Math.abs(move) / company.price) * 100).toFixed(1)}%)
              </span>
              <span className="text-muted"> if no other order came</span>
            </span>
          ) : (
            <span className="font-mono text-sm text-phosphor">{money(company.price)}</span>
          )}
        </div>
        <TradingChart candles={shown} label={`${company.ticker} price`} testId="trade-chart" live={!!live} average={3} note="One candle per price step: each trading round, the IPO, crises and score moves" />
      </section>
      {ticket ? (
        <Panel
          className="lg:self-start"
          title={`Order ticket · round ${ticket.round.number}`}
          actions={
            <span className="text-sm text-paper">
              closes in <Countdown to={ticket.round.closesAt} passed="now" className="font-semibold text-phosphor" />
            </span>
          }
        >
          <OrderTicket ctx={ticket.ctx} companies={companies} round={ticket.round} action={ticket.action} picked={company.id} onPick={setPicked} />
          {ticket.ownTicker ? (
            <p className="mt-3 text-xs text-muted">
              Your squad&apos;s company, {ticket.ownTicker}, is not listed: a fund never trades its own squad&apos;s company.
            </p>
          ) : null}
        </Panel>
      ) : null}
    </div>
  );
}
