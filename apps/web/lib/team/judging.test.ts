import { describe, expect, test } from "vitest";
import { RUBRICS, RULES } from "@msim/engine";
import type { JudgePrompt } from "@/lib/judge/prompts";
import { judgingSteps, priceExamples, promptAnchor, publishedPrompts } from "./judging";

const fake = (type: "PRD" | "SOLUTION"): JudgePrompt => ({ type, text: `# ${type}\n`, sha: "a".repeat(64), file: `${type}.md` });

describe("publishedPrompts", () => {
  test("the two prompts in the order of the night, with their rubric, word limit and context", () => {
    const prompts = publishedPrompts(fake);
    expect(prompts.map((p) => [p.type, p.label, p.file, p.wordLimit])).toEqual([
      ["PRD", "PRD", "PRD.md", RULES.WORD_LIMIT.PRD],
      ["SOLUTION", "Crisis solution", "SOLUTION.md", RULES.WORD_LIMIT.SOLUTION],
    ]);
    expect(prompts[0]!.rubric).toBe(RUBRICS.PRD);
    expect(prompts[1]!.context).toContain("crisis card");
    expect(prompts[0]!.prompt).toEqual({ ok: true, text: "# PRD\n", sha: "a".repeat(64) });
  });
  test("a prompt that cannot be read is reported, not thrown", () => {
    const prompts = publishedPrompts(() => {
      throw new Error("The PRD judge prompt is missing");
    });
    expect(prompts[0]!.prompt).toEqual({ ok: false, error: "The PRD judge prompt is missing" });
  });
  test("anchors", () => {
    expect(promptAnchor("SOLUTION")).toBe("solution");
  });
});

describe("priceExamples", () => {
  test("the brief's numbers: start $10.00 + $0.10 × (score − 50); reveal × (1 + 0.5% × (score − 50)) after the crisis", () => {
    const [top, s84, , s50, , zero] = priceExamples();
    expect(top).toEqual({ score: 100, start: 1500, factorBp: 12_500, afterReveal: 1063 }); // 850 × 1.25 = 1062.5 → 1063
    expect(s84).toEqual({ score: 84, start: 1340, factorBp: 11_700, afterReveal: 995 }); // 850 × 1.17 = 994.5 → 995
    expect(s50).toMatchObject({ start: 1000, factorBp: 10_000, afterReveal: 850 });
    expect(zero).toMatchObject({ start: 500, factorBp: 7_500, afterReveal: 638 }); // 850 × 0.75 = 637.5 → 638
  });
});

describe("judgingSteps", () => {
  test("uses the engine's numbers", () => {
    const text = judgingSteps()
      .map((s) => `${s.title} ${s.text}`)
      .join(" ");
    expect(text).toContain(`costs ${RULES.INJECTION_PENALTY} points`);
    expect(text).toContain(`read ${RULES.JUDGE_RUNS} times`);
    expect(text).toContain("64, 66 and 68 give 66");
  });
});
