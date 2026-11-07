// The planned timetable of the night, in event minutes after 20:00 (Asia/Kolkata). Organisers start the night and
// control its timing; these are the default durations (buildSchedule), and the clock helpers read a planned time.
// clockSpeed 10 in rehearsal: 1 real minute = 10 event minutes.

import type { DeadlineCode, PhaseCode, TradingPhase } from "./types";

export interface PhaseSlot {
  code: PhaseCode;
  start: number;
  end: number;
}

export interface RoundSlot {
  number: number;
  phase: TradingPhase;
  start: number;
  end: number;
}

export interface DeadlineSlot {
  code: DeadlineCode;
  at: number;
}

/** 20:00 = minute 0, 06:00 = minute 600. */
export const DEFAULT_PHASES: readonly PhaseSlot[] = [
  { code: "SETUP", start: -60, end: 0 },
  { code: "CHECKIN", start: 0, end: 45 }, // 20:00
  { code: "BRIEFING", start: 45, end: 75 }, // 20:45
  { code: "BUILD", start: 75, end: 180 }, // 21:15: problem cards; 22:15 the twist; 23:00 the PRD lock
  { code: "JUDGING_1", start: 180, end: 210 }, // 23:00
  { code: "REVEAL_1", start: 210, end: 225 }, // 23:30: starting prices
  { code: "CRISIS_QA", start: 225, end: 255 }, // 23:45: the crisis, the rescue circle, the Q&A board
  { code: "RESCUE", start: 255, end: 345 }, // 00:15: crisis solutions; 01:45 the lock
  { code: "JUDGING_2", start: 345, end: 375 }, // 01:45
  { code: "MARKET_BLIND", start: 375, end: 405 }, // 02:15: solutions published; rounds 1–2
  { code: "MARKET", start: 405, end: 510 }, // 02:45: the score reveal; rounds 3–9; 03:30 the leaderboard freezes
  { code: "SETTLEMENT", start: 510, end: 555 }, // 04:30: the closing bell
  { code: "AWARDS", start: 555, end: 600 }, // 05:15
];

/** Nine rounds of 15 minutes, 02:15–04:30. */
export const DEFAULT_ROUNDS: readonly RoundSlot[] = Array.from({ length: 9 }, (_, i) => ({
  number: i + 1,
  phase: i < 2 ? "MARKET_BLIND" : "MARKET",
  start: 375 + i * 15,
  end: 375 + (i + 1) * 15,
}));

export const DEFAULT_DEADLINES: readonly DeadlineSlot[] = [
  { code: "PROBLEM_DRAW", at: 75 }, // 21:15
  { code: "TWIST", at: 135 }, // 22:15
  { code: "PRD_LOCK", at: 180 }, // 23:00
  { code: "QA_CLOSE", at: 255 }, // 00:15
  { code: "SOLUTION_LOCK", at: 345 }, // 01:45
  { code: "LEADERBOARD_FREEZE", at: 450 }, // 03:30
  { code: "MARKET_CLOSE", at: 510 }, // 04:30
];

export function eventMinuteToReal(startsAt: Date, minute: number, clockSpeed = 1): Date {
  if (!Number.isInteger(clockSpeed) || clockSpeed < 1) throw new Error("clockSpeed must be a positive integer");
  return new Date(startsAt.getTime() + Math.round((minute * 60_000) / clockSpeed));
}

/** Event clock reading (minutes after 20:00) for a real instant. */
export function realToEventMinute(startsAt: Date, at: Date, clockSpeed = 1): number {
  return ((at.getTime() - startsAt.getTime()) * clockSpeed) / 60_000;
}

/** "HH:MM" on the event clock for a minute offset from 20:00. */
export function formatEventMinute(minute: number): string {
  const total = (((20 * 60 + Math.floor(minute)) % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * The night's timing as the database keeps it: durations, not clock times. Nothing has a time until an organiser
 * starts the event; every time is then projected from when each phase actually started.
 *   • A phase's duration is null when it has none: Setup (the event starts when an organiser starts it), the trading
 *     phases (they last as long as their rounds) and the awards (open until an organiser ends the event).
 *   • The twist and the leaderboard freeze are offsets from the start of Build and of Market.
 */
export interface BuiltSchedule {
  phases: { seq: number; code: PhaseCode; duration_seconds: number | null }[];
  rounds: { number: number; phase: TradingPhase; duration_seconds: number }[];
  twist_offset_seconds: number;
  freeze_offset_seconds: number;
}

/** Phases with no duration of their own (see BuiltSchedule). */
export const UNTIMED_PHASES: readonly PhaseCode[] = ["SETUP", "MARKET_BLIND", "MARKET", "AWARDS"];

const seconds = (minutes: number, clockSpeed: number) => Math.max(30, Math.round((minutes * 60) / clockSpeed));

/** The default durations of the night (the planned 20:00–06:00 timetable), faster by `clockSpeed` in rehearsal. */
export function buildSchedule(clockSpeed = 1): BuiltSchedule {
  if (!Number.isInteger(clockSpeed) || clockSpeed < 1) throw new Error("clockSpeed must be a positive integer");
  const at = (code: DeadlineCode) => DEFAULT_DEADLINES.find((d) => d.code === code)!.at;
  const start = (code: PhaseCode) => DEFAULT_PHASES.find((p) => p.code === code)!.start;
  return {
    phases: DEFAULT_PHASES.map((p, seq) => ({
      seq,
      code: p.code,
      duration_seconds: UNTIMED_PHASES.includes(p.code) ? null : seconds(p.end - p.start, clockSpeed),
    })),
    rounds: DEFAULT_ROUNDS.map((r) => ({ number: r.number, phase: r.phase, duration_seconds: seconds(r.end - r.start, clockSpeed) })),
    twist_offset_seconds: seconds(at("TWIST") - start("BUILD"), clockSpeed),
    freeze_offset_seconds: seconds(at("LEADERBOARD_FREEZE") - start("MARKET"), clockSpeed),
  };
}

/**
 * Event 20:00 on a calendar date in Asia/Kolkata (UTC+05:30, no daylight saving).
 * @param date "YYYY-MM-DD"
 */
export function eventStartIST(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`expected YYYY-MM-DD, got ${date}`);
  return new Date(`${date}T20:00:00+05:30`);
}
