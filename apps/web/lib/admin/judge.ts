// What the judge console shows, worked out from the stored rows: per type a summary (companies, submissions, judge
// runs by status, scores sealed / released / missing), the progress of the judge against the brief's target, and per
// company its runs, spread, median, final score, status and latest re-run; the appeals and re-runs of the event; when
// judging may start and why a re-run is refused; and the messages of the console's actions. Pure (the clock is passed
// in), so it is unit-tested; judge-data.ts reads the rows.

import {
  RUBRICS,
  SUBMISSION_TYPES,
  medianScore,
  needsExtraRuns,
  phaseReached,
  runsComplete,
  type DeadlineCode,
  type PhaseCode,
  type SubmissionType,
} from "@msim/engine";
import { bp, clock, money } from "@/lib/format";

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

export type AppealStatus = "JUDGING" | "READY" | "APPLIED" | "DISMISSED";

/** One row of public.appeals: a technical re-run of one company's submission (a new generation of runs 1–3). */
export interface JudgeAppealRow {
  id: string;
  company_id: string;
  type: SubmissionType;
  submission_id: string;
  generation: number;
  /** After release (PLAN and FLASH only) the new score waits for an organiser; before release it is sealed at once. */
  after_release: boolean;
  reason: string;
  status: AppealStatus;
  requested_at: string;
  /** The score it replaces: {final, median, tier_bp, …} (null when there was none). */
  old_score: Record<string, unknown> | null;
  /** The score its runs gave: {final, median, tier_bp, …} (null until they are complete). */
  new_score: Record<string, unknown> | null;
  ready_at: string | null;
  decided_at: string | null;
  note: string | null;
  /** What apply_appeal changed (see AppealEffects). */
  effects: Record<string, unknown> | null;
}

export interface JudgeRows {
  companies: readonly JudgeCompanyRow[];
  submissions: readonly JudgeSubmissionRow[];
  runs: readonly JudgeRunRow[];
  scores: readonly JudgeScoreRow[];
  appeals: readonly JudgeAppealRow[];
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
  /**
   * Every run for this company and type: the current submission's first (newest generation first), then older ones.
   * `dismissed`: a generation whose appeal was dismissed (it never counts).
   */
  allRuns: (JudgeRunRow & { current: boolean; dismissed: boolean })[];
  /** The company's latest re-run of this type (null when there was none). */
  appeal: AppealView | null;
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

const generationKey = (r: { submission_id: string; generation: number }) => `${r.submission_id}:${r.generation}`;

/** The generations whose appeal was dismissed: their runs never count (the score stays as it was). */
function dismissedGenerations(appeals: readonly JudgeAppealRow[]): Set<string> {
  return new Set(appeals.filter((a) => a.status === "DISMISSED").map(generationKey));
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
  const dismissed = dismissedGenerations(rows.appeals);
  // appealViews lists the newest first: the first one met is the company's latest.
  const latestAppeal = new Map<string, AppealView>();
  for (const a of appealViews(rows)) if (a.type === type && !latestAppeal.has(a.companyId)) latestAppeal.set(a.companyId, a);

  return rows.companies
    .map((company): CompanyJudgeView => {
      const submission = submissions.get(company.id) ?? null;
      const score = sealedScore(scores.get(company.id));
      const all = runsOf.get(company.id) ?? [];
      const current = submission ? all.filter((r) => r.submission_id === submission.id && !dismissed.has(generationKey(r))) : [];
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
        .map((r) => ({ ...r, current: r.submission_id === submission?.id, dismissed: dismissed.has(generationKey(r)) }))
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
        appeal: latestAppeal.get(company.id) ?? null,
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

/** True while a run of a current submission is waiting or running. */
export function judging(summaries: readonly TypeSummary[]): boolean {
  return summaries.some((s) => s.runs.QUEUED + s.runs.RUNNING > 0);
}

const inFlight = (r: Pick<JudgeRunRow, "status">) => r.status === "QUEUED" || r.status === "RUNNING";

/**
 * How often the judge page re-reads itself (null: it need not). A finished run is written without a realtime message
 * (only a seal, a failure or a new appeal score broadcasts), so: every 3 s while any run of the event is queued or
 * running, every 15 s until every score is released (submissions and seals of the missing), then not at all.
 */
export function refreshInterval(summaries: readonly TypeSummary[], runs: readonly Pick<JudgeRunRow, "status">[]): number | null {
  if (runs.some(inFlight) || judging(summaries)) return 3000;
  return summaries.some((s) => s.companies > 0 && s.released < s.companies) ? 15_000 : null;
}

// ───────────────────────────── Progress ─────────────────────────────

/** The brief: all submissions × 3 runs within 10 minutes. */
export const TARGET_MS = 10 * 60_000;
/** Throughput is measured over the last 2 minutes of work. */
export const PACE_WINDOW_MS = 2 * 60_000;
/** …but never over less than 15 s, so the first finished run does not read as a huge pace. */
const MIN_PACE_WINDOW_MS = 15_000;

export type TargetState = "MET" | "MISSED" | "ON_PACE" | "BEHIND" | "NO_PACE";

/** The brief's target, on the first pass: runs 1–3 (generation 1) of every current submission. */
export interface TargetCheck {
  /** 3 per current submission. */
  runs: number;
  done: number;
  startedAt: string;
  /** startedAt + 10 minutes. */
  deadline: string;
  state: TargetState;
  /** MET and a finished MISSED: from the first run created to the last of them done. */
  tookMs: number | null;
  /** ON_PACE and BEHIND: when the first pass ends at the current pace. */
  projectedAt: string | null;
}

export interface JudgeProgress {
  type: SubmissionType;
  /** Companies with a current submission. */
  submissions: number;
  /** Of those, the ones whose current submission has a sealed (or released) score. */
  sealed: number;
  /** Current submissions with no runs yet (Start judging queues them). */
  notStarted: number;
  /** Runs needed: 3 per current submission, plus the extra runs 4–5 that exist (latest generation). */
  needed: number;
  done: number;
  /** The latest generation's runs of the current submissions, by status. */
  runs: Record<RunStatus, number>;
  /** Runs still to do: queued, running and those of submissions not started. */
  remaining: number;
  /** The first run's created_at. */
  startedAt: string | null;
  /** When the last run finished, once nothing is left to do (failed runs aside); null while work remains. */
  finishedAt: string | null;
  /** From the first run to now, or to finishedAt. */
  elapsedMs: number | null;
  /** Runs done per minute over the last 2 minutes of work (to now, or to finishedAt). */
  perMinute: number | null;
  /** remaining ÷ perMinute (null when nothing is left or nothing finished lately). */
  etaMs: number | null;
  target: TargetCheck | null;
}

const minIso = (xs: readonly string[]) => xs.reduce<string | null>((m, x) => (m === null || x < m ? x : m), null);
const maxIso = (xs: readonly string[]) => xs.reduce<string | null>((m, x) => (m === null || x > m ? x : m), null);

/** Runs done per minute among `runs` that finished in the 2 minutes before `until` (and after `startMs`). */
export function pace(runs: readonly Pick<JudgeRunRow, "status" | "finished_at">[], startMs: number, until: number): number | null {
  if (until <= startMs) return null;
  const from = until - Math.max(Math.min(PACE_WINDOW_MS, until - startMs), MIN_PACE_WINDOW_MS);
  const n = runs.filter((r) => {
    if (r.status !== "DONE" || !r.finished_at) return false;
    const t = Date.parse(r.finished_at);
    return t > from && t <= until;
  }).length;
  return n / ((until - from) / 60_000);
}

function targetCheck(withSubmission: number, first: readonly JudgeRunRow[], perMinute: number | null, now: number): TargetCheck | null {
  const startedAt = minIso(first.map((r) => r.created_at));
  if (!startedAt) return null;
  const start = Date.parse(startedAt);
  const deadline = new Date(start + TARGET_MS).toISOString();
  const runs = 3 * withSubmission;
  const doneRuns = first.filter((r) => r.status === "DONE");
  const base = { runs, done: doneRuns.length, startedAt, deadline, tookMs: null, projectedAt: null };
  if (doneRuns.length >= runs) {
    const end = maxIso(doneRuns.map((r) => r.finished_at ?? r.created_at))!;
    const tookMs = Math.max(0, Date.parse(end) - start);
    return { ...base, state: tookMs <= TARGET_MS ? "MET" : "MISSED", tookMs };
  }
  if (now > start + TARGET_MS) return { ...base, state: "MISSED" };
  if (!perMinute) return { ...base, state: "NO_PACE" };
  const projected = now + ((runs - doneRuns.length) / perMinute) * 60_000;
  return { ...base, state: projected <= start + TARGET_MS ? "ON_PACE" : "BEHIND", projectedAt: new Date(projected).toISOString() };
}

/** The progress of one type's judging at `now` (ms): what the bar, the counts, the timing and the target show. */
export function judgeProgress(type: SubmissionType, views: readonly CompanyJudgeView[], runs: readonly JudgeRunRow[], now: number): JudgeProgress {
  const withSubmission = views.filter((v) => v.submission);
  const counted = withSubmission.flatMap((v) => v.runs);
  const byStatus: Record<RunStatus, number> = { QUEUED: 0, RUNNING: 0, DONE: 0, FAILED: 0 };
  for (const r of counted) byStatus[r.status] += 1;
  const notStarted = withSubmission.filter((v) => v.runs.length === 0).length;
  const current = new Set(withSubmission.map((v) => v.submission!.id));
  const ofType = runs.filter((r) => r.type === type);
  const mine = ofType.filter((r) => current.has(r.submission_id));

  const remaining = byStatus.QUEUED + byStatus.RUNNING + 3 * notStarted;
  const startedAt = minIso(mine.map((r) => r.created_at));
  const lastFinished = maxIso(mine.flatMap((r) => (r.finished_at ? [r.finished_at] : [])));
  const finishedAt = startedAt && remaining === 0 ? lastFinished : null;
  const until = remaining === 0 ? (lastFinished ? Date.parse(lastFinished) : null) : now;
  const start = startedAt ? Date.parse(startedAt) : null;
  const elapsedMs = start !== null && until !== null ? Math.max(0, until - start) : null;
  const perMinute = start !== null && until !== null ? pace(ofType, start, until) : null;
  const etaMs = remaining > 0 && perMinute ? (remaining / perMinute) * 60_000 : null;

  return {
    type,
    submissions: withSubmission.length,
    sealed: withSubmission.filter((v) => v.score && !v.score.missing && !v.stale).length,
    notStarted,
    needed: 3 * withSubmission.length + counted.filter((r) => r.run_no > 3).length,
    done: byStatus.DONE,
    runs: byStatus,
    remaining,
    startedAt,
    finishedAt,
    elapsedMs,
    perMinute,
    etaMs,
    target: targetCheck(withSubmission.length, mine.filter((r) => r.generation === 1 && r.run_no <= 3), perMinute, now),
  };
}

/** "42 s", "2 min", "7 min 40 s", "1 h 5 min". */
export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return s % 60 === 0 ? `${s / 60} min` : `${Math.floor(s / 60)} min ${s % 60} s`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

/** "28 runs/min", "2.5 runs/min". */
export function perMinuteText(n: number | null): string {
  if (n === null) return "—";
  const v = n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
  return `${v} run${v === 1 ? "" : "s"}/min`;
}

/** The target line under the progress bar. */
export function targetText(t: TargetCheck): string {
  const left = t.runs - t.done;
  switch (t.state) {
    case "MET":
      return `Met: ${plural(t.runs, "run")} in ${duration(t.tookMs)}.`;
    case "MISSED":
      return t.tookMs !== null
        ? `Missed: ${plural(t.runs, "run")} took ${duration(t.tookMs)}.`
        : `Missed: 10 minutes have passed with ${left} of ${plural(t.runs, "run")} still to do.`;
    case "ON_PACE":
      return `On pace: done at about ${clock(t.projectedAt, true)}, before ${clock(t.deadline, true)}.`;
    case "BEHIND":
      return `Behind: at this pace it ends at about ${clock(t.projectedAt, true)}, after ${clock(t.deadline, true)}. Run the judge on more consoles, or switch to the backup model.`;
    case "NO_PACE":
      return `No pace yet (no run has finished lately): the target is ${clock(t.deadline, true)}.`;
  }
}

export const TARGET_TONE: Record<TargetState, StatusTone> = { MET: "green", ON_PACE: "green", MISSED: "red", BEHIND: "amber", NO_PACE: "slate" };

// ───────────────────────────── When judging may start ─────────────────────────────

/** The deadline after which a type is judged and sealed: plans after both the plan and the deal deadline. */
export function scoringClosesAt(type: SubmissionType, deadlines: Partial<Record<DeadlineCode, string>>): string | null {
  if (type !== "PLAN") return deadlines[type] ?? null;
  const plan = deadlines.PLAN;
  const deal = deadlines.DEAL;
  return plan && deal ? (plan > deal ? plan : deal) : null;
}

/** As app.deadline_passed: a deadline after the moment the event was paused has not passed while it is paused. */
function deadlinePassed(at: string | undefined, now: number, pausedAt: string | null): boolean {
  if (!at) return false;
  if (pausedAt && Date.parse(at) > Date.parse(pausedAt)) return false;
  return now > Date.parse(at);
}

/** As app.scoring_closed: the type's deadline has passed (plans: the plan and the deal deadlines). */
export function scoringClosed(type: SubmissionType, deadlines: Partial<Record<DeadlineCode, string>>, now: number, pausedAt: string | null): boolean {
  return deadlinePassed(deadlines[type], now, pausedAt) && (type !== "PLAN" || deadlinePassed(deadlines.DEAL, now, pausedAt));
}

const DEADLINE_NAMES: Record<SubmissionType, string> = { PITCH: "pitch deadline", PLAN: "plan and deal deadlines", FLASH: "flash deadline" };

/** Why Start judging is off for a type (null when it is on): before its deadline, and once its scores are released. */
export function startBlock(type: SubmissionType, s: { closed: boolean; released: boolean; closesAt: string | null }): string | null {
  if (s.released) return `${TYPE_TITLES[type]} scores have been released.`;
  if (!s.closed) return `${TYPE_TITLES[type]} judging starts after the ${DEADLINE_NAMES[type]}${s.closesAt ? ` (${clock(s.closesAt)})` : ""}.`;
  return null;
}

// ───────────────────────────── Re-runs and appeals ─────────────────────────────

/**
 * Why this company's submission cannot be re-run now (null when it can; the database still decides): no on-time
 * submission, not judged yet, runs in flight, a new score waiting, a released pitch, or the awards have begun.
 */
export function rerunBlock(type: SubmissionType, v: CompanyJudgeView, s: { phase: PhaseCode; closed: boolean }): string | null {
  if (phaseReached(s.phase, "AWARDS")) return "Appeals are decided before the awards.";
  if (!s.closed) return "A submission is judged after its deadline.";
  if (!v.submission) return "No on-time submission to judge again.";
  if (v.score?.status === "RELEASED" && type === "PITCH") {
    return "A released pitch score cannot be re-run: it has set the IPO price and the IPO is allocated.";
  }
  if (v.appeal?.status === "READY") return "A new score is waiting: apply or dismiss it under Appeals and re-runs first.";
  if (v.runs.some(inFlight)) return "The judge is still working on this submission: wait for its runs to finish.";
  if (v.allRuns.every((r) => !r.current)) return "Not judged yet: Start judging queues its runs.";
  return null;
}

/** What a company's latest re-run shows next to its status. */
export const APPEAL_BADGES: Record<AppealStatus, CompanyStatus> = {
  JUDGING: { label: "Re-run: waiting for the judge", tone: "blue" },
  READY: { label: "New score ready: apply or dismiss", tone: "amber" },
  APPLIED: { label: "Re-run: applied", tone: "green" },
  DISMISSED: { label: "Re-run: dismissed", tone: "slate" },
};

/** The status column of the appeals panel. */
export const APPEAL_STATUS_LABELS: Record<AppealStatus, string> = {
  JUDGING: "Waiting for the judge",
  READY: "New score ready",
  APPLIED: "Applied",
  DISMISSED: "Dismissed",
};

/** A final score and its tier, as an appeal stores them. */
export interface AppealScore {
  final: number | null;
  tier_bp: number | null;
}

/** What apply_appeal changed (appeals.effects). Money in integer cents. */
export interface AppealEffects {
  score: { from: number | null; to: number | null };
  tier_bp: { from: number | null; to: number | null };
  ai_price: { from: number | null; to: number | null };
  /** Once the market has closed. */
  closing_price: { from: number | null; to: number | null } | null;
  /** What the shorts covered at the close pay more (negative: get back). */
  short_cover_cents: number;
  /** What the consultant's plan bonus changes by (paid at settlement). */
  plan_bonus_cents: number;
  /** Consultant call 3 earnings that changed. */
  calls: { team_id: string; cents: number }[];
  /** Results and rankings were computed again. */
  settled: boolean;
}

const int = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const change = (v: unknown) => {
  const o = obj(v);
  return { from: int(o?.from), to: int(o?.to) };
};

export function appealScore(v: Record<string, unknown> | null): AppealScore | null {
  return v ? { final: int(v.final), tier_bp: int(v.tier_bp) } : null;
}

export function parseEffects(v: unknown): AppealEffects | null {
  const o = obj(v);
  if (!o) return null;
  return {
    score: change(o.score),
    tier_bp: change(o.tier_bp),
    ai_price: change(o.ai_price),
    closing_price: obj(o.closing_price) ? change(o.closing_price) : null,
    short_cover_cents: int(o.short_cover_cents) ?? 0,
    plan_bonus_cents: int(o.plan_bonus_cents) ?? 0,
    calls: Array.isArray(o.calls)
      ? o.calls.flatMap((c) => {
          const x = obj(c);
          const cents = int(x?.cents);
          return x && typeof x.team_id === "string" && cents !== null ? [{ team_id: x.team_id, cents }] : [];
        })
      : [],
    settled: o.settled === true,
  };
}

const signed = (cents: number) => (cents > 0 ? `+${money(cents)}` : money(cents));
const arrow = (from: string, to: string) => `${from} → ${to}`;

/** What an applied appeal changed, each part starting in lower case (as in a sentence). */
function effectParts(e: AppealEffects): string[] {
  const parts = [
    `score ${arrow(String(e.score.from ?? "—"), String(e.score.to ?? "—"))}`,
    `tier ${arrow(bp(e.tier_bp.from), bp(e.tier_bp.to))}`,
    `AI price ${arrow(money(e.ai_price.from), money(e.ai_price.to))}`,
  ];
  if (e.closing_price) parts.push(`closing price ${arrow(money(e.closing_price.from), money(e.closing_price.to))}`);
  if (e.short_cover_cents > 0) parts.push(`shorts covered at the close pay ${money(e.short_cover_cents)} more`);
  if (e.short_cover_cents < 0) parts.push(`shorts covered at the close get ${money(-e.short_cover_cents)} back`);
  if (e.plan_bonus_cents !== 0) parts.push(`consultant's plan bonus ${signed(e.plan_bonus_cents)}`);
  if (e.calls.length > 0) {
    const total = e.calls.reduce((a, c) => a + c.cents, 0);
    parts.push(`consultant call 3 judged again: ${plural(e.calls.length, "call")} changed (${signed(total)})`);
  }
  if (e.settled) parts.push("results and rankings computed again");
  return parts;
}

/** One line per thing an applied appeal changed. */
export function effectLines(e: AppealEffects): string[] {
  return effectParts(e).map((p) => p.charAt(0).toUpperCase() + p.slice(1));
}

export interface AppealView {
  id: string;
  companyId: string;
  /** The ticker (or squad). */
  label: string;
  type: SubmissionType;
  afterRelease: boolean;
  reason: string;
  requestedAt: string;
  status: AppealStatus;
  badge: CompanyStatus;
  from: AppealScore | null;
  /** The new score once its runs are complete. */
  to: AppealScore | null;
  generation: number;
  /** Its generation's runs: done, failed, in flight, and needed (3, or 5 once the extra runs exist). */
  runs: { done: number; failed: number; inFlight: number; total: number };
  decidedAt: string | null;
  note: string | null;
  effects: AppealEffects | null;
  /** READY after release: apply_appeal. */
  canApply: boolean;
  /** Open after release: dismiss_appeal. */
  canDismiss: boolean;
}

const OPEN_FIRST: Record<AppealStatus, number> = { READY: 0, JUDGING: 1, APPLIED: 2, DISMISSED: 2 };

/** Every appeal of the event: those waiting for an organiser first, then the judge's, then the decided; newest first. */
export function appealViews(rows: Pick<JudgeRows, "appeals" | "runs" | "companies">): AppealView[] {
  const companies = new Map(rows.companies.map((c) => [c.id, c]));
  const runsOf = new Map<string, JudgeRunRow[]>();
  for (const r of rows.runs) {
    const k = generationKey(r);
    runsOf.set(k, [...(runsOf.get(k) ?? []), r]);
  }
  return rows.appeals
    .map((a): AppealView => {
      const runs = runsOf.get(generationKey(a)) ?? [];
      const company = companies.get(a.company_id);
      return {
        id: a.id,
        companyId: a.company_id,
        label: company ? companyLabel({ company }) : "Company",
        type: a.type,
        afterRelease: a.after_release,
        reason: a.reason,
        requestedAt: a.requested_at,
        status: a.status,
        badge: APPEAL_BADGES[a.status],
        from: appealScore(a.old_score),
        to: appealScore(a.new_score),
        generation: a.generation,
        runs: {
          done: runs.filter((r) => r.status === "DONE").length,
          failed: runs.filter((r) => r.status === "FAILED").length,
          inFlight: runs.filter(inFlight).length,
          total: Math.max(3, runs.length),
        },
        decidedAt: a.decided_at,
        note: a.note,
        effects: parseEffects(a.effects),
        canApply: a.after_release && a.status === "READY",
        canDismiss: a.after_release && (a.status === "READY" || a.status === "JUDGING"),
      };
    })
    .sort((a, b) => OPEN_FIRST[a.status] - OPEN_FIRST[b.status] || b.requestedAt.localeCompare(a.requestedAt));
}

/** "50 (0%)", "40 (−10%)", "—". */
export function scoreWithTier(s: AppealScore | null): string {
  if (!s || s.final === null) return "—";
  return `${s.final} (${bp(s.tier_bp)})`;
}

/** "AQS plan 50 → 40": what applying an appeal changes, for its confirmation. */
export function appealChange(a: Pick<AppealView, "label" | "type" | "from" | "to">): string {
  return `${a.label} ${TYPE_NAMES[a.type]} ${a.from?.final ?? "—"} → ${a.to?.final ?? "—"}`;
}

// ───────────────────────────── Run issues (the Runs column) ─────────────────────────────

/** The models that judged (or are judging) these runs, in order of first use. */
export function runModels(runs: readonly Pick<JudgeRunRow, "model">[]): string[] {
  return [...new Set(runs.flatMap((r) => (r.model ? [r.model] : [])))];
}

export interface RunIssue {
  runNo: number;
  text: string;
  tone: "red" | "amber" | "slate";
}

/** A line for each run that failed, waits to be tried again, or is on a later attempt. */
export function runIssues(runs: readonly JudgeRunRow[]): RunIssue[] {
  return runs.flatMap((r): RunIssue[] => {
    if (r.status === "FAILED") return [{ runNo: r.run_no, text: `Run ${r.run_no} failed after ${plural(r.attempts, "attempt")}: ${r.error ?? "no reason given"}`, tone: "red" }];
    if (r.status === "QUEUED" && r.attempts > 0) {
      return [{ runNo: r.run_no, text: `Run ${r.run_no} waits to be tried again (attempt ${r.attempts} of 5 failed${r.error ? `: ${r.error}` : ""})`, tone: "amber" }];
    }
    if (r.status === "RUNNING" && r.attempts > 1) return [{ runNo: r.run_no, text: `Run ${r.run_no}: attempt ${r.attempts} of 5`, tone: "slate" }];
    return [];
  });
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

function plural(n: number, word: string): string {
  if (n === 1) return `${n} ${word}`;
  return `${n} ${word.endsWith("y") ? `${word.slice(0, -1)}ies` : `${word}s`}`;
}

export function sealMissingMessage(type: SubmissionType, sealed: number): string {
  return sealed === 0
    ? `No missing ${TYPE_NAMES[type]} scores to seal: every company has an on-time submission or a score.`
    : `Sealed ${plural(sealed, `missing ${TYPE_NAMES[type]} score`)} as 0.`;
}

export function releaseMessage(type: SubmissionType, released: number): string {
  const effect = type === "PITCH" ? "IPO prices are set" : "the tiers moved the market and AI prices";
  return `Released ${plural(released, `${TYPE_NAMES[type]} score`)}; ${effect}.`;
}

export function startMessage(type: SubmissionType, queued: number, companies: number): string {
  return queued === 0
    ? `Nothing to queue: every current ${TYPE_NAMES[type]} submission already has judge runs.`
    : `Queued ${plural(queued, "run")} for ${plural(companies, "company")}.`;
}

export function retryMessage(retried: number): string {
  return retried === 0 ? "No failed runs to send back to the queue." : `Sent ${plural(retried, "failed run")} back to the queue.`;
}

export type JudgeSlot = "PRIMARY" | "BACKUP";
export const SLOT_NAMES: Record<JudgeSlot, string> = { PRIMARY: "primary", BACKUP: "backup" };

/** The model switch: where it goes from `slot`, its label and its confirmation. */
export function modelSwitch(slot: JudgeSlot, models: Record<JudgeSlot, string> | null) {
  const to: JudgeSlot = slot === "PRIMARY" ? "BACKUP" : "PRIMARY";
  const named = models ? ` (${models[to]})` : "";
  return to === "BACKUP"
    ? { to, label: "Switch to the backup model", confirm: `Click again to switch to the backup model${named}` }
    : { to, label: "Switch back to the primary model", confirm: `Click again to switch back to the primary model${named}` };
}

export function modelMessage(slot: JudgeSlot, model: string | null): string {
  return `Runs claimed from now on use the ${SLOT_NAMES[slot]} model${model ? ` (${model})` : ""}; runs already running finish as they are.`;
}

export function rerunMessage(label: string, type: SubmissionType, afterRelease: boolean, generation: number): string {
  return afterRelease
    ? `Appeal opened: 3 new runs of ${label}'s ${TYPE_NAMES[type]} are queued (generation ${generation}). The released score stays until you apply or dismiss the new one.`
    : `Re-running ${label}'s ${TYPE_NAMES[type]}: 3 new runs are queued (generation ${generation}). The score is sealed again when they are done.`;
}

export function applyMessage(label: string, type: SubmissionType, e: AppealEffects | null): string {
  if (!e) return `Applied the new ${label} ${TYPE_NAMES[type]} score.`;
  return `Applied: ${label} ${TYPE_NAMES[type]} ${effectParts(e).join("; ")}.`;
}

export function dismissMessage(label: string, type: SubmissionType): string {
  return `Appeal dismissed: ${label}'s released ${TYPE_NAMES[type]} score stays.`;
}
