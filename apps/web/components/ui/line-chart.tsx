// A line chart in plain SVG (geometry in lib/chart.ts): the main series solid with a light area under it, an optional
// second series dashed, a few y ticks, and tags above the steps that matter (IPO, crisis, verdicts). It scales to its
// container's width. A <title> per point gives the exact value on hover; the chart carries a one-line summary for
// screen readers, and the page keeps a table with every value.

import { axisMoney, chartGeometry, chartSummary, sparkPath, type ChartPoint } from "@/lib/chart";
import { money } from "@/lib/format";

const BOX = { width: 720, height: 240, padLeft: 64, padRight: 16, padTop: 26, padBottom: 22 };

export function LineChart({
  points,
  label,
  mainName,
  secondName,
  testId,
}: {
  points: readonly ChartPoint[];
  /** What the chart shows, e.g. "AQS price by step". */
  label: string;
  mainName: string;
  secondName?: string;
  testId?: string;
}) {
  if (points.length < 2) return null;
  const g = chartGeometry(points, BOX);
  const bottom = BOX.height - BOX.padBottom;
  const up = points.at(-1)!.value >= points[0]!.value;
  const stroke = up ? "#15803d" : "#b91c1c";
  const tickStep = g.yTicks.length > 1 ? g.yTicks[1]!.value - g.yTicks[0]!.value : 1;
  return (
    <figure className="w-full" data-testid={testId}>
      <svg viewBox={`0 0 ${BOX.width} ${BOX.height}`} className="h-auto w-full" role="img" aria-label={`${label}: ${chartSummary(points, money)}`}>
        {g.yTicks.map((t) => (
          <g key={t.value}>
            <line x1={BOX.padLeft} x2={BOX.width - BOX.padRight} y1={t.y} y2={t.y} stroke="#e2e8f0" strokeWidth="1" />
            <text x={BOX.padLeft - 8} y={t.y + 4} textAnchor="end" fontSize="11" fill="#64748b">
              {axisMoney(t.value, tickStep, g.max, money)}
            </text>
          </g>
        ))}
        {g.points
          .filter((p) => p.marker)
          .map((p) => (
            <g key={`m-${p.x}`}>
              <line x1={p.x} x2={p.x} y1={BOX.padTop - 4} y2={bottom} stroke="#94a3b8" strokeWidth="1" strokeDasharray="2 3" />
              <text x={p.x} y={BOX.padTop - 10} textAnchor="middle" fontSize="11" fontWeight="600" fill="#334155">
                {p.marker}
              </text>
            </g>
          ))}
        <path d={g.area} fill={stroke} opacity="0.08" />
        {g.path2 ? <path d={g.path2} fill="none" stroke="#7c3aed" strokeWidth="2" strokeDasharray="6 4" /> : null}
        <path d={g.path} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {g.points.map((p) => (
          <circle key={`p-${p.x}`} cx={p.x} cy={p.y} r="3" fill={stroke}>
            <title>{`${p.label}: ${money(p.value)}${p.second != null && secondName ? ` · ${secondName} ${money(p.second)}` : ""}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-5" style={{ background: stroke }} /> {mainName}
        </span>
        {secondName && g.path2 ? (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-5 border-t-2 border-dashed border-violet-600" /> {secondName}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

/** A small trend line for a table cell; green if the last value is at least the first, red otherwise. */
export function Sparkline({ values, label }: { values: readonly number[]; label: string }) {
  if (values.length < 2) return <span className="text-xs text-slate-400">—</span>;
  const up = values.at(-1)! >= values[0]!;
  return (
    <svg viewBox="0 0 64 20" width="64" height="20" role="img" aria-label={label} className="overflow-visible">
      <path d={sparkPath(values, 64, 20)} fill="none" stroke={up ? "#15803d" : "#b91c1c"} strokeWidth="1.75" strokeLinejoin="round" />
    </svg>
  );
}
