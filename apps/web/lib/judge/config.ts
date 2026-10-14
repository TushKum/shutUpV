// The judge's settings, read from the environment (docs/JUDGE.md "Environment"). Pure: pass the environment in to
// test it. A bad value is an error at start-up, before any run is claimed.

import type { JudgeEffort, JudgeSlot } from "./types";

export interface JudgeConfig {
  models: Record<JudgeSlot, string>;
  /** Sent to the API only when set (current Claude models reject temperature: PLAN Q3). */
  temperature?: number;
  effort: JudgeEffort;
  /** Parallel calls per worker. */
  concurrency: number;
  /** How long one POST /api/judge/work keeps claiming runs. */
  budgetMs: number;
  /** JUDGE_FAKE=1: a deterministic scorer instead of the model (rehearsal events only). */
  fake: boolean;
  fakeLatencyMs: number;
}

export const JUDGE_DEFAULTS = {
  model: "claude-opus-5-5",
  backupModel: "claude-sonnet-5-5",
  effort: "low",
  concurrency: 8,
  budgetMs: 50_000,
  fakeLatencyMs: 300,
} as const;

const EFFORTS: readonly JudgeEffort[] = ["low", "medium", "high", "xhigh", "max"];

type Env = Record<string, string | undefined>;

/** An unset or blank variable counts as unset (.env.example ships `JUDGE_TEMPERATURE=`). */
function read(env: Env, name: string): string | undefined {
  const v = env[name]?.trim();
  return v ? v : undefined;
}

function integer(env: Env, name: string, fallback: number, min: number, max: number): number {
  const v = read(env, name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be a whole number from ${min} to ${max}, got "${v}"`);
  return n;
}

export function judgeConfig(env: Env = process.env): JudgeConfig {
  const effort = (read(env, "JUDGE_EFFORT") ?? JUDGE_DEFAULTS.effort) as JudgeEffort;
  if (!EFFORTS.includes(effort)) throw new Error(`JUDGE_EFFORT must be one of ${EFFORTS.join(", ")}, got "${effort}"`);

  const t = read(env, "JUDGE_TEMPERATURE");
  let temperature: number | undefined;
  if (t !== undefined) {
    temperature = Number(t);
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 1) {
      throw new Error(`JUDGE_TEMPERATURE must be a number from 0 to 1 (or unset), got "${t}"`);
    }
  }

  const fakeFlag = read(env, "JUDGE_FAKE")?.toLowerCase();
  if (fakeFlag !== undefined && !["0", "1", "true", "false", "yes", "no", "on", "off"].includes(fakeFlag)) {
    throw new Error(`JUDGE_FAKE must be 1 or 0, got "${fakeFlag}"`);
  }

  return {
    models: {
      PRIMARY: read(env, "JUDGE_MODEL") ?? JUDGE_DEFAULTS.model,
      BACKUP: read(env, "JUDGE_BACKUP_MODEL") ?? JUDGE_DEFAULTS.backupModel,
    },
    ...(temperature !== undefined ? { temperature } : {}),
    effort,
    // claim_judge_runs hands out at most 50 runs per claim.
    concurrency: integer(env, "JUDGE_CONCURRENCY", JUDGE_DEFAULTS.concurrency, 1, 50),
    budgetMs: integer(env, "JUDGE_WORK_BUDGET_MS", JUDGE_DEFAULTS.budgetMs, 1_000, 15 * 60_000),
    fake: fakeFlag === "1" || fakeFlag === "true" || fakeFlag === "yes" || fakeFlag === "on",
    fakeLatencyMs: integer(env, "JUDGE_FAKE_LATENCY_MS", JUDGE_DEFAULTS.fakeLatencyMs, 0, 120_000),
  };
}

/** The real judge needs an API credential; checked before any run is claimed so none fails for want of a key. */
export function hasApiCredential(env: Env = process.env): boolean {
  return read(env, "ANTHROPIC_API_KEY") !== undefined || read(env, "ANTHROPIC_AUTH_TOKEN") !== undefined;
}
