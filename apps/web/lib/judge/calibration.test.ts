import path from "node:path";
import { describe, expect, test } from "vitest";
import { RULES, wordCount } from "@msim/engine";
import { calibrationResults, loadCalibrationSamples, parseCalibrationSamples, uploadPayload } from "./calibration";

const DIR = path.resolve(__dirname, "../../../../prompts");

const sample = (over: Record<string, unknown> = {}) => ({
  type: "PRD",
  title: "A PRD",
  expected: { min: 40, max: 60 },
  company_name: "Good Co",
  ticker: "GOOD",
  context: "Problem card.",
  text: "Good Co (GOOD)\n\nProblem:\nSnacks.",
  ...over,
});

describe("the repository's samples", () => {
  test("weak to strong PRDs and crisis solutions, each within its word limit, with its context", () => {
    const samples = loadCalibrationSamples(DIR);
    expect(samples.filter((s) => s.type === "PRD").length).toBeGreaterThanOrEqual(3);
    expect(samples.filter((s) => s.type === "SOLUTION").length).toBeGreaterThanOrEqual(3);
    for (const s of samples) {
      expect(wordCount(s.text), s.title).toBeLessThanOrEqual(RULES.WORD_LIMIT[s.type]);
      expect(s.context, s.title).not.toBe("");
    }
    // The ranges climb from the weakest sample to the strongest of each type.
    for (const t of ["PRD", "SOLUTION"] as const) {
      const mins = samples.filter((s) => s.type === t).map((s) => s.expected.min);
      expect(mins).toEqual([...mins].sort((a, b) => a - b));
    }
  });
});

describe("parseCalibrationSamples", () => {
  test("says exactly what is wrong", () => {
    expect(() => parseCalibrationSamples({})).toThrow(/JSON array/);
    expect(() => parseCalibrationSamples([sample({ type: "PITCH" }), sample({ ticker: "go" }), sample({ expected: { min: 70, max: 60 } })])).toThrow(
      /sample 1: type must be PRD or SOLUTION; sample 2: ticker must be 4 capital letters; sample 3: expected must be/,
    );
    expect(() => parseCalibrationSamples([sample({ text: "word ".repeat(801) })])).toThrow(/over the PRD limit of 800/);
    expect(() => parseCalibrationSamples([sample()])).toThrow(/there is no SOLUTION sample/);
  });
  test("the upload payload", () => {
    const s = parseCalibrationSamples([sample(), sample({ type: "SOLUTION", company_name: "" })]);
    expect(uploadPayload(s)).toEqual([
      { type: "PRD", title: "A PRD", expected_min: 40, expected_max: 60, company_name: "Good Co", ticker: "GOOD", context_text: "Problem card.", body_text: "Good Co (GOOD)\n\nProblem:\nSnacks." },
      { type: "SOLUTION", title: "A PRD", expected_min: 40, expected_max: 60, company_name: "GOOD", ticker: "GOOD", context_text: "Problem card.", body_text: "Good Co (GOOD)\n\nProblem:\nSnacks." },
    ]);
  });
});

describe("calibrationResults", () => {
  test("the median of three readings against the expected range, and the spread", () => {
    const samples = [
      { sample_no: 1, type: "PRD" as const, title: "Weak", expected_min: 10, expected_max: 30 },
      { sample_no: 2, type: "PRD" as const, title: "Strong", expected_min: 75, expected_max: 95 },
      { sample_no: 3, type: "SOLUTION" as const, title: "Middle", expected_min: 40, expected_max: 60 },
    ];
    const runs = [
      { sample_no: 1, run_no: 1, status: "DONE", total: 20 },
      { sample_no: 1, run_no: 2, status: "DONE", total: 35 },
      { sample_no: 1, run_no: 3, status: "DONE", total: 28 },
      { sample_no: 2, run_no: 1, status: "DONE", total: 70 },
      { sample_no: 2, run_no: 2, status: "DONE", total: 72 },
      { sample_no: 2, run_no: 3, status: "DONE", total: 74 },
      { sample_no: 3, run_no: 1, status: "DONE", total: 50 },
      { sample_no: 3, run_no: 2, status: "FAILED", total: null },
    ];
    const r = calibrationResults(samples, runs);
    expect(r.map((x) => [x.sample_no, x.median, x.verdict, x.spread])).toEqual([
      [1, 28, "IN_RANGE", 15],
      [2, 72, "LOW", 4],
      [3, null, "FAILED", null],
    ]);
    expect(r[2]!.totals).toEqual([50, null, null]);
  });
});
