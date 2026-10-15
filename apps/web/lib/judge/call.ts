// One judging call to Claude (docs/JUDGE.md "Call", "Check", "Errors"): the system prompt with cache_control, the
// user message, structured output by JSON schema, effort from JUDGE_EFFORT, temperature only when JUDGE_TEMPERATURE
// is set. Thinking is left to the model (it cannot be turned off on Opus 5.5) and there is no assistant prefill.
// stop_reason is checked before the content is read. An invalid answer (not JSON, a rubric violation, a refusal, or
// cut off at max_tokens) is asked again, 3 attempts in all. API errors are not retried here (the SDK has already
// retried 429, 5xx and network errors with its own backoff): they are classified for the queue. Rate limits, overload
// and network errors go back to the queue. Configuration errors (401, 403, 404, 402) go back to the queue too and stop
// the worker, since every run would fail the same way. A 400 fails that run (the worker stops after three in a row).
// Also here: the start-up check of a model (models.retrieve), which uses no run.

import Anthropic from "@anthropic-ai/sdk";
import { validateJudgeOutput, type SubmissionType } from "@msim/engine";
import { outputSchema } from "./schema";
import { EMPTY_USAGE, type JudgeCallResult, type JudgeEffort, type JudgeFn, type JudgeUsage } from "./types";

export const MAX_TOKENS = 8000;
export const OUTPUT_ATTEMPTS = 3;

/** The part of the SDK client the judge uses (a fake in the tests). */
export interface MessagesClient {
  messages: {
    create(
      body: Anthropic.MessageCreateParamsNonStreaming,
      options?: { signal?: AbortSignal | null },
    ): PromiseLike<Anthropic.Message>;
  };
}

export interface JudgeOnceOptions {
  model: string;
  system: string;
  userText: string;
  type: SubmissionType;
  /** Sent only when set: current Claude models reject temperature (PLAN Q3). */
  temperature?: number;
  effort: JudgeEffort;
  signal?: AbortSignal;
  now?: () => number;
}

type Failure = Extract<JudgeCallResult, { ok: false }>;
type Classified = Pick<Failure, "error" | "retryable" | "retryAfterMs" | "fatal" | "status">;

/** The request body: exported so a test can check exactly what is sent. */
export function judgeParams(o: Pick<JudgeOnceOptions, "model" | "system" | "userText" | "type" | "temperature" | "effort">) {
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: o.model,
    max_tokens: MAX_TOKENS,
    system: [{ type: "text", text: o.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: o.userText }],
    output_config: { effort: o.effort, format: { type: "json_schema", schema: outputSchema(o.type) } },
  };
  if (o.temperature !== undefined) params.temperature = o.temperature;
  return params;
}

/** retry-after-ms (milliseconds) or retry-after (seconds, or an HTTP date), when the API sent one. */
export function retryAfterMs(headers: Headers | undefined | null, now: number = Date.now()): number | undefined {
  if (!headers) return undefined;
  const ms = headers.get("retry-after-ms");
  if (ms !== null && ms.trim() !== "" && Number.isFinite(Number(ms))) return Math.max(0, Math.round(Number(ms)));
  const after = headers.get("retry-after");
  if (after === null || after.trim() === "") return undefined;
  if (Number.isFinite(Number(after))) return Math.max(0, Math.round(Number(after) * 1000));
  const at = Date.parse(after);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/** "401 authentication_error: invalid x-api-key": the status, the error type and the API's own message. */
function describe(e: InstanceType<typeof Anthropic.APIError>): string {
  const parts = [e.status !== undefined ? String(e.status) : null, e.type ?? null].filter(Boolean);
  // The SDK's message is "<status> <the JSON body>" when the body has no top-level message: use the inner one.
  const inner = (e.error as { error?: { message?: unknown } } | undefined)?.error?.message;
  const text =
    typeof inner === "string" && inner !== ""
      ? inner
      : e.status !== undefined && e.message.startsWith(`${e.status} `)
        ? e.message.slice(String(e.status).length + 1)
        : e.message;
  return `${parts.join(" ")}${parts.length ? ": " : ""}${text}`.slice(0, 500);
}

/** HTTP statuses that mean the setup is wrong (key, access, model name, billing), not this run. */
const CONFIGURATION_STATUSES = new Set([401, 402, 403, 404]);

/**
 * Sorts an exception from the SDK: retry later (rate limit, overload, network), go back to the queue and stop the
 * worker (a configuration error), or fail this run (a bad request, anything else).
 */
export function classifyError(e: unknown, now: number = Date.now()): Classified {
  // Most specific first: APIUserAbortError and APIConnectionError are subclasses of APIError in the TypeScript SDK.
  if (e instanceof Anthropic.APIUserAbortError) {
    return { error: "the worker stopped before the model answered", retryable: true };
  }
  if (e instanceof Anthropic.APIConnectionTimeoutError) {
    return { error: "the model did not answer in time", retryable: true };
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return { error: `network error: ${e.message}`.slice(0, 500), retryable: true };
  }
  if (e instanceof Anthropic.APIError) {
    const status = typeof e.status === "number" ? e.status : undefined;
    const withStatus = status !== undefined ? { status } : {};
    if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError) {
      // 429, and 500, 529 overloaded and the other 5xx.
      const after = retryAfterMs(e.headers, now);
      return { error: describe(e), retryable: true, ...withStatus, ...(after !== undefined ? { retryAfterMs: after } : {}) };
    }
    if (status !== undefined && CONFIGURATION_STATUSES.has(status)) {
      // Bad key, no access, unknown model, billing: nothing was judged, so the run goes back to the queue (it can be
      // judged once the setup is fixed), and the worker stops because every other run would fail the same way.
      return { error: describe(e), retryable: true, fatal: true, ...withStatus };
    }
    if (status === 400) {
      // This request was refused. Probably this run only (the worker stops after three in a row).
      return { error: describe(e), retryable: false, ...withStatus };
    }
    // 408 and 409 are transient; 413 (too large), 422 and the rest fail this run.
    return { error: describe(e), retryable: status === 408 || status === 409, ...withStatus };
  }
  // Not from the API (for example no credentials configured): a setup problem, so back to the queue and stop.
  const message = e instanceof Error ? e.message : String(e);
  return { error: `judge call failed: ${message}`.slice(0, 500), retryable: true, fatal: true };
}

function addUsage(total: JudgeUsage, u: Anthropic.Usage | null | undefined): JudgeUsage {
  if (!u) return total;
  return {
    input_tokens: total.input_tokens + (u.input_tokens ?? 0),
    output_tokens: total.output_tokens + (u.output_tokens ?? 0),
    cache_read_input_tokens: total.cache_read_input_tokens + (u.cache_read_input_tokens ?? 0),
    cache_creation_input_tokens: total.cache_creation_input_tokens + (u.cache_creation_input_tokens ?? 0),
  };
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Judges one request: up to 3 attempts at a valid answer. Never throws for API errors. */
export async function judgeOnce(client: MessagesClient, o: JudgeOnceOptions): Promise<JudgeCallResult> {
  const now = o.now ?? Date.now;
  const started = now();
  const params = judgeParams(o);
  let usage = EMPTY_USAGE;
  let lastError = "no answer";
  let lastRaw: string | undefined;
  let model = o.model;

  for (let attempt = 1; attempt <= OUTPUT_ATTEMPTS; attempt++) {
    let message: Anthropic.Message;
    try {
      message = await client.messages.create(params, o.signal ? { signal: o.signal } : undefined);
    } catch (e) {
      return { ok: false, ...classifyError(e), model, latencyMs: now() - started, usage, attempts: attempt, ...(lastRaw !== undefined ? { raw: lastRaw } : {}) };
    }
    usage = addUsage(usage, message.usage);
    model = message.model || model;
    const text = textOf(message);
    lastRaw = text;

    if (message.stop_reason === "refusal") {
      const d = message.stop_details;
      lastError = `the model refused${d?.category ? ` (${d.category})` : ""}${d?.explanation ? `: ${d.explanation}` : ""}`;
      continue;
    }
    if (message.stop_reason === "max_tokens" || message.stop_reason === "model_context_window_exceeded") {
      lastError = `the answer was cut off (${message.stop_reason})`;
      continue;
    }
    if (message.stop_reason !== "end_turn" && message.stop_reason !== "stop_sequence") {
      lastError = `unexpected stop_reason ${message.stop_reason ?? "null"}`;
      continue;
    }

    const check = validateJudgeOutput(o.type, text);
    if (!check.ok) {
      lastError = check.errors.join("; ");
      continue;
    }
    return {
      ok: true,
      breakdown: check.breakdown,
      total: check.total,
      rationale: check.rationale,
      raw: text,
      model,
      latencyMs: now() - started,
      usage,
      attempts: attempt,
    };
  }
  return {
    ok: false,
    error: `no valid answer in ${OUTPUT_ATTEMPTS} attempts: ${lastError}`.slice(0, 1000),
    retryable: false,
    model,
    latencyMs: now() - started,
    usage,
    attempts: OUTPUT_ATTEMPTS,
    ...(lastRaw !== undefined ? { raw: lastRaw } : {}),
  };
}

/** The judge the worker calls, over a real (or fake) client. */
export function claudeJudge(
  client: MessagesClient,
  settings: { temperature?: number; effort: JudgeEffort },
): JudgeFn {
  return (r) =>
    judgeOnce(client, {
      model: r.model,
      system: r.system,
      userText: r.userText,
      type: r.type,
      effort: settings.effort,
      ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
      ...(r.signal ? { signal: r.signal } : {}),
    });
}

/**
 * The SDK client for the judge: the SDK retries 429, 5xx, network errors and timeouts twice, and each try may take
 * 60 s. The worker also gives each run its own limit (RUN_TIMEOUT_MS, below the queue's 3-minute lease).
 */
export function anthropicClient(): Anthropic {
  return new Anthropic({ maxRetries: 2, timeout: 60_000 });
}

// ───────────────────────────── The start-up check ─────────────────────────────

/** The part of the SDK client the start-up check uses (a fake in the tests). */
export interface ModelsClient {
  models: {
    retrieve(modelID: string, params?: null, options?: { timeout?: number; maxRetries?: number }): PromiseLike<unknown>;
  };
}

/** How long a successful check is trusted (per process). */
export const MODEL_CHECK_TTL_MS = 60_000;

export type ModelCheck = { ok: true; cached: boolean } | { ok: false; error: string; status?: number };

/**
 * A check that the API takes this key and this model, made without using a run (GET /v1/models/{model}): a bad key,
 * no access or an unknown model shows here instead of on the first run claimed. A success is remembered for 60 s, so
 * the control panel (a call every 50 s per open console) checks about once a minute; a failure is not remembered.
 */
export function modelChecker(client: ModelsClient, options: { ttlMs?: number; now?: () => number } = {}) {
  const ttl = options.ttlMs ?? MODEL_CHECK_TTL_MS;
  const now = options.now ?? Date.now;
  const goodUntil = new Map<string, number>();
  return async (model: string): Promise<ModelCheck> => {
    const until = goodUntil.get(model);
    if (until !== undefined && now() < until) return { ok: true, cached: true };
    try {
      await client.models.retrieve(model, null, { timeout: 20_000, maxRetries: 1 });
    } catch (e) {
      goodUntil.delete(model);
      const c = classifyError(e);
      return { ok: false, error: c.error, ...(c.status !== undefined ? { status: c.status } : {}) };
    }
    goodUntil.set(model, now() + ttl);
    return { ok: true, cached: false };
  };
}
