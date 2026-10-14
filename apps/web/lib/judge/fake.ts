// The fake judge (JUDGE_FAKE=1), for tests and rehearsals without the API. Deterministic: the SHA-256 of the request
// sets a "quality" for the submission, and the SHA-256 of the request and the run number adds a little noise per
// rubric line, so runs of one submission differ (sometimes by more than 10, which exercises runs 4 and 5) but the
// same run always gives the same answer. Each line stays within its maximum and the total is the sum.
// The worker refuses the fake judge on a live (non-rehearsal) event.

import { createHash } from "node:crypto";
import { RUBRICS, type JudgeOutput, type SubmissionType } from "@msim/engine";
import { EMPTY_USAGE, type JudgeCallResult, type JudgeFn } from "./types";

export const FAKE_MODEL = "fake-judge";

function digest(text: string): Uint8Array {
  return createHash("sha256").update(text, "utf8").digest();
}

export function fakeJudgeOutput(type: SubmissionType, requestText: string, runNo: number): JudgeOutput {
  const base = digest(requestText);
  const perRun = digest(`${requestText}\n#run ${runNo}`);
  // Quality from 30% to 95% of each line's maximum.
  const quality = 0.3 + (((base[0]! << 8) | base[1]!) / 0xffff) * 0.65;
  const rubric = RUBRICS[type];
  const breakdown: Record<string, number> = {};
  rubric.forEach((line, i) => {
    const noise = (perRun[i]! % 7) - 3; // −3 … +3
    breakdown[line.key] = Math.min(line.max, Math.max(0, Math.round(line.max * quality) + noise));
  });
  const total = rubric.reduce((s, l) => s + breakdown[l.key]!, 0);
  const ratio = (key: string) => breakdown[key]! / rubric.find((l) => l.key === key)!.max;
  const sorted = [...rubric].sort((a, b) => ratio(b.key) - ratio(a.key) || a.key.localeCompare(b.key));
  const best = sorted[0]!;
  const worst = sorted[sorted.length - 1]!;
  const rationale =
    `This is the fake judge used for rehearsals, and it scored this ${type.toLowerCase()} ${total} out of 100. ` +
    `Its strongest line is ${best.label.toLowerCase()} (${breakdown[best.key]}/${best.max}) and its weakest is ` +
    `${worst.label.toLowerCase()} (${breakdown[worst.key]}/${worst.max}). ` +
    `The score comes from a hash of the request (${Buffer.from(base.subarray(0, 4)).toString("hex")}) and run ${runNo}, not from reading it.`;
  return { breakdown, total, rationale };
}

function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function fakeJudge(options: { latencyMs: number; now?: () => number }): JudgeFn {
  const now = options.now ?? Date.now;
  return async (r): Promise<JudgeCallResult> => {
    const started = now();
    const finished = await sleep(options.latencyMs, r.signal);
    if (!finished) {
      return {
        ok: false,
        error: "the worker stopped before the model answered",
        retryable: true,
        model: FAKE_MODEL,
        latencyMs: now() - started,
        usage: EMPTY_USAGE,
        attempts: 1,
      };
    }
    const out = fakeJudgeOutput(r.type, r.requestText, r.runNo);
    return {
      ok: true,
      ...out,
      raw: JSON.stringify(out),
      model: FAKE_MODEL,
      latencyMs: now() - started,
      usage: EMPTY_USAGE,
      attempts: 1,
    };
  };
}
