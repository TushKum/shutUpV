import type { Metadata } from "next";
import Link from "next/link";
import type { DeadlineCode, SubmissionType } from "@msim/engine";
import { currentViewer } from "@/lib/auth/viewer";
import { loadAdminEvent, loadEventStatus } from "@/lib/admin/event";
import { loadJudgeData } from "@/lib/admin/judge-data";
import {
  APPEAL_STATUS_LABELS,
  JUDGE_COLUMNS,
  JUDGE_TYPES,
  TARGET_TONE,
  TYPE_NAMES,
  TYPE_TITLES,
  appealChange,
  appealViews,
  companyViews,
  defaultJudgeType,
  duration,
  effectLines,
  judgeProgress,
  modelSwitch,
  parseJudgeType,
  perMinuteText,
  refreshInterval,
  rerunBlock,
  scoreWithTier,
  scoringClosed,
  scoringClosesAt,
  startBlock,
  summarise,
  targetText,
  type AppealView,
  type CompanyJudgeView,
  type JudgeProgress,
  type JudgeSlot,
  type TypeSummary,
} from "@/lib/admin/judge";
import { judgeConfig, type JudgeConfig } from "@/lib/judge/config";
import { fakeJudgeRefusal } from "@/lib/judge";
import { clock } from "@/lib/format";
import { Badge, Notice, Panel, Stat, Table, inputClass } from "@/components/ui/ui";
import { ActionButton, ConfirmForm } from "@/components/ui/action";
import { Countdown } from "@/components/ui/countdown";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { RefreshAt } from "@/lib/live/refresh-at";
import { CompanyRow } from "./company-row";
import { JudgeRunner } from "./runner";
import {
  applyAppeal,
  dismissAppeal,
  releaseScores,
  retryFailedRuns,
  sealMissingScores,
  setJudgeModel,
  startJudging,
} from "./actions";

export const metadata: Metadata = { title: "Judge" };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const TARGET_TEXT = { green: "text-emerald-700", amber: "text-amber-700", red: "text-red-700", slate: "text-slate-700", blue: "text-sky-700", violet: "text-violet-700" } as const;

/** The judge's settings (JUDGE_* variables), or why they are wrong. */
function readSettings(): { ok: true; config: JudgeConfig } | { ok: false; error: string } {
  try {
    return { ok: true, config: judgeConfig() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Judge: the controls (run the judge from this console, the model in use and the backup switch, calibration), per
// type a summary, the progress of the judge against the brief's target, starting the judging and retrying failed
// runs, every company's runs, spread, median and final score with a technical re-run, sealing the 0 of companies with
// no on-time submission and the release; then every appeal and re-run, with apply and dismiss for those after
// release. Organisers act; the fairness officer sees it read-only. Judge functions broadcast on the staff channel,
// and the page re-reads itself every 3 s while runs are in flight (a finished run sends no message).
export default async function JudgePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  const [status, data] = await Promise.all([loadEventStatus(event.id), loadJudgeData(event.id)]);
  const organiser = viewer!.role === "ORGANISER";
  const now = Date.parse(status.server_time);
  const pausedAt = status.paused ? status.paused_at : null;
  const settings = readSettings();
  const type = parseJudgeType(query.type) ?? defaultJudgeType(status.phase);
  const views = Object.fromEntries(JUDGE_TYPES.map((t) => [t, companyViews(t, data)])) as Record<SubmissionType, CompanyJudgeView[]>;
  const summaries = Object.fromEntries(JUDGE_TYPES.map((t) => [t, summarise(t, views[t])])) as Record<SubmissionType, TypeSummary>;
  const summary = summaries[type];
  const released = summary.released > 0;
  const refresh = refreshInterval(
    JUDGE_TYPES.map((t) => summaries[t]),
    data.runs,
  );
  const closesAt = scoringClosesAt(type, data.deadlines);
  const closed = scoringClosed(type, data.deadlines, now, pausedAt);
  const startOff = startBlock(type, { closed, released, closesAt });
  const progress = judgeProgress(type, views[type], data.runs, now);
  const appeals = appealViews(data);
  const waiting = appeals.filter((a) => a.canApply).length;
  const failed = summary.runs.FAILED;

  return (
    <div className="space-y-6">
      <AutoRefresh everyMs={refresh ?? 15_000} active={refresh !== null} />
      {/* When the type's deadline passes, re-read: Start judging (and sealing) opens. */}
      <RefreshAt at={closed ? null : closesAt} />

      <JudgeControls eventId={event.id} slug={slug} organiser={organiser} settings={settings} slot={data.modelSlot} rehearsal={event.is_rehearsal} />

      {waiting > 0 ? (
        <Notice tone="amber">
          {waiting === 1 ? "1 appeal has" : `${waiting} appeals have`} a new score waiting: apply or dismiss{" "}
          <a href="#appeals" className="font-semibold underline">
            under Appeals and re-runs
          </a>
          . The awards wait for every open appeal.
        </Notice>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        {JUDGE_TYPES.map((t) => (
          <SummaryCard key={t} slug={slug} summary={summaries[t]} selected={t === type} />
        ))}
      </div>

      <nav className="flex gap-1 border-b border-slate-200" aria-label="Submission type">
        {JUDGE_TYPES.map((t) => (
          <Link
            key={t}
            href={`/admin/${slug}/judge?type=${t.toLowerCase()}`}
            aria-current={t === type ? "page" : undefined}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${t === type ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-900"}`}
          >
            {TYPE_TITLES[t]}
          </Link>
        ))}
      </nav>

      <Panel
        title={`${TYPE_TITLES[type]} scores`}
        actions={
          <>
            {released ? <Badge tone="green">Released {clock(summary.releasedAt)}</Badge> : null}
            {organiser ? (
              <>
                {/* Kept mounted (disabled) after the release, so the release's own message stays on screen; keyed by type so a
                    message never carries over to another type's tab. */}
                <ActionButton
                  key={`start-${type}`}
                  action={startJudging.bind(null, event.id, type)}
                  confirm={`Click again to start judging ${TYPE_NAMES[type]} submissions`}
                  disabled={startOff !== null}
                  title={startOff ?? undefined}
                >
                  Start judging
                </ActionButton>
                {failed > 0 ? (
                  <ActionButton
                    key={`retry-${type}`}
                    action={retryFailedRuns.bind(null, event.id, type)}
                    confirm={`Click again to retry ${plural(failed, "failed run")}`}
                  >
                    Retry {plural(failed, "failed run")}
                  </ActionButton>
                ) : null}
                <ActionButton
                  key={`seal-${type}`}
                  action={sealMissingScores.bind(null, event.id, type)}
                  confirm={`Click again to seal missing ${TYPE_NAMES[type]} scores as 0`}
                  disabled={released}
                  title={released ? `${TYPE_TITLES[type]} scores have been released.` : undefined}
                >
                  Seal missing as 0
                </ActionButton>
                <ActionButton
                  key={`release-${type}`}
                  action={releaseScores.bind(null, event.id, type)}
                  confirm={`Click again to release ${TYPE_NAMES[type]} scores`}
                  variant="primary"
                  disabled={released}
                  title={released ? `${TYPE_TITLES[type]} scores have been released.` : undefined}
                >
                  Release {TYPE_NAMES[type]} scores
                </ActionButton>
              </>
            ) : (
              <span className="text-sm text-slate-500">Organisers start the judge, seal and release scores.</span>
            )}
          </>
        }
      >
        <Progress p={progress} />
        <div className="mt-4">
          <Rules type={type} deadlines={data.deadlines} />
        </div>
        {startOff && !released && organiser ? <p className="mt-2 text-sm text-slate-500">{startOff}</p> : null}
        {summary.stale > 0 ? (
          <div className="mt-3">
            <Notice tone="red">
              {summary.stale} score{summary.stale === 1 ? " was" : "s were"} sealed for a submission that is no longer the current one. The release
              refuses until {summary.stale === 1 ? "it is" : "they are"} judged again.
            </Notice>
          </div>
        ) : null}
        <Table head={[...JUDGE_COLUMNS]} empty="No companies yet: they are formed at the squad draw." className="mt-4" label={`${TYPE_TITLES[type]} scores by company`}>
          {views[type].map((v) => (
            <CompanyRow
              key={`${type}-${v.company.id}`}
              type={type}
              view={v}
              organiser={organiser}
              rerunBlocked={rerunBlock(type, v, { phase: status.phase, closed })}
            />
          ))}
        </Table>
      </Panel>

      <AppealsPanel appeals={appeals} organiser={organiser} />
    </div>
  );
}

function JudgeControls({
  eventId,
  slug,
  organiser,
  settings,
  slot,
  rehearsal,
}: {
  eventId: string;
  slug: string;
  organiser: boolean;
  settings: ReturnType<typeof readSettings>;
  slot: JudgeSlot;
  rehearsal: boolean;
}) {
  const config = settings.ok ? settings.config : null;
  const refusal = config ? fakeJudgeRefusal(config, { is_rehearsal: rehearsal }) : null;
  const runner = organiser && config !== null && refusal === null;
  const models = config?.models ?? null;
  const sw = modelSwitch(slot, models);
  return (
    <Panel
      title="Judge"
      actions={
        <>
          {/* The runner shows its own badge next to its button. */}
          {config?.fake && !runner ? <Badge tone="amber">FAKE JUDGE</Badge> : null}
          <Link href={`/admin/${slug}/judge/calibration`} className="text-sm font-semibold text-slate-700 underline hover:text-slate-900">
            Calibration
          </Link>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-2 lg:col-span-2">
          <h3 className="text-sm font-semibold text-slate-900">Run the judge</h3>
          <p className="text-sm text-slate-600">
            While it is on, this console works the judge queue: every queued run of every type, the extra runs, retries, re-runs and calibration. Several
            consoles can run it at once, and so can <code className="font-mono text-xs">pnpm judge-worker --event {slug}</code> on a laptop.
          </p>
          {!settings.ok ? (
            <Notice tone="red">
              <span data-testid="judge-settings-error">The judge settings are wrong: {settings.error}</span>
            </Notice>
          ) : refusal ? (
            <Notice tone="red">{refusal}</Notice>
          ) : null}
          {runner ? (
            <JudgeRunner eventId={eventId} fake={config.fake} canRun={organiser} />
          ) : organiser ? null : (
            <p className="text-sm text-slate-500">Organisers run the judge.</p>
          )}
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">Model</h3>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-sm" aria-label="Judge model" data-testid="judge-model">
            {(["PRIMARY", "BACKUP"] as const).map((s) => (
              <div key={s} className="contents">
                <dt className="text-slate-500">{s === "PRIMARY" ? "Primary" : "Backup"}</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs [overflow-wrap:anywhere]">{models?.[s] ?? "—"}</span>
                  {slot === s ? <Badge tone="green">In use</Badge> : null}
                </dd>
              </div>
            ))}
          </dl>
          {organiser ? (
            <ActionButton key="model" action={setJudgeModel.bind(null, eventId, sw.to)} confirm={sw.confirm}>
              {sw.label}
            </ActionButton>
          ) : null}
          <p className="text-xs text-slate-500">
            A switch applies to runs claimed from then on; runs already running finish on their model. Every run stores the model that judged it.
          </p>
        </div>
      </div>
      <p className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-600">
        Before the event:{" "}
        <Link href={`/admin/${slug}/judge/calibration`} className="font-semibold text-slate-700 underline hover:text-slate-900">
          calibrate the judge on 10 sample pitches
        </Link>{" "}
        and compare its scores with the expected ranges.
      </p>
    </Panel>
  );
}

function Meter({ label, value, max, text }: { label: string; value: number; max: number; text: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const full = max > 0 && value >= max;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="tabular-nums text-slate-900">
          {value} of {max}
        </span>
      </div>
      {max > 0 ? (
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={text}
          className="mt-1 h-2.5 overflow-hidden rounded-full bg-slate-100"
        >
          <div className={`h-full rounded-full ${full ? "bg-emerald-600" : "bg-sky-600"}`} style={{ width: `${pct}%` }} />
        </div>
      ) : (
        <p className="mt-1 text-xs text-slate-500">No submissions.</p>
      )}
    </div>
  );
}

function Progress({ p }: { p: JudgeProgress }) {
  const r = p.runs;
  const eta = p.remaining > 0 && p.etaMs !== null ? duration(p.etaMs) : "—";
  const etaHint =
    p.remaining === 0
      ? r.FAILED > 0
        ? `${plural(r.FAILED, "run")} failed: retry ${r.FAILED === 1 ? "it" : "them"}`
        : "Nothing left to judge"
      : p.etaMs === null && p.startedAt
        ? "No run finished in the last 2 min"
        : `${plural(p.remaining, "run")} to go, at this pace`;
  return (
    <section aria-label={`${TYPE_TITLES[p.type]} progress`} data-testid="judge-progress" className="space-y-3">
      <div className="grid gap-4 md:grid-cols-2">
        <Meter label="Runs done" value={p.done} max={p.needed} text={`${p.done} of ${p.needed} runs done`} />
        <Meter label="Companies sealed" value={p.sealed} max={p.submissions} text={`${p.sealed} of ${p.submissions} companies with a submission sealed`} />
      </div>
      <p className="text-sm tabular-nums text-slate-700" data-testid="judge-progress-counts">
        {r.DONE} done · {r.RUNNING} running · {r.QUEUED} queued · <span className={r.FAILED > 0 ? "font-semibold text-red-700" : ""}>{r.FAILED} failed</span>
        {p.notStarted > 0 ? ` · ${plural(p.notStarted, "submission")} not started` : ""}
        <span className="text-slate-500"> · runs needed: 3 per submission, plus runs 4–5 where the first 3 spread more than 10 points</span>
      </p>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Started" value={p.startedAt ? clock(p.startedAt, true) : "—"} hint={p.startedAt ? "The first run" : "Not started"} />
        <Stat label="Elapsed" value={duration(p.elapsedMs)} hint={p.finishedAt ? `Last run finished ${clock(p.finishedAt, true)}` : p.startedAt ? "Still judging" : undefined} />
        <Stat label="Throughput" value={perMinuteText(p.perMinute)} hint="Runs done in the last 2 min" />
        <Stat label="ETA" value={eta} hint={etaHint} />
      </div>
      <p className="text-sm text-slate-600" data-testid="judge-target">
        Target (the brief): all submissions × 3 runs within 10 minutes.{" "}
        {p.target ? (
          <span className={`font-semibold ${TARGET_TEXT[TARGET_TONE[p.target.state]]}`}>{targetText(p.target)}</span>
        ) : (
          <span>It is timed from the first run.</span>
        )}
      </p>
    </section>
  );
}

function SummaryCard({ slug, summary: s, selected }: { slug: string; summary: TypeSummary; selected: boolean }) {
  const runs = s.runs;
  const anyRuns = runs.QUEUED + runs.RUNNING + runs.DONE + runs.FAILED > 0;
  return (
    <Panel
      title={TYPE_TITLES[s.type]}
      className={selected ? "ring-2 ring-slate-900" : ""}
      actions={
        s.released > 0 ? (
          <Badge tone="green">Released</Badge>
        ) : s.unsealed === 0 && s.companies > 0 ? (
          <Badge tone="blue">All sealed</Badge>
        ) : (
          <Badge tone="slate">Not released</Badge>
        )
      }
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm" aria-label={`${TYPE_TITLES[s.type]} summary`}>
        <dt className="text-slate-500">Companies</dt>
        <dd className="tabular-nums">{s.companies}</dd>
        <dt className="text-slate-500">Submissions</dt>
        <dd className="tabular-nums">
          {s.submissions}
          {s.companies > s.submissions ? <span className="text-slate-500"> · {s.companies - s.submissions} without</span> : null}
        </dd>
        <dt className="text-slate-500">Judge runs</dt>
        <dd className="tabular-nums">
          {anyRuns ? (
            <>
              {runs.DONE} done · {runs.RUNNING} running · {runs.QUEUED} queued ·{" "}
              <span className={runs.FAILED > 0 ? "font-semibold text-red-700" : ""}>{runs.FAILED} failed</span>
            </>
          ) : (
            "None yet"
          )}
        </dd>
        <dt className="text-slate-500">Scores</dt>
        <dd className="tabular-nums">
          {s.sealed} sealed · {s.released} released · {s.missing} missing
        </dd>
        <dt className="text-slate-500">Not sealed</dt>
        <dd className="tabular-nums">{s.unsealed}</dd>
      </dl>
      <Link href={`/admin/${slug}/judge?type=${s.type.toLowerCase()}`} className="mt-2 inline-block text-sm font-semibold text-slate-700 underline">
        {selected ? "Shown below" : `Show ${TYPE_NAMES[s.type]} scores`}
      </Link>
    </Panel>
  );
}

function When({ at }: { at: string | undefined }) {
  if (!at) return <span>—</span>;
  return (
    <span className="font-mono tabular-nums">
      {clock(at)} (<Countdown to={at} passed="passed" />)
    </span>
  );
}

function Rules({ type, deadlines }: { type: SubmissionType; deadlines: Partial<Record<DeadlineCode, string>> }) {
  return (
    <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-600">
      {type === "PITCH" ? (
        <>
          <li>
            Pitch submissions close at <When at={deadlines.PITCH} />. Judging starts after that, and missing pitches can then be sealed as 0.
          </li>
          <li>
            Release after consultant call 1 closes at <When at={deadlines.CALL_1} />, in Reading, between rounds. It sets every company&apos;s IPO price
            ($10.00 × (1 + tier)).
          </li>
        </>
      ) : type === "PLAN" ? (
        <>
          <li>
            Plans close at <When at={deadlines.PLAN} /> and deals at <When at={deadlines.DEAL} />; judging starts after both. A plan whose deal was not
            fully signed by then is capped at 50.
          </li>
          <li>Release at Verdicts (03:30). The tier moves both the market price and the AI price.</li>
        </>
      ) : (
        <>
          <li>
            Flash answers close at <When at={deadlines.FLASH} />. Judging starts after that.
          </li>
          <li>
            Release after round 17 clears (<When at={deadlines.FLASH_TIER} />). The tier moves both the market price and the AI price, and consultant call 2
            is judged.
          </li>
        </>
      )}
      <li>
        Start judging queues runs 1–3 of every current submission. When the first 3 spread more than 10 points, runs 4 and 5 are added. A score is
        sealed as soon as its runs are complete.
      </li>
      <li>A second injection offence by the same squad costs 10 points (penalty). The final score is the median, capped, minus the penalty.</li>
    </ul>
  );
}

function AppealsPanel({ appeals, organiser }: { appeals: AppealView[]; organiser: boolean }) {
  const open = appeals.filter((a) => a.afterRelease && (a.status === "JUDGING" || a.status === "READY")).length;
  return (
    <div id="appeals" className="scroll-mt-4">
      <Panel
        title="Appeals and re-runs"
        actions={
          appeals.length ? (
            <span className="text-sm text-slate-500">
              {plural(appeals.length, "re-run")} · {open} open
            </span>
          ) : null
        }
      >
        <div className="space-y-1 text-sm text-slate-600">
          <p>
            For technical errors only. Re-run a submission from its Runs above, with the reason. Before release the new runs replace the score as soon as
            they are done. After release (plans and flash answers; a released pitch score has set the IPO price) it is an appeal: the new score waits
            here until an organiser applies or dismisses it. Applying moves the score, the tier, the AI price and, after the close, the closing price; the
            market price history is not rewritten.
          </p>
          <p className="font-medium text-slate-900" data-testid="appeals-gate">
            The awards wait for every open appeal: Appeals cannot end while one waits for the judge or for a decision.{" "}
            {open === 0 ? "None is open." : `${open === 1 ? "1 is" : `${open} are`} open.`}
          </p>
        </div>
        {appeals.length ? (
          <ol className="mt-4 space-y-3">
            {appeals.map((a) => (
              <AppealCard key={a.id} a={a} organiser={organiser} />
            ))}
          </ol>
        ) : (
          <p className="mt-4 text-sm text-slate-500">No re-runs yet.</p>
        )}
      </Panel>
    </div>
  );
}

function AppealCard({ a, organiser }: { a: AppealView; organiser: boolean }) {
  const name = TYPE_NAMES[a.type];
  const openNow = a.status === "READY" || a.status === "JUDGING";
  return (
    <li
      aria-label={`Re-run of ${a.label} ${name}`}
      className={`rounded-md border p-3 ${a.status === "READY" ? "border-amber-300 bg-amber-50/40" : openNow ? "border-sky-200" : "border-slate-200"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-semibold">{a.label}</span>
        <span className="text-sm text-slate-700">{TYPE_TITLES[a.type]}</span>
        <Badge tone={a.afterRelease ? "violet" : "slate"}>{a.afterRelease ? "After release" : "Before release"}</Badge>
        <Badge tone={a.badge.tone}>{APPEAL_STATUS_LABELS[a.status]}</Badge>
      </div>
      <p className="mt-1 text-sm text-slate-800">Reason: “{a.reason}”</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-slate-500">Requested</dt>
        <dd className="font-mono tabular-nums">{clock(a.requestedAt, true)}</dd>
        <dt className="text-slate-500">Score</dt>
        <dd className="tabular-nums" data-testid="appeal-score">
          {scoreWithTier(a.from)} → {scoreWithTier(a.to)}
        </dd>
        <dt className="text-slate-500">Runs</dt>
        <dd className="tabular-nums" data-testid="appeal-runs">
          {a.runs.done} of {a.runs.total} done
          {a.runs.inFlight > 0 ? ` · ${a.runs.inFlight} in flight` : ""}
          {a.runs.failed > 0 ? <span className="text-red-700"> · {a.runs.failed} failed</span> : null}
          <span className="text-slate-500"> (generation {a.generation})</span>
        </dd>
        {a.decidedAt && a.status !== "JUDGING" && a.status !== "READY" ? (
          <>
            <dt className="text-slate-500">{a.status === "APPLIED" ? "Applied" : "Dismissed"}</dt>
            <dd>
              <span className="font-mono tabular-nums">{clock(a.decidedAt, true)}</span>
              {a.note ? <span className="text-slate-700">: “{a.note}”</span> : null}
            </dd>
          </>
        ) : null}
      </dl>
      {a.status === "APPLIED" && !a.afterRelease ? <p className="mt-2 text-sm text-slate-600">Sealed from the new runs (before release).</p> : null}
      {a.status === "JUDGING" && !a.afterRelease ? <p className="mt-2 text-sm text-slate-600">Sealed by itself when its runs are done.</p> : null}
      {a.status === "JUDGING" && a.runs.failed > 0 ? (
        <p className="mt-2 text-sm text-red-700">A run failed: retry the failed runs of this type, or re-run it again.</p>
      ) : null}
      {a.effects ? (
        <ul className="mt-2 list-disc pl-5 text-sm text-slate-700" aria-label={`What applying the re-run of ${a.label} changed`}>
          {effectLines(a.effects).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : null}
      {a.canApply || a.canDismiss ? (
        organiser ? (
          <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
            {a.canApply ? (
              <div>
                <ActionButton action={applyAppeal.bind(null, a.id, a.label, a.type)} confirm={`Click again to apply ${appealChange(a)}`} variant="primary">
                  Apply the new score
                </ActionButton>
              </div>
            ) : (
              <p className="text-sm text-slate-600">The new score can be applied once the judge has finished its runs.</p>
            )}
            <ConfirmForm
              action={dismissAppeal.bind(null, a.id, a.label, a.type)}
              submit="Dismiss"
              confirm={`Click again to dismiss the re-run of ${a.label}'s ${name}`}
              className="max-w-xl"
            >
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Reason to keep the released score (at least 5 characters; logged)</span>
                <textarea name="reason" required minLength={5} maxLength={1000} rows={2} className={inputClass} />
              </label>
            </ConfirmForm>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500">Organisers apply or dismiss an appeal.</p>
        )
      ) : null}
    </li>
  );
}
