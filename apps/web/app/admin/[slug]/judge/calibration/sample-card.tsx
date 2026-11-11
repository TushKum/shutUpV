// One sample of a calibration batch: its title, expected band, word count and status; its runs 1–5 (status, total,
// model; the median run marked) with any failure; the median, spread and verdict against the band; and, folded away,
// the text as the batch stored it, the median run's breakdown and rationale, and the exact request the judge was
// sent, with the lines removed before judging and a check that they are not in it.

import { breakdownLines, latency } from "@/lib/admin/judge";
import { bandText, leakedLines, runIssue, type CalibrationRunRow, type SampleView } from "@/lib/admin/calibration";
import { Badge } from "@/components/ui/ui";

const RUN_STYLE: Record<CalibrationRunRow["status"], string> = {
  QUEUED: "border-dashed border-line bg-raised text-paper",
  RUNNING: "border-phosphor-dim bg-phosphor-deep/40 text-phosphor-mid",
  DONE: "border-line bg-panel text-phosphor",
  FAILED: "border-danger/70 bg-danger/10 text-danger-soft",
};

const ISSUE_TONE = { red: "text-danger-soft", amber: "text-warn" } as const;

const summaryClass = "cursor-pointer text-sm font-semibold text-paper hover:text-phosphor";
const preClass = "mt-1 max-h-80 overflow-y-auto whitespace-pre-wrap rounded border border-line bg-panel p-2 text-xs text-phosphor";

function RunChip({ r, median }: { r: CalibrationRunRow; median: boolean }) {
  return (
    <li
      className={`rounded-md border px-2 py-1 text-xs ${RUN_STYLE[r.status]} ${median ? "ring-2 ring-phosphor" : ""}`}
      data-testid="calibration-run"
      data-run={r.run_no}
      data-status={r.status}
    >
      <span className="text-muted">Run {r.run_no}</span>{" "}
      {r.status === "DONE" ? <span className="font-mono text-sm font-semibold tabular-nums">{r.total}</span> : <span className="font-semibold">{r.status.toLowerCase()}</span>}
      {median ? <span className="ml-1 font-semibold">(median)</span> : null}
      {r.model ? <span className="block font-mono text-[11px] text-muted [overflow-wrap:anywhere]">{r.model}</span> : null}
    </li>
  );
}

export function SampleCard({ v, request }: { v: SampleView; request: string | null }) {
  const issues = v.runs.flatMap((r) => {
    const issue = runIssue(r);
    return issue ? [{ ...issue, runNo: r.run_no }] : [];
  });
  const leaked = v.removed ? leakedLines(v.removed, request) : [];
  const m = v.medianRun;
  return (
    <li
      className="rounded-md border border-line p-3"
      aria-label={`Sample ${v.sampleNo}`}
      data-testid="calibration-sample"
      data-sample={v.sampleNo}
      data-verdict={v.verdict?.kind ?? ""}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-phosphor">
            <span className="font-mono">#{v.sampleNo}</span> {v.title}
          </p>
          <p className="text-xs text-muted">
            Expected {bandText(v.expected)}
            {v.words !== null ? ` · ${v.words} words` : ""} · {v.companyName} ({v.ticker})
          </p>
        </div>
        <Badge tone={v.status.tone}>{v.status.label}</Badge>
      </div>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <ol className="flex flex-wrap gap-1.5" aria-label={`Runs of sample ${v.sampleNo}`}>
          {v.runs.map((r) => (
            <RunChip key={r.id} r={r} median={m?.id === r.id} />
          ))}
        </ol>
        <dl className="flex flex-wrap items-end gap-x-5 gap-y-1 text-sm">
          <div>
            <dt className="text-xs text-muted">Median</dt>
            <dd className="font-mono text-lg font-semibold tabular-nums" data-testid="calibration-median">
              {v.median ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Spread</dt>
            <dd className={`font-mono text-lg tabular-nums ${v.spread !== null && v.spread > 10 ? "font-semibold text-warn" : ""}`}>{v.spread ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Verdict</dt>
            <dd className="pb-1" data-testid="calibration-verdict">
              {v.verdict ? <Badge tone={v.verdict.tone}>{v.verdict.label}</Badge> : <span className="text-muted">—</span>}
            </dd>
          </div>
        </dl>
      </div>

      {v.extraRuns ? <p className="mt-1 text-xs text-muted">Runs 4 and 5 were added: the first 3 spread more than 10 points.</p> : null}
      {issues.map((x) => (
        <p key={x.runNo} className={`mt-1 text-xs ${ISSUE_TONE[x.tone]}`}>
          {x.text}
        </p>
      ))}

      <div className="mt-2 space-y-1 border-t border-line pt-2">
        <details>
          <summary className={summaryClass}>Sample text</summary>
          {v.text !== null ? <pre className={`${preClass} font-sans`}>{v.text}</pre> : <p className="text-sm text-muted">Not stored.</p>}
        </details>

        <details data-testid="calibration-median-run">
          <summary className={summaryClass}>Median run: breakdown and rationale</summary>
          {m ? (
            <div className="mt-1 max-w-xl space-y-2">
              <p className="text-xs text-muted">
                Run {m.run_no}, the first whose total equals the median · {m.model ?? "—"} · {latency(m.latency_ms)}
              </p>
              <ul className="space-y-0.5 text-xs">
                {breakdownLines("PITCH", m.breakdown).map((l) => (
                  <li key={l.key} className="flex justify-between gap-3">
                    <span className="text-paper">{l.label}</span>
                    <span className="font-mono tabular-nums">
                      {l.value ?? "—"}
                      {l.max !== null ? `/${l.max}` : ""}
                    </span>
                  </li>
                ))}
                <li className="flex justify-between gap-3 border-t border-line pt-0.5 font-semibold">
                  <span>Total</span>
                  <span className="font-mono tabular-nums">{m.total}</span>
                </li>
              </ul>
              <p className="text-sm text-paper">{m.rationale}</p>
            </div>
          ) : (
            <p className="text-sm text-muted">Shown once the runs are complete.</p>
          )}
        </details>

        <details data-testid="calibration-request">
          <summary className={summaryClass}>The request the judge saw</summary>
          <div className="mt-1 space-y-2">
            {v.removed && v.removed.length > 0 ? (
              <div className="text-sm">
                <p className="text-paper">Removed before judging (lines aimed at the judge):</p>
                <ul className="list-disc pl-5 text-paper">
                  {v.removed.map((h) => (
                    <li key={h.lineNumber}>
                      Line {h.lineNumber}: “{h.line}” <span className="text-xs text-muted">({h.pattern})</span>
                    </li>
                  ))}
                </ul>
                {request === null ? null : leaked.length > 0 ? (
                  <p className="font-semibold text-danger-soft" role="alert">
                    {leaked.length === 1 ? "This line is" : "These lines are"} still in the request below.
                  </p>
                ) : (
                  <p className="text-phosphor" data-testid="calibration-stripped">
                    Checked: not in the request below.
                  </p>
                )}
              </div>
            ) : v.removed ? (
              <p className="text-sm text-paper">No line of this sample is aimed at the judge.</p>
            ) : null}
            {request !== null ? (
              <>
                <p className="text-xs text-muted">
                  The user message of run {v.runs.find((r) => r.id === v.requestRunId)?.run_no ?? "—"}, exactly as sent (every run of a sample gets the same
                  one); the system prompt is prompts/PITCH.md.
                </p>
                <pre className={`${preClass} font-mono`}>{request}</pre>
              </>
            ) : (
              <p className="text-sm text-muted">Shown once a run has reported.</p>
            )}
          </div>
        </details>
      </div>
    </li>
  );
}
