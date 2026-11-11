// The judge on a local model through Ollama (https://ollama.com), for an organiser's laptop: the CLI worker
// (pnpm judge-worker) with JUDGE_PROVIDER=ollama. Same prompt, same JSON schema (Ollama's structured outputs: `format`
// takes the schema) and the same rubric check as the Claude judge, 3 attempts at a valid answer per run. The control
// panel's "Run the judge here" runs on the web server, which cannot reach a laptop's Ollama: use the CLI worker.
//
// Errors: Ollama not running, or the model not pulled, stop the worker (every run would fail the same way) and the
// run goes back to the queue; a slow answer or a 5xx goes back to the queue to be tried again.

import { validateJudgeOutput } from "@msim/engine";
import { MAX_TOKENS, OUTPUT_ATTEMPTS, type ModelCheck } from "./call";
import { outputSchema } from "./schema";
import { EMPTY_USAGE, type JudgeCallResult, type JudgeFn, type JudgeUsage } from "./types";

export const OLLAMA_DEFAULT_URL = "http://127.0.0.1:11434";

/** The part of fetch the Ollama judge uses (a fake in the tests). */
export type FetchFn = (url: string, init: { method: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

interface ChatReply {
  model?: string;
  message?: { content?: string };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

/** The request body for Ollama's /api/chat: exported so a test can check exactly what is sent. */
export function ollamaParams(o: { model: string; system: string; userText: string; type: Parameters<typeof outputSchema>[0]; temperature?: number }) {
  return {
    model: o.model,
    stream: false,
    format: outputSchema(o.type),
    messages: [
      { role: "system", content: o.system },
      { role: "user", content: o.userText },
    ],
    // Low temperature: a judge should give the same answer to the same text. A context large enough for the prompt,
    // the submission and the answer.
    options: { temperature: o.temperature ?? 0.2, num_ctx: 16_384, num_predict: MAX_TOKENS },
  };
}

function networkFailure(e: unknown, url: string): { error: string; retryable: true; fatal?: true } {
  const name = (e as { name?: string } | null)?.name;
  if (name === "AbortError" || name === "TimeoutError") return { error: "the model did not answer in time", retryable: true };
  const message = e instanceof Error ? `${e.message}${(e as { cause?: { code?: string } }).cause?.code ? ` (${(e as { cause: { code: string } }).cause.code})` : ""}` : String(e);
  return { error: `Ollama is not reachable at ${url}: ${message}. Start it with "ollama serve" (or open the Ollama app).`.slice(0, 500), retryable: true, fatal: true };
}

/** One judging call to Ollama: up to 3 attempts at a valid answer. Never throws. */
export function ollamaJudge(settings: { url?: string; temperature?: number; fetchFn?: FetchFn; now?: () => number } = {}): JudgeFn {
  const base = (settings.url ?? OLLAMA_DEFAULT_URL).replace(/\/+$/, "");
  const fetchFn: FetchFn = settings.fetchFn ?? ((u, init) => fetch(u, init) as unknown as ReturnType<FetchFn>);
  const now = settings.now ?? Date.now;
  return async (r): Promise<JudgeCallResult> => {
    const started = now();
    const body = JSON.stringify(ollamaParams({ model: r.model, system: r.system, userText: r.userText, type: r.type, ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}) }));
    let usage: JudgeUsage = EMPTY_USAGE;
    let lastError = "no answer";
    let lastRaw: string | undefined;
    for (let attempt = 1; attempt <= OUTPUT_ATTEMPTS; attempt++) {
      let reply: ChatReply;
      try {
        const res = await fetchFn(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body, ...(r.signal ? { signal: r.signal } : {}) });
        if (!res.ok) {
          const text = (await res.text().catch(() => "")).slice(0, 300);
          const missing = res.status === 404 || /not found|pull/i.test(text);
          return {
            ok: false,
            error: missing ? `the model ${r.model} is not in Ollama: run "ollama pull ${r.model}" (${res.status} ${text})`.slice(0, 500) : `Ollama answered ${res.status}: ${text}`.slice(0, 500),
            retryable: missing || res.status >= 500 || res.status === 408 || res.status === 429,
            ...(missing ? { fatal: true } : {}),
            status: res.status,
            model: r.model,
            latencyMs: now() - started,
            usage,
            attempts: attempt,
          };
        }
        reply = (await res.json()) as ChatReply;
      } catch (e) {
        return { ok: false, ...networkFailure(e, base), model: r.model, latencyMs: now() - started, usage, attempts: attempt, ...(lastRaw !== undefined ? { raw: lastRaw } : {}) };
      }
      usage = {
        ...usage,
        input_tokens: usage.input_tokens + (reply.prompt_eval_count ?? 0),
        output_tokens: usage.output_tokens + (reply.eval_count ?? 0),
      };
      const text = reply.message?.content ?? "";
      lastRaw = text;
      if (reply.done_reason === "length") {
        lastError = "the answer was cut off (length)";
        continue;
      }
      const check = validateJudgeOutput(r.type, text);
      if (!check.ok) {
        lastError = check.errors.join("; ");
        continue;
      }
      return { ok: true, breakdown: check.breakdown, total: check.total, rationale: check.rationale, raw: text, model: reply.model || r.model, latencyMs: now() - started, usage, attempts: attempt };
    }
    return {
      ok: false,
      error: `no valid answer in ${OUTPUT_ATTEMPTS} attempts: ${lastError}`.slice(0, 1000),
      retryable: false,
      model: r.model,
      latencyMs: now() - started,
      usage,
      attempts: OUTPUT_ATTEMPTS,
      ...(lastRaw !== undefined ? { raw: lastRaw } : {}),
    };
  };
}

/** Before claiming runs: is Ollama running, and has it got this model? (GET /api/tags, no run used.) */
export function ollamaChecker(settings: { url?: string; fetchFn?: FetchFn } = {}) {
  const base = (settings.url ?? OLLAMA_DEFAULT_URL).replace(/\/+$/, "");
  const fetchFn: FetchFn = settings.fetchFn ?? ((u, init) => fetch(u, init) as unknown as ReturnType<FetchFn>);
  return async (model: string): Promise<ModelCheck> => {
    let tags: { models?: { name?: string; model?: string }[] };
    try {
      const res = await fetchFn(`${base}/api/tags`, { method: "GET", signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return { ok: false, error: `Ollama answered ${res.status} at ${base}/api/tags`, status: res.status };
      tags = (await res.json()) as typeof tags;
    } catch (e) {
      return { ok: false, error: networkFailure(e, base).error };
    }
    const names = new Set((tags.models ?? []).flatMap((m) => [m.name, m.model]).filter((n): n is string => !!n));
    const wanted = model.includes(":") ? [model] : [model, `${model}:latest`];
    if (!wanted.some((w) => names.has(w))) {
      return { ok: false, error: `Ollama does not have the model ${model}: run "ollama pull ${model}" (it has: ${[...names].join(", ") || "none"})` };
    }
    return { ok: true, cached: false };
  };
}
