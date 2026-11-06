// The default timetable of the night, in event minutes after 20:00 (Asia/Kolkata).
// Real time = startsAt + minutes ÷ clockSpeed (clockSpeed 10 in rehearsal: 1 real minute = 10 event minutes).

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

export interface BuiltSchedule {
  phases: { seq: number; code: PhaseCode; starts_at: string; ends_at: string }[];
  rounds: { number: number; phase: TradingPhase; opens_at: string; closes_at: string }[];
  deadlines: { code: DeadlineCode; at: string }[];
}

/** Concrete timestamps for an event that starts (event 20:00) at `startsAt`. */
export function buildSchedule(startsAt: Date, clockSpeed = 1): BuiltSchedule {
  const at = (m: number) => eventMinuteToReal(startsAt, m, clockSpeed).toISOString();
  return {
    phases: DEFAULT_PHASES.map((p, seq) => ({ seq, code: p.code, starts_at: at(p.start), ends_at: at(p.end) })),
    rounds: DEFAULT_ROUNDS.map((r) => ({ number: r.number, phase: r.phase, opens_at: at(r.start), closes_at: at(r.end) })),
    deadlines: DEFAULT_DEADLINES.map((d) => ({ code: d.code, at: at(d.at) })),
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
