// What POST /api/judge/work answers (the route file may export only its handler, so the mapping lives here). Pure.
// 200 with the worker's summary when it stopped normally (the queue ran dry, the time budget, a stop); 502 with the
// summary, `error` and `reason` when it stopped on something it cannot get past (a configuration error, three bad
// requests in a row, the queue could not be read) or when the start-up check of the model failed. The control
// panel's loop switches itself off on any answer that is not 2xx and shows `error` after "The judge stopped: ".

import type { ModelCheck } from "./call";
import type { QueueCounts } from "./db";
import type { JudgeSlot } from "./types";
import type { WorkerSummary } from "./worker";

export interface WorkReply {
  status: number;
  body: Record<string, unknown>;
}

const FALLBACK: Partial<Record<WorkerSummary["stopped"], string>> = {
  fatal: "a configuration error",
  error: "the judge queue could not be read",
};

/** The answer for one turn of work. */
export function workReply(summary: WorkerSummary, extra: { fake: boolean; remaining: QueueCounts | null }): WorkReply {
  const body: Record<string, unknown> = { ...summary, ...extra };
  if (summary.stopped !== "fatal" && summary.stopped !== "error") return { status: 200, body };
  const reason = summary.reason ?? FALLBACK[summary.stopped]!;
  return { status: 502, body: { ...body, error: reason, stopped: summary.stopped, reason } };
}

/** The answer when the start-up check of the event's model failed (nothing was claimed). */
export function modelCheckReply(model: string, slot: JudgeSlot, check: Extract<ModelCheck, { ok: false }>): WorkReply {
  const reason = `the API check of ${model} (the ${slot} model) failed: ${check.error}`;
  return { status: 502, body: { error: reason, stopped: "fatal", reason } };
}
