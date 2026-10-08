// The health view's pure logic: the backend summary from admin_health, the heartbeat's state, which teams have a
// screen connected (a ping in the last 60 seconds) and which have none, and this console's clock offset.

import type { Track } from "@msim/engine";

/** A screen counts as connected when its heartbeat (every 20 s) was seen in the last minute. */
export const CONNECTED_MS = 60_000;

export interface CronHealth {
  lastStart: string | null;
  lastEnd: string | null;
  runsLast10Min: number;
  failedLast10Min: number;
  lastError: string | null;
}

export interface ScreenCount {
  area: string;
  role: string;
  connected: number;
  realtimeOk: number;
}

export interface AdminHealth {
  serverTime: string;
  /** null where pg_cron is not installed. */
  cron: CronHealth | null;
  tickErrorsLastHour: number;
  screens: ScreenCount[];
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : 0;
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** admin_health's result (the rpc's data, without ok) as typed values. */
export function parseHealth(data: Record<string, unknown> | undefined): AdminHealth {
  const d = data ?? {};
  const c = d.cron && typeof d.cron === "object" ? (d.cron as Record<string, unknown>) : null;
  const screens = Array.isArray(d.screens) ? (d.screens as Record<string, unknown>[]) : [];
  return {
    serverTime: str(d.server_time) ?? new Date(0).toISOString(),
    cron: c
      ? {
          lastStart: str(c.last_start),
          lastEnd: str(c.last_end),
          runsLast10Min: num(c.runs_last_10min),
          failedLast10Min: num(c.failed_last_10min),
          lastError: str(c.last_error),
        }
      : null,
    tickErrorsLastHour: num(d.tick_errors_last_hour),
    screens: screens.map((s) => ({ area: String(s.area ?? ""), role: String(s.role ?? ""), connected: num(s.connected), realtimeOk: num(s.realtime_ok) })),
  };
}

export type Tone = "green" | "amber" | "red";

/** How the database heartbeat (pg_cron, every 2 seconds) is doing, as one line. */
export function cronState(cron: CronHealth | null, serverMs: number): { tone: Tone; label: string } {
  if (!cron) return { tone: "red", label: "pg_cron is not installed: only an open organiser console ticks the game." };
  if (!cron.lastStart) return { tone: "red", label: "The heartbeat has not run in the last hour." };
  const age = Math.max(0, serverMs - new Date(cron.lastStart).getTime());
  if (age > 10_000) return { tone: "red", label: `No heartbeat for ${ago(age)}.` };
  if (cron.failedLast10Min > 0) {
    return { tone: "amber", label: `${cron.failedLast10Min} failed run${cron.failedLast10Min === 1 ? "" : "s"} in the last 10 minutes.` };
  }
  return { tone: "green", label: "Running every 2 seconds." };
}

/** "8 s", "3 min", "2 h" (whole units, rounded down). */
export function ago(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  return `${Math.floor(s / 3600)} h`;
}

/** "12 s ago" against the server clock, or "never". */
export function seenAgo(at: string | null | undefined, serverMs: number): string {
  if (!at) return "never";
  return `${ago(serverMs - new Date(at).getTime())} ago`;
}

export interface PingRow {
  client_id: string;
  team_id: string | null;
  role: string;
  area: string;
  realtime: string;
  first_seen: string;
  last_seen: string;
}

export interface HealthTeam {
  id: string;
  code: string;
  track: Track;
}

export interface TeamScreen {
  clientId: string;
  code: string;
  track: Track;
  area: string;
  realtime: string;
  firstSeen: string;
  lastSeen: string;
}

export interface SilentTeam {
  code: string;
  track: Track;
  /** The last time any of its screens was seen, if ever. */
  lastSeen: string | null;
}

/**
 * Team screens seen in the last minute (one row per browser tab, by team code) and the teams with none, with the
 * last time any of their screens was seen.
 */
export function teamScreens(
  teams: readonly HealthTeam[],
  pings: readonly PingRow[],
  serverMs: number,
  windowMs = CONNECTED_MS,
): { connected: TeamScreen[]; silent: SilentTeam[] } {
  const byId = new Map(teams.map((t) => [t.id, t]));
  const latest = new Map<string, string>();
  const connected: TeamScreen[] = [];
  for (const p of pings) {
    const team = p.team_id ? byId.get(p.team_id) : undefined;
    if (!team) continue;
    const prev = latest.get(team.id);
    if (!prev || new Date(p.last_seen).getTime() > new Date(prev).getTime()) latest.set(team.id, p.last_seen);
    if (serverMs - new Date(p.last_seen).getTime() <= windowMs) {
      connected.push({ clientId: p.client_id, code: team.code, track: team.track, area: p.area, realtime: p.realtime, firstSeen: p.first_seen, lastSeen: p.last_seen });
    }
  }
  const live = new Set(connected.map((c) => c.code));
  const silent = teams
    .filter((t) => !live.has(t.code))
    .map((t) => ({ code: t.code, track: t.track, lastSeen: latest.get(t.id) ?? null }))
    .sort((a, b) => a.code.localeCompare(b.code));
  connected.sort((a, b) => a.code.localeCompare(b.code) || b.lastSeen.localeCompare(a.lastSeen));
  return { connected, silent };
}

/**
 * This browser's clock against the server's. `offsetMs` = server − browser: positive means the browser is behind.
 * Countdowns use the server clock either way; a large offset only means this machine's own clock is wrong.
 */
export function describeOffset(offsetMs: number): { tone: Tone; label: string } {
  const abs = Math.abs(offsetMs);
  if (abs < 100) return { tone: "green", label: "In step with the server (within 0.1 s)." };
  const secs = abs < 10_000 ? (abs / 1000).toFixed(1) : String(Math.round(abs / 1000));
  return { tone: abs < 2_000 ? "green" : "amber", label: `This browser's clock is ${secs} s ${offsetMs > 0 ? "behind" : "ahead of"} the server.` };
}
