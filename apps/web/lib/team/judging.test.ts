import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { RUBRICS, RULES, finalScore, injectionPenalty, ipoPrice, medianScore, needsExtraRuns, tierBp, type SubmissionType } from "@msim/engine";
import type { JudgePrompt } from "@/lib/judge/prompts";
import { EXTRA_RUN_SPREAD, TIER_BANDS, judgingSteps, promptAnchor, publishedPrompts, tierRows } from "./judging";

const PROMPTS = path.resolve(__dirname, "../../../../prompts");

describe("publishedPrompts", () => {
  test("the three prompts of the repository, in the order of the night, read with the judge's own loader", () => {
    const prompts = publishedPrompts();
    expect(prompts.map((p) => [p.type, p.label, p.file, p.wordLimit])).toEqual([
      ["PITCH", "Pitch card", "PITCH.md", 400],
      ["PLAN", "Rescue plan", "PLAN.md", 500],
      ["FLASH", "Flash answer", "FLASH.md", 100],
    ]);
    for (const p of prompts) {
      expect(p.rubric).toBe(RUBRICS[p.type]);
      if (!p.prompt.ok) throw new Error(p.prompt.error);
      // Exactly the file, and its SHA-256 recomputed here from the file's bytes.
      const bytes = readFileSync(path.join(PROMPTS, p.file));
      expect(p.prompt.text).toBe(bytes.toString("utf8"));
      expect(p.prompt.sha).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(p.prompt.sha).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(new Set(prompts.map((p) => (p.prompt.ok ? p.prompt.sha : null))).size).toBe(3);
  });

  test("a prompt that cannot be read is reported, and the others still show", () => {
    const load = (type: SubmissionType): JudgePrompt => {
      if (type === "PLAN") throw new Error("The PLAN judge prompt is missing: /x/PLAN.md");
      return { type, text: `# ${type}\n`, sha: "f".repeat(64), file: `/x/${type}.md` };
    };
    const prompts = publishedPrompts(load);
    expect(prompts.map((p) => p.prompt)).toEqual([
      { ok: true, text: "# PITCH\n", sha: "f".repeat(64) },
      { ok: false, error: "The PLAN judge prompt is missing: /x/PLAN.md" },
      { ok: true, text: "# FLASH\n", sha: "f".repeat(64) },
    ]);
  });

  test("what each score moves, and the anchors", () => {
    expect(publishedPrompts().map((p) => p.moves)).toEqual([
      "Its score sets the IPO price.",
      "Its score moves the market price and the AI price.",
      "Its score moves the market price and the AI price.",
    ]);
    expect((["PITCH", "PLAN", "FLASH"] as const).map(promptAnchor)).toEqual(["pitch", "plan", "flash"]);
  });
});

describe("tierRows", () => {
  test("the brief's tier table, with the IPO price each pitch band gives", () => {
    const rows = tierRows();
    expect(rows.map((r) => [r.band, r.bp.PITCH, r.bp.PLAN, r.bp.FLASH, r.ipoPrice])).toEqual([
      ["90–100", 1000, 2500, 500, 1100],
      ["80–89", 1000, 2000, 500, 1100],
      ["70–79", 500, 1000, 500, 1050],
      ["60–69", 500, 500, 0, 1050],
      ["50–59", 0, 0, 0, 1000],
      ["40–49", -500, -1000, -500, 950],
      ["0–39", -1000, -2000, -500, 900],
    ]);
  });

  test("the bands cover 0–100 once each, and every score in a band has the engine's tier for it", () => {
    const covered = TIER_BANDS.flatMap(([min, max]) => Array.from({ length: max - min + 1 }, (_, k) => min + k)).sort((a, b) => a - b);
    expect(covered).toEqual(Array.from({ length: 101 }, (_, k) => k));
    for (const row of tierRows()) {
      for (let score = row.min; score <= row.max; score++) {
        for (const t of ["PITCH", "PLAN", "FLASH"] as const) expect(tierBp(t, score)).toBe(row.bp[t]);
        expect(ipoPrice(score)).toBe(row.ipoPrice);
      }
    }
  });
});

describe("judgingSteps", () => {
  const all = () => judgingSteps().map((s) => `${s.title} ${s.text}`).join("\n");

  test("the spread that triggers 2 more runs is the engine's", () => {
    expect(needsExtraRuns([50, 50, 50 + EXTRA_RUN_SPREAD])).toBe(false);
    expect(needsExtraRuns([50, 50, 51 + EXTRA_RUN_SPREAD])).toBe(true);
    expect(all()).toContain(`If the 3 totals spread more than ${EXTRA_RUN_SPREAD} points, it is judged 2 more times (5 in all).`);
  });

  test("the median example, the plan cap, the injection penalty and late submissions match the engine", () => {
    expect(medianScore([64, 66, 68])).toBe(66);
    expect(all()).toContain("64, 66 and 68 give 66.");

    expect(finalScore({ type: "PLAN", median: 78, dealSignedInTime: false }).final).toBe(50);
    expect(all()).toContain("A rescue plan without a fully signed deal by 03:00 is capped at 50.");

    expect(injectionPenalty("PITCH", { PITCH: true })).toBe(0);
    expect(injectionPenalty("PLAN", { PITCH: true, PLAN: true })).toBe(RULES.INJECTION_PENALTY);
    expect(all()).toContain(`From your squad's second submission with a removed line, that submission loses ${RULES.INJECTION_PENALTY} points.`);

    expect(finalScore({ type: "FLASH", median: null }).final).toBe(0);
    expect(all()).toContain("A late or missing submission scores 0.");
  });

  test("the steps, in order", () => {
    expect(judgingSteps().map((s) => s.title)).toEqual([
      "Names become the ticker.",
      "Lines aimed at the judge are removed.",
      "The judge reads the prompt and your submission.",
      "Each submission is judged 3 times, and the median counts.",
      "A rescue plan needs a signed deal.",
      "Scores stay sealed until the organisers release them.",
      "Every run is stored.",
    ]);
  });
});
