import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, test } from "vitest";
import { classifyError, claudeJudge, judgeOnce, judgeParams, MAX_TOKENS, retryAfterMs, type MessagesClient } from "./call";
import { outputSchema } from "./schema";

const VALID = JSON.stringify({
  breakdown: { problem: 20, solution: 18, business_model: 15, advantage: 12 },
  total: 65,
  rationale: "Clear problem. Workable solution. Thin advantage.",
});

function message(text: string, stop_reason: Anthropic.StopReason = "end_turn", extra: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: text === "" ? [] : [{ type: "text", text, citations: null }],
    stop_reason,
    stop_sequence: null,
    stop_details: null,
    container: null,
    diagnostics: null,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 0,
      cache_creation: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: "standard",
    },
    ...extra,
  } as Anthropic.Message;
}

function fakeClient(answers: (Anthropic.Message | Error)[]) {
  const calls: { body: Anthropic.MessageCreateParamsNonStreaming; options?: { signal?: AbortSignal | null } }[] = [];
  const client: MessagesClient = {
    messages: {
      async create(body, options) {
        calls.push(options ? { body, options } : { body });
        const next = answers.shift();
        if (!next) throw new Error("no more answers");
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
  return { client, calls };
}

const errorBody = (type: string, message: string) => ({ type: "error", error: { type, message } });
const OPTS = { model: "claude-opus-5-5", system: "RUBRIC", userText: "<submission>…</submission>", type: "PITCH" as const, effort: "low" as const };

describe("judgeOnce", () => {
  test("a valid answer: breakdown, total, rationale, the raw text, the model and the usage", async () => {
    const { client, calls } = fakeClient([message(VALID)]);
    const r = await judgeOnce(client, OPTS);
    expect(r).toMatchObject({
      ok: true,
      breakdown: { problem: 20, solution: 18, business_model: 15, advantage: 12 },
      total: 65,
      rationale: "Clear problem. Workable solution. Thin advantage.",
      raw: VALID,
      model: "claude-opus-5-5",
      attempts: 1,
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
    });
    expect(calls).toHaveLength(1);
  });

  test("an invalid answer is asked again; a valid second answer wins", async () => {
    const { client, calls } = fakeClient([message("Sure! Here is the score: 65"), message(VALID)]);
    const r = await judgeOnce(client, OPTS);
    expect(r).toMatchObject({ ok: true, total: 65, attempts: 2 });
    expect(calls).toHaveLength(2);
    expect(r.usage.input_tokens).toBe(200);
  });

  test("three invalid answers fail the run, not retryable", async () => {
    const wrongSum = JSON.stringify({ breakdown: { problem: 20, solution: 18, business_model: 15, advantage: 12 }, total: 99, rationale: "x" });
    const overMax = JSON.stringify({ breakdown: { problem: 26, solution: 0, business_model: 0, advantage: 0 }, total: 26, rationale: "x" });
    const { client, calls } = fakeClient([message("not json"), message(overMax), message(wrongSum)]);
    const r = await judgeOnce(client, OPTS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.retryable).toBe(false);
    expect(r.fatal).toBeUndefined();
    expect(r.error).toMatch(/no valid answer in 3 attempts: total 99 does not equal the sum 65/);
    expect(r.raw).toBe(wrongSum);
    expect(r.attempts).toBe(3);
    expect(calls).toHaveLength(3);
  });

  test("a refusal counts as an invalid answer (asked again, then the run fails)", async () => {
    const refusal = message("", "refusal", {
      stop_details: { type: "refusal", category: "general_harms", explanation: "declined" },
    });
    const again = fakeClient([refusal, message(VALID)]);
    expect(await judgeOnce(again.client, OPTS)).toMatchObject({ ok: true, attempts: 2 });

    const never = fakeClient([refusal, refusal, refusal]);
    const r = await judgeOnce(never.client, OPTS);
    expect(r).toMatchObject({ ok: false, retryable: false, attempts: 3 });
    if (!r.ok) expect(r.error).toContain("the model refused (general_harms): declined");
  });

  test("an answer cut off at max_tokens counts as invalid, even when its text happens to parse", async () => {
    const cut = fakeClient([message(VALID, "max_tokens"), message(VALID)]);
    expect(await judgeOnce(cut.client, OPTS)).toMatchObject({ ok: true, attempts: 2 });
    const always = fakeClient([message('{"breakdown":', "max_tokens"), message("", "max_tokens"), message("", "max_tokens")]);
    const r = await judgeOnce(always.client, OPTS);
    expect(r).toMatchObject({ ok: false, retryable: false });
    if (!r.ok) expect(r.error).toContain("cut off (max_tokens)");
  });

  test("only text blocks are read (thinking blocks are skipped)", async () => {
    const withThinking = message(VALID, "end_turn", {
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: VALID, citations: null },
      ],
    });
    const { client } = fakeClient([withThinking]);
    expect(await judgeOnce(client, OPTS)).toMatchObject({ ok: true, total: 65 });
  });

  test("429 with retry-after: retryable, with retryAfterMs", async () => {
    const e = new Anthropic.RateLimitError(429, errorBody("rate_limit_error", "slow down"), "slow down", new Headers({ "retry-after": "7" }), "rate_limit_error");
    const { client, calls } = fakeClient([e]);
    const r = await judgeOnce(client, OPTS);
    expect(r).toMatchObject({ ok: false, retryable: true, retryAfterMs: 7000 });
    expect(calls).toHaveLength(1); // API errors are not asked again here: the SDK has retried, the queue retries later
    const noHeader = new Anthropic.RateLimitError(429, errorBody("rate_limit_error", "x"), "x", new Headers(), "rate_limit_error");
    const r2 = classifyError(noHeader);
    expect(r2).toMatchObject({ retryable: true });
    expect(r2.retryAfterMs).toBeUndefined();
  });

  test("401 is not retryable and stops the worker (every run would fail the same way)", async () => {
    const e = new Anthropic.AuthenticationError(401, errorBody("authentication_error", "invalid x-api-key"), "invalid x-api-key", new Headers(), "authentication_error");
    const { client } = fakeClient([e]);
    const r = await judgeOnce(client, OPTS);
    expect(r).toMatchObject({ ok: false, retryable: false, fatal: true });
    if (!r.ok) expect(r.error).toContain("401");
  });

  test("errors are classified by type: overload, server and network errors retry; bad requests and unknown models do not", () => {
    const h = new Headers();
    expect(classifyError(new Anthropic.InternalServerError(529, errorBody("overloaded_error", "Overloaded"), "Overloaded", h, "overloaded_error"))).toMatchObject({ retryable: true });
    expect(classifyError(new Anthropic.InternalServerError(500, errorBody("api_error", "boom"), "boom", new Headers({ "retry-after": "3" }), "api_error"))).toMatchObject({ retryable: true, retryAfterMs: 3000 });
    expect(classifyError(new Anthropic.APIConnectionError({ message: "Connection error." }))).toMatchObject({ retryable: true });
    expect(classifyError(new Anthropic.APIConnectionTimeoutError())).toMatchObject({ retryable: true });
    expect(classifyError(new Anthropic.APIUserAbortError())).toMatchObject({ retryable: true });
    expect(classifyError(new Anthropic.BadRequestError(400, errorBody("invalid_request_error", "temperature is not supported"), "temperature is not supported", h, "invalid_request_error"))).toMatchObject({ retryable: false, fatal: true });
    expect(classifyError(new Anthropic.NotFoundError(404, errorBody("not_found_error", "model: x"), "model: x", h, "not_found_error"))).toMatchObject({ retryable: false, fatal: true });
    expect(classifyError(new Anthropic.PermissionDeniedError(403, errorBody("permission_error", "no"), "no", h, "permission_error"))).toMatchObject({ retryable: false, fatal: true });
    expect(classifyError(new Error("Could not resolve authentication method"))).toMatchObject({ retryable: false, fatal: true });
  });

  test("retry-after-ms wins over retry-after; an HTTP date counts from now", () => {
    expect(retryAfterMs(new Headers({ "retry-after-ms": "1500", "retry-after": "9" }))).toBe(1500);
    const now = Date.parse("2026-11-14T21:00:00Z");
    expect(retryAfterMs(new Headers({ "retry-after": "Sat, 14 Nov 2026 21:00:30 GMT" }), now)).toBe(30_000);
    expect(retryAfterMs(new Headers({ "retry-after": "soon" }))).toBeUndefined();
    expect(retryAfterMs(undefined)).toBeUndefined();
  });
});

describe("the request sent", () => {
  test("temperature is sent only when set (0 included)", async () => {
    const without = fakeClient([message(VALID)]);
    await judgeOnce(without.client, OPTS);
    expect("temperature" in without.calls[0]!.body).toBe(false);

    const zero = fakeClient([message(VALID)]);
    await judgeOnce(zero.client, { ...OPTS, temperature: 0 });
    expect(zero.calls[0]!.body.temperature).toBe(0);
  });

  test("effort and the JSON schema go in output_config; the system prompt is cached; no thinking, no prefill", async () => {
    const { client, calls } = fakeClient([message(VALID)]);
    await judgeOnce(client, { ...OPTS, type: "PLAN", model: "claude-sonnet-5-5", effort: "medium" });
    const body = calls[0]!.body;
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.max_tokens).toBe(MAX_TOKENS);
    expect(body.output_config).toEqual({ effort: "medium", format: { type: "json_schema", schema: outputSchema("PLAN") } });
    expect(body.system).toEqual([{ type: "text", text: "RUBRIC", cache_control: { type: "ephemeral" } }]);
    expect(body.messages).toEqual([{ role: "user", content: OPTS.userText }]);
    expect("thinking" in body).toBe(false);
    expect("top_p" in body || "top_k" in body).toBe(false);
  });

  test("the same body is sent on every attempt (so the cached prefix is reused)", async () => {
    const { client, calls } = fakeClient([message("x"), message(VALID)]);
    await judgeOnce(client, OPTS);
    expect(calls[1]!.body).toEqual(calls[0]!.body);
    expect(judgeParams(OPTS)).toEqual(calls[0]!.body);
  });

  test("claudeJudge passes the worker's request, the settings and the abort signal through", async () => {
    const { client, calls } = fakeClient([message(VALID)]);
    const signal = new AbortController().signal;
    const judge = claudeJudge(client, { effort: "low", temperature: 0 });
    const r = await judge({ type: "PITCH", model: "m", system: "S", userText: "U", requestText: "U", runNo: 1, signal });
    expect(r.ok).toBe(true);
    expect(calls[0]!.body).toMatchObject({ model: "m", temperature: 0, messages: [{ role: "user", content: "U" }] });
    expect(calls[0]!.options?.signal).toBe(signal);
  });
});
