// Candlestick charts in plain SVG (geometry in lib/chart.ts candleGeometry), drawn like a trading platform: each candle's
// body from open to close (green up, red down, a thin grey bar unchanged) with its wick from the high to the low, the
// shares traded as volume bars underneath, an optional moving average of the closes (amber line), the score-based price
// as a dashed line, and a dotted last-price line with the price in a tag on the right. Colours come from the same CSS variables as the
// line chart, so the dark terminal screens redraw it in their palette. `live` pulses the latest candle: the page is
// re-read at every clearing, so the last candle is always the latest step.

import { axisMoney, candleGeometry, candlesFrom, type Candle, type ChartBox, type PlacedCandle } from "@/lib/chart";
import { count, money } from "@/lib/format";

const BOX: ChartBox = { width: 720, height: 280, padLeft: 64, padRight: 72, padTop: 26, padBottom: 12 };

const C = {
  up: "var(--chart-up, #15803d)",
  down: "var(--chart-down, #b91c1c)",
  flat: "var(--chart-axis, #64748b)",
  grid: "var(--chart-grid, #e2e8f0)",
  axis: "var(--chart-axis, #64748b)",
  marker: "var(--chart-marker, #94a3b8)",
  markerText: "var(--chart-marker-text, #334155)",
  second: "var(--chart-second, #7c3aed)",
  volume: "var(--chart-volume, #cbd5e1)",
  average: "var(--chart-average, #d97706)",
  tagText: "var(--chart-tag-text, #ffffff)",
};

export function CandleChart({
  candles,
  label,
  secondName,
  testId,
  box = BOX,
  fontSize = 11,
  format = money,
  live = false,
  caption = true,
  average = 0,
}: {
  candles: readonly Candle[];
  /** What the chart shows, e.g. "AQS price by step". */
  label: string;
  /** The dashed line's name in the legend (the score-based price), when the candles carry it. */
  secondName?: string;
  testId?: string;
  box?: ChartBox;
  fontSize?: number;
  /** How a value is written on the axis and in the tooltips (money by default). */
  format?: (value: number) => string;
  /** A pulsing ring round the latest candle. */
  live?: boolean;
  caption?: boolean;
  /** The moving average's window in candles (0: no average). */
  average?: number;
}) {
  if (candles.length < 2) return null;
  const g = candleGeometry(candles, box, 4, average);
  const tickStep = g.yTicks.length > 1 ? g.yTicks[1]!.value - g.yTicks[0]!.value : 1;
  const axis = format === money ? (v: number) => axisMoney(v, tickStep, g.max, money) : format;
  const first = candles[0]!;
  const lastC = candles.at(-1)!;
  const last = g.candles.at(-1)!;
  const tone = { up: C.up, down: C.down, flat: C.flat };
  return (
    <figure className="w-full" data-testid={testId}>
      <svg
        viewBox={`0 0 ${box.width} ${box.height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${label}: ${first.label} ${format(first.close)}, ${lastC.label} ${format(lastC.close)}, ${candles.length} steps.`}
      >
        {g.yTicks.map((t) => (
          <g key={t.value}>
            <line x1={box.padLeft} x2={box.width - box.padRight} y1={t.y} y2={t.y} stroke={C.grid} strokeWidth="1" />
            <text x={box.padLeft - 8} y={t.y + fontSize / 3} textAnchor="end" fontSize={fontSize} fill={C.axis}>
              {axis(t.value)}
            </text>
          </g>
        ))}
        {markers(g.candles, fontSize).map(({ c, text }) => (
          <g key={`m-${c.x}`}>
            <line x1={c.x} x2={c.x} y1={box.padTop - 4} y2={g.volBottom} stroke={C.marker} strokeWidth="1" strokeDasharray="2 3" />
            {text ? (
              <text x={c.x} y={box.padTop - 10} textAnchor="middle" fontSize={fontSize} fontWeight="600" fill={C.markerText}>
                {c.marker}
              </text>
            ) : null}
          </g>
        ))}
        {g.maxVolume > 0
          ? g.candles.map((c) =>
              c.volTop < g.volBottom ? (
                <rect key={`v-${c.x}`} x={c.x - g.width / 2} y={c.volTop} width={g.width} height={g.volBottom - c.volTop} fill={C.volume} opacity="0.5">
                  <title>{`${c.label}: ${count(c.volume ?? 0)} shares traded`}</title>
                </rect>
              ) : null,
            )
          : null}
        {/* The last price: a dotted line across the chart and the price in a tag at the right edge. */}
        <line x1={box.padLeft} x2={box.width - box.padRight} y1={g.lastY} y2={g.lastY} stroke={tone[last.tone]} strokeWidth="1" strokeDasharray="1 3" />
        {g.path2 ? <path d={g.path2} fill="none" stroke={C.second} strokeWidth={fontSize / 5.5} strokeDasharray="6 4" /> : null}
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
            data-testid={testId ? `${testId}-live` : undefined}
          />
        ) : null}
        {g.candles.map((c) => (
          <g key={`c-${c.x}`}>
            <title>{`${c.label}: open ${format(c.open)} · high ${format(c.high ?? Math.max(c.open, c.close))} · low ${format(c.low ?? Math.min(c.open, c.close))} · close ${format(c.close)}${c.volume ? ` · ${count(c.volume)} shares` : ""}${c.second != null && secondName ? ` · ${secondName} ${format(c.second)}` : ""}`}</title>
            {c.wickBottom - c.wickTop > c.bottom - c.top ? (
              <line x1={c.x} x2={c.x} y1={c.wickTop} y2={c.wickBottom} stroke={tone[c.tone]} strokeWidth={Math.max(1, Math.min(2, g.width / 4))} />
            ) : null}
            <rect x={c.x - g.width / 2} y={c.top} width={g.width} height={c.bottom - c.top} fill={tone[c.tone]} />
          </g>
        ))}
        {g.pathAverage ? <path d={g.pathAverage} fill="none" stroke={C.average} strokeWidth={fontSize / 6} strokeLinejoin="round" /> : null}
        <g>
          <rect x={box.width - box.padRight + 2} y={g.lastY - fontSize * 0.75} width={box.padRight - 2} height={fontSize * 1.5} fill={tone[last.tone]} />
          <text x={box.width - box.padRight / 2 + 1} y={g.lastY + fontSize / 3} textAnchor="middle" fontSize={fontSize * 0.85} fontWeight="700" fill={C.tagText}>
            {format(lastC.close)}
          </text>
        </g>
      </svg>
      {caption ? (
        <figcaption className="mt-1 flex flex-wrap gap-x-4 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-1.5" style={{ background: C.up }} />
            <span className="inline-block h-2.5 w-1.5" style={{ background: C.down }} /> open → close, wick high to low
          </span>
          {g.pathAverage ? (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-0.5 w-5" style={{ background: C.average }} /> {average}-candle average
            </span>
          ) : null}
          {g.maxVolume > 0 ? (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 opacity-50" style={{ background: C.volume }} /> shares traded
            </span>
          ) : null}
          {secondName && g.path2 ? (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-5 border-t-2 border-dashed" style={{ borderColor: C.second }} /> {secondName}
            </span>
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

/** The tagged candles; a tag too close to the one before it keeps its line but not its text, so tags never overlap. */
function markers(candles: readonly PlacedCandle[], fontSize: number): { c: PlacedCandle; text: boolean }[] {
  let lastX = -Infinity;
  return candles
    .filter((c) => c.marker)
    .map((c) => {
      const text = c.x - lastX >= fontSize * 4.5;
      if (text) lastX = c.x;
      return { c, text };
    });
}

/** Small candles for a table row or a tile: one per step, from the values in order. */
export function MiniCandles({ values, label, width = 64, height = 20 }: { values: readonly number[]; label: string; width?: number; height?: number }) {
  if (values.length < 2) return <span className="text-xs text-slate-400">—</span>;
  const g = candleGeometry(candlesFrom(values), { width, height, padLeft: 0, padRight: 0, padTop: 1, padBottom: 1 }, 1);
  const tone = { up: C.up, down: C.down, flat: C.flat };
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label} className="shrink-0 overflow-visible">
      {g.candles.map((c) => (
        <rect key={c.x} x={c.x - g.width / 2} y={c.top} width={g.width} height={Math.max(1, c.bottom - c.top)} fill={tone[c.tone]} />
      ))}
    </svg>
  );
}
