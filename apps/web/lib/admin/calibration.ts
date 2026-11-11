// What the calibration page shows. Before the event the judge scores the sample pitches of
// prompts/calibration/pitches.json like real pitches (runs 1–3, and 4–5 when the first 3 spread more than 10 points),
// one batch per start. Worked out here from the stored rows: the batches so far; for one batch, per sample its runs,
// its status, the median once the runs are complete (the engine's rules), the spread, the verdict against the
// expected band, the run behind the median and the lines the judge never saw; the batch's summary (samples in band,
// mean distance outside the band, runs by status, judging time, models and prompt versions, checked against the
// current ones); whether the sample file has changed since; and the action's messages. Pure (the clock is passed in),
// so it is unit-tested; the page reads the rows.

import {
  medianScore,
  needsExtraRuns,
  representativeRun,
  runsComplete,
  stripInjections,
  wordCount,
  type InjectionHit,
} from "@msim/engine";
import { spread, type RunStatus, type StatusTone } from "./judge";

/** One row of public.calibration_samples: a sample pitch as a batch stored it. */
export interface CalibrationSampleRow {
  batch: number;
  sample_no: number;
  title: string;
  expected_min: number;
  expected_max: number;
  company_name: string;
  ticker: string;
  created_at: string;
  /** Read only for the batch on screen. */
  body_text?: string | null;
}

/** One row of public.calibration_runs, without the stored request and raw response. */
export interface CalibrationRunRow {
  id: string;
  batch: number;
  sample_no: number;
  run_no: number;
  status: RunStatus;
  attempts: number;
  model: string | null;
  prompt_sha: string | null;
  breakdown: Record<string, unknown> | null;
  total: number | null;
  rationale: string | null;
  error: string | null;
  latency_ms: number | null;
  created_at: string;
  /** Set while a worker holds the run (cleared when it reports). */
  locked_at: string | null;
  finished_at: string | null;
}

/** A sample as prompts/calibration/pitches.json holds it (lib/judge/calibration's CalibrationSample). */
export interface FileSample {
  sample_no: number;
  title: string;
  expected: { min: number; max: number };
  text: string;
}

export interface Band {
  min: number;
  max: number;
}

const inFlight = (r: Pick<CalibrationRunRow, "status">) => r.status === "QUEUED" || r.status === "RUNNING";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "30–45". */
export function bandText(b: Band): string {
  return `${b.min}–${b.max}`;
}

/** The first 12 characters of a SHA-256, enough to tell prompt versions apart. */
export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 12) : "—";
}

// ───────────────────────────── Batches ─────────────────────────────

/** The batch numbers, newest first. */
export function batchNumbers(samples: readonly Pick<CalibrationSampleRow, "batch">[]): number[] {
  return [...new Set(samples.map((s) => s.batch))].sort((a, b) => b - a);
}

/** "?batch=2" → 2 when that batch exists; anything else → the latest batch (null when there is none). */
export function selectBatch(v: string | string[] | undefined, batches: readonly number[]): number | null {
  const s = Array.isArray(v) ? v[0] : v;
  const n = s !== undefined && /^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN;
  if (batches.includes(n)) return n;
  return batches.length ? Math.max(...batches) : null;
}

// ───────────────────────────── Per sample ─────────────────────────────

export type VerdictKind = "IN" | "BELOW" | "ABOVE";

export interface Verdict {
  kind: VerdictKind;
  /** Points outside the band (0 inside). */
  distance: number;
  label: string;
  tone: StatusTone;
}

/** The median against the expected band: "In band", "4 below", "12 above". */
export function verdict(median: number, band: Band): Verdict {
  if (median < band.min) return { kind: "BELOW", distance: band.min - median, label: `${band.min - median} below`, tone: "amber" };
  if (median > band.max) return { kind: "ABOVE", distance: median - band.max, label: `${median - band.max} above`, tone: "amber" };
  return { kind: "IN", distance: 0, label: "In band", tone: "green" };
}

export interface SampleStatus {
  label: string;
  tone: StatusTone;
}

export interface SampleView {
  sampleNo: number;
  title: string;
  expected: Band;
  companyName: string;
  ticker: string;
  /** The stored text and its word count (null when the text was not read). */
  text: string | null;
  words: number | null;
  /** Its runs, by run number. */
  runs: CalibrationRunRow[];
  /** The totals of its finished runs, by run number. */
  totals: number[];
  /** Highest minus lowest finished total (null with fewer than 2). */
  spread: number | null;
  /** Runs 4–5 were added (the first 3 spread more than 10 points). */
  extraRuns: boolean;
  /** 3 runs within 10 points, or 5 runs, and nothing in flight. */
  complete: boolean;
  median: number | null;
  /** The run behind the median: the first whose total equals it (as for a real score). */
  medianRun: CalibrationRunRow | null;
  verdict: Verdict | null;
  status: SampleStatus;
  /**
   * The run whose request the page shows: the median run, otherwise the latest run that reported (every run of a
   * sample is sent the same request).
   */
  requestRunId: string | null;
  /** The lines the judge never sees (stripInjections on the stored text); null when the text was not read. */
  removed: InjectionHit[] | null;
}

function sampleStatus(runs: readonly CalibrationRunRow[], totals: readonly number[], complete: boolean): SampleStatus {
  if (runs.length === 0) return { label: "Not queued", tone: "slate" };
  const done = runs.filter((r) => r.status === "DONE").length;
  if (runs.some(inFlight)) return { label: `Judging: ${done} of ${runs.length} runs done`, tone: "blue" };
  if (complete) return { label: "Judged", tone: "green" };
  if (runs.some((r) => r.status === "FAILED")) return { label: "Run failed", tone: "red" };
  if (needsExtraRuns(totals)) return { label: "Spread over 10: needs 2 more runs", tone: "amber" };
  return { label: "Runs incomplete", tone: "amber" };
}

export function sampleView(sample: CalibrationSampleRow, allRuns: readonly CalibrationRunRow[]): SampleView {
  const runs = allRuns
    .filter((r) => r.batch === sample.batch && r.sample_no === sample.sample_no)
    .sort((a, b) => a.run_no - b.run_no);
  const doneRuns = runs.filter((r) => r.status === "DONE" && r.total !== null);
  const totals = doneRuns.map((r) => r.total!);
  const complete = !runs.some(inFlight) && runsComplete(totals);
  const median = complete ? medianScore(totals) : null;
  const medianRun = complete ? doneRuns[representativeRun(totals)]! : null;
  const expected = { min: sample.expected_min, max: sample.expected_max };
  const reported = runs.filter((r) => r.status === "DONE" || r.status === "FAILED");
  const text = sample.body_text ?? null;
  return {
    sampleNo: sample.sample_no,
    title: sample.title,
    expected,
    companyName: sample.company_name,
    ticker: sample.ticker,
    text,
    words: text === null ? null : wordCount(text),
    runs,
    totals,
    spread: spread(totals),
    extraRuns: runs.some((r) => r.run_no > 3),
    complete,
    median,
    medianRun,
    verdict: median === null ? null : verdict(median, expected),
    status: sampleStatus(runs, totals, complete),
    requestRunId: medianRun?.id ?? reported[reported.length - 1]?.id ?? null,
    removed: text === null ? null : stripInjections(text).hits,
  };
}

export interface RunIssue {
  text: string;
  tone: "red" | "amber";
}

/**
 * A line for a run that failed (a failed calibration run is not tried again: a new batch is), or that waits to be
 * tried again after a failed attempt; null otherwise.
 */
export function runIssue(r: Pick<CalibrationRunRow, "run_no" | "status" | "attempts" | "error">): RunIssue | null {
  if (r.status === "FAILED") return { text: `Run ${r.run_no} failed after ${plural(r.attempts, "attempt")}: ${r.error ?? "no reason given"}`, tone: "red" };
  if (r.status === "QUEUED" && r.attempts > 0) {
    return { text: `Run ${r.run_no} waits to be tried again (attempt ${r.attempts} of 5 failed${r.error ? `: ${r.error}` : ""})`, tone: "amber" };
  }
  return null;
}

/** One batch's samples, by sample number. */
export function sampleViews(batch: number, samples: readonly CalibrationSampleRow[], runs: readonly CalibrationRunRow[]): SampleView[] {
  return samples
    .filter((s) => s.batch === batch)
    .sort((a, b) => a.sample_no - b.sample_no)
    .map((s) => sampleView(s, runs));
}

/**
 * Whether a removed line still appears in the request the judge was sent (it should not): compared line by line,
 * ignoring surrounding spaces, so a line that only shares words with the request does not count.
 */
export function leakedLines(removed: readonly InjectionHit[], requestText: string | null | undefined): InjectionHit[] {
  if (!requestText) return [];
  const lines = new Set(requestText.split(/\r\n?|\n/).map((l) => l.trim()));
  return removed.filter((h) => h.line.trim() !== "" && lines.has(h.line.trim()));
}

// ───────────────────────────── Per batch ─────────────────────────────

export interface BatchSummary {
  batch: number;
  /** When the batch was started (its samples were stored). */
  startedAt: string | null;
  samples: number;
  /** Samples whose runs are complete. */
  judged: number;
  inBand: number;
  below: number;
  above: number;
  /** The mean, over the judged samples, of the points outside the band (0 for a sample in band); null before any. */
  meanDistance: number | null;
  runs: Record<RunStatus, number>;
  totalRuns: number;
  /**
   * The first claim. A run keeps no claim time once it has reported, so it is estimated: a reported run was claimed
   * at its finish less the model call's latency; a running run at its (latest) claim.
   */
  firstClaimAt: string | null;
  lastFinishedAt: string | null;
  /** Nothing queued or running. */
  settled: boolean;
  /** From the first claim to the last finish (to now while runs are in flight). */
  elapsedMs: number | null;
  /** The models that judged its runs, in order of first use. */
  models: string[];
  /** The PITCH prompt versions (SHA-256) its runs were judged with, in order of first use. */
  promptShas: string[];
}

function claimedAt(r: CalibrationRunRow): number | null {
  if (r.status === "RUNNING" && r.locked_at) return Date.parse(r.locked_at);
  if ((r.status === "DONE" || r.status === "FAILED") && r.finished_at && r.latency_ms !== null) return Date.parse(r.finished_at) - r.latency_ms;
  return null;
}

/** When a batch was started: when its samples were stored. */
function batchStartedAt(batch: number, samples: readonly Pick<CalibrationSampleRow, "batch" | "created_at">[]): string | null {
  return samples.reduce<string | null>((m, s) => (s.batch === batch && (m === null || s.created_at < m) ? s.created_at : m), null);
}

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
const minOf = (xs: readonly number[]) => (xs.length ? Math.min(...xs) : null);
const maxOf = (xs: readonly number[]) => (xs.length ? Math.max(...xs) : null);

export function batchSummary(
  batch: number,
  views: readonly SampleView[],
  samples: readonly Pick<CalibrationSampleRow, "batch" | "created_at">[],
  now: number,
): BatchSummary {
  const runs = views.flatMap((v) => v.runs);
  const byStatus: Record<RunStatus, number> = { QUEUED: 0, RUNNING: 0, DONE: 0, FAILED: 0 };
  for (const r of runs) byStatus[r.status] += 1;
  const judged = views.filter((v) => v.verdict !== null);
  const settled = byStatus.QUEUED + byStatus.RUNNING === 0;
  const first = minOf(runs.flatMap((r) => (claimedAt(r) === null ? [] : [claimedAt(r)!])));
  const last = maxOf(runs.flatMap((r) => ((r.status === "DONE" || r.status === "FAILED") && r.finished_at ? [Date.parse(r.finished_at)] : [])));
  const until = settled ? last : now;
  return {
    batch,
    startedAt: batchStartedAt(batch, samples),
    samples: views.length,
    judged: judged.length,
    inBand: judged.filter((v) => v.verdict!.kind === "IN").length,
    below: judged.filter((v) => v.verdict!.kind === "BELOW").length,
    above: judged.filter((v) => v.verdict!.kind === "ABOVE").length,
    meanDistance: judged.length ? judged.reduce((s, v) => s + v.verdict!.distance, 0) / judged.length : null,
    runs: byStatus,
    totalRuns: runs.length,
    firstClaimAt: iso(first),
    lastFinishedAt: iso(last),
    settled,
    elapsedMs: first !== null && until !== null ? Math.max(0, until - first) : null,
    models: [...new Set(runs.flatMap((r) => (r.model ? [r.model] : [])))],
    promptShas: [...new Set(runs.flatMap((r) => (r.prompt_sha ? [r.prompt_sha] : [])))],
  };
}

/** "2.3 points", "1 point", "0 points", "—". */
export function distanceText(n: number | null): string {
  if (n === null) return "—";
  const v = Math.round(n * 10) / 10;
  return `${v} point${v === 1 ? "" : "s"}`;
}

/** The list of batches to switch between: each with when it started and how many samples were in band. */
export interface BatchInfo {
  batch: number;
  startedAt: string | null;
  samples: number;
  judged: number;
  inBand: number;
  runs: number;
  done: number;
  inFlight: number;
  failed: number;
}

export function batchList(samples: readonly CalibrationSampleRow[], runs: readonly CalibrationRunRow[]): BatchInfo[] {
  return batchNumbers(samples).map((batch) => {
    const views = sampleViews(batch, samples, runs);
    const all = views.flatMap((v) => v.runs);
    return {
      batch,
      startedAt: batchStartedAt(batch, samples),
      samples: views.length,
      judged: views.filter((v) => v.verdict !== null).length,
      inBand: views.filter((v) => v.verdict?.kind === "IN").length,
      runs: all.length,
      done: all.filter((r) => r.status === "DONE").length,
      inFlight: all.filter(inFlight).length,
      failed: all.filter((r) => r.status === "FAILED").length,
    };
  });
}

/** "7 of 10 in band", "judging: 12 of 30 runs done", "3 of 10 judged, 4 runs failed". */
export function batchResultText(b: BatchInfo): string {
  if (b.inFlight > 0) return `judging: ${b.done} of ${plural(b.runs, "run")} done`;
  const inBand = `${b.inBand} of ${b.samples} in band`;
  if (b.judged === b.samples) return inBand;
  return `${inBand}, ${b.judged} of ${b.samples} judged${b.failed ? `, ${plural(b.failed, "run")} failed` : ""}`;
}

// ───────────────────────────── Checks against the current prompt, model and file ─────────────────────────────

export interface Check {
  ok: boolean;
  text: string;
}

/** The batch's prompt versions against prompts/PITCH.md now (null before any run reported one). */
export function promptCheck(batch: number, shas: readonly string[], current: string): Check | null {
  if (shas.length === 0) return null;
  if (shas.every((s) => s === current)) return { ok: true, text: `Judged with the current prompts/PITCH.md (${shortSha(current)}).` };
  const others = shas.filter((s) => s !== current).map(shortSha);
  const mixed = shas.includes(current) ? " (and partly with the current one)" : "";
  return {
    ok: false,
    text:
      `Batch ${batch} was judged with another PITCH prompt (${others.join(", ")})${mixed}; prompts/PITCH.md is now ${shortSha(current)}. ` +
      "Start a new batch to calibrate the current prompt.",
  };
}

/** What runs claimed now are judged with: the fake judge, or the model of the event's slot. */
export interface CurrentModel {
  model: string;
  /** "the primary model", "the backup model", "the fake judge". */
  label: string;
}

/** The batch's models against the one runs claimed now use (null before any run reported one). */
export function modelCheck(batch: number, models: readonly string[], current: CurrentModel): Check | null {
  if (models.length === 0) return null;
  if (models.every((m) => m === current.model)) return { ok: true, text: `Judged with ${current.model}, ${current.label} in use now.` };
  const others = models.filter((m) => m !== current.model);
  const mixed = models.includes(current.model) ? ` (and partly with ${current.model})` : "";
  return {
    ok: false,
    text:
      `Batch ${batch} was judged with ${others.join(", ")}${mixed}, but runs claimed now use ${current.model} (${current.label}). ` +
      "Start a new batch to calibrate it.",
  };
}

/**
 * The sample numbers whose title, expected band or text differ between the file and a batch (or that are in only one
 * of them): the file was edited after the batch started. Needs the batch's texts.
 */
export function changedSamples(file: readonly FileSample[], batch: readonly CalibrationSampleRow[]): number[] {
  const stored = new Map(batch.map((s) => [s.sample_no, s]));
  const inFile = new Map(file.map((s) => [s.sample_no, s]));
  const numbers = [...new Set([...stored.keys(), ...inFile.keys()])].sort((a, b) => a - b);
  return numbers.filter((n) => {
    const f = inFile.get(n);
    const s = stored.get(n);
    if (!f || !s) return true;
    return f.title !== s.title || f.expected.min !== s.expected_min || f.expected.max !== s.expected_max || f.text !== (s.body_text ?? null);
  });
}

// ───────────────────────────── Refresh and messages ─────────────────────────────

/**
 * How often the page re-reads itself (null: it need not): every 3 s while a calibration run is queued or running
 * (a claim sends no realtime message, and a run sent back to the queue neither).
 */
export function calibrationRefresh(runs: readonly Pick<CalibrationRunRow, "status">[]): number | null {
  return runs.some(inFlight) ? 3000 : null;
}

/** The start button's confirmation. */
export function startConfirm(nextBatch: number, samples: number): string {
  return `Click again to start batch ${nextBatch}: ${plural(3 * samples, "run")}`;
}

/** "Batch 2: queued 30 runs." */
export function startCalibrationMessage(batch: number, queued: number): string {
  return `Batch ${batch}: queued ${plural(queued, "run")}.`;
}
