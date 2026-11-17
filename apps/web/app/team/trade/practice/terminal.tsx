"use client";

// The practice trading terminal (laptop layout): the 50 tickers with their live price and move since the open, the
// selected ticker's 30-second candles (live, with the crosshair and pattern markers), and the order panel with the
// fund's practice cash, positions, profit and the edge it would carry into the real market. Prices tick every 5
// seconds; the page reads the newest tick for every ticker, and the selected ticker's new ticks, every 5 seconds.
// Trades go straight to the database function (practice_trade), which checks everything and fills at the latest
// price.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { candlesFromTicks, practiceEdge, PRACTICE, type OrderType } from "@msim/engine";
import type { Candle } from "@/lib/chart";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { count, money } from "@/lib/format";
import { TradingChart } from "@/components/ui/trading-chart";
import type { PracticeTicker } from "@/lib/team/practice";

const WINDOW_CANDLES = 60;

interface Position {
  ticker_team_id: string;
  qty: number;
}
interface Trade {
  id: number;
  ticker_team_id: string;
  type: OrderType;
  qty: number;
  price_cents: number;
  created_at: string;
}

export function PracticeTerminal({
  eventId,
  teamId,
  tickers,
  startsAt,
  tickSeconds,
  steps,
  serverNow,
  initialStep,
  paused,
}: {
  eventId: string;
  teamId: string;
  tickers: PracticeTicker[];
  startsAt: string;
  tickSeconds: number;
  steps: number;
  serverNow: string;
  /** The tick the server was at when it rendered the page. */
  initialStep: number;
  paused: boolean;
}) {
  const sb = supabaseBrowser();
  // The server's clock minus this laptop's, measured once on mount (ticks are timed by the server).
  const offset = useRef(0);
  const start = new Date(startsAt).getTime();
  const tickMs = tickSeconds * 1000;
  const per = PRACTICE.candleTicks;
  const stepNow = useCallback(() => Math.max(0, Math.min(steps - 1, Math.floor((Date.now() + offset.current - start) / tickMs))), [start, tickMs, steps]);

  const [selected, setSelected] = useState(tickers[0]?.id ?? "");
  const [latest, setLatest] = useState<Record<string, number>>({});
  const [opening, setOpening] = useState<Record<string, number>>({});
  const [series, setSeries] = useState<Record<string, { steps: number[]; prices: number[] }>>({});
  const [cash, setCash] = useState<number>(PRACTICE.startCents);
  const [positions, setPositions] = useState<Position[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [qty, setQty] = useState("100");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState("");
  const [step, setStep] = useState(initialStep);
  const known = useRef<Record<string, number>>({});

  const byId = useMemo(() => new Map(tickers.map((t) => [t.id, t])), [tickers]);

  // Every ticker's newest price (and, once, its opening price).
  const readPrices = useCallback(async () => {
    const k = stepNow();
    const { data } = await sb
      .from("practice_ticks")
      .select("ticker_team_id, step, price_cents")
      .eq("event_id", eventId)
      .in("step", [Math.max(0, k - 1), k]);
    if (!data) return;
    const next: Record<string, { step: number; price: number }> = {};
    for (const r of data as { ticker_team_id: string; step: number; price_cents: number }[]) {
      if (!next[r.ticker_team_id] || next[r.ticker_team_id]!.step < r.step) next[r.ticker_team_id] = { step: r.step, price: r.price_cents };
    }
    setLatest((old) => ({ ...old, ...Object.fromEntries(Object.entries(next).map(([id, v]) => [id, v.price])) }));
  }, [sb, eventId, stepNow]);

  // The selected ticker's ticks: the last half hour once, then only the new ones.
  const readSeries = useCallback(
    async (id: string) => {
      const last = known.current[id];
      const from = last !== undefined ? last + 1 : Math.max(0, Math.floor(stepNow() / per) * per - WINDOW_CANDLES * per);
      const { data } = await sb
        .from("practice_ticks")
        .select("step, price_cents")
        .eq("ticker_team_id", id)
        .gte("step", from)
        .order("step")
        .limit(1000);
      if (!data || data.length === 0) return;
      const rows = data as { step: number; price_cents: number }[];
      known.current[id] = rows.at(-1)!.step;
      setSeries((old) => {
        const cur = old[id] ?? { steps: [], prices: [] };
        const s = [...cur.steps];
        const p = [...cur.prices];
        for (const r of rows) {
          if (s.length && r.step <= s.at(-1)!) continue;
          s.push(r.step);
          p.push(r.price_cents);
        }
        return { ...old, [id]: { steps: s.slice(-WINDOW_CANDLES * per - per), prices: p.slice(-WINDOW_CANDLES * per - per) } };
      });
    },
    [sb, stepNow, per],
  );

  const readAccount = useCallback(async () => {
    const [a, p, t] = await Promise.all([
      sb.from("practice_accounts").select("cash_cents").eq("team_id", teamId).maybeSingle(),
      sb.from("practice_positions").select("ticker_team_id, qty").eq("team_id", teamId),
      sb.from("practice_trades").select("id, ticker_team_id, type, qty, price_cents, created_at").eq("team_id", teamId).order("id", { ascending: false }).limit(12),
    ]);
    if (a.data) setCash(Number((a.data as { cash_cents: number | string }).cash_cents));
    if (p.data) setPositions(p.data as Position[]);
    if (t.data) setTrades(t.data as Trade[]);
  }, [sb, teamId]);

  const readOpening = useCallback(async () => {
    const { data } = await sb.from("practice_ticks").select("ticker_team_id, price_cents").eq("event_id", eventId).eq("step", 0);
    if (data) setOpening(Object.fromEntries((data as { ticker_team_id: string; price_cents: number }[]).map((r) => [r.ticker_team_id, r.price_cents])));
  }, [sb, eventId]);

  // The 5-second heartbeat, just after each tick (the first beat also reads the opening prices and the account).
  useEffect(() => {
    offset.current = new Date(serverNow).getTime() - Date.now();
  }, [serverNow]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let first = true;
    const beat = async () => {
      await Promise.all([readPrices(), readSeries(selected), ...(first ? [readOpening(), readAccount()] : [])]);
      first = false;
      setStep(stepNow());
      const now = Date.now() + offset.current;
      const wait = tickMs - ((now - start) % tickMs) + 250;
      timer = setTimeout(beat, Math.max(500, wait));
    };
    timer = setTimeout(beat, 0);
    return () => clearTimeout(timer);
  }, [readPrices, readSeries, readOpening, readAccount, stepNow, selected, tickMs, start]);

  const sel = byId.get(selected);
  const s = series[selected];
  const candles: Candle[] = useMemo(() => {
    if (!s || s.steps.length === 0) return [];
    // Align to candle boundaries (a candle is `per` ticks from a multiple of `per`).
    const firstFull = s.steps.findIndex((st) => st % per === 0);
    if (firstFull < 0) return [];
    const st = s.steps.slice(firstFull);
    const pr = s.prices.slice(firstFull);
    return candlesFromTicks(pr, per).map((c, i) => ({
      label: new Date(start + st[i * per]! * tickMs).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
  }, [s, per, start, tickMs]);

  const posOf = (id: string) => positions.find((p) => p.ticker_team_id === id)?.qty ?? 0;
  const equity = cash + positions.reduce((sum, p) => sum + p.qty * (latest[p.ticker_team_id] ?? 0), 0);
  const shortValue = positions.reduce((sum, p) => sum + (p.qty < 0 ? -p.qty * (latest[p.ticker_team_id] ?? 0) : 0), 0);
  const free = cash - Math.ceil(shortValue * PRACTICE.shortCollateral);
  const price = latest[selected] ?? null;
  const pos = posOf(selected);
  const n = Number.parseInt(qty.replace(/[ ,]/g, ""), 10);
  const maxFor = (type: OrderType) => {
    if (!price) return 0;
    if (type === "BUY") return Math.max(0, Math.min(PRACTICE.maxLong - Math.max(pos, 0), Math.floor(free / price)));
    if (type === "SELL") return Math.max(0, pos);
    if (type === "SHORT") return Math.max(0, Math.min(PRACTICE.maxShort + Math.min(pos, 0), Math.floor(free / (price * (PRACTICE.shortCollateral - 1)))));
    return Math.max(0, -pos);
  };

  async function trade(type: OrderType) {
    if (!sel || !Number.isFinite(n) || n < 1) {
      setMessage({ ok: false, text: "Enter a number of shares." });
      return;
    }
    setBusy(true);
    setMessage(null);
    const { data, error } = await sb.rpc("practice_trade", { p_ticker: selected, p_type: type, p_qty: n });
    setBusy(false);
    const r = data as { ok?: boolean; message?: string; price?: number } | null;
    if (error || !r?.ok) {
      setMessage({ ok: false, text: r?.message ?? error?.message ?? "Refused." });
    } else {
      setMessage({ ok: true, text: `${type} ${count(n)} ${sel.code} at ${money(r.price ?? 0)}.` });
      await readAccount();
    }
  }

  const left = Math.max(0, steps - 1 - step);
  const shown = tickers.filter((t) => !filter || `${t.code} ${t.name}`.toLowerCase().includes(filter.toLowerCase()));
  const profit = equity - PRACTICE.startCents;

  return (
    // Laptop screens: the terminal uses the full width of the window, not the team pages' reading column.
    <div className="relative left-1/2 w-[calc(100vw-3rem)] max-w-[1700px] -translate-x-1/2 space-y-3" data-testid="practice-terminal">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold text-phosphor">Practice market · Round 1</h1>
        <p className="text-sm text-muted">
          A candle every {tickSeconds * per} s, a price every {tickSeconds} s. Your profit (up to {money(PRACTICE.edgeCapCents)}) is added to your real fund when
          Round 1 ends; a loss costs nothing.
        </p>
      </div>
      {paused ? <p className="rounded-md bg-panel px-3 py-2 text-sm text-warn ring-1 ring-inset ring-warn/60">The event is paused: trading is stopped.</p> : null}

      <div className="grid grid-cols-[230px_minmax(0,1fr)_290px] gap-3">
        {/* Tickers */}
        <section className="flex max-h-[720px] flex-col rounded-md bg-panel ring-1 ring-inset ring-line">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find a company"
            aria-label="Find a company"
            className="m-2 rounded border border-phosphor-dim bg-transparent px-2 py-1 text-sm"
          />
          <ul className="flex-1 overflow-y-auto text-sm" data-testid="practice-tickers">
            {shown.map((t) => {
              const p = latest[t.id];
              const o = opening[t.id];
              const ch = p && o ? ((p - o) / o) * 100 : 0;
              const held = posOf(t.id);
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(t.id)}
                    data-testid={`ticker-${t.code}`}
                    className={`flex w-full items-center justify-between gap-2 px-2 py-1 text-left hover:bg-raised ${t.id === selected ? "bg-raised text-phosphor" : "text-paper"}`}
                  >
                    <span className="min-w-0">
                      <span className="font-mono font-semibold">{t.code}</span>
                      {held ? <span className={`ml-1 text-xs ${held > 0 ? "text-phosphor" : "text-warn"}`}>{held > 0 ? `+${held}` : held}</span> : null}
                      <span className="block truncate text-xs text-muted">{t.name}</span>
                    </span>
                    <span className="text-right font-mono text-xs">
                      {p ? money(p) : "—"}
                      <span className={`block ${ch > 0 ? "text-phosphor" : ch < 0 ? "text-danger-soft" : "text-muted"}`}>
                        {ch >= 0 ? "+" : ""}
                        {ch.toFixed(1)}%
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Chart */}
        <section className="rounded-md bg-panel p-3 ring-1 ring-inset ring-line">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="font-mono text-base font-semibold text-paper">
              {sel?.code} <span className="text-sm font-normal text-muted">{sel?.name}</span>
            </h2>
            <span className="font-mono text-lg text-phosphor" data-testid="practice-price">
              {price ? money(price) : "—"}
            </span>
          </div>
          <TradingChart candles={candles} label={`${sel?.code ?? ""} practice price`} testId="practice-chart" live average={5} note="30-second candles" />
        </section>

        {/* Order panel and account */}
        <section className="space-y-3">
          <div className="rounded-md bg-panel p-3 ring-1 ring-inset ring-line">
            <h2 className="mb-2 text-sm font-semibold text-paper">
              Trade {sel?.code} <span className="font-normal text-muted">· you hold {pos > 0 ? `${count(pos)} long` : pos < 0 ? `${count(-pos)} short` : "none"}</span>
            </h2>
            <label className="block text-xs text-muted" htmlFor="practice-qty">
              Shares
            </label>
            <input
              id="practice-qty"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              inputMode="numeric"
              className="mt-1 w-full rounded border border-phosphor-dim bg-transparent px-2 py-1.5 font-mono text-sm"
            />
            <div className="mt-2 flex gap-1 text-xs">
              {[100, 500, 1000, 2000].map((v) => (
                <button key={v} type="button" onClick={() => setQty(String(v))} className="rounded bg-raised px-2 py-1 text-paper hover:text-phosphor">
                  {count(v)}
                </button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(["BUY", "SELL", "SHORT", "COVER"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  disabled={busy || paused || left === 0}
                  onClick={() => trade(type)}
                  data-testid={`practice-${type}`}
                  className={`rounded-md px-3 py-2 text-sm font-semibold ring-1 ring-inset disabled:opacity-40 ${
                    type === "BUY" || type === "COVER" ? "text-phosphor ring-phosphor-dim hover:bg-phosphor-deep" : "text-danger-soft ring-danger/70 hover:bg-red-950/40"
                  }`}
                >
                  {type}
                  <span className="block text-[10px] font-normal text-muted">max {count(maxFor(type))}</span>
                </button>
              ))}
            </div>
            {message ? (
              <p className={`mt-2 text-xs ${message.ok ? "text-phosphor" : "text-danger-soft"}`} role="status" data-testid="practice-message">
                {message.text}
              </p>
            ) : null}
          </div>

          <div className="rounded-md bg-panel p-3 text-sm ring-1 ring-inset ring-line" data-testid="practice-account">
            <dl className="grid grid-cols-2 gap-y-1 font-mono text-xs">
              <dt className="text-muted">Cash</dt>
              <dd className="text-right">{money(cash)}</dd>
              <dt className="text-muted">Fund value</dt>
              <dd className="text-right text-paper">{money(equity)}</dd>
              <dt className="text-muted">Profit</dt>
              <dd className={`text-right ${profit >= 0 ? "text-phosphor" : "text-danger-soft"}`} data-testid="practice-profit">
                {profit >= 0 ? "+" : "−"}
                {money(Math.abs(profit))}
              </dd>
              <dt className="text-muted">Edge for the IPO</dt>
              <dd className="text-right text-phosphor" data-testid="practice-edge">
                +{money(practiceEdge(equity))}
              </dd>
            </dl>
            {positions.some((p) => p.qty !== 0) ? (
              <table className="mt-2 w-full text-xs">
                <tbody>
                  {positions
                    .filter((p) => p.qty !== 0)
                    .map((p) => (
                      <tr key={p.ticker_team_id}>
                        <td>
                          <button type="button" className="font-mono hover:text-phosphor" onClick={() => setSelected(p.ticker_team_id)}>
                            {byId.get(p.ticker_team_id)?.code}
                          </button>
                        </td>
                        <td className={`text-right font-mono ${p.qty > 0 ? "text-phosphor" : "text-warn"}`}>{p.qty > 0 ? `${count(p.qty)} long` : `${count(-p.qty)} short`}</td>
                        <td className="text-right font-mono">{money(Math.abs(p.qty) * (latest[p.ticker_team_id] ?? 0))}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ) : null}
          </div>

          {trades.length > 0 ? (
            <div className="rounded-md bg-panel p-3 ring-1 ring-inset ring-line">
              <h3 className="mb-1 text-xs font-semibold text-muted">Your trades</h3>
              <ul className="space-y-0.5 font-mono text-xs" data-testid="practice-trades">
                {trades.map((t) => (
                  <li key={t.id}>
                    {new Date(t.created_at).toLocaleTimeString("en-GB")} {t.type} {count(t.qty)} {byId.get(t.ticker_team_id)?.code} @ {money(t.price_cents)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-xs text-muted">
            Practice closes when Round 1 ends. Up to {count(PRACTICE.maxLong)} shares long or{" "}
            {count(PRACTICE.maxShort)} short per company; shorts need 150% cover.
          </p>
        </section>
      </div>
    </div>
  );
}
