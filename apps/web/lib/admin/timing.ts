// The Event timing panel's arithmetic, kept pure: what an organiser's edits change, how long the current phase has
// run and has left, the timeline's segments and the log's wording. The database decides every time (app.reproject);
// this only turns what it returned into what the panel shows, and the organiser's draft into a change to send.

import { PHASE_LABELS, type PhaseCode } from "@msim/engine";
import type { TimingChange } from "@/lib/team/alerts";

export type { TimingChange };

export interface PhaseTiming {
  code: PhaseCode;
  seq: number;
  duration_seconds: number | null;
  starts_at: string | null;
  ends_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  paused_seconds: number;
  extended_seconds: number;
}

export interface RoundTiming {
  number: number;
  phase: "MARKET_BLIND" | "MARKET";
  status: "SCHEDULED" | "OPEN" | "CLOSED" | "CLEARED";
  duration_seconds: number;
  opens_at: string | null;
  closes_at: string | null;
  opened_at: string | null;
  closed_at: string | null;
  paused_seconds: number;
  extended_seconds: number;
}

/** What set_timing takes (seconds; a phase set to null is untimed). */
export interface TimingChanges {
  phases?: Partial<Record<PhaseCode, number | null>>;
  rounds?: Record<string, number>;
  twist_offset_seconds?: number;
  freeze_offset_seconds?: number;
  /** Lengthens what is running now (the open round, or the current phase). */
  extend_seconds?: number;
}

/** The panel's draft: minutes as typed, per row; "" for an untimed phase. Only rows the organiser touched are in it. */
export interface TimingDraft {
  phases: Partial<Record<PhaseCode, string>>;
  rounds: Record<string, string>;
  twist?: string;
  freeze?: string;
}

export const TRADING_PHASES: readonly PhaseCode[] = ["MARKET_BLIND", "MARKET"];
/** Phases whose length an organiser cannot set: Setup ends when the night starts; trading lasts as long as its rounds. */
export const FIXED_PHASES: readonly PhaseCode[] = ["SETUP", ...TRADING_PHASES];

export const PHASE_LIMITS = { min: 0.5, max: 720 } as const; // minutes: 30 s to 12 h
export const ROUND_LIMITS = { min: 0.5, max: 120 } as const; // minutes: 30 s to 2 h

/** Minutes for an input box: whole minutes, or up to one decimal for a rehearsal's short phases. */
export function toMinutes(seconds: number | null): string {
  if (seconds === null) return "";
  const m = seconds / 60;
  return Number.isInteger(m) ? String(m) : String(Math.round(m * 10) / 10);
}

/** Typed minutes to seconds, or an error in the organiser's words. */
export function parseMinutes(text: string, limits: { min: number; max: number }): { seconds: number } | { error: string } {
  const t = text.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return { error: "Enter minutes, like 45 or 1.5." };
  const m = Number(t);
  if (m < limits.min || m > limits.max) return { error: `From ${limits.min} to ${limits.max} minutes.` };
  return { seconds: Math.round(m * 60) };
}

/**
 * The change the draft makes against what the database holds: only what differs, so an untouched row (or one typed
 * back to its value) sends nothing. Returns the errors per row instead when any entry is not a valid duration.
 */
export function draftChanges(
  draft: TimingDraft,
  phases: PhaseTiming[],
  rounds: RoundTiming[],
  offsets: { twist_offset_seconds: number; freeze_offset_seconds: number },
): { changes: TimingChanges; count: number; errors: Record<string, string> } {
  const changes: TimingChanges = {};
  const errors: Record<string, string> = {};
  let count = 0;
  for (const [code, text] of Object.entries(draft.phases) as [PhaseCode, string][]) {
    const row = phases.find((p) => p.code === code);
    if (!row || FIXED_PHASES.includes(code) || row.ended_at) continue;
    let secs: number | null;
    if (text === "") secs = null;
    else {
      const p = parseMinutes(text, PHASE_LIMITS);
      if ("error" in p) {
        errors[`phase:${code}`] = p.error;
        continue;
      }
      secs = p.seconds;
    }
    if (secs === row.duration_seconds) continue;
    (changes.phases ??= {})[code] = secs;
    count++;
  }
  for (const [n, text] of Object.entries(draft.rounds)) {
    const row = rounds.find((r) => String(r.number) === n);
    if (!row || row.status === "CLOSED" || row.status === "CLEARED") continue;
    const p = parseMinutes(text, ROUND_LIMITS);
    if ("error" in p) {
      errors[`round:${n}`] = p.error;
      continue;
    }
    if (p.seconds === row.duration_seconds) continue;
    (changes.rounds ??= {})[n] = p.seconds;
    count++;
  }
  for (const [field, key, limits] of [
    ["twist", "twist_offset_seconds", { min: 0, max: 720 }],
    ["freeze", "freeze_offset_seconds", { min: 0, max: 720 }],
  ] as const) {
    const text = draft[field];
    if (text === undefined) continue;
    const p = parseMinutes(text, limits);
    if ("error" in p) {
      errors[field] = p.error;
      continue;
    }
    if (p.seconds === offsets[key]) continue;
    changes[key] = p.seconds;
    count++;
  }
  return { changes, count, errors };
}

/** How long the current phase has run, not counting pauses (frozen while paused). */
export function elapsedMs(phase: Pick<PhaseTiming, "started_at" | "paused_seconds"> | undefined, now: number): number | null {
  if (!phase?.started_at) return null;
  return Math.max(0, now - Date.parse(phase.started_at) - phase.paused_seconds * 1000);
}

/** "1:05:09" or "4:09" for a span; "—" for none. */
export function span(ms: number | null): string {
  if (ms === null) return "—";
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export interface Segment {
  code: PhaseCode;
  label: string;
  /** Seconds: the planned (or, once ended, the actual) length; null for an untimed phase. */
  seconds: number | null;
  state: "done" | "current" | "ahead";
  /** 0–1 through the current phase. */
  progress: number;
}

/**
 * The timeline: one segment per phase after Setup. A trading phase is as long as its rounds; an ended phase shows
 * how long it actually ran.
 */
export function timelineSegments(phases: PhaseTiming[], rounds: RoundTiming[], current: PhaseCode, now: number): Segment[] {
  return phases
    .filter((p) => p.code !== "SETUP")
    .map((p) => {
      const state: Segment["state"] = p.ended_at ? "done" : p.code === current ? "current" : "ahead";
      let seconds: number | null;
      if (p.ended_at && p.started_at) seconds = Math.max(1, (Date.parse(p.ended_at) - Date.parse(p.started_at)) / 1000);
      else if (TRADING_PHASES.includes(p.code))
        seconds = rounds.filter((r) => r.phase === p.code).reduce((s, r) => s + r.duration_seconds + r.paused_seconds + r.extended_seconds, 0);
      else seconds = p.duration_seconds === null ? null : p.duration_seconds + p.paused_seconds + p.extended_seconds;
      let progress = state === "done" ? 1 : 0;
      if (state === "current" && p.starts_at && p.ends_at) {
        const total = Date.parse(p.ends_at) - Date.parse(p.starts_at);
        progress = total > 0 ? Math.min(1, Math.max(0, (now - Date.parse(p.starts_at)) / total)) : 1;
      }
      return { code: p.code, label: PHASE_LABELS[p.code], seconds, state, progress };
    });
}

export const TIMING_ACTION_LABELS: Record<string, string> = {
  start: "Started the night",
  end_phase: "Ended a phase",
  pause: "Paused",
  resume: "Resumed",
  extend: "Extended",
  set_timing: "Changed durations",
  close_round: "Closed a round early",
  mode_auto: "Advance when timer expires",
  mode_manual: "Manual advance",
  end_event: "Ended the night",
};

export interface TimingLogEntry {
  at: string;
  action: string;
  actor_role: string | null;
  after: { changes?: TimingChange[]; detail?: Record<string, unknown>; version?: number } | null;
}

/** One line of the timing log: what was done, in a few words. */
export function logSummary(e: TimingLogEntry): string {
  const action = e.action.replace(/^timing:/, "");
  const d = e.after?.detail ?? {};
  const label = TIMING_ACTION_LABELS[action] ?? action;
  switch (action) {
    case "end_phase":
      return `${label}: ${PHASE_LABELS[d.from as PhaseCode] ?? d.from} → ${PHASE_LABELS[d.to as PhaseCode] ?? d.to}`;
    case "extend":
      return typeof d.extend_seconds === "number" ? `${label} by ${toMinutes(d.extend_seconds)} min` : label;
    case "resume":
      return typeof d.paused_seconds === "number" ? `${label} after ${span(d.paused_seconds * 1000)}` : label;
    case "close_round":
      return `${label}: round ${d.round} (${d.mode === "CANCEL" ? `cancelled ${d.cancelled ?? 0} pending orders` : "pending orders filled"})`;
    default:
      return label;
  }
}
