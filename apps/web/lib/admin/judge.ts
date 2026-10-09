// What the judge view shows, worked out from the stored rows: per type a summary (companies, submissions, judge runs
// by status, scores sealed / released / missing) and per company its runs, spread, median, final score and status.
// Pure, so it is unit-tested; judge-data.ts reads the rows.

import {
  RUBRICS,
  SUBMISSION_TYPES,
  medianScore,
  needsExtraRuns,
  phaseReached,
  runsComplete,
  type PhaseCode,
  type SubmissionType,
} from "@msim/engine";

export const JUDGE_TYPES = SUBMISSION_TYPES;

/** Used in sentences and button labels ("Release pitch scores"). */
export const TYPE_NAMES: Record<SubmissionType, string> = { PITCH: "pitch", PLAN: "plan", FLASH: "flash" };
export const TYPE_TITLES: Record<SubmissionType, string> = { PITCH: "Pitch", PLAN: "Plan", FLASH: "Flash" };

export type RunStatus = "QUEUED" | "RUNNING" | "DONE" | "FAILED";
export const RUN_STATUSES: readonly RunStatus[] = ["QUEUED", "RUNNING", "DONE", "FAILED"];
export type ScoreStatus = "PENDING" | "SCORING" | "SEALED" | "RELEASED";
export type StatusTone = "slate" | "green" | "amber" | "red" | "blue" | "violet";

export interface JudgeCompanyRow {
  id: string;
  ticker: string | null;
  name: string | null;
  squad: number | null;
}

export interface JudgeSubmissionRow {
  id: string;
  company_id: string;
  type: SubmissionType;
  word_count: number;
  submitted_at: string;
  body_text: string;
}

export interface JudgeRunRow {
  id: string;
  submission_id: string;
  company_id: string;
  type: SubmissionType;
  generation: number;
  run_no: number;
  model: string | null;
  status: RunStatus;
  attempts: number;
  breakdown: Record<string, unknown> | null;
  total: number | null;
  rationale: string | null;
  error: string | null;
  latency_ms: number | null;
  created_at: string;
  finished_at: string | null;
}

export interface JudgeScoreRow {
  company_id: string;
  type: SubmissionType;
  submission_id: string | null;
  generation: number;
  status: ScoreStatus;
  run_totals: number[] | null;
  median: number | null;
  missing: boolean;
  capped: boolean;
  penalty: number;
  final_score: number | null;
  tier_bp: number | null;
  breakdown: Record<string, unknown> | null;
  rationale: string | null;
  released_at: string | null;
}

export interface JudgeRows {
  companies: readonly JudgeCompanyRow[];
  submissions: readonly JudgeSubmissionRow[];
  runs: readonly JudgeRunRow[];
  scores: readonly JudgeScoreRow[];
}

// ───────────────────────────── Which type to show ─────────────────────────────

/** "?type=plan" → PLAN; anything else → null. */
export function parseJudgeType(v: string | string[] | undefined): SubmissionType | null {
  const s = (Array.isArray(v) ? v[0] : v)?.toUpperCase();
  return (JUDGE_TYPES as readonly string[]).includes(s ?? "") ? (s as SubmissionType) : null;
}

/** The type the night is working on: pitches until the plans are published, plans until rounds 13–21, then flash. */
export function defaultJudgeType(phase: PhaseCode): SubmissionType {
  if (phaseReached(phase, "ROUNDS_13_21")) return "FLASH";
  if (phaseReached(phase, "PLANS_PUBLISHED")) return "PLAN";
  return "PITCH";
}

// ───────────────────────────── Per company ─────────────────────────────

export interface CompanyStatus {
  label: string;
  tone: StatusTone;
}

export interface CompanyJudgeView {
  company: JudgeCompanyRow;
  submission: JudgeSubmissionRow | null;
  /** The latest generation of runs of the current submission (null when it has no runs). */
  generation: number | null;
  /** That generation's runs, by run number. */
  runs: JudgeRunRow[];
  /** The totals of its finished runs, by run number. */
  totals: number[];
  /** Highest minus lowest finished total (null with fewer than 2). */
  spread: number | null;
  /** The sealed median, or the median of complete unsealed runs (sealed = false). */
  median: { value: number; sealed: boolean } | null;
  /** The sealed or released score (null before it is sealed). */
  score: JudgeScoreRow | null;
  status: CompanyStatus;
  /** A sealed (not yet released) score whose submission is no longer the current one: release refuses it. */
  stale: boolean;
  /** Every run for this company and type: the current submission's first (newest generation first), then older ones. */
  allRuns: (JudgeRunRow & { current: boolean })[];
}

/** Highest minus lowest; null with fewer than 2 totals. */
export function spread(totals: readonly number[]): number | null {
  return totals.length < 2 ? null : Math.max(...totals) - Math.min(...totals);
}

/** A score counts once it is sealed (or released); a PENDING or SCORING row is treated as no score yet. */
export function sealedScore(score: JudgeScoreRow | null | undefined): JudgeScoreRow | null {
  return score && (score.status === "SEALED" || score.status === "RELEASED") ? score : null;
}

function companyStatus(score: JudgeScoreRow | null, submission: JudgeSubmissionRow | null, runs: readonly JudgeRunRow[], totals: readonly number[]): CompanyStatus {
  if (score?.status === "RELEASED") return { label: score.missing ? "Released: missing (0)" : "Released", tone: "green" };
  if (score?.status === "SEALED") return score.missing ? { label: "Sealed: missing (0)", tone: "amber" } : { label: "Sealed", tone: "blue" };
  if (!submission) return { label: "No submission", tone: "amber" };
  if (runs.length === 0) return { label: "Not judged", tone: "slate" };
  const done = runs.filter((r) => r.status === "DONE").length;
  if (runs.some((r) => r.status === "QUEUED" || r.status === "RUNNING")) return { label: `Judging: ${done} of ${runs.length} runs done`, tone: "blue" };
  if (runs.some((r) => r.status === "FAILED")) return { label: "Run failed", tone: "red" };
  if (needsExtraRuns(totals)) return { label: "Spread over 10: needs 2 more runs", tone: "amber" };
  if (runsComplete(totals)) return { label: "Judged, not sealed", tone: "slate" };
  return { label: "Runs incomplete", tone: "amber" };
}

/** The judge table's columns (the last one holds the Runs button). */
export const JUDGE_COLUMNS = ["Company", "Submission", "Runs", "Spread", "Median", "Final", "Tier", "Capped", "Penalty", "Status"] as const;

/** The ticker, or the squad before a ticker is claimed. */
export function companyLabel(v: { company: JudgeCompanyRow }): string {
  return v.company.ticker ?? (v.company.squad !== null ? `Squad ${v.company.squad}` : "Company");
}

const byRun = (a: JudgeRunRow, b: JudgeRunRow) => a.run_no - b.run_no;

/** Companies with a ticker first (A–Z), then the rest by squad. */
function byCompany(a: CompanyJudgeView, b: CompanyJudgeView): number {
  const ta = a.company.ticker;
  const tb = b.company.ticker;
  if (ta !== null && tb !== null) return ta.localeCompare(tb);
  if (ta !== null || tb !== null) return ta !== null ? -1 : 1;
  return (a.company.squad ?? Number.MAX_SAFE_INTEGER) - (b.company.squad ?? Number.MAX_SAFE_INTEGER);
}

export function companyViews(type: SubmissionType, rows: JudgeRows): CompanyJudgeView[] {
  const submissions = new Map(rows.submissions.filter((s) => s.type === type).map((s) => [s.company_id, s]));
  const scores = new Map(rows.scores.filter((s) => s.type === type).map((s) => [s.company_id, s]));
  const runsOf = new Map<string, JudgeRunRow[]>();
  for (const r of rows.runs) {
    if (r.type !== type) continue;
    const list = runsOf.get(r.company_id) ?? [];
    list.push(r);
    runsOf.set(r.company_id, list);
  }

  return rows.companies
    .map((company): CompanyJudgeView => {
      const submission = submissions.get(company.id) ?? null;
      const score = sealedScore(scores.get(company.id));
      const all = runsOf.get(company.id) ?? [];
      const current = submission ? all.filter((r) => r.submission_id === submission.id) : [];
      const generation = current.length ? Math.max(...current.map((r) => r.generation)) : null;
      const runs = current.filter((r) => r.generation === generation).sort(byRun);
      const totals = runs.filter((r) => r.status === "DONE" && r.total !== null).map((r) => r.total!);
      const median =
        score && score.median !== null
          ? { value: score.median, sealed: true }
          : !score && runsComplete(totals)
            ? { value: medianScore(totals), sealed: false }
            : null;
      // Release refuses while a sealed score's submission is no longer the current one.
      const stale = score?.status === "SEALED" && (score.submission_id ?? null) !== (submission?.id ?? null);
      const allRuns = all
        .map((r) => ({ ...r, current: r.submission_id === submission?.id }))
        .sort((a, b) => Number(b.current) - Number(a.current) || b.generation - a.generation || a.run_no - b.run_no || a.created_at.localeCompare(b.created_at));
      return {
        company,
        submission,
        generation,
        runs,
        totals,
        spread: spread(totals),
        median,
        score,
        status: companyStatus(score, submission, runs, totals),
        stale,
        allRuns,
      };
    })
    .sort(byCompany);
}

// ───────────────────────────── Per type ─────────────────────────────

export interface TypeSummary {
  type: SubmissionType;
  companies: number;
  submissions: number;
  /** Runs of the current submissions (latest generation), by status. */
  runs: Record<RunStatus, number>;
  sealed: number;
  released: number;
  /** Scores (sealed or released) of 0 because there was no on-time submission. */
  missing: number;
  /** Companies with no sealed or released score yet. */
  unsealed: number;
  stale: number;
  /** When the type was released (the latest release time), or null. */
  releasedAt: string | null;
}

export function summarise(type: SubmissionType, views: readonly CompanyJudgeView[]): TypeSummary {
  const runs: Record<RunStatus, number> = { QUEUED: 0, RUNNING: 0, DONE: 0, FAILED: 0 };
  for (const v of views) for (const r of v.runs) runs[r.status] += 1;
  const sealed = views.filter((v) => v.score?.status === "SEALED").length;
  const released = views.filter((v) => v.score?.status === "RELEASED").length;
  const releasedAt = views.map((v) => v.score?.released_at ?? null).reduce<string | null>((max, t) => (t && (!max || t > max) ? t : max), null);
  return {
    type,
    companies: views.length,
    submissions: views.filter((v) => v.submission).length,
    runs,
    sealed,
    released,
    missing: views.filter((v) => v.score?.missing).length,
    unsealed: views.length - sealed - released,
    stale: views.filter((v) => v.stale).length,
    releasedAt,
  };
}

/** True while a run of a current submission is waiting or running (the page then re-reads itself to show progress). */
export function judging(summaries: readonly TypeSummary[]): boolean {
  return summaries.some((s) => s.runs.QUEUED + s.runs.RUNNING > 0);
}

/**
 * How often the judge page re-reads itself (null: it need not). Submissions, judge runs and seals are written
 * without a realtime message: every 5 s while runs are in flight, every 15 s until every score is released.
 */
export function refreshInterval(summaries: readonly TypeSummary[]): number | null {
  if (judging(summaries)) return 5000;
  return summaries.some((s) => s.companies > 0 && s.released < s.companies) ? 15_000 : null;
}

// ───────────────────────────── Run detail ─────────────────────────────

export interface BreakdownLine {
  key: string;
  label: string;
  value: number | null;
  max: number | null;
}

/** The rubric lines in order with the run's points (null if absent), then any line the rubric does not have. */
export function breakdownLines(type: SubmissionType, breakdown: Record<string, unknown> | null): BreakdownLine[] {
  if (!breakdown) return [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : null);
  const lines: BreakdownLine[] = RUBRICS[type].map((l) => ({ key: l.key, label: l.label, value: num(breakdown[l.key]), max: l.max }));
  for (const [key, v] of Object.entries(breakdown)) {
    if (!RUBRICS[type].some((l) => l.key === key)) lines.push({ key, label: key, value: num(v), max: null });
  }
  return lines;
}

/** "850 ms", "12.4 s", "—". */
export function latency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

// ───────────────────────────── Action messages ─────────────────────────────

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function sealMissingMessage(type: SubmissionType, sealed: number): string {
  return sealed === 0
    ? `No missing ${TYPE_NAMES[type]} scores to seal: every company has an on-time submission or a score.`
    : `Sealed ${plural(sealed, `missing ${TYPE_NAMES[type]} score`)} as 0.`;
}

export function releaseMessage(type: SubmissionType, released: number): string {
  const effect = type === "PITCH" ? "IPO prices are set" : "the tiers moved the market and AI prices";
  return `Released ${plural(released, `${TYPE_NAMES[type]} score`)}; ${effect}.`;
}
