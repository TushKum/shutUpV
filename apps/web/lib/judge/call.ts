// One judging call to Claude (docs/JUDGE.md "Call", "Check", "Errors"): the system prompt with cache_control, the
// user message, structured output by JSON schema, effort from JUDGE_EFFORT, temperature only when JUDGE_TEMPERATURE
// is set. Thinking is left to the model (it cannot be turned off on Opus 5.5) and there is no assistant prefill.
// stop_reason is checked before the content is read. An invalid answer (not JSON, a rubric violation, a refusal, or
// cut off at max_tokens) is asked again, 3 attempts in all. API errors are not retried here (the SDK has already
// retried 429, 5xx and network errors with its own backoff): they are classified for the queue, which retries
// rate limits, overload and network errors later and fails the run at once on authentication or bad requests.

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
type Classified = Pick<Failure, "error" | "retryable" | "retryAfterMs" | "fatal">;

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

function describe(e: InstanceType<typeof Anthropic.APIError>): string {
  const parts = [e.status !== undefined ? String(e.status) : null, e.type ?? null].filter(Boolean);
  return `${parts.join(" ")}${parts.length ? ": " : ""}${e.message}`.slice(0, 500);
}

/** Sorts an exception from the SDK into retry later (rate limit, overload, network) or fail now. */
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
  if (e instanceof Anthropic.RateLimitError) {
    const after = retryAfterMs(e.headers, now);
    return { error: describe(e), retryable: true, ...(after !== undefined ? { retryAfterMs: after } : {}) };
  }
  if (e instanceof Anthropic.InternalServerError) {
    // 500, 529 overloaded and the other 5xx.
    const after = retryAfterMs(e.headers, now);
    return { error: describe(e), retryable: true, ...(after !== undefined ? { retryAfterMs: after } : {}) };
  }
  if (
    e instanceof Anthropic.AuthenticationError ||
    e instanceof Anthropic.PermissionDeniedError ||
    e instanceof Anthropic.NotFoundError ||
    e instanceof Anthropic.BadRequestError
  ) {
    // Every run would fail the same way (bad key, unknown model, a parameter the model rejects).
    return { error: describe(e), retryable: false, fatal: true };
  }
  if (e instanceof Anthropic.APIError) {
    // 408 and 409 are transient; 402 (billing), 413 (too large) and 422 are not.
    const status = typeof e.status === "number" ? e.status : 0;
    const transient = status === 408 || status === 409;
    return { error: describe(e), retryable: transient, ...(status === 402 ? { fatal: true } : {}) };
  }
  // Not from the API (for example no credentials configured): a setup problem, so stop rather than burn the queue.
  const message = e instanceof Error ? e.message : String(e);
  return { error: `judge call failed: ${message}`.slice(0, 500), retryable: false, fatal: true };
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

/** The SDK client for the judge: the SDK retries 429, 5xx and network errors twice; each try may take 2 minutes. */
export function anthropicClient(): Anthropic {
  return new Anthropic({ maxRetries: 2, timeout: 120_000 });
}
