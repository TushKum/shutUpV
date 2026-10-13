import type { Verdict } from "@/lib/team/market";

// Why a released score is what it is: the points of the published judge run per rubric line, and its rationale.
export function VerdictDetail({ v }: { v: Verdict }) {
  if (!v.lines.length && !v.rationale) return null;
  return (
    <details className="mt-1 text-sm">
      <summary className="cursor-pointer text-slate-700 underline underline-offset-2">Why this score</summary>
      {v.lines.length ? (
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
          {v.lines.map((l) => (
            <div key={l.label} className="contents">
              <dt className="text-slate-600">{l.label}</dt>
              <dd className="text-right font-mono tabular-nums">
                {l.points ?? "—"}/{l.max}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {v.rationale ? <p className="mt-2 whitespace-pre-wrap text-slate-700">{v.rationale}</p> : null}
    </details>
  );
}
