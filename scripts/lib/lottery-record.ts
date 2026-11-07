// The lottery record's format and check live in the engine (shared with the control panel); see
// packages/engine/src/lottery-record.ts. Here: what is wrong with a file that is not a lottery record at all, so the
// verifier says so instead of crashing.

import type { LotteryRecord } from "@msim/engine";

export { checkLotteryRecord, type LotteryRecord } from "@msim/engine";

const isStrings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");

/** Why this JSON is not a lottery record (empty: it has the right shape). */
export function recordShapeProblems(json: unknown): string[] {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return ["the file is not a lottery record (expected a JSON object)"];
  const r = json as Record<string, unknown>;
  const problems: string[] = [];
  for (const k of ["seed", "dice", "commitment"]) if (typeof r[k] !== "string" || r[k] === "") problems.push(`"${k}" is missing`);
  for (const k of ["teams", "problemCards", "crisisCards"]) if (!isStrings(r[k])) problems.push(`"${k}" must be a list of strings`);
  const draws = r.draws;
  if (!Array.isArray(draws) || !draws.every((d) => d && typeof d === "object" && ["team", "problem", "crisis", "rescues"].every((k) => typeof (d as Record<string, unknown>)[k] === "string"))) {
    problems.push(`"draws" must be a list of {team, problem, crisis, rescues}`);
  }
  return problems;
}

export const asRecord = (json: unknown) => json as LotteryRecord;
