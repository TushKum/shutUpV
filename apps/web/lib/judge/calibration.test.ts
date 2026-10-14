import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { calibrationSample, loadCalibrationSamples, parseCalibrationSamples } from "./calibration";

const samples = () =>
  Array.from({ length: 10 }, (_, i) => ({
    sample_no: 10 - i,
    title: `Sample ${10 - i}`,
    expected: { min: 40, max: 70 },
    text: `Pitch text for sample ${10 - i}.`,
  }));

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("parseCalibrationSamples", () => {
  test("10 valid samples, sorted by sample_no", () => {
    const parsed = parseCalibrationSamples(samples());
    expect(parsed.map((s) => s.sample_no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(parsed[0]).toEqual({ sample_no: 1, title: "Sample 1", expected: { min: 40, max: 70 }, text: "Pitch text for sample 1." });
  });

  test("says what is wrong", () => {
    expect(() => parseCalibrationSamples({})).toThrow(/JSON array/);
    expect(() => parseCalibrationSamples(samples().slice(0, 9))).toThrow(/there must be 10 samples, found 9/);
    const dup = samples();
    dup[1]!.sample_no = dup[0]!.sample_no;
    expect(() => parseCalibrationSamples(dup)).toThrow(/unique/);
    const badRange = samples();
    badRange[0]!.expected = { min: 80, max: 60 };
    expect(() => parseCalibrationSamples(badRange)).toThrow(/sample 1: expected must be/);
    const noText = samples();
    noText[2]!.text = "  ";
    expect(() => parseCalibrationSamples(noText)).toThrow(/sample 3: text is missing/);
    const long = samples();
    long[4]!.text = "word ".repeat(401);
    expect(() => parseCalibrationSamples(long)).toThrow(/401 words, over the pitch limit of 400/);
    const badNo = samples();
    badNo[0]!.sample_no = 11;
    expect(() => parseCalibrationSamples(badNo)).toThrow(/sample_no must be a whole number from 1 to 10/);
  });
});

describe("loadCalibrationSamples", () => {
  test("reads prompts/calibration/pitches.json and finds a sample by number", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "judge-cal-"));
    dirs.push(dir);
    mkdirSync(path.join(dir, "calibration"));
    writeFileSync(path.join(dir, "calibration", "pitches.json"), JSON.stringify(samples()));
    expect(loadCalibrationSamples(dir)).toHaveLength(10);
    expect(calibrationSample(7, dir).title).toBe("Sample 7");
    expect(() => calibrationSample(12, dir)).toThrow(/no calibration sample 12/);
  });

  test("a missing or broken file is an error", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "judge-cal-"));
    dirs.push(dir);
    expect(() => loadCalibrationSamples(dir)).toThrow(/calibration samples are missing/);
    mkdirSync(path.join(dir, "calibration"));
    writeFileSync(path.join(dir, "calibration", "pitches.json"), "[{");
    expect(() => loadCalibrationSamples(dir)).toThrow(/not valid JSON/);
  });
});
