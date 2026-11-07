// A revealed score as a team sees it: the final score, each rubric line's points out of its maximum, the judge's
// three-sentence reason, and the penalty when a line aimed at the judge was removed for the second time.

import { RUBRICS, type SubmissionType } from "@msim/engine";

export interface RevealedScore {
  final_score: number | null;
  median: number | null;
  penalty: number;
  missing: boolean;
  breakdown: Record<string, unknown> | null;
  rationale: string | null;
}

export function ScoreCard({ type, score, extra }: { type: SubmissionType; score: RevealedScore; extra?: React.ReactNode }) {
  const lines = RUBRICS[type];
  const points = (k: string) => (typeof score.breakdown?.[k] === "number" ? (score.breakdown[k] as number) : null);
  return (
    <div className="space-y-3" data-testid={`score-${type}`}>
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-4xl font-bold tabular-nums text-slate-900">{score.final_score ?? "—"}</span>
        <span className="text-sm text-slate-600">out of 100</span>
        {extra}
      </div>
      {score.missing ? (
        <p className="text-sm text-slate-700">Nothing was saved before the lock, so this round scores 0.</p>
      ) : (
        <>
          <table className="w-full max-w-lg text-sm">
            <tbody>
              {lines.map((l) => (
                <tr key={l.key} className="border-b border-slate-100 last:border-0">
                  <td className="py-1 pr-3 text-slate-700">{l.label}</td>
                  <td className="py-1 text-right font-mono tabular-nums">
                    {points(l.key) ?? "—"} / {l.max}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {score.penalty ? (
            <p className="text-sm text-red-800">
              −{score.penalty} points: a second line aimed at the judge was removed from your work (median {score.median} → {score.final_score}).
            </p>
          ) : null}
          {score.rationale ? <p className="max-w-2xl whitespace-pre-wrap text-sm text-slate-800">{score.rationale}</p> : null}
          <p className="text-xs text-slate-500">The median of three independent readings counts; this is the reading at the median.</p>
        </>
      )}
    </div>
  );
}
