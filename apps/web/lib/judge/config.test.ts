import { describe, expect, test } from "vitest";
import { hasApiCredential, judgeConfig } from "./config";

describe("judgeConfig", () => {
  test("defaults (docs/JUDGE.md): Opus primary, Sonnet backup, no temperature, low effort, 8 in parallel, 50 s", () => {
    const c = judgeConfig({});
    expect(c).toEqual({
      models: { PRIMARY: "claude-opus-5-5", BACKUP: "claude-sonnet-5-5" },
      effort: "low",
      concurrency: 8,
      budgetMs: 50_000,
      fake: false,
      fakeLatencyMs: 300,
    });
    expect("temperature" in c).toBe(false);
  });

  test("a blank variable counts as unset (.env.example ships JUDGE_TEMPERATURE=)", () => {
    expect("temperature" in judgeConfig({ JUDGE_TEMPERATURE: "", JUDGE_MODEL: " " })).toBe(false);
    expect(judgeConfig({ JUDGE_MODEL: " " }).models.PRIMARY).toBe("claude-opus-5-5");
  });

  test("reads every setting", () => {
    const c = judgeConfig({
      JUDGE_MODEL: "claude-sonnet-4-6",
      JUDGE_BACKUP_MODEL: "claude-haiku-5-5",
      JUDGE_TEMPERATURE: "0",
      JUDGE_EFFORT: "medium",
      JUDGE_CONCURRENCY: "16",
      JUDGE_WORK_BUDGET_MS: "40000",
      JUDGE_FAKE: "1",
      JUDGE_FAKE_LATENCY_MS: "50",
    });
    expect(c).toEqual({
      models: { PRIMARY: "claude-sonnet-4-6", BACKUP: "claude-haiku-5-5" },
      temperature: 0,
      effort: "medium",
      concurrency: 16,
      budgetMs: 40_000,
      fake: true,
      fakeLatencyMs: 50,
    });
    expect(judgeConfig({ JUDGE_FAKE: "0" }).fake).toBe(false);
  });

  test("a bad value is an error, not a silent default", () => {
    expect(() => judgeConfig({ JUDGE_EFFORT: "extreme" })).toThrow(/JUDGE_EFFORT/);
    expect(() => judgeConfig({ JUDGE_TEMPERATURE: "hot" })).toThrow(/JUDGE_TEMPERATURE/);
    expect(() => judgeConfig({ JUDGE_TEMPERATURE: "1.5" })).toThrow(/JUDGE_TEMPERATURE/);
    expect(() => judgeConfig({ JUDGE_CONCURRENCY: "0" })).toThrow(/JUDGE_CONCURRENCY/);
    expect(() => judgeConfig({ JUDGE_CONCURRENCY: "2.5" })).toThrow(/JUDGE_CONCURRENCY/);
    expect(() => judgeConfig({ JUDGE_CONCURRENCY: "51" })).toThrow(/1 to 50/);
    expect(() => judgeConfig({ JUDGE_FAKE: "maybe" })).toThrow(/JUDGE_FAKE/);
  });

  test("the real judge needs ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN)", () => {
    expect(hasApiCredential({})).toBe(false);
    expect(hasApiCredential({ ANTHROPIC_API_KEY: "" })).toBe(false);
    expect(hasApiCredential({ ANTHROPIC_API_KEY: "sk-ant-x" })).toBe(true);
    expect(hasApiCredential({ ANTHROPIC_AUTH_TOKEN: "t" })).toBe(true);
  });
});
