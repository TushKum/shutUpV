// The squad workspace's rules as the database applies them, so the page agrees with it: who may write which
// submission and when its window is open (app.submission_window), when a deadline has passed (app.deadline_passed:
// frozen while the event is paused), the problem card pick (pick_problem_card, app.default_problem_cards), the
// status of each submission for the overview, and the plan's cap when the deal is not signed in time
// (app.deal_signed_in_time). The database decides; this is for showing the state and for guidance.

import { phaseIndex, phaseReached, submissionWords, type DeadlineCode, type PhaseCode, type SubmissionType, type Track } from "@msim/engine";
import type { Tone } from "@/components/ui/ui";
import { clock } from "@/lib/format";

export const SUBMISSION_LABELS: Record<SubmissionType, string> = { PITCH: "Pitch card", PLAN: "Rescue plan", FLASH: "Flash answer" };

/** The deadline that closes each submission. */
export const SUBMISSION_DEADLINE: Record<SubmissionType, DeadlineCode> = { PITCH: "PITCH", PLAN: "PLAN", FLASH: "FLASH" };

/** Where each submission is edited. */
export const SUBMISSION_PATHS: Record<SubmissionType, string> = { PITCH: "/team/squad/pitch", PLAN: "/team/squad/plan", FLASH: "/team/squad/flash" };

export interface PauseState {
  paused: boolean;
  pausedAt: string | null;
}

/** While the event is paused, a deadline after the moment the pause began has not passed (it moves on resume). */
export function deadlineFrozen(at: string | null | undefined, p: PauseState): boolean {
  return !!at && p.paused && p.pausedAt !== null && Date.parse(at) > Date.parse(p.pausedAt);
}

/** app.deadline_passed: by the server clock, and never while frozen by a pause. No deadline never passes. */
export function deadlinePassed(at: string | null | undefined, nowMs: number, p: PauseState): boolean {
  if (!at || deadlineFrozen(at, p)) return false;
  return nowMs > Date.parse(at);
}

// ───────────── The squad's three teams ─────────────

export interface SquadTeams {
  product_team_id: string;
  consulting_team_id: string;
  finance_team_id: string;
}

export function roleOf(s: SquadTeams, teamId: string | null | undefined): Track | null {
  if (!teamId) return null;
  if (teamId === s.product_team_id) return "PRODUCT";
  if (teamId === s.consulting_team_id) return "CONSULTING";
  if (teamId === s.finance_team_id) return "FINANCE";
  return null;
}

const ROLE_NAMES: Record<Track, string> = { PRODUCT: "Product", CONSULTING: "Consulting", FINANCE: "Finance" };

/** Who did something, from this team's point of view: "your team", "Product", "Consulting"… */
export function whoLabel(s: SquadTeams, me: string, teamId: string | null | undefined): string {
  if (!teamId) return "—";
  if (teamId === me) return "your team";
  const role = roleOf(s, teamId);
  return role ? ROLE_NAMES[role] : "another team";
}

/** "your team (another device)" or "the Consulting team": who saved a version the screen did not save itself. */
export function otherSaver(s: SquadTeams, me: string, teamId: string | null | undefined): string {
  if (teamId === me) return "Your team (on another device)";
  const role = roleOf(s, teamId);
  return role ? `The ${ROLE_NAMES[role]} team` : "Someone in your squad";
}

// ───────────── Submission windows (app.submission_window) ─────────────

/** The pitch is the Product team's; the plan and the flash answer are written by Product and Consulting together. */
export function mayWrite(type: SubmissionType, track: Track): boolean {
  return type === "PITCH" ? track === "PRODUCT" : track === "PRODUCT" || track === "CONSULTING";
}

export type Stage = "BEFORE" | "OPEN" | "CLOSED";

export interface WindowInput extends PauseState {
  phase: PhaseCode;
  drawn: boolean;
  nowMs: number;
  deadlines: Partial<Record<DeadlineCode, string>>;
  /** When the flash bulletin was published (null before). */
  flashPublishedAt: string | null;
  /** The flash scores are released (the flash window closes for good). */
  flashReleased: boolean;
}

export interface SubmissionWindow {
  type: SubmissionType;
  stage: Stage;
  /** This team's track writes this submission. */
  mayWrite: boolean;
  /** Open and this team may write: the editor is live. */
  editable: boolean;
  deadline: string | null;
  /** Why it is not editable (empty when it is). */
  note: string;
}

/** `phase between from and to`, as the Postgres enum compares. */
const between = (phase: PhaseCode, from: PhaseCode, to: PhaseCode) => phaseIndex(phase) >= phaseIndex(from) && phaseIndex(phase) <= phaseIndex(to);

function stageOf(type: SubmissionType, w: WindowInput): Stage {
  const passed = deadlinePassed(w.deadlines[SUBMISSION_DEADLINE[type]], w.nowMs, w);
  switch (type) {
    case "PITCH":
      if (!w.drawn || !phaseReached(w.phase, "SQUAD_DRAW")) return "BEFORE";
      return passed || !between(w.phase, "SQUAD_DRAW", "BUILD") ? "CLOSED" : "OPEN";
    case "PLAN":
      if (!phaseReached(w.phase, "CRISIS")) return "BEFORE";
      return passed || !between(w.phase, "CRISIS", "RESCUE_2") || !w.drawn ? "CLOSED" : "OPEN";
    case "FLASH": {
      if (passed || w.flashReleased) return "CLOSED";
      const published = w.flashPublishedAt !== null && Date.parse(w.flashPublishedAt) <= w.nowMs;
      return published && w.drawn ? "OPEN" : "BEFORE";
    }
  }
}

export function submissionWindow(type: SubmissionType, track: Track, w: WindowInput): SubmissionWindow {
  const deadline = w.deadlines[SUBMISSION_DEADLINE[type]] ?? null;
  const stage = stageOf(type, w);
  const may = mayWrite(type, track);
  const editable = may && stage === "OPEN";
  let note = "";
  if (stage === "BEFORE") {
    const bulletin = w.deadlines.FLASH_BULLETIN;
    note = {
      PITCH: "The pitch card opens at the squad draw.",
      PLAN: "The rescue plan opens when the crisis is published.",
      FLASH: `The flash answer opens when the flash bulletin is published${bulletin ? ` (planned for ${clock(bulletin)})` : ""}.`,
    }[type];
  } else if (stage === "CLOSED") {
    const at = deadline ? ` at ${clock(deadline)}` : "";
    note = { PITCH: `The pitch card closed${at}.`, PLAN: `The rescue plan closed${at}.`, FLASH: `The flash answer closed${at}.` }[type];
  } else if (!may) {
    note = "The Product team writes the pitch card; you can read it here.";
  }
  return { type, stage, mayWrite: may, editable, deadline, note };
}

// ───────────── The problem card (pick_problem_card) ─────────────

export interface PickInput extends PauseState {
  track: Track;
  nowMs: number;
  deadline: string | null;
  dealt: readonly string[];
  chosenId: string | null;
  byDefault: boolean;
}

export interface PickState {
  /** Before the pick deadline. */
  open: boolean;
  /** This team picks (Product); Consulting sees the cards and the pick. */
  mayPick: boolean;
  canPick: boolean;
  /** The card chosen so far (or the default about to be applied once the pick has closed). */
  chosenId: string | null;
  byDefault: boolean;
  /** The pick has closed with nothing picked and the heartbeat has not applied the default yet. */
  defaultPending: boolean;
  note: string;
}

export function pickState(p: PickInput): PickState {
  const open = !deadlinePassed(p.deadline, p.nowMs, p);
  const mayPick = p.track === "PRODUCT";
  const by = p.deadline ? ` by ${clock(p.deadline)}` : "";
  const first = p.dealt[0] ?? null;
  const defaultPending = !open && p.chosenId === null && first !== null;
  let note: string;
  if (open) {
    if (mayPick) {
      note = p.chosenId
        ? `You can change your pick until the pick closes${p.deadline ? ` at ${clock(p.deadline)}` : ""}.`
        : `Pick one of the three cards${by}. If you do not pick, the first card is chosen for you.`;
    } else {
      note = `The Product team picks one card${by}. If it does not pick, the first card is chosen.`;
    }
  } else if (defaultPending) {
    note = "No card was picked before the pick closed: the first card dealt is being chosen by default.";
  } else if (p.byDefault) {
    note = "No card was picked before the pick closed, so the first card dealt was chosen by default.";
  } else {
    note = "The pick has closed.";
  }
  return {
    open,
    mayPick,
    canPick: open && mayPick,
    chosenId: p.chosenId ?? (defaultPending ? first : null),
    byDefault: p.byDefault || defaultPending,
    defaultPending,
    note,
  };
}

// ───────────── Drafts and submissions ─────────────

export type Content = Record<string, unknown>;

export interface DraftRow {
  type: SubmissionType;
  content: Content;
  version: number;
  updated_at: string;
  updated_by_team: string | null;
}

export interface SubmissionRow {
  id: string;
  type: SubmissionType;
  content: Content;
  word_count: number;
  submitted_at: string;
  submitted_by_team: string;
  superseded_at: string | null;
}

/** Key order does not matter (jsonb equality, as submit_submission compares the draft with the last submission). */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export function sameContent(a: Content | null | undefined, b: Content | null | undefined): boolean {
  return canonical(a ?? {}) === canonical(b ?? {});
}

/** The current (judged) submission of a type: the one not superseded. */
export function currentSubmission(subs: readonly SubmissionRow[], type: SubmissionType): SubmissionRow | null {
  return subs.find((s) => s.type === type && s.superseded_at === null) ?? null;
}

/** Submitted after its deadline (the database refuses that, so this only shows if a deadline moved earlier). */
export function submittedLate(submittedAt: string, deadline: string | null, p: PauseState): boolean {
  return !!deadline && !deadlineFrozen(deadline, p) && Date.parse(submittedAt) > Date.parse(deadline);
}

export interface SubmissionStatus {
  type: SubmissionType;
  label: string;
  /** The saved draft (null before the first save). */
  draft: { version: number; savedAt: string; by: string | null; words: number } | null;
  /** The submitted version that will be judged. */
  current: { submittedAt: string; by: string; words: number; late: boolean } | null;
  /** Earlier submitted versions, replaced by a later submission. */
  superseded: number;
  /** The saved draft differs from the submitted version (the draft is not judged unless submitted). */
  changedSinceSubmit: boolean;
  state: { text: string; tone: Tone };
}

export function submissionStatus(
  type: SubmissionType,
  draft: DraftRow | null | undefined,
  subs: readonly SubmissionRow[],
  win: SubmissionWindow,
  p: PauseState,
): SubmissionStatus {
  const mine = subs.filter((s) => s.type === type);
  const cur = currentSubmission(mine, type);
  const saved = draft && draft.version > 0 ? draft : null;
  const changedSinceSubmit = !!cur && !!saved && !sameContent(saved.content, cur.content);
  let state: SubmissionStatus["state"];
  if (cur) {
    state = changedSinceSubmit && win.stage === "OPEN" ? { text: "Submitted · draft changed since", tone: "amber" } : { text: "Submitted", tone: "green" };
  } else if (win.stage === "CLOSED") {
    state = { text: "Not submitted · scores 0", tone: "red" };
  } else if (win.stage === "BEFORE") {
    state = { text: "Not open yet", tone: "slate" };
  } else {
    state = saved ? { text: "Draft saved · not submitted", tone: "amber" } : { text: "Not started", tone: "slate" };
  }
  return {
    type,
    label: SUBMISSION_LABELS[type],
    draft: saved ? { version: saved.version, savedAt: saved.updated_at, by: saved.updated_by_team, words: submissionWords(type, saved.content) } : null,
    current: cur
      ? { submittedAt: cur.submitted_at, by: cur.submitted_by_team, words: cur.word_count, late: submittedLate(cur.submitted_at, win.deadline, p) }
      : null,
    superseded: mine.filter((s) => s.superseded_at !== null).length,
    changedSinceSubmit,
    state,
  };
}

export interface SubmissionVersion {
  id: string;
  submittedAt: string;
  by: string;
  words: number;
  /** The version that will be judged (the one not superseded). */
  current: boolean;
  late: boolean;
  content: Content;
}

/** Every submitted version of a type, newest first: the current (judged) one and those it superseded. */
export function submissionVersions(subs: readonly SubmissionRow[], type: SubmissionType, deadline: string | null, p: PauseState): SubmissionVersion[] {
  return subs
    .filter((s) => s.type === type)
    .sort((a, b) => Date.parse(b.submitted_at) - Date.parse(a.submitted_at))
    .map((s) => ({
      id: s.id,
      submittedAt: s.submitted_at,
      by: s.submitted_by_team,
      words: s.word_count,
      current: s.superseded_at === null,
      late: submittedLate(s.submitted_at, deadline, p),
      content: s.content,
    }));
}

// ───────────── The plan's deadline and cap (app.final_score: late → 0, cap 50 without the deal) ─────────────

/** Within this many event minutes of the plan deadline, its notice turns red. */
export const PLAN_URGENT_MINUTES = 15;

/** What the plan's hard deadline means for this squad now: before it, a warning (red when near); after it, the outcome. */
export function planDeadline(
  submittedAt: string | null,
  deadline: string | null,
  nowMs: number,
  p: PauseState,
  clockSpeed = 1,
): { text: string; tone: Tone } {
  const at = deadline ? clock(deadline) : "the deadline";
  if (deadlinePassed(deadline, nowMs, p)) {
    return submittedAt
      ? { text: `The plan closed at ${at}. The version submitted at ${clock(submittedAt, true)} is the one judged.`, tone: "slate" }
      : { text: `No plan was submitted by ${at}: the plan scores 0.`, tone: "red" };
  }
  const near = !!deadline && !deadlineFrozen(deadline, p) && Date.parse(deadline) - nowMs <= (PLAN_URGENT_MINUTES * 60_000) / clockSpeed;
  const status = submittedAt
    ? ` Your squad submitted at ${clock(submittedAt, true)}; submit again to replace that version.`
    : " Your squad has not submitted a plan yet.";
  return {
    text: `Hard deadline ${at}: only a version submitted by then is judged; a late or missing plan scores 0.${status}`,
    tone: near ? "red" : "amber",
  };
}

export interface DealRow {
  executed_at: string | null;
  signed_product_at: string | null;
  signed_consulting_at: string | null;
  signed_finance_at: string | null;
}

/**
 * Is the plan safe from the cap at 50 (the deal fully signed by the deal deadline, app.deal_signed_in_time), and how
 * to say it: before the deadline as a warning, after it as the outcome.
 */
export function planCap(
  deal: DealRow | null | undefined,
  dealDeadline: string | null,
  nowMs: number,
  p: PauseState,
): { safe: boolean; text: string; tone: Tone } {
  const by = dealDeadline ? clock(dealDeadline) : "the deadline";
  if (deal?.executed_at && dealDeadline && Date.parse(deal.executed_at) <= Date.parse(dealDeadline)) {
    return { safe: true, text: `The deal was fully signed at ${clock(deal.executed_at)}: the plan score is not capped.`, tone: "green" };
  }
  if (deadlinePassed(dealDeadline, nowMs, p)) {
    return { safe: false, text: `The deal was not fully signed by ${by}: the plan score is capped at 50.`, tone: "red" };
  }
  const signed = deal ? [deal.signed_product_at, deal.signed_consulting_at, deal.signed_finance_at].filter(Boolean).length : 0;
  return {
    safe: false,
    text: `The deal is not fully signed yet (${signed} of 3 signatures). If it is not fully signed by ${by}, the plan score is capped at 50.`,
    tone: "amber",
  };
}
