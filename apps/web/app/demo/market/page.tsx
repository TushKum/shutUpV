"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MarketHeatmap, type HeatmapQuote } from "@/components/ui/market-heatmap";
import { TradingChart } from "@/components/ui/trading-chart";
import { bp } from "@/lib/format";
import { useDemoTrack } from "../ui";
import { SEED_TICKERS } from "../finance/_desk/data/seedData";
import { followPaperQuotes } from "../finance/_desk/data/paper-quotes";
import { FINANCE_ROUTES } from "../finance/_desk/routes";
import { CANDLE_PRICE_SCALE } from "../finance/_desk/utils/candles";
import { formatCurrency } from "../finance/_desk/utils/tradingEngine";
import "../finance/finance.css";

const eventSymbols = ["FRPK", "QAAC", "NOVA", "GRID", "MINT", "LUMA", "VITA", "ORBI"];
const displayTicker = (symbol: string) => eventSymbols.includes(symbol.replace(/-V$/, "")) ? symbol.replace(/-V$/, "") : symbol;

export default function Market() {
  const [track] = useDemoTrack();
  const [tickers, setTickers] = useState(SEED_TICKERS);
  useEffect(() => followPaperQuotes(setTickers), []);
  const [selected, setSelected] = useState("NOVA");
  const quote = useRef<HTMLDialogElement>(null);
  const chart = useRef<HTMLElement>(null);
  const companies: HeatmapQuote[] = tickers.map((ticker) => ({
    ticker: displayTicker(ticker.symbol), name: ticker.name,
    tag: ticker.symbol === "FRPK-V" ? "Built by you" : ticker.symbol === "QAAC-V" ? "Rescued by you" : ticker.sector,
    price: formatCurrency(ticker.price, ticker.price < 2 ? 3 : 2),
    moveBp: Math.round(ticker.changePct24h * 100),
  })).sort((a, b) => (eventSymbols.includes(b.ticker) ? 1 : 0) - (eventSymbols.includes(a.ticker) ? 1 : 0));
  const company = companies.find(({ ticker }) => ticker === selected) ?? companies[0]!;
  const instrument = tickers.find(({ symbol }) => displayTicker(symbol) === company.ticker) ?? tickers[0]!;
  const canTrade = track === "FINANCE";

  return (
    <div className="market-board market-type space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-line pb-4">
        <div>
          <h1 className="text-[clamp(2rem,4vw,3.25rem)] leading-none font-semibold tracking-tight">Market</h1>
          <p className="mt-2 text-sm text-muted">Simulated prices from the Finance desk in this browser.</p>
        </div>
        <p className="text-sm text-muted">Score reveal planned for <time dateTime="02:45+05:30" className="font-semibold text-paper">02:45 IST</time></p>
      </header>
      <section ref={chart} tabIndex={-1} aria-labelledby="market-chart-title" className="market-chart scroll-mt-24">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <h2 id="market-chart-title" className="text-xl font-semibold">Candlestick chart</h2>
            <p className="mt-1 text-2xl leading-tight font-semibold text-paper">{company.price} <span className="text-sm font-medium text-muted">{bp(company.moveBp)}</span></p>
          </div>
          <label className="grid w-full max-w-xs gap-1 text-sm font-medium text-paper">
            Chart instrument
            <select className="w-full min-w-0 text-sm" value={company.ticker} onChange={(event) => setSelected(event.target.value)}>
              {companies.map((listing) => <option key={listing.ticker} value={listing.ticker}>{listing.ticker} · {listing.name}</option>)}
            </select>
          </label>
        </header>
        <div className="finance-candles">
          <TradingChart key={instrument.symbol} label={`${company.ticker} market price`} testId="market-candles"
            candles={instrument.candles.map((candle, index) => ({ ...candle, label: `Bar ${index + 1}` }))}
            format={(value) => formatCurrency(value / CANDLE_PRICE_SCALE, instrument.price < 2 ? 3 : 2)}
            average={5} slowAverage={10} colorVolume patterns={false} />
        </div>
      </section>
      <section aria-labelledby="market-heatmap-title">
        <h2 id="market-heatmap-title" className="mb-3 text-xl font-semibold">Market heatmap</h2>
        <MarketHeatmap quotes={companies} selected={selected} opensDialog onSelect={(ticker) => {
          setSelected(ticker);
          quote.current?.showModal();
        }} />
      </section>
      <dialog ref={quote} aria-labelledby="market-snapshot-quote" className="market-chart fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-md overflow-auto text-paper backdrop:bg-black/75">
        <h2 id="market-snapshot-quote" className="text-xl font-semibold">{company.ticker} · {company.name}</h2>
        <p className="mt-1 text-sm text-muted">{company.tag} · Simulated quote</p>
        <dl className="mt-4 grid grid-cols-2 gap-4 border-y border-line py-4">
          <div><dt className="text-sm text-muted">Last price</dt><dd className="text-xl font-semibold">{company.price}</dd></div>
          <div><dt className="text-sm text-muted">Price change</dt><dd className="text-xl font-semibold">{bp(company.moveBp)}</dd></div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="market-action" onClick={() => {
            quote.current?.close();
            chart.current?.focus();
          }}>View candlestick chart</button>
          <button type="button" className="market-action" onClick={() => quote.current?.close()}>Close quote</button>
        </div>
      </dialog>
      <div className="space-y-4 border-t border-line pt-2 text-sm">
        <details>
          <summary className="min-h-11 content-center font-semibold">Price mechanics</summary>
          <ul className="space-y-2 pb-2 text-muted">
            <li>Starting share price = $10.00 + $0.10 × (PRD score − 50).</li>
            <li>At the crisis, every price falls by 15%.</li>
            <li>At the rescue score reveal, price × (1 + 0.5% × (crisis score − 50)).</li>
          </ul>
        </details>
        {canTrade && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted">Event trading opens in Round 3. Your built and rescued companies are excluded.</p>
            <Link className="market-action inline-flex items-center" href={FINANCE_ROUTES.markets}>Open Finance trading desk</Link>
          </div>
        )}
      </div>
    </div>
  );
}
