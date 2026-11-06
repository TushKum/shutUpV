// The judge console's pure logic: for each round (PRD, crisis solution), how far judging has got (submissions locked,
// readings done or failed, scores sealed and revealed), and one line per company (the team that earns the points,
// the three readings, median, penalty, final score, lines removed). Scores are sealed by the judge worker from three
// readings; nobody types one in.

import type { SubmissionType } from "@msim/engine";

export type JudgeSlot = "PRIMARY" | "BACKUP";
export type ScoreStatus = "PENDING" | "SCORING" | "SEALED" | "REVEALED";
export type RunStatus = "QUEUED" | "RUNNING" | "DONE" | "FAILED";

export const JUDGE_TYPE_LABELS: Record<SubmissionType, string> = { PRD: "Round 1 · PRDs", SOLUTION: "Round 2 · Crisis solutions" };

export interface JudgeCompanyRow {
  id: string;
  ticker: string | null;
  name: string | null;
  founder_team_id: string;
  rescuer_team_id: string | null;
}

export interface JudgeSubmissionRow {
  id: string;
  company_id: string;
  team_id: string;
  type: SubmissionType;
  word_count: number;
  saved_at: string;
}

export interface JudgeRunRow {
  submission_id: string;
  generation: number;
  run_no: number;
  status: RunStatus;
  total: number | null;
  error: string | null;
}

export interface JudgeScoreRow {
  company_id: string;
  team_id: string;
  type: SubmissionType;
  status: ScoreStatus;
  missing: boolean;
  median: number | null;
  penalty: number;
  final_score: number | null;
  rationale: string | null;
}

export interface JudgeRows {
  companies: JudgeCompanyRow[];
  teams: { id: string; code: string }[];
  submissions: JudgeSubmissionRow[];
  runs: JudgeRunRow[];
  scores: JudgeScoreRow[];
  /** Lines removed from each submission before judging (judge_injection_checks.hits), by submission id. */
  hits: Record<string, number>;
}

export interface JudgeProgress {
  companies: number;
  submissions: number;
  missing: number;
  readings: { total: number; done: number; failed: number; queued: number; running: number };
  sealed: number;
  revealed: number;
  /** Every company has a sealed (or revealed) score: the round's gate is open. */
  complete: boolean;
}

/** Readings of a submission's latest generation. */
function latestRuns(runs: readonly JudgeRunRow[], submissionId: string): JudgeRunRow[] {
  const mine = runs.filter((r) => r.submission_id === submissionId);
  const gen = Math.max(0, ...mine.map((r) => r.generation));
  return mine.filter((r) => r.generation === gen).sort((a, b) => a.run_no - b.run_no);
}

/** Companies a round judges: every company for PRDs; for solutions, every company with a rescuer (from 23:45). */
function judged(rows: JudgeRows, type: SubmissionType): JudgeCompanyRow[] {
  return rows.companies.filter((c) => type === "PRD" || c.rescuer_team_id !== null);
}

export function judgeProgress(rows: JudgeRows, type: SubmissionType): JudgeProgress {
  const companies = judged(rows, type);
  const subs = rows.submissions.filter((s) => s.type === type);
  const scores = rows.scores.filter((s) => s.type === type);
  const readings = { total: 0, done: 0, failed: 0, queued: 0, running: 0 };
  for (const s of subs) {
    for (const r of latestRuns(rows.runs, s.id)) {
      readings.total++;
      if (r.status === "DONE") readings.done++;
      else if (r.status === "FAILED") readings.failed++;
      else if (r.status === "QUEUED") readings.queued++;
      else readings.running++;
    }
  }
  const sealed = scores.filter((s) => s.status === "SEALED" || s.status === "REVEALED").length;
  return {
    companies: companies.length,
    submissions: subs.length,
    missing: scores.filter((s) => s.missing).length,
    readings,
    sealed,
    revealed: scores.filter((s) => s.status === "REVEALED").length,
    complete: companies.length > 0 && sealed === companies.length,
  };
}

export interface JudgeLine {
  companyId: string;
  ticker: string;
  name: string;
  /** The team that wrote it (and earns the points). */
  author: string;
  words: number | null;
  readings: { runNo: number; status: RunStatus; total: number | null; error: string | null }[];
  median: number | null;
  penalty: number;
  final: number | null;
  removed: number | null;
  status: ScoreStatus | "NOT_LOCKED";
  missing: boolean;
  /** What this company waits for, in words. */
  waiting: string;
}

const byTicker = (a: JudgeLine, b: JudgeLine) => a.ticker.localeCompare(b.ticker);

/** One line per company of the round, by ticker. */
export function judgeLines(rows: JudgeRows, type: SubmissionType): JudgeLine[] {
  const code = new Map(rows.teams.map((t) => [t.id, t.code]));
  return judged(rows, type)
    .map((c): JudgeLine => {
      const sub = rows.submissions.find((s) => s.company_id === c.id && s.type === type);
      const score = rows.scores.find((s) => s.company_id === c.id && s.type === type);
      const runs = sub ? latestRuns(rows.runs, sub.id) : [];
      const authorId = score?.team_id ?? sub?.team_id ?? (type === "PRD" ? c.founder_team_id : c.rescuer_team_id);
      const failed = runs.filter((r) => r.status === "FAILED").length;
      const done = runs.filter((r) => r.status === "DONE").length;
      const status: JudgeLine["status"] = score?.status ?? "NOT_LOCKED";
      const waiting = !score
        ? "Not locked yet"
        : score.missing
          ? "No submission: scores 0"
          : status === "SEALED" || status === "REVEALED"
            ? ""
            : failed
              ? `${failed} reading${failed === 1 ? "" : "s"} failed`
              : rows.hits[sub?.id ?? ""] === undefined && done === 0
                ? "Waiting for the judge worker"
                : `${done} of 3 readings done`;
      return {
        companyId: c.id,
        ticker: c.ticker ?? "—",
        name: c.name ?? "",
        author: authorId ? (code.get(authorId) ?? "?") : "—",
        words: sub?.word_count ?? null,
        readings: runs.map((r) => ({ runNo: r.run_no, status: r.status, total: r.total, error: r.error })),
        median: score?.median ?? null,
        penalty: score?.penalty ?? 0,
        final: score?.final_score ?? null,
        removed: sub ? (rows.hits[sub.id] ?? null) : null,
        status,
        missing: score?.missing ?? false,
        waiting,
      };
    })
    .sort(byTicker);
}

export function parseJudgeType(v: unknown): SubmissionType | null {
  return v === "PRD" || v === "SOLUTION" ? v : null;
}

/** The type the page shows: ?type=, otherwise the round the night is working on (solutions once the crisis is in). */
export function pickType(query: unknown, crisisApplied: boolean): SubmissionType {
  const q = typeof query === "string" ? parseJudgeType(query.toUpperCase()) : null;
  return q ?? (crisisApplied ? "SOLUTION" : "PRD");
}
