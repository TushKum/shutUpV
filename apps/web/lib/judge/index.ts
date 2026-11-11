// The AI judge worker, for the route (app/api/judge/work) and the CLI (scripts/judge-worker.ts): settings, the judge
// (Claude or the fake), the start-up check of the model, the queue over Supabase, the worker loop and the route's
// answer. Nothing here imports Next, and imports are relative (no "@/"), so tsx can run it from the repository root.

import type Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, claudeJudge, modelChecker, type ModelCheck } from "./call";
import type { JudgeConfig } from "./config";
import { fakeJudge } from "./fake";
import type { JudgeFn } from "./types";

export { judgeConfig, hasApiCredential, rejectsSampling, JUDGE_DEFAULTS, type JudgeConfig } from "./config";
export { supabaseJudgeDb, queueCounts, type QueueCounts } from "./db";
export { promptLoader, loadPrompt, findPromptsDir, type JudgePrompt } from "./prompts";
export { loadCalibrationSamples, type CalibrationSample } from "./calibration";
export { runWorker, RUN_TIMEOUT_MS, type JudgeDb, type WorkerSummary } from "./worker";
export { workReply, modelCheckReply, type WorkReply } from "./reply";
export { FAKE_MODEL } from "./fake";
export type { ModelCheck } from "./call";
export type { JudgeSlot } from "./types";

// One SDK client and one model check per process (the check remembers a success for 60 s).
let client: Anthropic | null = null;
let checker: ((model: string) => Promise<ModelCheck>) | null = null;
const sharedClient = () => (client ??= anthropicClient());

/** The judge for these settings: the fake when JUDGE_FAKE is on, otherwise Claude through the SDK. */
export function createJudge(config: JudgeConfig): JudgeFn {
  if (config.fake) return fakeJudge({ latencyMs: config.fakeLatencyMs });
  return claudeJudge(sharedClient(), {
    effort: config.effort,
    ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
  });
}

/**
 * Checks that the API takes the key and the model before any run is claimed (GET /v1/models/{model}, no run used);
 * a success is remembered for 60 s in this process. Not for the fake judge.
 */
export function checkJudgeModel(model: string): Promise<ModelCheck> {
  checker ??= modelChecker(sharedClient());
  return checker(model);
}

/** Why the fake judge may not run on this event, or null when it may (or is off). */
export function fakeJudgeRefusal(config: Pick<JudgeConfig, "fake">, event: { is_rehearsal: boolean }): string | null {
  if (!config.fake || event.is_rehearsal) return null;
  return "The fake judge (JUDGE_FAKE) is on, and this is a live event: turn JUDGE_FAKE off to judge it.";
}
