import React, { useMemo } from 'react';
import type {
  DeskState,
  FeedDiagnostic,
  PortfolioMetrics,
} from '../types/command';
import {
  formatCurrency,
  formatSignedCurrency,
} from '../utils/tradingEngine';

interface RiskTelemetryScreenProps {
  state: DeskState;
  metrics: PortfolioMetrics;
  diagnostics: FeedDiagnostic[];
  onReducePosition: (symbol: string, fraction: number) => void;
}

export const RiskTelemetryScreen: React.FC<RiskTelemetryScreenProps> = ({
  state,
  metrics,
  diagnostics,
  onReducePosition,
}) => {
  const tickerMap = useMemo(
    () => new Map(state.tickers.map((t) => [t.symbol, t])),
    [state.tickers],
  );

  const sectorBreakdown = useMemo(() => {
    const totals: Record<string, number> = {
      Perps: 0,
      Equities: 0,
      Venture: 0,
      Macro: 0,
    };
    for (const pos of state.positions) {
      const price = tickerMap.get(pos.symbol)?.price ?? pos.avgEntry;
      totals[pos.sector] = (totals[pos.sector] ?? 0) + Math.abs(pos.qty * price);
    }
    return Object.entries(totals).map(([sector, exposure]) => ({
      sector,
      exposure,
      pct: metrics.grossExposure > 0 ? (exposure / metrics.grossExposure) * 100 : 0,
    }));
  }, [state.positions, tickerMap, metrics.grossExposure]);

  const var95 = metrics.grossExposure * 0.042;
  const sharpe = 2.84;
  const maxDrawdown = -2.4;

  return (
    <div className="space-y-4">
      {/* Risk KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-[#171610] border border-white/[0.07] rounded-lg p-4">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D]">
            1-Day 95% Value at Risk
          </div>
          <div className="font-mono text-xl font-semibold text-[#FF5364] tabular-nums mt-2">
            -{formatCurrency(var95, 0)}
          </div>
          <div className="font-mono text-xs text-[#87948D] mt-1">
            {((var95 / Math.max(1, metrics.nav)) * 100).toFixed(2)}% of Portfolio NAV
          </div>
        </div>

        <div className="bg-[#171610] border border-white/[0.07] rounded-lg p-4">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D]">
            Rolling Sharpe Ratio
          </div>
          <div className="font-mono text-xl font-semibold text-[#00D68F] tabular-nums mt-2">
            {sharpe.toFixed(2)}
          </div>
          <div className="font-mono text-xs text-[#87948D] mt-1">
            Annualized competition window
          </div>
        </div>

        <div className="bg-[#171610] border border-white/[0.07] rounded-lg p-4">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D]">
            Peak-to-Trough Drawdown
          </div>
          <div className="font-mono text-xl font-semibold text-[#F2F5F3] tabular-nums mt-2">
            {maxDrawdown.toFixed(2)}%
          </div>
          <div className="font-mono text-xs text-[#87948D] mt-1">
            Desk limit threshold: -8.00%
          </div>
        </div>

        <div className="bg-[#171610] border border-white/[0.07] rounded-lg p-4">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D]">
            Net Directional Beta
          </div>
          <div className="font-mono text-xl font-semibold text-[#F2F5F3] tabular-nums mt-2">
            {formatCurrency(metrics.netExposure, 0)}
          </div>
          <div className="font-mono text-xs text-[#87948D] mt-1">
            Gross {formatCurrency(metrics.grossExposure, 0)}
          </div>
        </div>
      </div>

      {/* Position Risk Matrix + Sector Exposure */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <section className="xl:col-span-8 bg-[#171610] border border-white/[0.07] rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-[#2d2a1d] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#F2F5F3]">
              Position Risk &amp; Liquidation Matrix
            </h2>
            <span className="font-mono text-xs text-[#87948D]">
              Margin Used {formatCurrency(metrics.marginUsed, 0)}
            </span>
          </div>

          <div className="overflow-x-auto">
            {state.positions.length === 0 ? (
              <div className="p-8 text-center font-mono text-xs text-[#87948D]">
                All risk exposure flattened. Zero open positions.
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#2d2a1d] bg-[#11110d]">
                    <th className="py-2.5 px-4 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D]">
                      Symbol
                    </th>
                    <th className="py-2.5 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] text-right">
                      Notional
                    </th>
                    <th className="py-2.5 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] text-right">
                      Liq. Price
                    </th>
                    <th className="py-2.5 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] text-right">
                      Unrealized PnL
                    </th>
                    <th className="py-2.5 px-4 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] text-right">
                      Risk Controls
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {state.positions.map((pos, idx) => {
                    const mark = tickerMap.get(pos.symbol)?.price ?? pos.avgEntry;
                    const notional = pos.qty * mark;
                    const pnl =
                      pos.side === 'LONG'
                        ? (mark - pos.avgEntry) * pos.qty
                        : (pos.avgEntry - mark) * pos.qty;
                    return (
                      <tr
                        key={pos.symbol}
                        className={`border-b border-[#2d2a1d]/70 ${
                          idx % 2 === 0 ? 'bg-[#11110d]' : 'bg-[#171610]'
                        }`}
                      >
                        <td className="py-2.5 px-4 font-mono text-[13px] font-semibold text-[#F2F5F3]">
                          {pos.symbol}
                          <span
                            className={`ml-2 text-[11px] ${
                              pos.side === 'LONG' ? 'text-[#00D68F]' : 'text-[#FF5364]'
                            }`}
                          >
                            {pos.side} {pos.leverage}x
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[13px] text-[#F2F5F3] text-right tabular-nums">
                          {formatCurrency(notional, 0)}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[13px] text-[#BACBB9] text-right tabular-nums">
                          {pos.liquidationPrice > 0
                            ? formatCurrency(pos.liquidationPrice)
                            : 'Unlevered'}
                        </td>
                        <td
                          className={`py-2.5 px-3 font-mono text-[13px] text-right tabular-nums ${
                            pnl >= 0 ? 'text-[#00D68F]' : 'text-[#FF5364]'
                          }`}
                        >
                          {formatSignedCurrency(pnl, 0)}
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onReducePosition(pos.symbol, 0.5)}
                              className="px-2.5 py-1 bg-[#11110d] border border-[#2d2a1d] hover:border-[color:var(--desk-accent-line)] rounded font-mono text-[11px] text-[#F2F5F3]"
                            >
                              Reduce 50%
                            </button>
                            <button
                              type="button"
                              onClick={() => onReducePosition(pos.symbol, 1)}
                              className="px-2.5 py-1 border border-[#FF5364]/60 hover:bg-[#FF5364]/12 rounded font-mono text-[11px] text-[#FF5364]"
                            >
                              Close
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="xl:col-span-4 bg-[#171610] border border-white/[0.07] rounded-lg p-4 space-y-4">
          <div className="pb-3 border-b border-[#2d2a1d]">
            <h2 className="text-sm font-semibold text-[#F2F5F3]">
              Sector Exposure Allocation
            </h2>
          </div>

          <div className="space-y-3">
            {sectorBreakdown.map((item) => (
              <div key={item.sector} className="space-y-1.5">
                <div className="flex items-center justify-between font-mono text-xs">
                  <span className="text-[#F2F5F3]">{item.sector}</span>
                  <span className="text-[#BACBB9] tabular-nums">
                    {formatCurrency(item.exposure, 0)} ({item.pct.toFixed(1)}%)
                  </span>
                </div>
                <div className="h-2 w-full bg-[#070909] rounded-sm overflow-hidden">
                  <div
                    className="h-full bg-[var(--desk-accent)]"
                    style={{ width: `${Math.min(100, item.pct)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="pt-4 border-t border-[#2d2a1d] space-y-2.5">
            <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D]">
              Data Feed Channels
            </h3>
            {diagnostics.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between text-xs font-mono py-1.5 border-b border-[#2d2a1d]/50 last:border-b-0"
              >
                <div className="min-w-0 pr-2">
                  <div className="text-[#F2F5F3] truncate">{d.channel}</div>
                  <div className="text-[10px] text-[#87948D]">{d.protocol}</div>
                </div>
                <div className="text-right shrink-0 tabular-nums">
                  <div className="text-[#00D68F]">{d.latencyMs.toFixed(1)} ms</div>
                  <div className="text-[10px] text-[#87948D]">{d.msgPerSec} msg/s</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};
