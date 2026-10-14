// The AI judge worker, for the route (app/api/judge/work) and the CLI (scripts/judge-worker.ts): settings, the judge
// (Claude or the fake), the queue over Supabase and the worker loop. Nothing here imports Next, and imports are
// relative (no "@/"), so tsx can run it from the repository root.

import { anthropicClient, claudeJudge } from "./call";
import type { JudgeConfig } from "./config";
import { fakeJudge } from "./fake";
import type { JudgeFn } from "./types";

export { judgeConfig, hasApiCredential, JUDGE_DEFAULTS, type JudgeConfig } from "./config";
export { supabaseJudgeDb, queueCounts, type QueueCounts } from "./db";
export { promptLoader, loadPrompt, findPromptsDir, type JudgePrompt } from "./prompts";
export { loadCalibrationSamples, type CalibrationSample } from "./calibration";
export { runWorker, type JudgeDb, type WorkerSummary } from "./worker";
export { FAKE_MODEL } from "./fake";

/** The judge for these settings: the fake when JUDGE_FAKE is on, otherwise Claude through the SDK. */
export function createJudge(config: JudgeConfig): JudgeFn {
  if (config.fake) return fakeJudge({ latencyMs: config.fakeLatencyMs });
  return claudeJudge(anthropicClient(), {
    effort: config.effort,
    ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
  });
}

/** Why the fake judge may not run on this event, or null when it may (or is off). */
export function fakeJudgeRefusal(config: Pick<JudgeConfig, "fake">, event: { is_rehearsal: boolean }): string | null {
  if (!config.fake || event.is_rehearsal) return null;
  return "The fake judge (JUDGE_FAKE) is on, and this is a live event: turn JUDGE_FAKE off to judge it.";
}
