import { describe, expect, test } from "vitest";
import { EFFORTS, hasApiCredential, judgeConfig, rejectsSampling } from "./config";

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
      JUDGE_BACKUP_MODEL: "claude-haiku-4-5",
      JUDGE_TEMPERATURE: "0",
      JUDGE_EFFORT: "medium",
      JUDGE_CONCURRENCY: "16",
      JUDGE_WORK_BUDGET_MS: "40000",
      JUDGE_FAKE: "1",
      JUDGE_FAKE_LATENCY_MS: "50",
    });
    expect(c).toEqual({
      models: { PRIMARY: "claude-sonnet-4-6", BACKUP: "claude-haiku-4-5" },
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

  test("effort is low, medium or high: xhigh and max need more output than a call allows", () => {
    expect(EFFORTS).toEqual(["low", "medium", "high"]);
    for (const e of ["low", "medium", "high"]) expect(judgeConfig({ JUDGE_EFFORT: e }).effort).toBe(e);
    for (const e of ["xhigh", "max"]) {
      expect(() => judgeConfig({ JUDGE_EFFORT: e })).toThrow(`JUDGE_EFFORT must be low, medium or high, got "${e}"`);
    }
  });

  test("JUDGE_TEMPERATURE is refused at start-up when either slot's model rejects sampling parameters (PLAN.md Q3)", () => {
    // The defaults (claude-opus-5-5, claude-sonnet-5-5) both reject it.
    expect(() => judgeConfig({ JUDGE_TEMPERATURE: "0" })).toThrow(
      /JUDGE_TEMPERATURE is set, but claude-opus-5-5 \(JUDGE_MODEL\) rejects temperature.*PLAN\.md Q3/,
    );
    // The backup counts too: an organiser can switch to it during the night.
    expect(() =>
      judgeConfig({ JUDGE_TEMPERATURE: "0", JUDGE_MODEL: "claude-sonnet-4-6", JUDGE_BACKUP_MODEL: "claude-opus-4-7" }),
    ).toThrow(/claude-opus-4-7 \(JUDGE_BACKUP_MODEL\)/);
    // Models that take it, in both slots: accepted.
    const ok = judgeConfig({ JUDGE_TEMPERATURE: "0", JUDGE_MODEL: "claude-sonnet-4-6", JUDGE_BACKUP_MODEL: "claude-opus-4-6" });
    expect(ok.temperature).toBe(0);
    // Unset temperature: any model.
    expect(judgeConfig({ JUDGE_TEMPERATURE: "", JUDGE_MODEL: "claude-fable-5-1" }).models.PRIMARY).toBe("claude-fable-5-1");
  });

  test("which models reject sampling parameters", () => {
    for (const m of [
      "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-sonnet-5", "claude-haiku-5-5", "claude-fable-5-1",
      "claude-fable-5", "claude-mythos-5-1", "claude-opus-4-7", "claude-opus-4-8", " Claude-Opus-5-5 ",
    ]) {
      expect(rejectsSampling(m), m).toBe(true);
    }
    for (const m of ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5", "claude-opus-4-5"]) {
      expect(rejectsSampling(m), m).toBe(false);
    }
  });

  test("the real judge needs ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN)", () => {
    expect(hasApiCredential({})).toBe(false);
    expect(hasApiCredential({ ANTHROPIC_API_KEY: "" })).toBe(false);
    expect(hasApiCredential({ ANTHROPIC_API_KEY: "sk-ant-x" })).toBe(true);
    expect(hasApiCredential({ ANTHROPIC_AUTH_TOKEN: "t" })).toBe(true);
  });
});
