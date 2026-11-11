import { describe, expect, test } from "vitest";
import { judgeConfig } from "./config";
import { ollamaChecker, ollamaJudge, ollamaParams, type FetchFn } from "./ollama";
import { outputSchema } from "./schema";

const VALID = JSON.stringify({
  breakdown: { problem: 20, solution: 18, metrics: 10, business_model: 9, feasibility: 4, clarity: 4 },
  total: 65,
  rationale: "Clear problem. Workable solution. Thin feasibility.",
});
const request = { model: "qwen2.5:7b", system: "You are the judge.", userText: "The PRD.", requestText: "The PRD.", runNo: 1, type: "PITCH" as const };

/** A stand-in for Ollama: answers the queued replies in order and records each request. */
function fakeOllama(replies: ({ status?: number; body?: unknown; text?: string } | Error)[]) {
  const calls: { url: string; body: unknown }[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
    const r = replies.shift() ?? new Error("no reply queued");
    if (r instanceof Error) throw r;
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body, text: async () => r.text ?? JSON.stringify(r.body ?? "") };
  };
  return { fetchFn, calls };
}
const chat = (content: string, extra: Record<string, unknown> = {}) => ({ body: { model: "qwen2.5:7b", message: { content }, done_reason: "stop", prompt_eval_count: 1200, eval_count: 150, ...extra } });

describe("the Ollama judge", () => {
  test("sends the same prompt and the JSON schema to /api/chat, and returns the checked score", async () => {
    const { fetchFn, calls } = fakeOllama([chat(VALID)]);
    const r = await ollamaJudge({ url: "http://127.0.0.1:11434/", fetchFn })(request);
    expect(r).toMatchObject({ ok: true, total: 65, model: "qwen2.5:7b", attempts: 1, usage: { input_tokens: 1200, output_tokens: 150 } });
    expect(calls[0]!.url).toBe("http://127.0.0.1:11434/api/chat");
    expect(calls[0]!.body).toEqual(ollamaParams(request));
    expect(ollamaParams(request)).toMatchObject({ stream: false, format: outputSchema("PITCH"), options: { temperature: 0.2 } });
  });

  test("an answer that breaks the rubric or is cut off is asked again, up to 3 times", async () => {
    const bad = JSON.stringify({ breakdown: { problem: 99 }, total: 99, rationale: "x" });
    const { fetchFn, calls } = fakeOllama([chat(bad), chat(VALID.slice(0, 20), { done_reason: "length" }), chat(VALID)]);
    const r = await ollamaJudge({ fetchFn })(request);
    expect(r).toMatchObject({ ok: true, attempts: 3, usage: { input_tokens: 3600 } });
    expect(calls).toHaveLength(3);
    const never = await ollamaJudge({ fetchFn: fakeOllama([chat(bad), chat(bad), chat(bad)]).fetchFn })(request);
    expect(never).toMatchObject({ ok: false, retryable: false, attempts: 3 });
    expect(never.ok === false && never.error).toMatch(/^no valid answer in 3 attempts/);
  });

  test("Ollama not running, or the model not pulled, stops the worker; a server error is tried again later", async () => {
    const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    const down = await ollamaJudge({ fetchFn: fakeOllama([refused]).fetchFn })(request);
    expect(down).toMatchObject({ ok: false, retryable: true, fatal: true });
    expect(down.ok === false && down.error).toMatch(/Ollama is not reachable .*ECONNREFUSED.*ollama serve/);

    const missing = await ollamaJudge({ fetchFn: fakeOllama([{ status: 404, text: '{"error":"model \\"qwen2.5:7b\\" not found, try pulling it first"}' }]).fetchFn })(request);
    expect(missing).toMatchObject({ ok: false, retryable: true, fatal: true, status: 404 });
    expect(missing.ok === false && missing.error).toMatch(/ollama pull qwen2.5:7b/);

    const busy = await ollamaJudge({ fetchFn: fakeOllama([{ status: 503, text: "busy" }]).fetchFn })(request);
    expect(busy).toMatchObject({ ok: false, retryable: true, status: 503 });
    expect(busy.ok === false && busy.fatal).toBeFalsy();

    const slow = await ollamaJudge({ fetchFn: fakeOllama([Object.assign(new Error("aborted"), { name: "AbortError" })]).fetchFn })(request);
    expect(slow).toMatchObject({ ok: false, retryable: true, error: "the model did not answer in time" });
  });

  test("the start-up check: Ollama running and the model pulled (a bare name matches :latest)", async () => {
    const tags = { body: { models: [{ name: "qwen2.5:7b" }, { name: "llama3.1:latest" }] } };
    expect(await ollamaChecker({ fetchFn: fakeOllama([tags]).fetchFn })("qwen2.5:7b")).toEqual({ ok: true, cached: false });
    expect(await ollamaChecker({ fetchFn: fakeOllama([tags]).fetchFn })("llama3.1")).toEqual({ ok: true, cached: false });
    const no = await ollamaChecker({ fetchFn: fakeOllama([tags]).fetchFn })("mistral");
    expect(no).toMatchObject({ ok: false });
    expect(no.ok === false && no.error).toMatch(/ollama pull mistral/);
    const down = await ollamaChecker({ fetchFn: fakeOllama([new TypeError("fetch failed")]).fetchFn })("qwen2.5:7b");
    expect(down.ok === false && down.error).toMatch(/Ollama is not reachable/);
  });

  test("settings: JUDGE_PROVIDER=ollama, OLLAMA_URL, one call at a time by default; Claude settings unchanged", () => {
    expect(judgeConfig({ JUDGE_PROVIDER: "ollama", JUDGE_MODEL: "qwen2.5:7b" })).toMatchObject({
      ollama: { url: "http://127.0.0.1:11434" },
      models: { PRIMARY: "qwen2.5:7b" },
      concurrency: 1,
    });
    expect(judgeConfig({ JUDGE_PROVIDER: "ollama", OLLAMA_URL: "http://10.0.0.5:11434", JUDGE_CONCURRENCY: "2", JUDGE_TEMPERATURE: "0" })).toMatchObject({
      ollama: { url: "http://10.0.0.5:11434" },
      concurrency: 2,
      temperature: 0,
    });
    expect(judgeConfig({}).ollama).toBeUndefined();
    expect(() => judgeConfig({ JUDGE_PROVIDER: "openai" })).toThrow(/JUDGE_PROVIDER must be anthropic or ollama/);
  });
});
