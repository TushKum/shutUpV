import React, { useState } from 'react';
import type { EquityPoint, EquityTimeframe } from '../types/command';
import { formatCurrency, formatSignedPercent } from '../utils/tradingEngine';

interface EquityChartProps {
  seriesByTimeframe: Record<EquityTimeframe, EquityPoint[]>;
  liveNav: number;
}

export const EquityChart: React.FC<EquityChartProps> = ({
  seriesByTimeframe,
  liveNav,
}) => {
  const [timeframe, setTimeframe] = useState<EquityTimeframe>('4H');
  const [mode, setMode] = useState<'EQUITY' | 'DRAWDOWN'>('EQUITY');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const rawPoints = seriesByTimeframe[timeframe];
  const points = rawPoints.map((pt, idx) =>
    idx === rawPoints.length - 1 ? { ...pt, nav: liveNav } : pt,
  );

  const width = 760;
  const height = 248;
  const padLeft = 58;
  const padRight = 18;
  const padTop = 18;
  const padBottom = 28;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const navValues = points.map((p) =>
    mode === 'EQUITY' ? p.nav : p.drawdownPct,
  );
  const benchValues = points.map((p) =>
    mode === 'EQUITY' ? p.benchmark : 0,
  );

  const allValues = mode === 'EQUITY' ? [...navValues, ...benchValues] : [...navValues, 0];
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const range = maxVal - minVal || 1;
  const yPad = range * 0.12;
  const yMin = minVal - (mode === 'EQUITY' ? yPad : 0.25);
  const yMax = maxVal + (mode === 'EQUITY' ? yPad : 0.1);

  const toX = (i: number) =>
    padLeft + (i / Math.max(1, points.length - 1)) * plotW;
  const toY = (v: number) =>
    padTop + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  const primaryLine = points
    .map((p, i) => `${toX(i).toFixed(1)},${toY(mode === 'EQUITY' ? p.nav : p.drawdownPct).toFixed(1)}`)
    .join(' ');

  const benchLine = points
    .map((p, i) => `${toX(i).toFixed(1)},${toY(p.benchmark).toFixed(1)}`)
    .join(' ');

  const areaPath = `M ${toX(0).toFixed(1)},${(padTop + plotH).toFixed(1)} L ${primaryLine
    .split(' ')
    .join(' L ')} L ${toX(points.length - 1).toFixed(1)},${(padTop + plotH).toFixed(1)} Z`;

  const activePoint = hoverIdx !== null ? points[hoverIdx] : points[points.length - 1];
  const activeIdx = hoverIdx !== null ? hoverIdx : points.length - 1;
  const alphaDeltaPct =
    activePoint.benchmark > 0
      ? ((activePoint.nav - activePoint.benchmark) / activePoint.benchmark) * 100
      : 0;

  const gridTicks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <section className="bg-[#171610] border border-white/[0.07] rounded-lg p-4 flex flex-col justify-between">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold tracking-tight text-[#F2F5F3]">
              {mode === 'EQUITY' ? 'Desk Equity Curve vs Benchmark' : 'Intraday Drawdown Profile'}
            </h2>
            <span className="font-mono text-[11px] text-[#87948D] tabular-nums">
              {activePoint.label}
            </span>
          </div>
          <div className="flex items-baseline gap-3 mt-1">
            <span className="font-mono text-lg font-semibold text-[#F2F5F3] tabular-nums">
              {mode === 'EQUITY'
                ? formatCurrency(activePoint.nav, 0)
                : `${activePoint.drawdownPct.toFixed(2)}%`}
            </span>
            {mode === 'EQUITY' && (
              <span className="font-mono text-xs text-[#00D68F] tabular-nums">
                Alpha {formatSignedPercent(alphaDeltaPct)} vs Index ({formatCurrency(activePoint.benchmark, 0)})
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-[#11110d] border border-[#2d2a1d] rounded p-0.5">
            <button
              type="button"
              onClick={() => setMode('EQUITY')}
              className={`px-2.5 py-1.5 text-[11px] font-mono font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 ${
                mode === 'EQUITY'
                  ? 'bg-[#201e14] text-[color:var(--desk-accent)] border border-[color:var(--desk-accent-line)]'
                  : 'text-[#87948D] hover:text-[#F2F5F3]'
              }`}
            >
              NAV Curve
            </button>
            <button
              type="button"
              onClick={() => setMode('DRAWDOWN')}
              className={`px-2.5 py-1.5 text-[11px] font-mono font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 ${
                mode === 'DRAWDOWN'
                  ? 'bg-[#201e14] text-[color:var(--desk-accent)] border border-[color:var(--desk-accent-line)]'
                  : 'text-[#87948D] hover:text-[#F2F5F3]'
              }`}
            >
              Drawdown
            </button>
          </div>

          <div className="flex items-center bg-[#11110d] border border-[#2d2a1d] rounded p-0.5">
            {(['1H', '4H', '12H', 'ALL'] as EquityTimeframe[]).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => {
                  setTimeframe(tf);
                  setHoverIdx(null);
                }}
                className={`px-2.5 py-1.5 text-[11px] font-mono font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 ${
                  timeframe === tf
                    ? 'bg-[var(--desk-accent)] text-[#070909] font-semibold'
                    : 'text-[#87948D] hover:text-[#F2F5F3]'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative w-full">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-[220px] select-none"
          role="img"
          aria-label="Desk portfolio performance chart"
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id="mcEquityGrad" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor={mode === 'EQUITY' ? 'var(--desk-accent)' : '#FF5364'}
                stopOpacity="0.22"
              />
              <stop
                offset="100%"
                stopColor={mode === 'EQUITY' ? 'var(--desk-accent)' : '#FF5364'}
                stopOpacity="0.0"
              />
            </linearGradient>
          </defs>

          {gridTicks.map((ratio) => {
            const y = padTop + ratio * plotH;
            const val = yMax - ratio * (yMax - yMin);
            return (
              <g key={ratio}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke="#1B2420"
                  strokeDasharray="3 3"
                />
                <text
                  x={padLeft - 8}
                  y={y + 3}
                  textAnchor="end"
                  fill="#87948D"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {mode === 'EQUITY' ? `$${Math.round(val / 1000)}k` : `${val.toFixed(1)}%`}
                </text>
              </g>
            );
          })}

          {points.map((pt, i) => (
            <text
              key={pt.label}
              x={toX(i)}
              y={height - 8}
              textAnchor="middle"
              fill={i === activeIdx ? '#F2F5F3' : '#87948D'}
              fontSize="10"
              fontFamily="JetBrains Mono, monospace"
            >
              {pt.label}
            </text>
          ))}

          <path d={areaPath} fill="url(#mcEquityGrad)" />

          {mode === 'EQUITY' && (
            <polyline
              fill="none"
              stroke="#87948D"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              points={benchLine}
            />
          )}

          <polyline
            fill="none"
            stroke={mode === 'EQUITY' ? 'var(--desk-accent)' : '#FF5364'}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={primaryLine}
          />

          <line
            x1={toX(activeIdx)}
            y1={padTop}
            x2={toX(activeIdx)}
            y2={padTop + plotH}
            stroke="var(--desk-accent-line)"
            strokeWidth="1"
          />

          <circle
            cx={toX(activeIdx)}
            cy={toY(mode === 'EQUITY' ? activePoint.nav : activePoint.drawdownPct)}
            r="4"
            fill={mode === 'EQUITY' ? 'var(--desk-accent)' : '#FF5364'}
            stroke="#070909"
            strokeWidth="2"
          />

          {points.map((pt, i) => {
            const sliceW = plotW / points.length;
            return (
              <rect
                key={pt.label}
                x={toX(i) - sliceW / 2}
                y={padTop}
                width={sliceW}
                height={plotH}
                fill="transparent"
                className="cursor-crosshair"
                onMouseEnter={() => setHoverIdx(i)}
              />
            );
          })}
        </svg>
      </div>
    </section>
  );
};
