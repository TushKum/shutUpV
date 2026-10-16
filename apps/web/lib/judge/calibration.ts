// The 10 sample pitches the calibration page scores before the event: prompts/calibration/pitches.json, an array of
// {sample_no, title, expected: {min, max}, text}. parseCalibrationSamples is pure (and says exactly what is wrong);
// loadCalibrationSamples reads the file next to the judge prompts and caches it until the file changes.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { RULES, wordCount } from "@msim/engine";
import { findPromptsDir } from "./prompts";

export const CALIBRATION_SAMPLES = 10;
export const CALIBRATION_FILE = path.join("calibration", "pitches.json");

export interface CalibrationSample {
  sample_no: number;
  title: string;
  /** The score range a sensible judge should give. */
  expected: { min: number; max: number };
  text: string;
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

export function parseCalibrationSamples(json: unknown): CalibrationSample[] {
  if (!Array.isArray(json)) throw new Error("calibration samples: the file must hold a JSON array");
  const errors: string[] = [];
  const samples: CalibrationSample[] = [];
  json.forEach((raw, i) => {
    const where = `sample ${i + 1}`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      errors.push(`${where} is not an object`);
      return;
    }
    const s = raw as Record<string, unknown>;
    const exp = s.expected as Record<string, unknown> | null | undefined;
    if (!isInt(s.sample_no) || s.sample_no < 1 || s.sample_no > CALIBRATION_SAMPLES) {
      errors.push(`${where}: sample_no must be a whole number from 1 to ${CALIBRATION_SAMPLES}`);
    }
    if (typeof s.title !== "string" || s.title.trim() === "") errors.push(`${where}: title is missing`);
    if (typeof s.text !== "string" || s.text.trim() === "") errors.push(`${where}: text is missing`);
    else if (wordCount(s.text) > RULES.WORD_LIMIT.PITCH) {
      errors.push(`${where}: text has ${wordCount(s.text)} words, over the pitch limit of ${RULES.WORD_LIMIT.PITCH}`);
    }
    if (
      typeof exp !== "object" ||
      exp === null ||
      !isInt(exp.min) ||
      !isInt(exp.max) ||
      exp.min < 0 ||
      exp.max > 100 ||
      exp.min > exp.max
    ) {
      errors.push(`${where}: expected must be {min, max}, whole numbers with 0 ≤ min ≤ max ≤ 100`);
    }
    if (errors.length === 0) {
      samples.push({
        sample_no: s.sample_no as number,
        title: (s.title as string).trim(),
        expected: { min: exp!.min as number, max: exp!.max as number },
        text: s.text as string,
      });
    }
  });
  if (errors.length === 0) {
    if (samples.length !== CALIBRATION_SAMPLES) errors.push(`there must be ${CALIBRATION_SAMPLES} samples, found ${samples.length}`);
    const numbers = new Set(samples.map((s) => s.sample_no));
    if (numbers.size !== samples.length) errors.push("sample_no values must be unique");
  }
  if (errors.length) throw new Error(`calibration samples: ${errors.join("; ")}`);
  return [...samples].sort((a, b) => a.sample_no - b.sample_no);
}

const cache = new Map<string, { mtimeMs: number; size: number; samples: CalibrationSample[] }>();

/** Reads and checks prompts/calibration/pitches.json (default folder: the one holding the judge prompts). */
export function loadCalibrationSamples(promptsDir: string = findPromptsDir()): CalibrationSample[] {
  // next.config.ts explicitly traces this sample file; avoid tracing an arbitrary runtime folder.
  const file = path.join(/* turbopackIgnore: true */ promptsDir, CALIBRATION_FILE);
  let stat;
  try {
    stat = statSync(/* turbopackIgnore: true */ file);
  } catch {
    throw new Error(`The calibration samples are missing: ${file}`);
  }
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.samples;
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(/* turbopackIgnore: true */ file, "utf8"));
  } catch (e) {
    throw new Error(`calibration samples: ${file} is not valid JSON (${e instanceof Error ? e.message : String(e)})`);
  }
  const samples = parseCalibrationSamples(json);
  cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, samples });
  return samples;
}

export function calibrationSample(sampleNo: number, promptsDir?: string): CalibrationSample {
  const sample = loadCalibrationSamples(promptsDir).find((s) => s.sample_no === sampleNo);
  if (!sample) throw new Error(`There is no calibration sample ${sampleNo}`);
  return sample;
}
