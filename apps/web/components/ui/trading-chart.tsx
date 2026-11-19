"use client";

// An interactive candlestick chart for trading on a laptop: a crosshair follows the mouse (the candle under it is
// read out as open, high, low and close, and the price at the pointer is tagged on the axis), candlestick patterns are
// marked on the candles they complete (▲ bullish under the candle, ▼ bearish above it, ◆ indecision) and listed under
// the chart with what they usually mean, and the latest candle can pulse while it is still forming.

import { useEffect, useMemo, useRef, useState } from "react";
import { detectPatterns, type Pattern } from "@msim/engine";
import { axisMoney, candleGeometry, type Candle, type ChartBox } from "@/lib/chart";
import { count, money } from "@/lib/format";

const BOX: ChartBox = { width: 900, height: 380, padLeft: 64, padRight: 78, padTop: 30, padBottom: 14 };

const C = {
  up: "var(--chart-up, #15803d)",
  down: "var(--chart-down, #b91c1c)",
  flat: "var(--chart-axis, #64748b)",
  grid: "var(--chart-grid, #e2e8f0)",
  axis: "var(--chart-axis, #64748b)",
  volume: "var(--chart-volume, #cbd5e1)",
  average: "var(--chart-average, #d97706)",
  slowAverage: "var(--chart-average-slow, #a78bfa)",
  tagText: "var(--chart-tag-text, #ffffff)",
  cross: "var(--chart-marker, #94a3b8)",
};

export function TradingChart({
  candles,
  label,
  testId,
  live = false,
  average = 5,
  slowAverage = 0,
  colorVolume = false,
  patterns = true,
  box: fixedBox,
  format = money,
  note,
  patternList = true,
  fontSize = 11,
}: {
  candles: readonly Candle[];
  label: string;
  testId?: string;
  /** The last candle is still forming: it pulses. */
  live?: boolean;
  /** Moving average window in candles (0: none). */
  average?: number;
  /** Optional slower moving average, over a second window of closes. */
  slowAverage?: number;
  /** Match each volume bar to the direction of its candle. */
  colorVolume?: boolean;
  /** Mark and list candlestick patterns. */
  patterns?: boolean;
  box?: ChartBox;
  format?: (v: number) => string;
  /** A line under the chart (e.g. what one candle is). */
  note?: string;
  /** List the latest patterns under the chart (the markers show either way). */
  patternList?: boolean;
  /** Axis and tag text size, in chart units (larger on a big screen). */
  fontSize?: number;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const frame = useRef<HTMLElement>(null);
  // Drawn at the width it is shown at (one unit = one pixel), so the labels stay readable on a wide screen.
  const [width, setWidth] = useState(BOX.width);
  const ready = candles.length >= 2;
  useEffect(() => {
    const el = frame.current;
    if (!el || fixedBox) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, Math.round(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fixedBox, ready]);
  const box = useMemo(() => fixedBox ?? { ...BOX, width }, [fixedBox, width]);
  const [hover, setHover] = useState<{ i: number; y: number } | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const g = useMemo(() => candleGeometry(candles, box, 5, average, slowAverage), [candles, box, average, slowAverage]);
  // A forming candle is not read for patterns: it can still change.
  const found = useMemo<Pattern[]>(() => {
    if (!patterns) return [];
    const closed = live ? candles.slice(0, -1) : candles;
    return detectPatterns(closed.map((c) => ({ open: c.open, close: c.close, high: c.high ?? Math.max(c.open, c.close), low: c.low ?? Math.min(c.open, c.close) })));
  }, [candles, live, patterns]);
  if (candles.length < 2) return <p className="text-sm text-slate-500">The chart starts after the first two candles.</p>;

  const tickStep = g.yTicks.length > 1 ? g.yTicks[1]!.value - g.yTicks[0]!.value : 1;
  const axis = format === money ? (v: number) => axisMoney(v, tickStep, g.max, money) : format;
  const tone = { up: C.up, down: C.down, flat: C.flat };
  const last = g.candles.at(-1)!;
  const priceTop = box.padTop;
  const priceBottom = g.priceBottom;
  const priceAt = (y: number) => g.min + ((priceBottom - y) / (priceBottom - priceTop)) * (g.max - g.min);
  const shown = hover ? g.candles[hover.i]! : last;
  const byIndex = new Map(found.map((p) => [p.index, p]));
  const recent = found.slice(-5).reverse();

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = svg.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * box.width;
    const y = ((e.clientY - r.top) / r.height) * box.height;
    if (x < box.padLeft || x > box.width - box.padRight) return setHover(null);
    const slot = (box.width - box.padLeft - box.padRight) / g.candles.length;
    const i = Math.max(0, Math.min(g.candles.length - 1, Math.floor((x - box.padLeft) / slot)));
    setHover({ i, y: Math.max(priceTop, Math.min(priceBottom, y)) });
  }

  const ohlc = (c: Candle) => ({ o: c.open, h: c.high ?? Math.max(c.open, c.close), l: c.low ?? Math.min(c.open, c.close), c: c.close });
  const s = ohlc(shown);
  const chg = s.c - s.o;

  return (
    <figure ref={frame} className="w-full" data-testid={testId}>
      <div className="mb-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-xs" data-testid={testId ? `${testId}-ohlc` : undefined}>
        <span className="font-semibold text-paper">{shown.label}</span>
        <span>O <b>{format(s.o)}</b></span>
        <span>H <b>{format(s.h)}</b></span>
        <span>L <b>{format(s.l)}</b></span>
        <span>C <b>{format(s.c)}</b></span>
        <span style={{ color: chg > 0 ? C.up : chg < 0 ? C.down : C.flat }}>
          {chg >= 0 ? "+" : "−"}
          {format(Math.abs(chg))} ({s.o ? ((chg / s.o) * 100).toFixed(2) : "0.00"}%)
        </span>
        {shown.volume ? <span>Vol {count(shown.volume)}</span> : null}
        {byIndex.get(hover ? hover.i : g.candles.length - 1) ? (
          <span className="rounded bg-raised px-1.5 py-0.5 text-warn">{byIndex.get(hover ? hover.i : g.candles.length - 1)!.name}</span>
        ) : null}
      </div>
      <svg
        ref={svg}
        viewBox={`0 0 ${box.width} ${box.height}`}
        className="h-auto w-full cursor-crosshair select-none"
        role="img"
        aria-label={`${label}: ${candles.length} candles, last ${format(last.close)}.`}
        onPointerDown={onMove}
        onPointerMove={onMove}
        onPointerLeave={(event) => { if (event.pointerType !== "touch") setHover(null); }}
      >
        {g.yTicks.map((t) => (
          <g key={t.value}>
            <line x1={box.padLeft} x2={box.width - box.padRight} y1={t.y} y2={t.y} stroke={C.grid} strokeWidth="1" />
            <text x={box.padLeft - 8} y={t.y + fontSize / 3} textAnchor="end" fontSize={fontSize} fill={C.axis}>
              {axis(t.value)}
            </text>
          </g>
        ))}
        {colorVolume && g.maxVolume > 0 ? (
          <text x={box.padLeft} y={g.volTop - 3} fontSize={fontSize} fill={C.axis}>Volume</text>
        ) : null}
        {g.maxVolume > 0
          ? g.candles.map((c) =>
              c.volTop < g.volBottom ? (
                <rect key={`v-${c.x}`} x={c.x - g.width / 2} y={c.volTop} width={g.width} height={g.volBottom - c.volTop} fill={colorVolume ? tone[c.tone] : C.volume} opacity={colorVolume ? 0.68 : 0.5} />
              ) : null,
            )
          : null}
        <line x1={box.padLeft} x2={box.width - box.padRight} y1={g.lastY} y2={g.lastY} stroke={tone[last.tone]} strokeWidth="1" strokeDasharray="1 3" />
        {live ? (
          <rect
            x={last.x - g.width / 2 - 2}
            y={last.top - 2}
            width={g.width + 4}
            height={last.bottom - last.top + 4}
            fill="none"
            stroke={tone[last.tone]}
            strokeWidth="2"
            className="msim-live-candle"
          />
        ) : null}
        {g.candles.map((c, i) => (
          <g key={`c-${c.x}`} opacity={focus !== null && focus !== i ? 0.45 : 1}>
            {c.wickBottom - c.wickTop > c.bottom - c.top ? (
              <line x1={c.x} x2={c.x} y1={c.wickTop} y2={c.wickBottom} stroke={tone[c.tone]} strokeWidth={Math.max(1, Math.min(2, g.width / 4))} />
            ) : null}
            <rect x={c.x - g.width / 2} y={c.top} width={g.width} height={c.bottom - c.top} fill={tone[c.tone]} />
          </g>
        ))}
        {g.pathSlowAverage ? <path d={g.pathSlowAverage} fill="none" stroke={C.slowAverage} strokeWidth="1.6" strokeLinejoin="round" /> : null}
        {g.pathAverage ? <path d={g.pathAverage} fill="none" stroke={C.average} strokeWidth="1.6" strokeLinejoin="round" opacity="0.9" /> : null}
        {/* Pattern markers. */}
        {found.map((p) => {
          const c = g.candles[p.index];
          if (!c) return null;
          const bull = p.bias === "bullish";
          const bear = p.bias === "bearish";
          const y = bull ? c.wickBottom + 11 : c.wickTop - 5;
          return (
            <text
              key={`p-${p.index}`}
              x={c.x}
              y={y}
              textAnchor="middle"
              fontSize={bull || bear ? fontSize : fontSize * 0.75}
              fill={bull ? C.up : bear ? C.down : C.average}
              data-testid="pattern-marker"
            >
              {bull ? "▲" : bear ? "▼" : "◆"}
              <title>{`${p.name}: ${p.hint}`}</title>
            </text>
          );
        })}
        {/* The price tag at the right edge. */}
        <rect x={box.width - box.padRight + 2} y={g.lastY - fontSize * 0.8} width={box.padRight - 2} height={fontSize * 1.6} fill={tone[last.tone]} />
        <text x={box.width - box.padRight / 2 + 1} y={g.lastY + fontSize / 3} textAnchor="middle" fontSize={fontSize} fontWeight="700" fill={C.tagText}>
          {format(last.close)}
        </text>
        {/* The crosshair. */}
        {hover ? (
          <g pointerEvents="none">
            <line x1={g.candles[hover.i]!.x} x2={g.candles[hover.i]!.x} y1={box.padTop} y2={box.height - box.padBottom} stroke={C.cross} strokeDasharray="3 3" />
            <line x1={box.padLeft} x2={box.width - box.padRight} y1={hover.y} y2={hover.y} stroke={C.cross} strokeDasharray="3 3" />
            <rect x={box.width - box.padRight + 2} y={hover.y - fontSize * 0.8} width={box.padRight - 2} height={fontSize * 1.6} fill={C.cross} />
            <text x={box.width - box.padRight / 2 + 1} y={hover.y + fontSize / 3} textAnchor="middle" fontSize={fontSize} fontWeight="700" fill={C.tagText}>
              {format(Math.round(priceAt(hover.y)))}
            </text>
          </g>
        ) : null}
      </svg>
      <figcaption className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: C.axis }}>
        {patterns ? <span>
          <span style={{ color: C.up }}>▲</span> bullish · <span style={{ color: C.down }}>▼</span> bearish · <span style={{ color: C.average }}>◆</span> indecision
        </span> : null}
        {g.pathAverage ? (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-0.5 w-5" style={{ background: C.average }} /> {average}-candle average
          </span>
        ) : null}
        {g.pathSlowAverage ? (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-0.5 w-5" style={{ background: C.slowAverage }} /> {slowAverage}-candle average
          </span>
        ) : null}
        {note ? <span>{note}</span> : null}
      </figcaption>
      {patterns && patternList ? (
        <div className="mt-2" data-testid={testId ? `${testId}-patterns` : undefined}>
          {recent.length === 0 ? (
            <p className="text-xs text-slate-500">No pattern yet: they are marked here as the candles form.</p>
          ) : (
            <ul className="grid gap-1 text-xs lg:grid-cols-2">
              {recent.map((p) => (
                <li
                  key={p.index}
                  className="flex cursor-default gap-2 rounded bg-raised px-2 py-1"
                  onMouseEnter={() => setFocus(p.index)}
                  onMouseLeave={() => setFocus(null)}
                >
                  <span style={{ color: p.bias === "bullish" ? C.up : p.bias === "bearish" ? C.down : C.average }}>
                    {p.bias === "bullish" ? "▲" : p.bias === "bearish" ? "▼" : "◆"}
                  </span>
                  <span>
                    <b className="text-paper">{p.name}</b> <span className="text-slate-500">({candles[p.index]?.label})</span>: {p.hint}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </figure>
  );
}
