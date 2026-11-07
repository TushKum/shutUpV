// The fallback when the AI service fails completely on the night (PLAN §42, RUNBOOK): human judges score on paper,
// their scores are typed into a CSV, and `pnpm human-scores` feeds them to the same judge worker as a "judge" that
// answers reading N of a company with judge N's row. Everything after that is unchanged: the rubric checks, the median
// of the 3 readings, the injection penalty, sealing and the reveal. Nobody types in a final score.
//
// CSV, one file per type, one row per judge per company:
//   ticker,judge,<the type's rubric keys…>,rationale
//   CRSP,1,16,19,14,10,7,7,Clear user and numbers; thin go to market; test the bags in the rain.
// judge is 1, 2 or 3: three judges for every company.

import { parseCsv, parseCsvObjects, RUBRICS, validateJudgeOutput, type SubmissionType } from "@msim/engine";
import { EMPTY_USAGE, type JudgeFn } from "../../apps/web/lib/judge/types";

export const HUMAN_MODEL = "human-judges";

export interface HumanRow {
  breakdown: Record<string, number>;
  total: number;
  rationale: string;
}

/** Scores by ticker, then by judge number (1–3). */
export type HumanScores = Map<string, Map<number, HumanRow>>;

export const humanColumns = (type: SubmissionType) => ["ticker", "judge", ...RUBRICS[type].map((l) => l.key), "rationale"];

export function parseHumanScores(type: SubmissionType, text: string): { ok: true; scores: HumanScores } | { ok: false; errors: string[] } {
  const clean = text.replace(/^\uFEFF/, "");
  const rows = parseCsvObjects(clean);
  const header = (parseCsv(clean)[0] ?? []).map((h) => h.trim().toLowerCase());
  const errors: string[] = [];
  for (const c of humanColumns(type).slice(0, -1)) if (!header.includes(c)) errors.push(`missing column ${c}`);
  if (errors.length) return { ok: false, errors: [`${errors.join(", ")} (expected: ${humanColumns(type).join(",")})`] };

  const scores: HumanScores = new Map();
  rows.forEach((r, i) => {
    const at = `row ${i + 2}`;
    const ticker = r.ticker!.toUpperCase();
    const judge = Number(r.judge);
    if (!/^[A-Z]{4}$/.test(ticker)) return void errors.push(`${at}: ticker "${r.ticker}" is not 4 letters`);
    if (!Number.isInteger(judge) || judge < 1 || judge > 3) return void errors.push(`${at}: judge must be 1, 2 or 3`);
    const breakdown: Record<string, unknown> = {};
    for (const l of RUBRICS[type]) breakdown[l.key] = /^\d+$/.test(r[l.key] ?? "") ? Number(r[l.key]) : r[l.key];
    const total = RUBRICS[type].reduce((s, l) => s + (typeof breakdown[l.key] === "number" ? (breakdown[l.key] as number) : 0), 0);
    const rationale = r.rationale || `Scored by human judge ${judge} of the panel, against the published rubric.`;
    const check = validateJudgeOutput(type, { breakdown, total, rationale });
    if (!check.ok) return void errors.push(`${at} (${ticker}, judge ${judge}): ${check.errors.join("; ")}`);
    const byJudge = scores.get(ticker) ?? new Map<number, HumanRow>();
    if (byJudge.has(judge)) return void errors.push(`${at}: ${ticker} has judge ${judge} twice`);
    byJudge.set(judge, { breakdown: check.breakdown, total: check.total, rationale: check.rationale });
    scores.set(ticker, byJudge);
  });
  return errors.length ? { ok: false, errors } : { ok: true, scores };
}

/** The readings still to judge that have no row yet. */
export function missingRows(scores: HumanScores, pending: readonly { ticker: string; runNo: number }[]) {
  const missing = pending.filter((p) => !scores.get(p.ticker)?.has(p.runNo)).map((p) => `${p.ticker} judge ${p.runNo}`);
  return { missing: [...new Set(missing)].sort() };
}

/** The judge: run N of a company gets judge N's row. A missing row stops the worker; the run goes back to the queue. */
export function humanJudge(scores: HumanScores): JudgeFn {
  return async (r) => {
    const ticker = /<submission type="[A-Z]+" ticker="([A-Z]+)">/.exec(r.userText)?.[1];
    const row = ticker ? scores.get(ticker)?.get(r.runNo) : undefined;
    if (!row) {
      return {
        ok: false, fatal: true, retryable: true, model: HUMAN_MODEL, latencyMs: 0, usage: EMPTY_USAGE, attempts: 1,
        error: `no score from judge ${r.runNo} for ${ticker ?? "this company"} in the CSV`,
      };
    }
    const out = { breakdown: row.breakdown, total: row.total, rationale: row.rationale };
    return { ok: true, ...out, raw: JSON.stringify(out), model: HUMAN_MODEL, latencyMs: 0, usage: EMPTY_USAGE, attempts: 1 };
  };
}
