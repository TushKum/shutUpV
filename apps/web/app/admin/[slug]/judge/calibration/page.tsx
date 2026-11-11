import type { Metadata } from "next";
import Link from "next/link";
import { wordCount } from "@msim/engine";
import { currentViewer } from "@/lib/auth/viewer";
import { loadAdminEvent, loadEventStatus } from "@/lib/admin/event";
import {
  bandText,
  batchList,
  batchNumbers,
  batchResultText,
  batchSummary,
  calibrationRefresh,
  changedSamples,
  distanceText,
  modelCheck,
  promptCheck,
  sampleViews,
  selectBatch,
  shortSha,
  startConfirm,
  type BatchInfo,
  type BatchSummary,
  type Check,
  type CurrentModel,
} from "@/lib/admin/calibration";
import { duration, type JudgeSlot } from "@/lib/admin/judge";
import { judgeConfig, type JudgeConfig } from "@/lib/judge/config";
import { loadCalibrationSamples, type CalibrationSample } from "@/lib/judge/calibration";
import { loadPrompt } from "@/lib/judge/prompts";
import { FAKE_MODEL } from "@/lib/judge/fake";
import { fakeJudgeRefusal } from "@/lib/judge";
import { clock, dateTime } from "@/lib/format";
import { Badge, Notice, Panel, Stat, Table, Td } from "@/components/ui/ui";
import { ActionButton } from "@/components/ui/action";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { JudgeRunner } from "../runner";
import { startCalibration } from "./actions";
import { loadBatchDetail, loadCalibrationRows } from "./data";
import { SampleCard } from "./sample-card";

export const metadata: Metadata = { title: "Calibration" };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

type Read<T> = { ok: true; value: T } | { ok: false; error: string };

/** A file or setting read on the server, or why it could not be read. */
function read<T>(f: () => T): Read<T> {
  try {
    return { ok: true, value: f() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** What runs claimed now are judged with. */
function currentModel(config: JudgeConfig, slot: JudgeSlot): CurrentModel {
  if (config.fake) return { model: FAKE_MODEL, label: "the fake judge" };
  return { model: config.models[slot], label: slot === "PRIMARY" ? "the primary model" : "the backup model" };
}

// Calibration (the brief: "a calibration page scores 10 sample pitches before the event"): an organiser starts a
// batch (the sample pitches of prompts/calibration/pitches.json, runs 1–3 each, 4–5 where they spread more than 10)
// and runs the judge from this console; the page shows the batch on screen (?batch=N, default the latest) sample by
// sample against the expected bands, with its summary, the models and prompt version it was judged with (checked
// against the current ones), the earlier batches and the sample file. Organisers act; the fairness officer sees it
// read-only. Staff read the runs through RLS; finished runs broadcast 'calibration' on the staff channel, and the
// page re-reads itself every 3 s while a run is queued or running.
export default async function CalibrationPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  const [status, rows] = await Promise.all([loadEventStatus(event.id), loadCalibrationRows(event.id)]);
  const organiser = viewer!.role === "ORGANISER";
  const now = Date.parse(status.server_time);

  const settings = read(() => judgeConfig());
  const file = read(() => loadCalibrationSamples());
  const prompt = read(() => loadPrompt("PITCH"));
  const config = settings.ok ? settings.value : null;
  const refusal = config ? fakeJudgeRefusal(config, { is_rehearsal: event.is_rehearsal }) : null;
  const runner = organiser && config !== null && refusal === null;

  const batches = batchNumbers(rows.samples);
  const latest = batches[0] ?? null;
  const batch = selectBatch(query.batch, batches);
  const list = batchList(rows.samples, rows.runs);
  const refresh = calibrationRefresh(rows.runs);

  // The batch on screen: its texts and the request of the run each sample shows.
  const light = batch === null ? [] : sampleViews(batch, rows.samples, rows.runs);
  const detail = batch === null ? null : await loadBatchDetail(event.id, batch, light.flatMap((v) => (v.requestRunId ? [v.requestRunId] : [])));
  const stored = rows.samples.filter((s) => s.batch === batch).map((s) => ({ ...s, body_text: detail?.texts.get(s.sample_no) ?? null }));
  const views = batch === null ? [] : sampleViews(batch, stored, rows.runs);
  const summary = batch === null ? null : batchSummary(batch, views, rows.samples, now);
  const changed = batch !== null && file.ok ? changedSamples(file.value, stored) : [];
  const inFlight = list.find((b) => b.inFlight > 0) ?? null;

  return (
    <div className="space-y-6">
      <AutoRefresh everyMs={refresh ?? 15_000} active={refresh !== null} />

      <Panel
        title="Calibration"
        actions={
          <>
            {config?.fake && !runner ? <Badge tone="amber">FAKE JUDGE</Badge> : null}
            <Link href={`/admin/${slug}/judge`} className="text-sm font-semibold text-slate-700 underline hover:text-slate-900">
              Back to the judge
            </Link>
          </>
        }
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">Start a batch</h3>
            <p className="text-sm text-slate-600">
              Before the event, the judge scores the {file.ok ? file.value.length : 10} sample pitches below like real pitches: 3 runs each, and 2 more
              where the first 3 spread more than 10 points. Compare each median with the range a sensible judge should give. Each start is a new
              batch, so a batch can be run again after a change to the prompt or the model.
            </p>
            {organiser ? (
              <div data-testid="calibration-start">
                <ActionButton
                  key="start-calibration"
                  action={startCalibration.bind(null, event.id)}
                  confirm={startConfirm((latest ?? 0) + 1, file.ok ? file.value.length : 10)}
                  variant="primary"
                  disabled={!file.ok}
                  title={file.ok ? undefined : file.error}
                >
                  Start calibration
                </ActionButton>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Organisers start calibration and run the judge.</p>
            )}
            {organiser && inFlight ? (
              <p className="text-sm text-slate-600">
                Batch {inFlight.batch} still has runs queued or running; a new start queues another batch after it.
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">Run the judge</h3>
            <p className="text-sm text-slate-600">
              While it is on, this console works the whole judge queue: judge runs first, then calibration runs. It can also run from the Judge page,
              another console, or <code className="font-mono text-xs">pnpm judge-worker --event {slug}</code> on a laptop.
            </p>
            {!settings.ok ? (
              <Notice tone="red">
                <span data-testid="judge-settings-error">The judge settings are wrong: {settings.error}</span>
              </Notice>
            ) : refusal ? (
              <Notice tone="red">{refusal}</Notice>
            ) : null}
            {runner ? <JudgeRunner eventId={event.id} fake={config.fake} canRun={organiser} /> : null}
          </div>
        </div>
      </Panel>

      {batch !== null && summary ? (
        <Panel
          title={`Batch ${batch}`}
          actions={
            <>
              <span className="text-sm text-slate-500">Started {dateTime(summary.startedAt)}</span>
              {batches.length > 1 ? (
                <a href="#batches" className="text-sm font-semibold text-slate-700 underline hover:text-slate-900">
                  Other batches
                </a>
              ) : null}
            </>
          }
        >
          <div className="space-y-4">
            {latest !== null && batch !== latest ? (
              <Notice tone="blue">
                This is batch {batch}; the latest is batch {latest}.{" "}
                <Link href={`/admin/${slug}/judge/calibration`} className="font-semibold underline">
                  Show the latest
                </Link>
              </Notice>
            ) : null}
            {changed.length > 0 ? (
              <Notice tone="amber">
                <span data-testid="calibration-file-changed">
                  prompts/calibration/pitches.json has changed since batch {batch} started ({changed.length === 1 ? "sample" : "samples"}{" "}
                  {changed.join(", ")}). Start a new batch to judge the current samples.
                </span>
              </Notice>
            ) : null}
            <Summary s={summary} />
            <Versions
              summary={summary}
              promptCheck={prompt.ok ? promptCheck(batch, summary.promptShas, prompt.value.sha) : null}
              promptError={prompt.ok ? null : prompt.error}
              modelCheck={config ? modelCheck(batch, summary.models, currentModel(config, rows.modelSlot)) : null}
            />
            {summary.runs.FAILED > 0 ? (
              <Notice tone="red">
                {plural(summary.runs.FAILED, "run")} failed. A failed calibration run is not tried again: start a new batch (switch to the backup model on
                the Judge page first if the primary keeps failing).
              </Notice>
            ) : null}
            <ol className="space-y-3" aria-label={`Samples of batch ${batch}`}>
              {views.map((v) => (
                <SampleCard key={v.sampleNo} v={v} request={v.requestRunId ? (detail?.requests.get(v.requestRunId) ?? null) : null} />
              ))}
            </ol>
          </div>
        </Panel>
      ) : (
        <Panel title="Results">
          <p className="text-sm text-slate-500" data-testid="calibration-empty">
            No calibration yet: Start calibration queues 3 runs of each sample pitch, then run the judge.
          </p>
        </Panel>
      )}

      {list.length > 0 ? <BatchesPanel slug={slug} list={list} shown={batch} /> : null}

      <SamplesPanel file={file} />
    </div>
  );
}

function Summary({ s }: { s: BatchSummary }) {
  const r = s.runs;
  const timeHint = !s.firstClaimAt ? "No run claimed yet: run the judge" : s.settled ? "From the first claim to the last finish" : "Still judging";
  return (
    <section aria-label="Batch summary" data-testid="calibration-summary" className="space-y-2">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat
          label="In band"
          value={<span data-testid="calibration-in-band">{`${s.inBand} of ${s.samples}`}</span>}
          hint={s.judged === s.samples ? `${s.below} below · ${s.above} above` : `${s.judged} of ${s.samples} judged so far`}
        />
        <Stat label="Mean distance outside the band" value={distanceText(s.meanDistance)} hint="Over the judged samples; one in band counts 0" />
        <Stat
          label="Runs"
          value={`${r.DONE} of ${s.totalRuns} done`}
          hint={
            <>
              <span className={r.FAILED ? "font-semibold text-red-700" : ""}>{r.FAILED} failed</span> · {r.RUNNING} running · {r.QUEUED} queued
            </>
          }
        />
        <Stat label="Judging time" value={duration(s.elapsedMs)} hint={timeHint} />
      </div>
      {s.firstClaimAt ? (
        <p className="text-xs text-slate-500">
          First claim about {clock(s.firstClaimAt, true)} (a finished run keeps no claim time: its finish less the model&apos;s answer time)
          {s.settled && s.lastFinishedAt ? ` · last finish ${clock(s.lastFinishedAt, true)}` : ""}.
        </p>
      ) : null}
    </section>
  );
}

function CheckLine({ check, testId }: { check: Check; testId: string }) {
  return check.ok ? (
    <p className="text-sm text-slate-600" data-testid={testId} data-ok="true">
      {check.text}
    </p>
  ) : (
    <Notice tone="amber">
      <span data-testid={testId} data-ok="false">
        {check.text}
      </span>
    </Notice>
  );
}

function Versions({
  summary: s,
  promptCheck: pc,
  promptError,
  modelCheck: mc,
}: {
  summary: BatchSummary;
  promptCheck: Check | null;
  promptError: string | null;
  modelCheck: Check | null;
}) {
  return (
    <section aria-label="Prompt and model" className="space-y-2">
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 text-sm">
        <dt className="text-slate-500">Models</dt>
        <dd className="font-mono text-xs [overflow-wrap:anywhere]" data-testid="calibration-models">
          {s.models.length ? s.models.join(", ") : "—"}
        </dd>
        <dt className="text-slate-500">PITCH prompt</dt>
        <dd className="font-mono text-xs [overflow-wrap:anywhere]" data-testid="calibration-prompt-shas">
          {s.promptShas.length ? s.promptShas.map(shortSha).join(", ") : "—"}
        </dd>
      </dl>
      {promptError ? <Notice tone="red">The current PITCH prompt cannot be read: {promptError}</Notice> : null}
      {pc ? <CheckLine check={pc} testId="calibration-prompt-check" /> : null}
      {mc ? <CheckLine check={mc} testId="calibration-model-check" /> : null}
      {!pc && !mc && !promptError ? <p className="text-sm text-slate-500">The prompt and model are checked once a run has reported.</p> : null}
    </section>
  );
}

function BatchesPanel({ slug, list, shown }: { slug: string; list: BatchInfo[]; shown: number | null }) {
  return (
    <div id="batches" className="scroll-mt-4">
      <Panel title="Batches" actions={<span className="text-sm text-slate-500">{`${list.length} ${list.length === 1 ? "batch" : "batches"}`}</span>}>
        <div data-testid="calibration-batches">
          <Table head={["Batch", "Started", "Result"]} label="Calibration batches">
            {list.map((b) => (
              <tr key={b.batch} className={b.batch === shown ? "bg-slate-50" : ""}>
                <Td>
                  <Link
                    href={`/admin/${slug}/judge/calibration?batch=${b.batch}`}
                    aria-current={b.batch === shown ? "page" : undefined}
                    className="font-semibold text-slate-700 underline hover:text-slate-900"
                  >
                    Batch {b.batch}
                  </Link>
                  {b.batch === shown ? (
                    <span className="ml-2">
                      <Badge tone="slate">Shown</Badge>
                    </span>
                  ) : null}
                </Td>
                <Td mono>{dateTime(b.startedAt)}</Td>
                <Td className="tabular-nums">
                  <span className={b.failed > 0 && b.inFlight === 0 ? "text-red-700" : "text-slate-800"}>{batchResultText(b)}</span>
                </Td>
              </tr>
            ))}
          </Table>
        </div>
      </Panel>
    </div>
  );
}

function SamplesPanel({ file }: { file: Read<CalibrationSample[]> }) {
  return (
    <Panel title="Sample pitches" actions={<span className="font-mono text-xs text-slate-500">prompts/calibration/pitches.json</span>}>
      {!file.ok ? (
        <Notice tone="red">
          <span data-testid="calibration-file-error">{file.error}</span>
        </Notice>
      ) : (
        <>
          <p className="text-sm text-slate-600">
            What the next batch will judge. Each sample comes with the range of scores a sensible judge should give; a batch stores its own copy.
          </p>
          <ol className="mt-3 divide-y divide-slate-100" data-testid="calibration-file">
            {file.value.map((s) => (
              <FileSampleRow key={s.sample_no} s={s} />
            ))}
          </ol>
        </>
      )}
    </Panel>
  );
}

function FileSampleRow({ s }: { s: CalibrationSample }) {
  return (
    <li className="py-2" aria-label={`Sample pitch ${s.sample_no}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="min-w-0 flex-1 text-sm text-slate-900">
          <span className="font-mono font-semibold">#{s.sample_no}</span> {s.title}
        </p>
        <p className="text-xs tabular-nums text-slate-500">
          Expected <span className="font-semibold text-slate-800">{bandText(s.expected)}</span> · {wordCount(s.text)} words
        </p>
      </div>
      <details className="mt-1">
        <summary className="cursor-pointer text-xs font-semibold text-slate-700 hover:text-slate-900">Text</summary>
        <pre className="mt-1 max-h-80 overflow-y-auto whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 font-sans text-xs text-slate-800">{s.text}</pre>
      </details>
    </li>
  );
}
