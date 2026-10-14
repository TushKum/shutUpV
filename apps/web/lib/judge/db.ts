// The worker's queue over Supabase, as the service role: the RPCs of docs/JUDGE.md for one event. Calibration sample
// texts come from calibration_input when it returns them, otherwise from prompts/calibration/pitches.json by sample_no.
// Every RPC error is thrown with the function's name, so the worker can log it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { SUBMISSION_TYPES } from "@msim/engine";
import { calibrationSample } from "./calibration";
import type {
  CalibrationInput,
  ClaimedCalibrationRun,
  ClaimedRun,
  FinishReply,
  InjectionLine,
  JudgeInput,
  RunResult,
} from "./types";
import type { JudgeDb } from "./worker";

/** The functions called and their parameters (the p_ prefix of every game function). */
export const RPC = {
  claimRuns: "claim_judge_runs", // (p_event, p_limit)
  input: "judge_input", // (p_run)
  recordInjections: "record_injections", // (p_submission, p_hits)
  finish: "finish_judge_run", // (p_run, p_result)
  claimCalibration: "claim_calibration_runs", // (p_event, p_limit)
  calibrationInput: "calibration_input", // (p_run)
  finishCalibration: "finish_calibration_run", // (p_run, p_result)
} as const;

/** The one method used; a SupabaseClient has it (the tests pass a fake). */
export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

async function call(sb: RpcClient, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

function rows<T>(fn: string, data: unknown): T[] {
  if (data === null || data === undefined) return [];
  if (!Array.isArray(data)) throw new Error(`${fn}: expected a list of runs`);
  return data as T[];
}

function object(fn: string, data: unknown): Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error(`${fn}: expected an object`);
  return data as Record<string, unknown>;
}

function checkInput(data: unknown): JudgeInput {
  const v = object(RPC.input, data);
  const type = v.type as JudgeInput["type"];
  if (!SUBMISSION_TYPES.includes(type)) throw new Error(`${RPC.input}: unknown type ${String(v.type)}`);
  if (typeof v.ticker !== "string" || v.ticker === "") throw new Error(`${RPC.input}: ticker is missing`);
  if (typeof v.submission_id !== "string") throw new Error(`${RPC.input}: submission_id is missing`);
  if (typeof v.submission_text !== "string") throw new Error(`${RPC.input}: submission_text is missing`);
  return {
    ...(v as unknown as JudgeInput),
    company_name: typeof v.company_name === "string" ? v.company_name : "",
    names: Array.isArray(v.names) ? v.names.filter((n): n is string => typeof n === "string") : [],
    injections_recorded: v.injections_recorded === true,
  };
}

export interface JudgeDbOptions {
  /** Fallback text of a calibration sample (default: prompts/calibration/pitches.json). */
  calibrationText?: (sampleNo: number) => string;
}

export function supabaseJudgeDb(sb: RpcClient, eventId: string, options: JudgeDbOptions = {}): JudgeDb {
  const sampleText = options.calibrationText ?? ((n: number) => calibrationSample(n).text);
  return {
    async claimRuns(limit) {
      return rows<ClaimedRun>(RPC.claimRuns, await call(sb, RPC.claimRuns, { p_event: eventId, p_limit: limit }));
    },
    async input(runId) {
      return checkInput(await call(sb, RPC.input, { p_run: runId }));
    },
    async recordInjections(submissionId, hits: InjectionLine[]) {
      await call(sb, RPC.recordInjections, { p_submission: submissionId, p_hits: hits });
    },
    async finish(runId, result: RunResult) {
      return (await call(sb, RPC.finish, { p_run: runId, p_result: result }) ?? { ok: true }) as FinishReply;
    },
    async claimCalibration(limit) {
      return rows<ClaimedCalibrationRun>(
        RPC.claimCalibration,
        await call(sb, RPC.claimCalibration, { p_event: eventId, p_limit: limit }),
      );
    },
    async calibrationInput(runId): Promise<CalibrationInput> {
      const v = object(RPC.calibrationInput, await call(sb, RPC.calibrationInput, { p_run: runId }));
      const sampleNo = Number(v.sample_no);
      if (!Number.isInteger(sampleNo)) throw new Error(`${RPC.calibrationInput}: sample_no is missing`);
      const text = typeof v.text === "string" && v.text.trim() !== "" ? v.text : sampleText(sampleNo);
      return {
        run_id: typeof v.run_id === "string" ? v.run_id : runId,
        sample_no: sampleNo,
        type: "PITCH",
        ticker: typeof v.ticker === "string" && v.ticker !== "" ? v.ticker : "CAL",
        company_name: typeof v.company_name === "string" ? v.company_name : "",
        names: Array.isArray(v.names) ? v.names.filter((n): n is string => typeof n === "string") : [],
        text,
      };
    },
    async finishCalibration(runId, result: RunResult) {
      return (await call(sb, RPC.finishCalibration, { p_run: runId, p_result: result }) ?? { ok: true }) as FinishReply;
    },
  };
}

export interface QueueCounts {
  queued: number;
  running: number;
  done: number;
  failed: number;
}

/** The event's judge runs by status (four count queries: the table can exceed one page of rows). */
export async function queueCounts(sb: SupabaseClient, eventId: string): Promise<QueueCounts> {
  const statuses = ["QUEUED", "RUNNING", "DONE", "FAILED"] as const;
  const counts = await Promise.all(
    statuses.map(async (status) => {
      const { count, error } = await sb
        .from("judge_runs")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId)
        .eq("status", status);
      if (error) throw new Error(`judge_runs: ${error.message}`);
      return count ?? 0;
    }),
  );
  return { queued: counts[0]!, running: counts[1]!, done: counts[2]!, failed: counts[3]! };
}
