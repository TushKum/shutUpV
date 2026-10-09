"use client";

// One company's line in the judge table, and (opened with its Runs button) the detail of every judge run: run,
// generation, model, status, total, breakdown, rationale, latency and error, with the judged submission's text.

import { Fragment, useState } from "react";
import { RULES, type SubmissionType } from "@msim/engine";
import { JUDGE_COLUMNS, breakdownLines, companyLabel, latency, type CompanyJudgeView, type JudgeRunRow } from "@/lib/admin/judge";
import { bp, clock, dateTime } from "@/lib/format";
import { Badge } from "@/components/ui/ui";

const RUN_TONE = { QUEUED: "slate", RUNNING: "blue", DONE: "green", FAILED: "red" } as const;

const cell = "whitespace-nowrap px-2 py-1.5";
const num = `${cell} font-mono tabular-nums`;

function RunTotals({ runs }: { runs: readonly JudgeRunRow[] }) {
  if (runs.length === 0) return <span className="text-slate-500">—</span>;
  return (
    <span>
      {runs.map((r, i) => (
        <Fragment key={r.id}>
          {i > 0 ? " " : null}
          {r.status === "DONE" ? (
            <span className="font-mono tabular-nums" title={`Run ${r.run_no}`}>
              {r.total}
            </span>
          ) : (
            <span className={`text-xs ${r.status === "FAILED" ? "text-red-700" : "text-slate-500"}`} title={`Run ${r.run_no}`}>
              {r.status.toLowerCase()}
            </span>
          )}
        </Fragment>
      ))}
    </span>
  );
}

function Breakdown({ type, breakdown }: { type: SubmissionType; breakdown: Record<string, unknown> | null }) {
  const lines = breakdownLines(type, breakdown);
  if (lines.length === 0) return <span className="text-slate-500">—</span>;
  return (
    <ul className="space-y-0.5 text-xs">
      {lines.map((l) => (
        <li key={l.key} className="flex justify-between gap-3">
          <span className="text-slate-600">{l.label}</span>
          <span className="font-mono tabular-nums">
            {l.value ?? "—"}
            {l.max !== null ? `/${l.max}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CompanyRow({ type, view: v }: { type: SubmissionType; view: CompanyJudgeView }) {
  const [open, setOpen] = useState(false);
  const label = companyLabel(v);
  const s = v.score;
  return (
    <>
      <tr className={open ? "bg-slate-50" : ""}>
        <td className={cell}>
          <span className="font-mono font-semibold">{label}</span>
          {v.company.name ? (
            <>
              {" "}
              <span className="ml-1 text-xs text-slate-500">{v.company.name}</span>
            </>
          ) : null}
          {/* In the first column, so it is in view on a phone without scrolling the table. */}
          <div>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label={`${open ? "Hide" : "Show"} runs of ${label}`}
              className="text-xs font-semibold text-slate-700 underline hover:text-slate-900"
            >
              {open ? "Hide runs" : `Runs (${v.allRuns.length})`}
            </button>
          </div>
        </td>
        <td className={cell}>
          {v.submission ? (
            <span title={dateTime(v.submission.submitted_at)}>
              {clock(v.submission.submitted_at)} · <span className="tabular-nums">{v.submission.word_count}</span> words
            </span>
          ) : (
            <span className="text-slate-500">None</span>
          )}
        </td>
        <td className={cell}>
          <RunTotals runs={v.runs} />
          {v.generation !== null && v.generation > 1 ? <span className="text-xs text-slate-500"> (re-run {v.generation})</span> : null}
        </td>
        <td className={`${num} ${v.spread !== null && v.spread > 10 ? "font-semibold text-amber-700" : ""}`}>{v.spread ?? "—"}</td>
        <td className={num}>
          {v.median ? (
            <>
              {v.median.value}
              {v.median.sealed ? null : <span className="font-sans text-xs text-slate-500"> (unsealed)</span>}
            </>
          ) : (
            "—"
          )}
        </td>
        <td className={`${num} font-semibold`}>{s?.final_score ?? "—"}</td>
        <td className={num}>{s?.tier_bp !== null && s?.tier_bp !== undefined ? bp(s.tier_bp) : "—"}</td>
        <td className={cell}>{s ? (s.capped ? <Badge tone="amber">Capped at 50</Badge> : "No") : "—"}</td>
        <td className={num}>{s ? (s.penalty > 0 ? `−${s.penalty}` : "0") : "—"}</td>
        <td className={cell}>
          <span className="inline-flex flex-wrap gap-1">
            <Badge tone={v.status.tone}>{v.status.label}</Badge>
            {v.stale ? (
              <>
                {" "}
                <Badge tone="red">Submission changed: judge again</Badge>
              </>
            ) : null}
          </span>
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={JUDGE_COLUMNS.length} className="bg-slate-50 px-3 pb-4 pt-1">
            {/* Pinned to the left edge of the table's scroller and as wide as the screen, so on a phone the detail is
                in view however far the table was scrolled. */}
            <div className="sticky left-0 w-[calc(100vw-4.5rem)] lg:w-auto">
              <Detail type={type} view={v} label={label} />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Detail({ type, view: v, label }: { type: SubmissionType; view: CompanyJudgeView; label: string }) {
  const s = v.score;
  return (
    <div className="space-y-4" role="region" aria-label={`Runs of ${label}`}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Judged submission</h4>
          {v.submission ? (
            <>
              <p className="text-sm text-slate-700">
                Submitted {dateTime(v.submission.submitted_at)} · {v.submission.word_count} of {RULES.WORD_LIMIT[type]} words
              </p>
              <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 font-sans text-xs text-slate-800">
                {v.submission.body_text}
              </pre>
            </>
          ) : (
            <p className="text-sm text-slate-600">No on-time submission: it scores 0 once sealed.</p>
          )}
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Published breakdown and rationale</h4>
          {s && s.breakdown ? (
            <div className="mt-1 max-w-md">
              <Breakdown type={type} breakdown={s.breakdown} />
              <p className="mt-2 text-sm text-slate-700">{s.rationale}</p>
              <p className="mt-1 text-xs text-slate-500">From the first run whose total equals the median ({s.median}).</p>
            </div>
          ) : (
            <p className="text-sm text-slate-600">{s?.rationale ?? "Shown once the score is sealed."}</p>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              {["Run", "Generation", "Model", "Status", "Total", "Breakdown", "Rationale", "Latency", "Error"].map((h) => (
                <th key={h} className="whitespace-nowrap px-2 py-2 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 align-top">
            {v.allRuns.map((r) => (
              <tr key={r.id} className={r.current ? "" : "text-slate-500"}>
                <td className={num}>{r.run_no}</td>
                <td className={cell}>
                  {r.generation}
                  {r.current ? null : <span className="text-xs"> (earlier submission)</span>}
                </td>
                <td className={`${cell} font-mono text-xs`}>{r.model ?? "—"}</td>
                <td className={cell}>
                  <Badge tone={RUN_TONE[r.status]}>{r.status}</Badge>
                  {r.attempts > 1 ? <span className="text-xs text-slate-500"> {r.attempts} attempts</span> : null}
                </td>
                <td className={`${num} font-semibold`}>{r.total ?? "—"}</td>
                <td className="min-w-56 px-2 py-1.5">
                  <Breakdown type={type} breakdown={r.breakdown} />
                </td>
                <td className="min-w-64 max-w-md px-2 py-1.5 text-xs text-slate-700">{r.rationale ?? "—"}</td>
                <td className={num}>{latency(r.latency_ms)}</td>
                <td className="min-w-40 max-w-xs px-2 py-1.5 text-xs text-red-700">{r.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {v.allRuns.length === 0 ? <p className="px-2 py-3 text-sm text-slate-500">No judge runs yet.</p> : null}
      </div>
    </div>
  );
}
