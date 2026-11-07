// Shapes shared by the judge worker's parts: what the database hands the worker (docs/JUDGE.md), what one judging
// call returns and what the worker reports back. No imports from Next here: the CLI (scripts/judge-worker.ts) uses
// this folder too.

import type { SubmissionType } from "@msim/engine";

export type JudgeSlot = "PRIMARY" | "BACKUP";
/** output_config.effort. Not xhigh or max: with thinking always on they need more than the 8,000 output tokens a call allows. */
export type JudgeEffort = "low" | "medium" | "high";

/** One row of public.claim_judge_runs(event, limit). */
export interface ClaimedRun {
  run_id: string;
  submission_id: string;
  company_id: string;
  type: SubmissionType;
  generation: number;
  run_no: number;
  attempts: number;
  /** Monotonic safe-integer token; unlike attempts, never reset by a retry. */
  claim_token: number;
  slot: JudgeSlot;
}

/** One row of public.claim_calibration_runs(event, limit). */
export interface ClaimedCalibrationRun {
  run_id: string;
  batch: number;
  sample_no: number;
  run_no: number;
  attempts: number;
  /** Monotonic safe-integer token; unlike attempts, never reset by a retry. */
  claim_token: number;
  slot: JudgeSlot;
  type: SubmissionType;
}

export interface CardInput {
  /** A problem card's sector, or a crisis card's category. */
  sector?: string;
  category?: string;
  title: string;
  body: string;
}

/** What the judge reads besides the submission: a PRD with its problem card and the twist; a crisis solution with
 * the rescued company's PRD and its crisis card. */
export interface JudgeContext {
  problem_card?: CardInput | null;
  twist?: { title: string; body: string } | null;
  /** SOLUTION only: the rescued company's PRD as it was judged (team-written). */
  prd_text?: string | null;
  crisis_card?: CardInput | null;
}

/** public.judge_input(run): everything needed to build one run's request. */
export interface JudgeInput {
  run_id: string;
  type: SubmissionType;
  ticker: string;
  company_name: string;
  /** Company, team and member names of the teams involved: each becomes the ticker. */
  names: string[];
  /**
   * The members' full names (also in `names`). Each part of these names (a first name used alone) is hidden too, in
   * the submission and in team-written context.
   */
  member_names?: string[];
  submission_id: string;
  submission_text: string;
  context?: JudgeContext;
  injections_recorded: boolean;
}

/** public.calibration_input(run): a sample PRD or crisis solution with its context written as plain text. */
export interface CalibrationInput {
  run_id: string;
  sample_no: number;
  type: SubmissionType;
  ticker: string;
  company_name?: string;
  names?: string[];
  /** The sample's context (problem card and twist, or PRD and crisis card), as one text. */
  context_text?: string;
  text: string | null;
}

/** A line removed from a submission because it spoke to the judge: the argument of public.record_injections. */
export interface InjectionLine {
  line: string;
  pattern: string;
}

export interface JudgeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

/** What one judging call (real or fake) returns. */
export type JudgeCallResult =
  | {
      ok: true;
      breakdown: Record<string, number>;
      total: number;
      rationale: string;
      /** The model's text output, stored as judge_runs.raw_response. */
      raw: string;
      model: string;
      latencyMs: number;
      usage: JudgeUsage;
      attempts: number;
    }
  | {
      ok: false;
      error: string;
      retryable: boolean;
      retryAfterMs?: number;
      /**
       * True when every other run would fail the same way (bad key, no access, unknown model, billing): the run goes
       * back to the queue and the worker stops claiming new runs.
       */
      fatal?: boolean;
      /** The HTTP status of the API error, when there was one (the worker counts 400s in a row). */
      status?: number;
      raw?: string;
      model: string;
      latencyMs: number;
      usage: JudgeUsage;
      attempts: number;
    };

/** One judging call as the worker asks for it. */
export interface JudgeRequest {
  type: SubmissionType;
  model: string;
  system: string;
  userText: string;
  /** The full user message (judge_runs.request_text); the fake judge hashes it. */
  requestText: string;
  runNo: number;
  signal?: AbortSignal;
}

export type JudgeFn = (request: JudgeRequest) => Promise<JudgeCallResult>;

/**
 * The `result` argument of public.finish_judge_run / finish_calibration_run (docs/JUDGE.md). `attempt` is the claim's
 * `claim_token`: the database ignores a report for an earlier claim of the run (STALE).
 */
export type RunResult =
  | {
      ok: true;
      attempt: number;
      model: string;
      prompt_sha: string;
      request_text: string;
      raw_response: string;
      breakdown: Record<string, number>;
      total: number;
      rationale: string;
      latency_ms: number;
    }
  | {
      ok: false;
      attempt: number;
      model?: string;
      prompt_sha?: string;
      request_text?: string;
      raw_response?: string;
      error: string;
      retryable: boolean;
      retry_after_ms?: number;
      latency_ms?: number;
    };

/**
 * What finish_judge_run answers: {ok: true, status: 'DONE' | 'QUEUED' | 'FAILED', sealed?: {final, median, runs},
 * extra_runs?, appeal_ready?}, or {ok: false, code: 'NOT_RUNNING' | 'STALE', …} for a run that was already reported or
 * has been claimed again since (both are ignored).
 */
export interface FinishReply {
  ok: boolean;
  status?: string;
  sealed?: unknown;
  code?: string;
  [key: string]: unknown;
}

export const EMPTY_USAGE: JudgeUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};
