import React, { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Download, Search } from 'lucide-react';
import type {
  DeskState,
  EquityPoint,
  EquityTimeframe,
  PortfolioMetrics,
} from '../types/command';
import type { OrderRequest } from '../utils/tradingEngine';
import {
  buildPositionsCsv,
  formatCompactCurrency,
  formatCurrency,
  formatSignedCurrency,
  formatSignedPercent,
} from '../utils/tradingEngine';
import { buildOrderBookForPrice } from '../data/seedData';
import { EquityChart } from './EquityChart';
import { QuickOrderForm } from './QuickOrderForm';
import { Sparkline } from './Sparkline';

interface OverviewScreenProps {
  state: DeskState;
  metrics: PortfolioMetrics;
  equitySeries: Record<EquityTimeframe, EquityPoint[]>;
  onSelectSymbol: (symbol: string) => void;
  onSubmitOrder: (req: OrderRequest) => { ok: boolean; error?: string };
  onNavigateMarkets: () => void;
}

export const OverviewScreen: React.FC<OverviewScreenProps> = ({
  state,
  metrics,
  equitySeries,
  onSelectSymbol,
  onSubmitOrder,
  onNavigateMarkets,
}) => {
  const [tableTab, setTableTab] = useState<'POSITIONS' | 'WATCHLIST'>('POSITIONS');
  const [searchQuery, setSearchQuery] = useState('');

  const tickerMap = useMemo(
    () => new Map(state.tickers.map((t) => [t.symbol, t])),
    [state.tickers],
  );

  const selectedTicker =
    tickerMap.get(state.selectedSymbol) ?? state.tickers[0];

  const orderBook = useMemo(
    () => buildOrderBookForPrice(selectedTicker.price),
    [selectedTicker.price],
  );

  const filteredPositions = state.positions.filter((p) =>
    p.symbol.toLowerCase().includes(searchQuery.trim().toLowerCase()),
  );

  const filteredWatchlist = state.tickers.filter(
    (t) =>
      t.symbol.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
      t.name.toLowerCase().includes(searchQuery.trim().toLowerCase()),
  );

  const handleExportCsv = () => {
    const csv = buildPositionsCsv(state.positions, state.tickers);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'matrix-command-positions.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const navSpark = equitySeries['4H'].map((p) => p.nav);
  const alphaSpark = [11.2, 13.8, 12.6, 16.4, 18.9, 21.1, metrics.totalReturnPct];

  return (
    <div className="space-y-4">
      {/* 4-Column Top KPI Metric Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-[#101715] border border-white/[0.07] rounded-lg p-4 flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D]">
              Portfolio NAV
            </span>
            <span className="font-mono text-[10px] text-[#00D68F]">LIVE</span>
          </div>
          <div className="font-mono text-xl font-semibold text-[#F2F5F3] tabular-nums">
            {formatCurrency(metrics.nav)}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span
              className={`font-mono text-xs tabular-nums flex items-center gap-1 ${
                metrics.totalPnl >= 0 ? 'text-[#00D68F]' : 'text-[#FF5364]'
              }`}
            >
              {metrics.totalPnl >= 0 ? (
                <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <ArrowDownRight className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              {formatSignedPercent(metrics.totalReturnPct)}
            </span>
            <Sparkline values={navSpark} positive={metrics.totalPnl >= 0} />
          </div>
        </div>

        <div className="bg-[#101715] border border-white/[0.07] rounded-lg p-4 flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D]">
              Overnight Alpha
            </span>
            <span className="font-mono text-[10px] text-[#87948D]">NET PNL</span>
          </div>
          <div
            className={`font-mono text-xl font-semibold tabular-nums ${
              metrics.totalPnl >= 0 ? 'text-[#00D68F]' : 'text-[#FF5364]'
            }`}
          >
            {formatSignedCurrency(metrics.totalPnl)}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-[#87948D] tabular-nums">
              Realized {formatSignedCurrency(state.realizedPnl, 0)}
            </span>
            <Sparkline values={alphaSpark} positive={metrics.totalPnl >= 0} />
          </div>
        </div>

        <div className="bg-[#101715] border border-white/[0.07] rounded-lg p-4 flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D]">
              Gross Exposure
            </span>
            <span className="font-mono text-[10px] text-[#87948D]">
              {state.positions.length} POSITIONS
            </span>
          </div>
          <div className="font-mono text-xl font-semibold text-[#F2F5F3] tabular-nums">
            {formatCurrency(metrics.grossExposure, 0)}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-[#BACBB9] tabular-nums">
              Margin {metrics.marginUtilPct.toFixed(1)}%
            </span>
            <div className="w-24 h-1.5 bg-[#070909] rounded-sm overflow-hidden">
              <div
                className="h-full bg-[#00E676] transition-all"
                style={{ width: `${Math.min(100, metrics.marginUtilPct)}%` }}
              />
            </div>
          </div>
        </div>

        <div className="bg-[#101715] border border-white/[0.07] rounded-lg p-4 flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D]">
              Available Cash
            </span>
            <span className="font-mono text-[10px] text-[#00D68F]">2.5X LEVERAGE</span>
          </div>
          <div className="font-mono text-xl font-semibold text-[#F2F5F3] tabular-nums">
            {formatCurrency(state.cash, 0)}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-[#87948D] tabular-nums">
              Buying Power {formatCompactCurrency(metrics.buyingPower)}
            </span>
            <button
              type="button"
              onClick={onNavigateMarkets}
              className="font-mono text-[11px] text-[#00E676] hover:underline whitespace-nowrap"
            >
              Order Book
            </button>
          </div>
        </div>
      </div>

      {/* Main Command Stage: Equity Chart (8 cols) + Quick Order Ticket (4 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
        <div className="xl:col-span-8 flex flex-col">
          <EquityChart seriesByTimeframe={equitySeries} liveNav={metrics.nav} />
        </div>
        <div className="xl:col-span-4 flex flex-col">
          <QuickOrderForm
            tickers={state.tickers}
            selectedSymbol={state.selectedSymbol}
            buyingPower={metrics.buyingPower}
            onSelectSymbol={onSelectSymbol}
            onSubmitOrder={onSubmitOrder}
            compact
          />
        </div>
      </div>

      {/* Secondary Grid: Active Positions/Watchlist (8 cols) + Live Order Book & Tape (4 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <section className="xl:col-span-8 bg-[#101715] border border-white/[0.07] rounded-lg overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-[#1B2420] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 bg-[#0C1110] border border-[#1B2420] p-0.5 rounded">
              <button
                type="button"
                onClick={() => setTableTab('POSITIONS')}
                className={`px-3 py-1.5 rounded-sm font-mono text-xs font-medium transition-colors whitespace-nowrap ${
                  tableTab === 'POSITIONS'
                    ? 'bg-[#151D19] text-[#00E676] border border-[#285D46]'
                    : 'text-[#87948D] hover:text-[#F2F5F3]'
                }`}
              >
                Active Positions ({state.positions.length})
              </button>
              <button
                type="button"
                onClick={() => setTableTab('WATCHLIST')}
                className={`px-3 py-1.5 rounded-sm font-mono text-xs font-medium transition-colors whitespace-nowrap ${
                  tableTab === 'WATCHLIST'
                    ? 'bg-[#151D19] text-[#00E676] border border-[#285D46]'
                    : 'text-[#87948D] hover:text-[#F2F5F3]'
                }`}
              >
                Live Watchlist ({state.tickers.length})
              </button>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search
                  className="w-3.5 h-3.5 text-[#87948D] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter symbol..."
                  aria-label="Filter positions or watchlist"
                  className="h-8 pl-8 pr-3 w-44 bg-[#0C1110] border border-[#1B2420] focus:border-[#00E676] focus:outline-none rounded font-mono text-xs text-[#F2F5F3] placeholder:text-[#87948D]"
                />
              </div>
              <button
                type="button"
                onClick={handleExportCsv}
                className="h-8 px-2.5 bg-[#0C1110] border border-[#1B2420] hover:border-[#285D46] rounded font-mono text-[11px] text-[#BACBB9] hover:text-[#F2F5F3] flex items-center gap-1.5 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>CSV</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            {tableTab === 'POSITIONS' ? (
              filteredPositions.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="font-mono text-xs text-[#87948D]">
                    {searchQuery
                      ? `No positions match "${searchQuery}".`
                      : 'No open positions in book.'}
                  </p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#1B2420] bg-[#0C1110]">
                      <th className="py-2.5 px-4 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D]">
                        Symbol
                      </th>
                      <th className="py-2.5 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D]">
                        Side
                      </th>
                      <th className="py-2.5 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] text-right">
                        Qty
                      </th>
                      <th className="py-2.5 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] text-right">
                        Avg Entry
                      </th>
                      <th className="py-2.5 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] text-right">
                        Mark
                      </th>
                      <th className="py-2.5 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] text-right">
                        Notional
                      </th>
                      <th className="py-2.5 px-4 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] text-right">
                        Unrealized PnL
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPositions.map((pos, idx) => {
                      const t = tickerMap.get(pos.symbol);
                      const mark = t?.price ?? pos.avgEntry;
                      const notional = pos.qty * mark;
                      const pnl =
                        pos.side === 'LONG'
                          ? (mark - pos.avgEntry) * pos.qty
                          : (pos.avgEntry - mark) * pos.qty;
                      const pnlPct =
                        pos.avgEntry > 0
                          ? ((pnl / (pos.avgEntry * pos.qty)) * 100)
                          : 0;
                      const isSelected = state.selectedSymbol === pos.symbol;
                      const flashCls =
                        t?.lastFlash === 'up'
                          ? 'animate-flash-pos'
                          : t?.lastFlash === 'down'
                            ? 'animate-flash-neg'
                            : '';

                      return (
                        <tr
                          key={pos.symbol}
                          onClick={() => onSelectSymbol(pos.symbol)}
                          className={`border-b border-[#1B2420]/70 cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-[#151D19]'
                              : idx % 2 === 0
                                ? 'bg-[#0C1110] hover:bg-[#151D19]/70'
                                : 'bg-[#101715] hover:bg-[#151D19]/70'
                          }`}
                        >
                          <td className="py-2.5 px-4 font-mono text-[13px] font-semibold text-[#F2F5F3] whitespace-nowrap">
                            {pos.symbol}
                            <span className="ml-2 text-[10px] font-normal text-[#87948D]">
                              {pos.leverage}x
                            </span>
                          </td>
                          <td
                            className={`py-2.5 px-3 font-mono text-xs font-semibold ${
                              pos.side === 'LONG' ? 'text-[#00D68F]' : 'text-[#FF5364]'
                            }`}
                          >
                            {pos.side}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[13px] text-[#F2F5F3] text-right tabular-nums">
                            {pos.qty.toLocaleString()}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[13px] text-[#BACBB9] text-right tabular-nums">
                            {formatCurrency(pos.avgEntry, pos.avgEntry < 2 ? 3 : 2)}
                          </td>
                          <td
                            className={`py-2.5 px-3 font-mono text-[13px] text-[#F2F5F3] text-right tabular-nums ${flashCls}`}
                          >
                            {formatCurrency(mark, mark < 2 ? 3 : 2)}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[13px] text-[#F2F5F3] text-right tabular-nums">
                            {formatCurrency(notional, 0)}
                          </td>
                          <td
                            className={`py-2.5 px-4 font-mono text-[13px] text-right tabular-nums whitespace-nowrap ${
                              pnl >= 0 ? 'text-[#00D68F]' : 'text-[#FF5364]'
                            }`}
                          >
                            {formatSignedCurrency(pnl, 0)}{' '}
                            <span className="text-[11px] opacity-80">
                              ({formatSignedPercent(pnlPct, 1)})
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#1B2420] bg-[#0C1110]">
                    <th className="py-2.5 px-4 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D]">
                      Instrument
                    </th>
                    <th className="py-2.5 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D]">
                      Sector
                    </th>
                    <th className="py-2.5 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] text-right">
                      Last Price
                    </th>
                    <th className="py-2.5 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] text-right">
                      24h Delta
                    </th>
                    <th className="py-2.5 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] text-right">
                      24h Vol
                    </th>
                    <th className="py-2.5 px-4 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] text-right">
                      Trend
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredWatchlist.map((ticker, idx) => (
                    <tr
                      key={ticker.symbol}
                      onClick={() => onSelectSymbol(ticker.symbol)}
                      className={`border-b border-[#1B2420]/70 cursor-pointer transition-colors ${
                        state.selectedSymbol === ticker.symbol
                          ? 'bg-[#151D19]'
                          : idx % 2 === 0
                            ? 'bg-[#0C1110] hover:bg-[#151D19]/70'
                            : 'bg-[#101715] hover:bg-[#151D19]/70'
                      }`}
                    >
                      <td className="py-2.5 px-4">
                        <div className="font-mono text-[13px] font-semibold text-[#F2F5F3]">
                          {ticker.symbol}
                        </div>
                        <div className="text-[11px] text-[#87948D]">{ticker.name}</div>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-xs text-[#87948D]">
                        {ticker.sector}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[13px] text-[#F2F5F3] text-right tabular-nums">
                        {formatCurrency(ticker.price, ticker.price < 2 ? 3 : 2)}
                      </td>
                      <td
                        className={`py-2.5 px-3 font-mono text-[13px] text-right tabular-nums ${
                          ticker.changePct24h >= 0 ? 'text-[#00D68F]' : 'text-[#FF5364]'
                        }`}
                      >
                        {formatSignedPercent(ticker.changePct24h)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-xs text-[#BACBB9] text-right tabular-nums">
                        {formatCompactCurrency(ticker.volume24h)}
                      </td>
                      <td className="py-2.5 px-4 flex justify-end">
                        <Sparkline
                          values={ticker.sparkline}
                          positive={ticker.changePct24h >= 0}
                          width={72}
                          height={20}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Compact L2 Depth Preview */}
        <section className="xl:col-span-4 bg-[#101715] border border-white/[0.07] rounded-lg p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-[#1B2420]">
              <div>
                <h2 className="text-sm font-semibold text-[#F2F5F3]">
                  L2 Depth · {selectedTicker.symbol}
                </h2>
                <span className="font-mono text-[11px] text-[#87948D]">
                  Spread {selectedTicker.spreadBps.toFixed(1)} bps
                </span>
              </div>
              <span className="font-mono text-sm font-semibold text-[#00E676] tabular-nums">
                {formatCurrency(selectedTicker.price, selectedTicker.price < 2 ? 3 : 2)}
              </span>
            </div>

            <div className="mt-3 space-y-1 font-mono text-xs tabular-nums">
              <div className="grid grid-cols-3 text-[10px] uppercase tracking-[0.08em] text-[#87948D] pb-1">
                <span>Price</span>
                <span className="text-right">Size</span>
                <span className="text-right">Cum</span>
              </div>

              {orderBook.asks.slice(2).map((lvl) => (
                <div
                  key={`ask-${lvl.price}`}
                  className="relative grid grid-cols-3 py-1 px-1.5 rounded-sm overflow-hidden"
                >
                  <div
                    className="absolute inset-y-0 right-0 bg-[#FF5364]/12 pointer-events-none"
                    style={{ width: `${Math.min(100, (lvl.size / 1400) * 100)}%` }}
                  />
                  <span className="relative text-[#FF5364]">
                    {lvl.price.toFixed(selectedTicker.price < 2 ? 3 : 2)}
                  </span>
                  <span className="relative text-right text-[#F2F5F3]">{lvl.size}</span>
                  <span className="relative text-right text-[#87948D]">{lvl.total}</span>
                </div>
              ))}

              <div className="my-1.5 py-1 border-y border-[#1B2420] flex items-center justify-between text-[11px] text-[#BACBB9]">
                <span>Mid Mark</span>
                <span className="font-semibold text-[#F2F5F3]">
                  {formatCurrency(selectedTicker.price, selectedTicker.price < 2 ? 3 : 2)}
                </span>
              </div>

              {orderBook.bids.slice(0, 4).map((lvl) => (
                <div
                  key={`bid-${lvl.price}`}
                  className="relative grid grid-cols-3 py-1 px-1.5 rounded-sm overflow-hidden"
                >
                  <div
                    className="absolute inset-y-0 right-0 bg-[#00D68F]/12 pointer-events-none"
                    style={{ width: `${Math.min(100, (lvl.size / 1400) * 100)}%` }}
                  />
                  <span className="relative text-[#00D68F]">
                    {lvl.price.toFixed(selectedTicker.price < 2 ? 3 : 2)}
                  </span>
                  <span className="relative text-right text-[#F2F5F3]">{lvl.size}</span>
                  <span className="relative text-right text-[#87948D]">{lvl.total}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-[#1B2420] flex items-center justify-between text-xs font-mono">
            <span className="text-[#87948D]">Latest Fill</span>
            <span className="text-[#F2F5F3] truncate max-w-[200px]">
              {state.orders[0]
                ? `${state.orders[0].side} ${state.orders[0].qty} ${state.orders[0].symbol}`
                : 'No recent fills'}
            </span>
          </div>
        </section>
      </div>
    </div>
  );
};
