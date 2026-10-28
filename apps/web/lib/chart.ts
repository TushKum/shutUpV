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
