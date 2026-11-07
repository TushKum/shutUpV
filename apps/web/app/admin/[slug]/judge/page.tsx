import type { Metadata } from "next";
import Link from "next/link";
import { SUBMISSION_TYPES } from "@msim/engine";
import { currentViewer } from "@/lib/auth/viewer";
import { loadAdminEvent } from "@/lib/admin/event";
import { loadJudgeData } from "@/lib/admin/judge-data";
import { APPEAL_STATUS_LABELS, JUDGE_TYPE_LABELS, appealLines, judgeLines, judgeProgress, openAppealCompanies, pickType, type ScoreStatus } from "@/lib/admin/judge";
import { calibrationResults } from "@/lib/judge/calibration";
import { judgeConfig } from "@/lib/judge/config";
import { loadPrompt } from "@/lib/judge/prompts";
import { clock, count } from "@/lib/format";
import { Badge, Notice, Panel, Stat, Table, Td, inputClass, type Tone } from "@/components/ui/ui";
import { ActionButton, ActionForm } from "@/components/ui/action";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { applyAppeal, dismissAppeal, rerunJudging, retryFailed, setModelSlot, startCalibration, uploadCalibration } from "./actions";
import { JudgeRunner } from "./runner";

export const metadata: Metadata = { title: "Judge" };

const STATUS_TONE: Record<ScoreStatus | "NOT_LOCKED", Tone> = { NOT_LOCKED: "slate", PENDING: "blue", SCORING: "blue", SEALED: "green", REVEALED: "violet" };
const STATUS_LABEL: Record<ScoreStatus | "NOT_LOCKED", string> = { NOT_LOCKED: "Not locked", PENDING: "Judging", SCORING: "Judging", SEALED: "Sealed", REVEALED: "Revealed" };

// Judge: "Run the judge here" (this console works the queue), each round's progress (locked submissions, the three
// readings, sealed and revealed scores), every company's readings, median, penalty and final score, the backup-model
// switch, failed readings back to the queue, technical re-runs with a written reason and their approval by a second
// organiser after a reveal, and calibration before the event. Scores stay secret from everyone but organisers until
// their reveal (PRDs 23:30, solutions 02:45).
export default async function JudgePage({ params, searchParams }: PageProps<"/admin/[slug]/judge">) {
  const { slug } = await params;
  const sp = await searchParams;
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  if (viewer!.role !== "ORGANISER") {
    return <Notice tone="amber">Judging is the organisers&apos;. Scores are secret until their reveal; the fairness officer sees them from then on, under Fairness.</Notice>;
  }
  const data = await loadJudgeData(event.id);
  const type = pickType(sp.type, data.crisisApplied);
  const progress = judgeProgress(data, type);
  const lines = judgeLines(data, type);
  const slot = data.slots[type];
  const appeals = appealLines(data.appeals, data.companies, type, viewer!.userId);
  const open = openAppealCompanies(data.appeals, type);
  const cal = calibrationResults(data.calibration.samples, data.calibration.runs);
  const calRunning = data.calibration.runs.some((r) => r.status === "QUEUED" || r.status === "RUNNING");
  const active = progress.readings.queued + progress.readings.running > 0 || calRunning;
  let fake = false;
  try {
    fake = judgeConfig().fake;
  } catch {
    // A bad setting shows when the judge runs (the route answers with it).
  }
  const prompt = (() => {
    try {
      return loadPrompt(type).sha;
    } catch {
      return null;
    }
  })();

  return (
    <div className="space-y-6">
      <AutoRefresh everyMs={5000} active={active} />
      <Panel title="The judge worker">
        <JudgeRunner eventId={event.id} fake={fake} canRun />
        <p className="mt-2 text-xs text-slate-500">
          While it is on, this console judges queued readings for both rounds and calibration, a few at a time; several consoles share the work. A laptop
          can run <span className="font-mono">pnpm judge-worker --event {slug}</span> instead. It switches itself off on a configuration error (a bad key, an
          unknown model).
        </p>
      </Panel>
      <nav className="flex gap-2" aria-label="Round">
        {SUBMISSION_TYPES.map((t) => (
          <Link
            key={t}
            href={`/admin/${slug}/judge?type=${t}`}
            aria-current={t === type ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${t === type ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"}`}
          >
            {JUDGE_TYPE_LABELS[t]}
          </Link>
        ))}
      </nav>

      <Panel
        title={JUDGE_TYPE_LABELS[type]}
        actions={
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-600">Model:</span>
            <Badge tone={slot === "PRIMARY" ? "green" : "amber"}>{slot === "PRIMARY" ? "Primary" : "Backup"}</Badge>
            <ActionButton
              action={setModelSlot.bind(null, event.id, type, slot === "PRIMARY" ? "BACKUP" : "PRIMARY")}
              confirm={`Click again to switch to the ${slot === "PRIMARY" ? "backup" : "primary"} model`}
            >
              Switch to {slot === "PRIMARY" ? "backup" : "primary"}
            </ActionButton>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Locked submissions" value={count(progress.submissions)} hint={`${progress.missing} with nothing saved (score 0)`} />
          <Stat
            label="Readings done"
            value={`${count(progress.readings.done)} of ${count(progress.readings.total)}`}
            hint={`${progress.readings.queued} queued · ${progress.readings.running} running`}
          />
          <Stat
            label="Failed readings"
            value={<span className={progress.readings.failed ? "text-red-700" : ""}>{count(progress.readings.failed)}</span>}
            hint={
              progress.readings.failed ? (
                <ActionButton action={retryFailed.bind(null, event.id, type)}>Retry failed readings</ActionButton>
              ) : undefined
            }
          />
          <Stat
            label="Sealed"
            value={`${count(progress.sealed)} of ${count(progress.companies)}`}
            hint={progress.revealed ? `${progress.revealed} revealed` : progress.complete ? "Every score sealed" : "The phase waits for every score"}
          />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Each submission is read three times, independently; the median counts. Lines aimed at the judge are removed before it reads, and a team&apos;s
          second removed line costs 10 points. The judge worker seals each score when its three readings are in. If the primary model fails, switch
          to the backup: readings claimed from then on use it.
          {prompt ? (
            <>
              {" "}
              Prompt SHA-256 <span className="font-mono">{prompt.slice(0, 16)}…</span>
            </>
          ) : (
            <span className="font-semibold text-red-700"> The prompt file for this round is missing.</span>
          )}
        </p>
      </Panel>

      <Panel title={`Companies (${lines.length})`}>
        <Table head={["Ticker", "Author", "Words", "Readings", "Median", "Penalty", "Final", "Removed lines", "Status", "Re-run"]} empty="No company to judge yet.">
          {lines.map((l) => (
            <tr key={l.companyId} className={l.readings.some((r) => r.status === "FAILED") ? "bg-red-50" : ""}>
              <Td mono className="font-semibold">
                <span title={l.name}>{l.ticker}</span>
              </Td>
              <Td mono>{l.author}</Td>
              <Td mono>{l.words ?? "—"}</Td>
              <Td mono>
                {l.readings.length
                  ? l.readings.map((r) => (
                      <span key={r.runNo} title={r.error ?? r.status} className={`mr-2 ${r.status === "FAILED" ? "text-red-700" : r.status === "DONE" ? "" : "text-slate-400"}`}>
                        {r.total ?? (r.status === "FAILED" ? "✗" : "·")}
                      </span>
                    ))
                  : "—"}
              </Td>
              <Td mono>{l.median ?? "—"}</Td>
              <Td mono>{l.penalty ? `−${l.penalty}` : ""}</Td>
              <Td mono className="font-semibold">{l.final ?? "—"}</Td>
              <Td mono>{l.removed ?? "—"}</Td>
              <Td>
                <Badge tone={STATUS_TONE[l.status]}>{l.missing ? "Missing (0)" : STATUS_LABEL[l.status]}</Badge>
                {l.waiting ? <span className="ml-2 text-xs text-slate-500">{l.waiting}</span> : null}
                {open.has(l.companyId) ? <span className="ml-2 text-xs text-amber-700">re-run open</span> : null}
              </Td>
              <Td>
                {!l.missing && l.status !== "NOT_LOCKED" && !open.has(l.companyId) ? (
                  <details>
                    <summary className="cursor-pointer text-xs font-medium text-slate-600">Re-run…</summary>
                    <ActionForm action={rerunJudging.bind(null, l.companyId, type)} submit="Queue three new readings" className="mt-2 w-64">
                      <label className="block text-xs text-slate-600">
                        Technical reason (logged)
                        <textarea name="reason" required minLength={5} maxLength={1000} rows={2} className={`${inputClass} mt-1 w-full`} />
                      </label>
                    </ActionForm>
                  </details>
                ) : null}
              </Td>
            </tr>
          ))}
        </Table>
        <p className="mt-3 text-xs text-slate-500">
          Re-runs are for technical errors only (for example a submission that was cut off). Before the reveal the new median replaces the score. After the
          reveal the new score waits until a second organiser approves it; applying it re-applies the score&apos;s price effect (the starting price for a PRD,
          the 02:45 reveal for a crisis solution) to the current price, and is logged.
        </p>
      </Panel>

      <Panel title={`Re-runs and appeals (${appeals.length})`}>
        {appeals.length === 0 ? (
          <p className="text-sm text-slate-500">No re-runs in this round.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {appeals.map((a) => (
              <li key={a.id} className="py-3 text-sm" data-testid={`appeal-${a.ticker}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold">{a.ticker}</span>
                  <Badge tone={a.status === "READY" ? "amber" : a.status === "APPLIED" ? "green" : a.status === "DISMISSED" ? "slate" : "blue"}>
                    {APPEAL_STATUS_LABELS[a.status]}
                  </Badge>
                  <span className="text-slate-600">{a.afterReveal ? "after the reveal" : "before the reveal"}</span>
                  <span className="font-mono text-slate-600">
                    {a.oldFinal ?? "—"} → {a.newFinal ?? "…"}
                    {a.newTotals.length ? ` (${a.newTotals.join(", ")})` : ""}
                  </span>
                  <span className="text-xs text-slate-500">{clock(a.requestedAt, true)}</span>
                </div>
                <p className="mt-1 text-slate-700">{a.reason}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {a.next}
                  {a.note ? ` Note: ${a.note}` : ""}
                </p>
                {a.status === "READY" && !a.mine ? (
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <ActionForm action={applyAppeal.bind(null, a.id)} submit="Approve and apply" confirm="Click again to apply the new score and its price effect">
                      <input name="note" maxLength={1000} placeholder="Note (optional)" className={`${inputClass} w-full`} />
                    </ActionForm>
                    <ActionForm action={dismissAppeal.bind(null, a.id)} submit="Dismiss">
                      <input name="note" required minLength={5} maxLength={1000} placeholder="Why not (required)" className={`${inputClass} w-full`} />
                    </ActionForm>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title={`Calibration${data.calibration.batch ? ` · batch ${data.calibration.batch}` : ""}`}
        actions={
          <div className="flex gap-2">
            <ActionButton action={uploadCalibration.bind(null, event.id)}>Upload the samples</ActionButton>
            {data.calibration.batch && data.calibration.runs.length === 0 ? (
              <ActionButton action={startCalibration.bind(null, event.id, data.calibration.batch)}>Judge them</ActionButton>
            ) : null}
          </div>
        }
      >
        <p className="text-sm text-slate-600">
          Before the event, judge the sample PRDs and crisis solutions from <span className="font-mono">prompts/calibration/samples.json</span> (weak to
          strong, each with the range it should score in) with each round&apos;s current model, and check the medians land in range. Calibration never
          touches the night&apos;s scores. To try again (say after editing a prompt), upload the samples again: each upload is a new batch.
        </p>
        {cal.length ? (
          <Table head={["#", "Type", "Sample", "Expected", "Readings", "Median", "Spread", "Result"]} label="Calibration results" className="mt-3">
            {cal.map((c) => (
              <tr key={c.sample_no} data-testid={`calibration-${c.sample_no}`}>
                <Td mono>{c.sample_no}</Td>
                <Td>{c.type === "PRD" ? "PRD" : "Solution"}</Td>
                <Td>{c.title}</Td>
                <Td mono>
                  {c.expected.min}–{c.expected.max}
                </Td>
                <Td mono>{c.totals.map((t) => t ?? "·").join(" ")}</Td>
                <Td mono className="font-semibold">
                  {c.median ?? "—"}
                </Td>
                <Td mono>{c.spread ?? "—"}</Td>
                <Td>
                  <Badge tone={c.verdict === "IN_RANGE" ? "green" : c.verdict === "PENDING" ? "slate" : c.verdict === "FAILED" ? "red" : "amber"}>
                    {c.verdict === "IN_RANGE" ? "In range" : c.verdict === "LOW" ? "Too low" : c.verdict === "HIGH" ? "Too high" : c.verdict === "FAILED" ? "Failed" : "Waiting"}
                  </Badge>
                </Td>
              </tr>
            ))}
          </Table>
        ) : null}
      </Panel>
    </div>
  );
}
