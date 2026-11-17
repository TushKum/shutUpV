// The real market as candles, for the order screen: one candle per price step of each company (the IPO, every trading
// round, each crisis shock and score move), with the trading rounds' real highs and lows (round_ranges: the indicative
// price as orders came in), the shares traded as volume, and, while a round is open, a live candle for it (open: the
// price the round started at; high, low and close: the indicative price so far).

import type { Candle } from "@/lib/chart";

export interface StepRow {
  company_id: string;
  kind: string;
  round_id: string | null;
  market_before: number | null;
  market_after: number;
  buy_qty: number | null;
  sell_qty: number | null;
  short_qty: number | null;
  cover_qty: number | null;
}

export interface RangeRow {
  round_id: string;
  company_id: string;
  open_cents: number;
  high_cents: number;
  low_cents: number;
  last_cents: number;
}

const KIND_LABEL: Record<string, string> = {
  IPO: "IPO",
  CRISIS: "Crisis",
  PLAN_TIER: "Plan score",
  FLASH_TIER: "Flash",
  CLOSE: "Close",
  APPEAL: "Appeal",
};

/** One company's candles, in step order (the rows are in id order). */
export function tradeCandles(rows: readonly StepRow[], ranges: readonly RangeRow[], roundNumber: (id: string) => number | null): Candle[] {
  const range = new Map(ranges.map((r) => [r.round_id, r]));
  const out: Candle[] = [];
  let prev: number | null = null;
  for (const r of rows) {
    const open = Number(r.market_before ?? prev ?? r.market_after);
    const close = Number(r.market_after);
    const g = r.round_id && r.kind === "CLEARING" ? range.get(r.round_id) : undefined;
    const n = r.round_id ? roundNumber(r.round_id) : null;
    const volume = Number(r.buy_qty ?? 0) + Number(r.sell_qty ?? 0) + Number(r.short_qty ?? 0) + Number(r.cover_qty ?? 0);
    out.push({
      label: r.kind === "CLEARING" ? `Round ${n ?? "?"}` : (KIND_LABEL[r.kind] ?? r.kind),
      open,
      close,
      high: Math.max(open, close, g ? Number(g.high_cents) : close),
      low: Math.min(open, close, g ? Number(g.low_cents) : close),
      volume: volume || null,
    });
    prev = close;
  }
  return out;
}

/** The open round's live candle, or null when nothing has been ordered in it yet (it opens at the current price). */
export function liveCandle(roundNo: number, current: number, range: RangeRow | null): Candle {
  if (!range) return { label: `Round ${roundNo} (now)`, open: current, close: current, high: current, low: current };
  return {
    label: `Round ${roundNo} (now)`,
    open: Number(range.open_cents),
    close: Number(range.last_cents),
    high: Math.max(Number(range.high_cents), Number(range.open_cents)),
    low: Math.min(Number(range.low_cents), Number(range.open_cents)),
  };
}
