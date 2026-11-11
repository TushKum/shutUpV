// Line charts drawn as plain SVG: the geometry (scales, ticks, paths) is computed here so it can be tested, and the
// components (components/ui/line-chart.tsx) only draw it. Values are integer cents; x is the step's index, so every
// round gets the same width whatever its length.

export interface ChartPoint {
  /** Shown in the tooltip and the accessible summary, e.g. "Round 4". */
  label: string;
  /** Cents. */
  value: number;
  /** A second series drawn dashed (the AI price); null where it has no value. */
  second?: number | null;
  /** A short tag drawn above the step (IPO, Crisis, Plan, Flash, Close), or null. */
  marker?: string | null;
}

export interface ChartBox {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
}

export interface PlacedPoint extends ChartPoint {
  x: number;
  y: number;
  /** The second series' y, or null. */
  y2: number | null;
}

export interface ChartGeometry {
  box: ChartBox;
  points: PlacedPoint[];
  /** "M x y L x y …" through every point, or "" with no points. */
  path: string;
  /** The second series' path, broken where it has no value. */
  path2: string;
  /** The area under the main line, closed along the bottom. */
  area: string;
  yTicks: { y: number; value: number }[];
  min: number;
  max: number;
}

/** A tick step of 1, 2 or 5 × 10^k cents that gives about `target` ticks over `span`. */
export function niceStep(span: number, target = 4): number {
  if (!(span > 0)) return 1;
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return Math.max(1, Math.round(m * pow));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function chartGeometry(input: readonly ChartPoint[], box: ChartBox, ticks = 4): ChartGeometry {
  const values = input.flatMap((p) => [p.value, ...(p.second != null ? [p.second] : [])]);
  if (values.length === 0) return { box, points: [], path: "", path2: "", area: "", yTicks: [], min: 0, max: 0 };
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi === lo) {
    const pad = Math.max(10, Math.round(hi * 0.02));
    lo -= pad;
    hi += pad;
  }
  const step = niceStep(hi - lo, ticks);
  const min = Math.max(0, Math.floor(lo / step) * step);
  const max = Math.ceil(hi / step) * step;
  const plotW = box.width - box.padLeft - box.padRight;
  const plotH = box.height - box.padTop - box.padBottom;
  const xAt = (i: number) => round1(box.padLeft + (input.length === 1 ? plotW / 2 : (plotW * i) / (input.length - 1)));
  const yAt = (v: number) => round1(box.padTop + plotH - ((v - min) / (max - min)) * plotH);
  const points: PlacedPoint[] = input.map((p, i) => ({ ...p, x: xAt(i), y: yAt(p.value), y2: p.second != null ? yAt(p.second) : null }));
  const path = points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
  let path2 = "";
  let pen = false;
  for (const p of points) {
    if (p.y2 === null) {
      pen = false;
      continue;
    }
    path2 += `${path2 ? " " : ""}${pen ? "L" : "M"}${p.x} ${p.y2}`;
    pen = true;
  }
  const bottom = round1(box.padTop + plotH);
  const area = `${path} L${points.at(-1)!.x} ${bottom} L${points[0]!.x} ${bottom} Z`;
  const yTicks: { y: number; value: number }[] = [];
  for (let v = min; v <= max; v += step) yTicks.push({ y: yAt(v), value: v });
  return { box, points, path, path2, area, yTicks, min, max };
}

/** A y-axis label: exact money for prices, "$540k" once values reach $10,000 (whole thousands, or one decimal when the
 * ticks are closer than $1,000 apart). */
export function axisMoney(cents: number, stepCents: number, max: number, fmt: (cents: number) => string): string {
  if (max < 1_000_000) return fmt(cents);
  const k = cents / 100_000;
  return `$${stepCents < 100_000 ? k.toFixed(1) : Math.round(k).toLocaleString("en-US")}k`;
}

/** A sparkline path through the values, scaled to fill width × height (flat values draw a middle line). */
export function sparkPath(values: readonly number[], width: number, height: number): string {
  if (values.length === 0) return "";
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const y = (v: number) => round1(hi === lo ? height / 2 : height - ((v - lo) / (hi - lo)) * height);
  const x = (i: number) => round1(values.length === 1 ? width / 2 : (width * i) / (values.length - 1));
  return values.map((v, i) => `${i ? "L" : "M"}${x(i)} ${y(v)}`).join(" ");
}

/** One sentence for screen readers: first and last value and the range. */
export function chartSummary(points: readonly ChartPoint[], fmt: (cents: number) => string): string {
  if (points.length === 0) return "No values yet.";
  const first = points[0]!;
  const last = points.at(-1)!;
  const vals = points.map((p) => p.value);
  return `${first.label} ${fmt(first.value)}, ${last.label} ${fmt(last.value)}; lowest ${fmt(Math.min(...vals))}, highest ${fmt(Math.max(...vals))}, ${points.length} steps.`;
}

// ───────────────────────────── Candlesticks ─────────────────────────────

/**
 * One candle: open, close and, when known, the highest and lowest price in between (drawn as the wick). Up candles
 * are green, down candles red, an unchanged one a thin grey bar.
 */
export interface Candle {
  label: string;
  open: number;
  close: number;
  /** The highest and lowest price within the candle; the body's ends when left out. */
  high?: number | null;
  low?: number | null;
  /** Shares traded at this step (bought + sold), drawn as a bar under the candle; null for none. */
  volume?: number | null;
  /** A second series drawn as a dashed line through the candles (the score-based price), or null. */
  second?: number | null;
  /** A short tag drawn above the step (Start, Crisis, Reveal, Close), or null. */
  marker?: string | null;
}

export interface PlacedCandle extends Candle {
  /** Centre x of the candle. */
  x: number;
  /** Top and bottom y of the body (at least 2 units apart, so an unchanged step still shows). */
  top: number;
  bottom: number;
  /** The wick's ends: the high and the low. */
  wickTop: number;
  wickBottom: number;
  tone: "up" | "down" | "flat";
  /** The volume bar's top y (equal to `volBottom` for no volume). */
  volTop: number;
  /** The second series' y, or null. */
  y2: number | null;
}

export interface CandleGeometry {
  box: ChartBox;
  candles: PlacedCandle[];
  /** Body width. */
  width: number;
  /** The second series' path, broken where it has no value. */
  path2: string;
  /** The moving average of the closes (`average` candles), from the first candle it has a full window for. */
  pathAverage: string;
  /** y of the last close, for the last-price line. */
  lastY: number;
  yTicks: { y: number; value: number }[];
  min: number;
  max: number;
  /** The volume pane (empty when no candle has volume). */
  volTop: number;
  volBottom: number;
  maxVolume: number;
}

/** Candles from consecutive values: each step opens at the value before it (the first opens and closes at its own). */
export function candlesFrom(values: readonly number[], labels: readonly string[] = []): Candle[] {
  return values.map((v, i) => ({ label: labels[i] ?? `Step ${i + 1}`, open: i === 0 ? v : values[i - 1]!, close: v }));
}

/** Where every candle goes in `box`; the bottom fifth holds the volume bars when any candle has volume. */
export function candleGeometry(input: readonly Candle[], box: ChartBox, ticks = 4, average = 0): CandleGeometry {
  const empty = { box, candles: [], width: 0, path2: "", pathAverage: "", lastY: 0, yTicks: [], min: 0, max: 0, volTop: 0, volBottom: 0, maxVolume: 0 };
  if (input.length === 0) return empty;
  const values = input.flatMap((c) => [c.open, c.close, ...(c.high != null ? [c.high] : []), ...(c.low != null ? [c.low] : []), ...(c.second != null ? [c.second] : [])]);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi === lo) {
    const pad = Math.max(10, Math.round(hi * 0.02));
    lo -= pad;
    hi += pad;
  }
  const step = niceStep(hi - lo, ticks);
  const min = Math.max(0, Math.floor(lo / step) * step);
  const max = Math.ceil(hi / step) * step;
  const maxVolume = Math.max(0, ...input.map((c) => c.volume ?? 0));
  const plotW = box.width - box.padLeft - box.padRight;
  const plotBottom = box.height - box.padBottom;
  const plotH = plotBottom - box.padTop;
  const volH = maxVolume > 0 ? round1(plotH * 0.2) : 0;
  const gap = volH > 0 ? round1(plotH * 0.05) : 0;
  const priceBottom = plotBottom - volH - gap;
  const priceH = priceBottom - box.padTop;
  const slot = plotW / input.length;
  const width = round1(Math.max(1.5, Math.min(slot * 0.62, 48)));
  const yAt = (v: number) => round1(box.padTop + priceH - ((v - min) / (max - min)) * priceH);
  const candles: PlacedCandle[] = input.map((c, i) => {
    const x = round1(box.padLeft + slot * (i + 0.5));
    const a = yAt(c.open);
    const b = yAt(c.close);
    let top = Math.min(a, b);
    let bottom = Math.max(a, b);
    if (bottom - top < 2) {
      const mid = (top + bottom) / 2;
      top = round1(mid - 1);
      bottom = round1(mid + 1);
    }
    const v = c.volume ?? 0;
    return {
      ...c,
      x,
      top,
      bottom,
      wickTop: Math.min(top, yAt(Math.max(c.open, c.close, c.high ?? c.close))),
      wickBottom: Math.max(bottom, yAt(Math.min(c.open, c.close, c.low ?? c.close))),
      tone: c.close > c.open ? "up" : c.close < c.open ? "down" : "flat",
      volTop: maxVolume > 0 ? round1(plotBottom - (v / maxVolume) * volH) : plotBottom,
      y2: c.second != null ? yAt(c.second) : null,
    };
  });
  let path2 = "";
  let pen = false;
  for (const c of candles) {
    if (c.y2 === null) {
      pen = false;
      continue;
    }
    path2 += `${path2 ? " " : ""}${pen ? "L" : "M"}${c.x} ${c.y2}`;
    pen = true;
  }
  const avg = average > 1 ? movingAverage(input.map((c) => c.close), average) : [];
  const pathAverage = candles
    .map((c, i) => (avg[i] == null ? null : `${c.x} ${yAt(avg[i]!)}`))
    .reduce<string>((d, p) => (p === null ? d : `${d}${d ? " L" : "M"}${p}`), "");
  const yTicks: { y: number; value: number }[] = [];
  for (let v = min; v <= max; v += step) yTicks.push({ y: yAt(v), value: v });
  return { box, candles, width, path2, pathAverage, lastY: yAt(input.at(-1)!.close), yTicks, min, max, volTop: plotBottom - volH, volBottom: plotBottom, maxVolume };
}


/** The average of each value and the n − 1 before it (null until there are n values). */
export function movingAverage(values: readonly number[], n: number): (number | null)[] {
  let sum = 0;
  return values.map((v, i) => {
    sum += v;
    if (i >= n) sum -= values[i - n]!;
    return i >= n - 1 ? sum / n : null;
  });
}

// ───────────────────────────── The detailed chart ─────────────────────────────

