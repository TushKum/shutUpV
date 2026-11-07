// The calibration samples organisers judge before the event (the brief: "run the judge on sample strong and weak PRDs
// and solutions and check the scores"): prompts/calibration/samples.json, an array of
// {type: "PRD" | "SOLUTION", title, expected: {min, max}, company_name, ticker, context, text}. The control panel
// uploads them as a batch (public.upload_calibration_samples) and queues three readings of each. parseCalibrationSamples
// is pure (and says exactly what is wrong); loadCalibrationSamples reads the file next to the judge prompts and caches
// it until the file changes.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { RULES, SUBMISSION_TYPES, wordCount, type SubmissionType } from "@msim/engine";
import { findPromptsDir } from "./prompts";

export const MAX_CALIBRATION_SAMPLES = 40;
export const CALIBRATION_FILE = path.join("calibration", "samples.json");

export interface CalibrationSample {
  type: SubmissionType;
  title: string;
  /** The score range a sensible judge should give. */
  expected: { min: number; max: number };
  company_name: string;
  ticker: string;
  /** What the judge reads besides the sample: the problem card and twist, or the rescued PRD and the crisis card. */
  context: string;
  text: string;
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const TICKER = /^[A-Z]{4}$/;

export function parseCalibrationSamples(json: unknown): CalibrationSample[] {
  if (!Array.isArray(json)) throw new Error("calibration samples: the file must hold a JSON array");
  const errors: string[] = [];
  const samples: CalibrationSample[] = [];
  json.forEach((raw, i) => {
    const where = `sample ${i + 1}`;
    const before = errors.length;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      errors.push(`${where} is not an object`);
      return;
    }
    const s = raw as Record<string, unknown>;
    const exp = s.expected as Record<string, unknown> | null | undefined;
    const type = s.type as SubmissionType;
    if (!SUBMISSION_TYPES.includes(type)) errors.push(`${where}: type must be PRD or SOLUTION`);
    if (typeof s.title !== "string" || s.title.trim() === "") errors.push(`${where}: title is missing`);
    if (typeof s.ticker !== "string" || !TICKER.test(s.ticker)) errors.push(`${where}: ticker must be 4 capital letters`);
    if (typeof s.text !== "string" || s.text.trim() === "") errors.push(`${where}: text is missing`);
    else if (SUBMISSION_TYPES.includes(type) && wordCount(s.text) > RULES.WORD_LIMIT[type]) {
      errors.push(`${where}: text has ${wordCount(s.text)} words, over the ${type} limit of ${RULES.WORD_LIMIT[type]}`);
    }
    if (s.context !== undefined && typeof s.context !== "string") errors.push(`${where}: context must be text`);
    if (typeof exp !== "object" || exp === null || !isInt(exp.min) || !isInt(exp.max) || exp.min < 0 || exp.max > 100 || exp.min > exp.max) {
      errors.push(`${where}: expected must be {min, max}, whole numbers with 0 ≤ min ≤ max ≤ 100`);
    }
    if (errors.length === before) {
      samples.push({
        type,
        title: (s.title as string).trim(),
        expected: { min: exp!.min as number, max: exp!.max as number },
        company_name: typeof s.company_name === "string" && s.company_name.trim() !== "" ? s.company_name.trim() : (s.ticker as string),
        ticker: s.ticker as string,
        context: typeof s.context === "string" ? s.context : "",
        text: s.text as string,
      });
    }
  });
  if (errors.length === 0) {
    if (samples.length === 0) errors.push("there are no samples");
    if (samples.length > MAX_CALIBRATION_SAMPLES) errors.push(`at most ${MAX_CALIBRATION_SAMPLES} samples, found ${samples.length}`);
    for (const t of SUBMISSION_TYPES) if (!samples.some((s) => s.type === t)) errors.push(`there is no ${t} sample`);
  }
  if (errors.length) throw new Error(`calibration samples: ${errors.join("; ")}`);
  return samples;
}

/** The argument of public.upload_calibration_samples. */
export function uploadPayload(samples: readonly CalibrationSample[]) {
  return samples.map((s) => ({
    type: s.type,
    title: s.title,
    expected_min: s.expected.min,
    expected_max: s.expected.max,
    company_name: s.company_name,
    ticker: s.ticker,
    context_text: s.context,
    body_text: s.text,
  }));
}

const cache = new Map<string, { mtimeMs: number; size: number; samples: CalibrationSample[] }>();

/** Reads and checks prompts/calibration/samples.json (default folder: the one holding the judge prompts). */
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

export interface CalibrationResult {
  sample_no: number;
  type: SubmissionType;
  title: string;
  expected: { min: number; max: number };
  /** The readings done so far, by reading number. */
  totals: (number | null)[];
  /** The median of three readings, or null until all three are done. */
  median: number | null;
  /** In range, out of range, or not judged yet. */
  verdict: "IN_RANGE" | "LOW" | "HIGH" | "PENDING" | "FAILED";
  /** The largest spread between the readings (how consistent the judge is). */
  spread: number | null;
}

/** One line per sample: its readings, the median against the expected range, and the spread. Pure. */
export function calibrationResults(
  samples: readonly { sample_no: number; type: SubmissionType; title: string; expected_min: number; expected_max: number }[],
  runs: readonly { sample_no: number; run_no: number; status: string; total: number | null }[],
): CalibrationResult[] {
  return [...samples]
    .sort((a, b) => a.sample_no - b.sample_no)
    .map((s) => {
      const mine = runs.filter((r) => r.sample_no === s.sample_no);
      const totals = [1, 2, 3].map((n) => mine.find((r) => r.run_no === n && r.status === "DONE")?.total ?? null);
      const done = totals.filter((t): t is number => t !== null);
      const failed = mine.some((r) => r.status === "FAILED");
      const median = done.length === 3 ? [...done].sort((a, b) => a - b)[1]! : null;
      const verdict =
        median === null ? (failed ? "FAILED" : "PENDING") : median < s.expected_min ? "LOW" : median > s.expected_max ? "HIGH" : "IN_RANGE";
      return {
        sample_no: s.sample_no,
        type: s.type,
        title: s.title,
        expected: { min: s.expected_min, max: s.expected_max },
        totals,
        median,
        verdict,
        spread: done.length >= 2 ? Math.max(...done) - Math.min(...done) : null,
      };
    });
}
