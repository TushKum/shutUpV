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
  slot: JudgeSlot;
}

/** One row of public.claim_calibration_runs(event, limit) (it also returns batch and type 'PITCH'). */
export interface ClaimedCalibrationRun {
  run_id: string;
  sample_no: number;
  run_no: number;
  attempts: number;
  slot: JudgeSlot;
}

export interface CrisisCardInput {
  category: string;
  title: string;
  body: string;
}

export interface DealInput {
  /** True when the deal was executed (all three signatures) by the deadline. */
  signed: boolean;
  executed_at: string | null;
  amount_cents: number | string | null;
  price_cents: number | string | null;
  shares: number | string | null;
  /** The company's share price after the crisis: the deal's price is shown against it. */
  post_crisis_price_cents?: number | string | null;
  deadline: string | null;
}

export interface BulletinInput {
  title: string;
  body: string;
}

/** public.judge_input(run): everything needed to build one run's request. */
export interface JudgeInput {
  run_id: string;
  type: SubmissionType;
  ticker: string;
  company_name: string;
  /** Company, team and member names of the squad: each becomes the ticker. */
  names: string[];
  /**
   * The members' full names (also in `names`). Each part of these names (a first name used alone) is hidden too, in
   * the submission and the pitch card.
   */
  member_names?: string[];
  submission_id: string;
  submission_text: string;
  /** PLAN only: the company's current pitch card. */
  pitch_text?: string | null;
  /** PLAN only. */
  crisis_card?: CrisisCardInput | null;
  /** PLAN only. */
  deal?: DealInput | null;
  /** FLASH only: the published flash bulletin. */
  bulletin?: BulletinInput | null;
  injections_recorded: boolean;
}

/**
 * public.calibration_input(run): {run_id, type: 'PITCH', batch, sample_no, run_no, ticker, company_name, names, text,
 * title}. When `text` is missing or empty, the worker reads it from prompts/calibration/pitches.json by sample_no.
 */
export interface CalibrationInput {
  run_id: string;
  sample_no: number;
  type: "PITCH";
  ticker: string;
  /** The sample company's name (from the text's first line, "Name (TICKER)"): replaced by the ticker like a real one. */
  company_name?: string;
  names?: string[];
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
 * `attempts`: the database ignores a report for an earlier claim of the run (STALE).
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
