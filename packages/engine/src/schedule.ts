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
  { code: "CHECKIN", start: 0, end: 30 },
  { code: "BRIEFING", start: 30, end: 60 },
  { code: "SQUAD_DRAW", start: 60, end: 70 },
  { code: "BUILD", start: 70, end: 150 },
  { code: "READING", start: 150, end: 195 },
  { code: "IPO", start: 195, end: 210 },
  { code: "ROUNDS_1_4", start: 210, end: 270 },
  { code: "CRISIS", start: 270, end: 285 },
  { code: "RESCUE_1", start: 285, end: 345 },
  { code: "BREAK", start: 345, end: 360 },
  { code: "RESCUE_2", start: 360, end: 420 },
  { code: "PLANS_PUBLISHED", start: 420, end: 450 },
  { code: "VERDICTS", start: 450, end: 450 },
  { code: "ROUNDS_13_21", start: 450, end: 540 },
  { code: "CLOSE", start: 540, end: 540 },
  { code: "SETTLEMENT", start: 540, end: 570 },
  { code: "APPEALS", start: 570, end: 580 },
  { code: "AWARDS", start: 580, end: 600 },
];

function rounds(first: number, count: number, phase: TradingPhase, start: number, length: number): RoundSlot[] {
  return Array.from({ length: count }, (_, i) => ({
    number: first + i,
    phase,
    start: start + i * length,
    end: start + (i + 1) * length,
  }));
}

export const DEFAULT_ROUNDS: readonly RoundSlot[] = [
  ...rounds(1, 4, "ROUNDS_1_4", 210, 15), // 23:30–00:30
  ...rounds(5, 4, "RESCUE_1", 285, 15), // 00:45–01:45
  ...rounds(9, 4, "RESCUE_2", 360, 15), // 02:00–03:00
  ...rounds(13, 9, "ROUNDS_13_21", 450, 10), // 03:30–05:00
];

export const DEFAULT_DEADLINES: readonly DeadlineSlot[] = [
  { code: "PROBLEM_PICK", at: 70 }, // 21:10
  { code: "PITCH", at: 150 }, // 22:30
  { code: "CALL_1", at: 195 }, // 23:15
  { code: "IPO_BIDS", at: 210 }, // 23:30
  { code: "FEE", at: 305 }, // 01:05
  { code: "DEAL_BONUS", at: 405 }, // 02:45
  { code: "DEAL", at: 420 }, // 03:00
  { code: "PLAN", at: 420 }, // 03:00
  { code: "CALL_2", at: 460 }, // 03:40
  { code: "FLASH_BULLETIN", at: 480 }, // 04:00
  { code: "FLASH", at: 495 }, // 04:15
  { code: "FLASH_TIER", at: 500 }, // 04:20, after round 17 clears
  { code: "CALL_3", at: 510 }, // 04:30
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
