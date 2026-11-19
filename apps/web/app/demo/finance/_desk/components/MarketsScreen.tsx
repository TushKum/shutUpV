import React, { useMemo, useState } from 'react';
import { LayoutGrid, List, Search, XCircle } from 'lucide-react';
import { HeatmapTiles } from '@/components/ui/market-heatmap';
import { TradingChart } from '@/components/ui/trading-chart';
import type { AssetSector, DeskState, PortfolioMetrics } from '../types/command';
import type { OrderRequest } from '../utils/tradingEngine';
import {
  formatCompactCurrency,
  formatCurrency,
  formatSignedPercent,
} from '../utils/tradingEngine';
import { buildOrderBookForPrice } from '../data/seedData';
import { CANDLE_PRICE_SCALE } from '../utils/candles';
import { QuickOrderForm } from './QuickOrderForm';
import { Sparkline } from './Sparkline';

interface MarketsScreenProps {
  state: DeskState;
  metrics: PortfolioMetrics;
  onSelectSymbol: (symbol: string) => void;
  onSubmitOrder: (req: OrderRequest) => { ok: boolean; error?: string };
  onCancelOrder: (orderId: string) => void;
}

const SECTORS: ('ALL' | AssetSector)[] = ['ALL', 'Perps', 'Equities', 'Venture', 'Macro'];

export const MarketsScreen: React.FC<MarketsScreenProps> = ({
  state,
  metrics,
  onSelectSymbol,
  onSubmitOrder,
  onCancelOrder,
}) => {
  const [sectorFilter, setSectorFilter] = useState<'ALL' | AssetSector>('ALL');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'heatmap' | 'table'>('heatmap');
  const [blotterTab, setBlotterTab] = useState<'OPEN' | 'ALL'>('ALL');

  const filteredTickers = useMemo(() => {
    return state.tickers.filter((t) => {
      const sectorOk = sectorFilter === 'ALL' || t.sector === sectorFilter;
      const q = search.trim().toLowerCase();
      const textOk =
        !q ||
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q);
      return sectorOk && textOk;
    });
  }, [state.tickers, sectorFilter, search]);

  const activeTicker =
    state.tickers.find((t) => t.symbol === state.selectedSymbol) ?? state.tickers[0];

  const book = useMemo(
    () => buildOrderBookForPrice(activeTicker.price),
    [activeTicker.price],
  );

  const openOrders = state.orders.filter((o) => o.status === 'OPEN');
  const displayedOrders = blotterTab === 'OPEN' ? openOrders : state.orders;
  const decimals = activeTicker.price < 2 ? 3 : 2;
  const candles = useMemo(
    () => activeTicker.candles.map((candle, index) => ({ ...candle, label: `Bar ${index + 1}` })),
    [activeTicker.candles],
  );
  const summary = [
    ['Mark', formatCurrency(activeTicker.price, decimals)],
    ['24h move', formatSignedPercent(activeTicker.changePct24h)],
    ['Best bid', formatCurrency(book.bids[0].price, decimals)],
    ['Best ask', formatCurrency(book.asks.at(-1)!.price, decimals)],
    ['24h volume', formatCompactCurrency(activeTicker.volume24h)],
    ['24h range', `${formatCurrency(activeTicker.low24h, decimals)} – ${formatCurrency(activeTicker.high24h, decimals)}`],
  ];

  return (
    <div className="space-y-4">
      {/* Market Screener Matrix */}
      <section className="bg-[#101715] border border-white/[0.07] rounded-lg overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1B2420] px-4 py-3">
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-[#F2F5F3]">Market screener</h2>
            <div aria-label="Screener view" role="group" className="flex gap-1">
              {(['heatmap', 'table'] as const).map((mode) => {
                const Icon = mode === 'heatmap' ? LayoutGrid : List;
                return (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={view === mode}
                    onClick={() => setView(mode)}
                    className="inline-flex items-center gap-1.5 rounded border border-[#33473e] px-2 py-1.5 text-xs capitalize text-[#F2F5F3] aria-pressed:border-[#8fddc3] aria-pressed:bg-[#213b32]"
                  >
                    <Icon className="size-3.5" aria-hidden="true" />
                    {mode}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1 bg-[#0C1110] border border-[#1B2420] p-0.5 rounded">
            {SECTORS.map((sec) => (
              <button
                key={sec}
                type="button"
                aria-pressed={sectorFilter === sec}
                onClick={() => setSectorFilter(sec)}
                className={`px-3 py-1.5 rounded-sm font-mono text-xs transition-colors whitespace-nowrap shrink-0 ${
                  sectorFilter === sec
                    ? 'bg-[#151D19] text-[#00E676] border border-[#285D46]'
                    : 'text-[#87948D] hover:text-[#F2F5F3]'
                }`}
              >
                {sec}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search
              className="w-3.5 h-3.5 text-[#87948D] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ticker or contract..."
              aria-label="Search market instruments"
              className="h-9 w-full rounded border border-[#33473e] bg-[#0C1110] pr-3 pl-9 font-mono text-xs text-[#F2F5F3] placeholder:text-[#87948D]"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          {filteredTickers.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <p className="font-mono text-xs text-[#87948D]">
                No instruments match &ldquo;{search}&rdquo; in {sectorFilter}.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setSectorFilter('ALL');
                }}
                className="px-3 py-1.5 bg-[#0C1110] border border-[#1B2420] hover:border-[#285D46] rounded font-mono text-xs text-[#00E676]"
              >
                Reset Market Filters
              </button>
            </div>
          ) : view === 'heatmap' ? (
            <div className="p-3">
              <HeatmapTiles
                selected={activeTicker.symbol}
                onSelect={onSelectSymbol}
                quotes={filteredTickers.map((ticker) => ({
                  ticker: ticker.symbol,
                  name: ticker.name,
                  tag: ticker.sector,
                  price: formatCurrency(ticker.price, ticker.price < 2 ? 3 : 2),
                  moveBp: Math.round(ticker.changePct24h * 100),
                }))}
              />
            </div>
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
                    Mark Price
                  </th>
                  <th className="py-2.5 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] text-right">
                    24h %
                  </th>
                  <th className="py-2.5 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] text-right">
                    24h High / Low
                  </th>
                  <th className="py-2.5 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] text-right">
                    24h Volume
                  </th>
                  <th className="py-2.5 px-4 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] text-right">
                    Intraday
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredTickers.map((t, idx) => {
                  const selected = t.symbol === activeTicker.symbol;
                  const flashCls =
                    t.lastFlash === 'up'
                      ? 'animate-flash-pos'
                      : t.lastFlash === 'down'
                        ? 'animate-flash-neg'
                        : '';
                  return (
                    <tr
                      key={t.symbol}
                      onClick={() => onSelectSymbol(t.symbol)}
                      className={`border-b border-[#1B2420]/70 cursor-pointer transition-colors ${
                        selected
                          ? 'bg-[#151D19]'
                          : idx % 2 === 0
                            ? 'bg-[#0C1110] hover:bg-[#151D19]/70'
                            : 'bg-[#101715] hover:bg-[#151D19]/70'
                      }`}
                    >
                      <td className="py-2.5 px-4">
                        <button type="button" aria-pressed={selected} className="font-mono text-[13px] font-semibold text-[#F2F5F3] underline underline-offset-4">
                          {t.symbol}
                        </button>
                        <div className="text-[11px] text-[#87948D]">{t.name}</div>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-xs text-[#87948D]">
                        {t.sector}
                      </td>
                      <td
                        className={`py-2.5 px-3 font-mono text-[13px] text-[#F2F5F3] text-right tabular-nums ${flashCls}`}
                      >
                        {formatCurrency(t.price, t.price < 2 ? 3 : 2)}
                      </td>
                      <td
                        className={`py-2.5 px-3 font-mono text-[13px] text-right tabular-nums ${
                          t.changePct24h >= 0 ? 'text-[#00D68F]' : 'text-[#FF5364]'
                        }`}
                      >
                        {formatSignedPercent(t.changePct24h)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-xs text-[#BACBB9] text-right tabular-nums whitespace-nowrap">
                        {formatCurrency(t.high24h, t.price < 2 ? 3 : 2)} /{' '}
                        {formatCurrency(t.low24h, t.price < 2 ? 3 : 2)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-xs text-[#BACBB9] text-right tabular-nums">
                        {formatCompactCurrency(t.volume24h)}
                      </td>
                      <td className="py-2.5 px-4 flex justify-end">
                        <Sparkline
                          values={t.sparkline}
                          positive={t.changePct24h >= 0}
                          width={76}
                          height={22}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section aria-label="Instrument analysis" className="rounded-lg border border-white/10 bg-[#101715] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[#F2F5F3]">{activeTicker.symbol}</h2>
            <p className="text-xs text-[#BACBB9]">{activeTicker.name}</p>
          </div>
          <a href="#order-ticket" className="rounded border border-[#408a72] px-3 py-2 text-sm font-semibold text-[#8fddc3]">
            Buy or sell {activeTicker.symbol} ↓
          </a>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {summary.map(([label, value]) => (
            <div key={label} className="min-w-0 rounded border border-white/10 bg-[#0C1110] p-2">
              <dt className="text-xs text-[#BACBB9]">{label}</dt>
              <dd className="mt-1 break-words font-mono text-xs font-semibold text-[#F2F5F3] tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="finance-candles mt-3 rounded border border-white/10 bg-[#0a141a] p-2 sm:p-3">
          <TradingChart
            key={activeTicker.symbol}
            testId="finance-candles"
            label={`${activeTicker.symbol} candlestick chart`}
            candles={candles}
            format={(value) => formatCurrency(value / CANDLE_PRICE_SCALE, decimals)}
            average={5}
            slowAverage={10}
            colorVolume
            patterns={false}
            note="Bodies show open to close. Wicks show high and low. Volume is simulated."
          />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-[#BACBB9]">
          The mark values your position. The best bid and ask show the highest buy and lowest sell quote in the simulated book.
          A market order fills at the simulator’s mark; a limit order records the price you set in the blotter.
        </p>
      </section>

      {/* Execution Workspace: L2 Order Book (4 cols) + Full Order Ticket (4 cols) + Order Blotter (4 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <section className="xl:col-span-4 bg-[#101715] border border-white/[0.07] rounded-lg p-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#1B2420]">
            <div>
              <h2 className="text-sm font-semibold text-[#F2F5F3]">
                Order Book · {activeTicker.symbol}
              </h2>
              <span className="font-mono text-[11px] text-[#87948D]">
                6-Level Aggregated Depth
              </span>
            </div>
            <span className="font-mono text-xs text-[#00E676] tabular-nums">
              {activeTicker.spreadBps.toFixed(1)} bps
            </span>
          </div>

          <div className="mt-3 space-y-1 font-mono text-xs tabular-nums">
            <div className="grid grid-cols-3 text-[10px] uppercase tracking-[0.08em] text-[#87948D] pb-1">
              <span>Price</span>
              <span className="text-right">Size</span>
              <span className="text-right">Total</span>
            </div>
            {book.asks.map((lvl) => (
              <div
                key={`m-ask-${lvl.price}`}
                className="relative grid grid-cols-3 py-1 px-1.5 rounded-sm overflow-hidden"
              >
                <div
                  className="absolute inset-y-0 right-0 bg-[#FF5364]/12 pointer-events-none"
                  style={{ width: `${Math.min(100, (lvl.size / 1400) * 100)}%` }}
                />
                <span className="relative text-[#FF5364]">
                  {lvl.price.toFixed(activeTicker.price < 2 ? 3 : 2)}
                </span>
                <span className="relative text-right text-[#F2F5F3]">{lvl.size}</span>
                <span className="relative text-right text-[#87948D]">{lvl.total}</span>
              </div>
            ))}

            <div className="my-2 py-1.5 border-y border-[#1B2420] flex items-center justify-between text-xs">
              <span className="text-[#87948D]">Index Mark</span>
              <span className="font-semibold text-[#F2F5F3]">
                {formatCurrency(activeTicker.price, activeTicker.price < 2 ? 3 : 2)}
              </span>
            </div>

            {book.bids.map((lvl) => (
              <div
                key={`m-bid-${lvl.price}`}
                className="relative grid grid-cols-3 py-1 px-1.5 rounded-sm overflow-hidden"
              >
                <div
                  className="absolute inset-y-0 right-0 bg-[#00D68F]/12 pointer-events-none"
                  style={{ width: `${Math.min(100, (lvl.size / 1400) * 100)}%` }}
                />
                <span className="relative text-[#00D68F]">
                  {lvl.price.toFixed(activeTicker.price < 2 ? 3 : 2)}
                </span>
                <span className="relative text-right text-[#F2F5F3]">{lvl.size}</span>
                <span className="relative text-right text-[#87948D]">{lvl.total}</span>
              </div>
            ))}
          </div>
        </section>

        <div id="order-ticket" className="scroll-mt-4 xl:col-span-4">
          <QuickOrderForm
            tickers={state.tickers}
            selectedSymbol={activeTicker.symbol}
            buyingPower={metrics.buyingPower}
            onSelectSymbol={onSelectSymbol}
            onSubmitOrder={onSubmitOrder}
          />
        </div>

        <section className="xl:col-span-4 bg-[#101715] border border-white/[0.07] rounded-lg overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-[#1B2420] flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#F2F5F3]">Order Blotter</h2>
            <div className="flex items-center bg-[#0C1110] border border-[#1B2420] p-0.5 rounded">
              <button
                type="button"
                onClick={() => setBlotterTab('OPEN')}
                className={`px-2.5 py-1 rounded-sm font-mono text-[11px] whitespace-nowrap ${
                  blotterTab === 'OPEN'
                    ? 'bg-[#151D19] text-[#00E676] border border-[#285D46]'
                    : 'text-[#87948D] hover:text-[#F2F5F3]'
                }`}
              >
                Open ({openOrders.length})
              </button>
              <button
                type="button"
                onClick={() => setBlotterTab('ALL')}
                className={`px-2.5 py-1 rounded-sm font-mono text-[11px] whitespace-nowrap ${
                  blotterTab === 'ALL'
                    ? 'bg-[#151D19] text-[#00E676] border border-[#285D46]'
                    : 'text-[#87948D] hover:text-[#F2F5F3]'
                }`}
              >
                All ({state.orders.length})
              </button>
            </div>
          </div>

          <div className="divide-y divide-[#1B2420] overflow-y-auto max-h-[380px]">
            {displayedOrders.length === 0 ? (
              <div className="p-6 text-center font-mono text-xs text-[#87948D]">
                No orders in selected blotter view.
              </div>
            ) : (
              displayedOrders.map((order) => (
                <div
                  key={order.id}
                  className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-[#151D19]/60"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-mono text-xs">
                      <span
                        className={`font-semibold ${
                          order.side === 'BUY' ? 'text-[#00D68F]' : 'text-[#FF5364]'
                        }`}
                      >
                        {order.side}
                      </span>
                      <span className="font-semibold text-[#F2F5F3]">{order.symbol}</span>
                      <span className="text-[#87948D]">{order.type}</span>
                    </div>
                    <div className="font-mono text-[11px] text-[#87948D] mt-0.5 tabular-nums">
                      {order.qty} @{' '}
                      {formatCurrency(
                        order.fillPrice ?? order.limitPrice ?? 0,
                        (order.fillPrice ?? order.limitPrice ?? 10) < 2 ? 3 : 2,
                      )}{' '}
                      · {order.timestamp}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`font-mono text-[10px] font-semibold uppercase tracking-[0.06em] px-2 py-0.5 rounded-sm border ${
                        order.status === 'FILLED'
                          ? 'bg-[#00D68F]/10 border-[#285D46] text-[#00D68F]'
                          : order.status === 'OPEN'
                            ? 'bg-[#00E676]/10 border-[#285D46] text-[#75FF9E]'
                            : 'bg-[#151D19] border-[#1B2420] text-[#87948D]'
                      }`}
                    >
                      {order.status}
                    </span>
                    {order.status === 'OPEN' && (
                      <button
                        type="button"
                        onClick={() => onCancelOrder(order.id)}
                        aria-label={`Cancel order ${order.id}`}
                        className="p-1.5 text-[#FF5364] hover:bg-[#FF5364]/10 rounded transition-colors"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
