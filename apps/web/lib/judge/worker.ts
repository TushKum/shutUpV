// The judge worker loop (docs/JUDGE.md "Work"): a pool that keeps up to `concurrency` runs in flight, claiming more
// from the database queue as slots free up (judge runs first, then calibration runs), until the time budget is spent
// or nothing is claimable, and then waits for the runs in flight. Each run: read its input, build the request,
// record the submission's stripped lines once, call the judge (real or fake), report the result. Retries of failed
// calls are the queue's job (finish_judge_run puts a retryable failure back with a backoff), not this loop's.
// The database and the judge are passed in, so the loop is tested with an in-memory queue and a fake judge.

import type { SubmissionType } from "@msim/engine";
import type { JudgePrompt } from "./prompts";
import { buildJudgeRequest, type BuiltRequest } from "./request";
import {
  EMPTY_USAGE,
  type CalibrationInput,
  type ClaimedCalibrationRun,
  type ClaimedRun,
  type FinishReply,
  type InjectionLine,
  type JudgeCallResult,
  type JudgeFn,
  type JudgeInput,
  type JudgeSlot,
  type JudgeUsage,
  type RunResult,
} from "./types";

/** The queue, for one event. The real one (db.ts) calls the RPCs of docs/JUDGE.md. */
export interface JudgeDb {
  claimRuns(limit: number): Promise<ClaimedRun[]>;
  input(runId: string): Promise<JudgeInput>;
  recordInjections(submissionId: string, hits: InjectionLine[]): Promise<void>;
  finish(runId: string, result: RunResult): Promise<FinishReply>;
  claimCalibration(limit: number): Promise<ClaimedCalibrationRun[]>;
  calibrationInput(runId: string): Promise<CalibrationInput>;
  finishCalibration(runId: string, result: RunResult): Promise<FinishReply>;
}

export interface WorkerOptions {
  db: JudgeDb;
  judge: JudgeFn;
  /** Stop claiming new runs after this long (runs in flight still finish). Infinity: no limit. */
  budgetMs: number;
  /** Runs in flight at once. */
  concurrency: number;
  /** The model for each slot (JUDGE_MODEL, JUDGE_BACKUP_MODEL). */
  models: Record<JudgeSlot, string>;
  /** The system prompt for a type (prompts/<TYPE>.md). */
  prompts: (type: SubmissionType) => Pick<JudgePrompt, "text" | "sha">;
  /** For log lines only. */
  eventId?: string;
  now?: () => number;
  log?: (line: string) => void;
  /** Stop claiming; the runs in flight finish normally. */
  stopSignal?: AbortSignal;
  /** Stop claiming and abort the calls in flight: they go back to the queue as retryable failures. */
  abortSignal?: AbortSignal;
  /** Called after each run is reported, with the counts so far. */
  onProgress?: (summary: Readonly<WorkerSummary>) => void;
}

export type StopReason = "empty" | "budget" | "stopped" | "aborted" | "fatal" | "error";

export interface WorkerSummary {
  /** Judge runs reported done. */
  done: number;
  /** Runs (judge or calibration) that failed for good. */
  failed: number;
  /** Runs (judge or calibration) sent back to the queue to be tried again later. */
  retried: number;
  /** Calibration runs reported done. */
  calibration: number;
  /** Scores sealed by this worker's reports (a generation completed). */
  sealed: number;
  /** Runs claimed. */
  claimed: number;
  /** Runs whose report did not reach the database (they are claimed again when their lease expires). */
  errors: number;
  ms: number;
  stopped: StopReason;
  /** Why the worker stopped early (fatal judge error, claim error). */
  reason?: string;
  tokens: JudgeUsage;
}

type Job = { kind: "judge"; run: ClaimedRun } | { kind: "calibration"; run: ClaimedCalibrationRun };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function addUsage(a: JudgeUsage, b: JudgeUsage): JudgeUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_read_input_tokens: a.cache_read_input_tokens + b.cache_read_input_tokens,
    cache_creation_input_tokens: a.cache_creation_input_tokens + b.cache_creation_input_tokens,
  };
}

/** The `result` argument of finish_judge_run for a judge call's outcome. Pure. */
export function toRunResult(r: JudgeCallResult, promptSha: string, requestText: string): RunResult {
  if (r.ok) {
    return {
      ok: true,
      model: r.model,
      prompt_sha: promptSha,
      request_text: requestText,
      raw_response: r.raw,
      breakdown: r.breakdown,
      total: r.total,
      rationale: r.rationale,
      latency_ms: Math.round(r.latencyMs),
    };
  }
  return {
    ok: false,
    model: r.model,
    prompt_sha: promptSha,
    request_text: requestText,
    ...(r.raw !== undefined ? { raw_response: r.raw } : {}),
    error: r.error,
    retryable: r.retryable,
    ...(r.retryable && r.retryAfterMs !== undefined ? { retry_after_ms: Math.round(r.retryAfterMs) } : {}),
    latency_ms: Math.round(r.latencyMs),
  };
}

export async function runWorker(o: WorkerOptions): Promise<WorkerSummary> {
  if (!Number.isInteger(o.concurrency) || o.concurrency < 1) throw new Error("concurrency must be a whole number ≥ 1");
  const now = o.now ?? Date.now;
  const log = o.log ?? (() => {});
  const started = now();
  const deadline = started + o.budgetMs;
  const tag = o.eventId ? `[judge ${o.eventId.slice(0, 8)}]` : "[judge]";

  const summary: WorkerSummary = {
    done: 0,
    failed: 0,
    retried: 0,
    calibration: 0,
    sealed: 0,
    claimed: 0,
    errors: 0,
    ms: 0,
    stopped: "empty",
    tokens: EMPTY_USAGE,
  };

  const calls = new AbortController();
  const onAbort = () => calls.abort();
  if (o.abortSignal?.aborted) calls.abort();
  o.abortSignal?.addEventListener("abort", onAbort, { once: true });

  let halt: { reason: StopReason; detail?: string } | null = null;
  const stop = (reason: StopReason, detail?: string) => {
    if (!halt) {
      halt = detail !== undefined ? { reason, detail } : { reason };
      log(`${tag} stopped claiming: ${reason}${detail ? `: ${detail}` : ""}`);
    }
  };

  // Stripped lines are recorded once per submission, even when several of its runs are in flight together.
  const recording = new Map<string, Promise<void>>();
  function recordOnce(submissionId: string, hits: InjectionLine[]): Promise<void> {
    let p = recording.get(submissionId);
    if (!p) {
      p = o.db.recordInjections(submissionId, hits);
      recording.set(submissionId, p);
      p.catch(() => recording.delete(submissionId));
    }
    return p;
  }

  async function prepare(job: Job): Promise<{ built: BuiltRequest; prompt: Pick<JudgePrompt, "text" | "sha">; type: SubmissionType }> {
    if (job.kind === "judge") {
      const input = await o.db.input(job.run.run_id);
      const prompt = o.prompts(input.type);
      const built = buildJudgeRequest(input, prompt.text);
      // Recorded even when nothing was stripped: finish_judge_run fails a run whose submission was never checked.
      if (!input.injections_recorded) await recordOnce(input.submission_id, built.injections);
      return { built, prompt, type: input.type };
    }
    const input = await o.db.calibrationInput(job.run.run_id);
    if (!input.text || input.text.trim() === "") throw new Error(`calibration sample ${input.sample_no} has no text`);
    const prompt = o.prompts("PITCH");
    const built = buildJudgeRequest(
      {
        run_id: input.run_id,
        type: "PITCH",
        ticker: input.ticker || "CAL",
        company_name: input.company_name ?? "",
        names: input.names ?? [],
        submission_id: "",
        submission_text: input.text,
        injections_recorded: true,
      },
      prompt.text,
    );
    return { built, prompt, type: "PITCH" };
  }

  async function process(job: Job): Promise<void> {
    const model = o.models[job.run.slot] ?? o.models.PRIMARY;
    const label = job.kind === "judge" ? `run ${job.run.run_no} (${job.run.type}, ${job.run.run_id.slice(0, 8)})` : `calibration sample ${job.run.sample_no} run ${job.run.run_no}`;
    let result: RunResult;
    let outcome: JudgeCallResult | null = null;
    try {
      const { built, prompt, type } = await prepare(job);
      outcome = await o.judge({
        type,
        model,
        system: built.system,
        userText: built.userText,
        requestText: built.requestText,
        runNo: job.run.run_no,
        signal: calls.signal,
      });
      summary.tokens = addUsage(summary.tokens, outcome.usage);
      result = toRunResult(outcome, prompt.sha, built.requestText);
      if (!outcome.ok && outcome.fatal) stop("fatal", outcome.error);
    } catch (e) {
      // Could not build the request (no prompt file, the input RPC failed…): nothing was judged, so the run goes back
      // to the queue, and the worker stops claiming because the next run would most likely fail the same way.
      const detail = `could not prepare the request: ${errorText(e)}`;
      result = { ok: false, model, error: detail.slice(0, 1000), retryable: true };
      stop("fatal", detail);
    }

    let reply: FinishReply;
    try {
      reply = job.kind === "judge" ? await o.db.finish(job.run.run_id, result) : await o.db.finishCalibration(job.run.run_id, result);
    } catch (e) {
      summary.errors++;
      log(`${tag} ${label}: could not report the result: ${errorText(e)}`);
      return;
    }
    if (reply.ok === false) {
      summary.errors++;
      log(`${tag} ${label}: the database refused the result: ${JSON.stringify(reply).slice(0, 300)}`);
      return;
    }
    if (reply.sealed) summary.sealed++;
    const status = typeof reply.status === "string" ? reply.status.toUpperCase() : null;
    if (result.ok && (status === null || status === "DONE")) {
      if (job.kind === "judge") summary.done++;
      else summary.calibration++;
    } else if (status === "QUEUED" || (status === null && !result.ok && result.retryable)) {
      summary.retried++;
      if (!result.ok) log(`${tag} ${label}: will be tried again${result.retry_after_ms !== undefined ? ` in ${Math.ceil(result.retry_after_ms / 1000)} s` : ""}: ${result.error}`);
    } else {
      summary.failed++;
      log(`${tag} ${label}: failed: ${result.ok ? `status ${status}` : result.error}`);
    }
  }

  let calibrationOff = false;
  async function claim(limit: number): Promise<Job[]> {
    const jobs: Job[] = (await o.db.claimRuns(limit)).map((run) => ({ kind: "judge" as const, run }));
    if (jobs.length < limit && !calibrationOff) {
      try {
        const cal = await o.db.claimCalibration(limit - jobs.length);
        jobs.push(...cal.map((run) => ({ kind: "calibration" as const, run })));
      } catch (e) {
        // Judge runs keep going without calibration.
        calibrationOff = true;
        log(`${tag} calibration runs cannot be claimed: ${errorText(e)}`);
      }
    }
    return jobs;
  }

  const inFlight = new Set<Promise<void>>();
  let drained = false; // the last claim found less than asked; claim again only after a run finishes
  try {
    for (;;) {
      const free = o.concurrency - inFlight.size;
      if (o.abortSignal?.aborted) stop("aborted");
      else if (o.stopSignal?.aborted) stop("stopped");
      else if (!drained && free > 0 && now() >= deadline) stop("budget");
      if (!halt && !drained && free > 0) {
        let jobs: Job[] = [];
        try {
          jobs = await claim(free);
        } catch (e) {
          stop("error", `could not claim runs: ${errorText(e)}`);
        }
        summary.claimed += jobs.length;
        if (jobs.length < free) drained = true;
        for (const job of jobs) {
          const p: Promise<void> = process(job)
            .catch((e) => {
              summary.errors++;
              log(`${tag} unexpected error: ${errorText(e)}`);
            })
            .finally(() => {
              inFlight.delete(p);
              drained = false; // a finished run may have queued runs 4 and 5
              summary.ms = now() - started;
              try {
                o.onProgress?.(summary);
              } catch {
                // A progress display must not stop the work.
              }
            });
          inFlight.add(p);
        }
        if (jobs.length > 0) continue;
      }
      if (inFlight.size === 0) break;
      await Promise.race(inFlight);
    }
  } finally {
    o.abortSignal?.removeEventListener("abort", onAbort);
  }

  const h = halt as { reason: StopReason; detail?: string } | null;
  summary.stopped = h ? h.reason : "empty";
  if (h?.detail) summary.reason = h.detail;
  summary.ms = now() - started;
  return summary;
}
