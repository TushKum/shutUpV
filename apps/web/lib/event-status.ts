// Where an event is (event_status): what every screen's header shows. Anyone who can see the event may read it.

import { cache } from "react";
import type { DeadlineCode, PhaseCode } from "@msim/engine";
import type { TimingChange } from "@/lib/team/alerts";
import { supabaseServer } from "@/lib/supabase/server";

export interface EventStatus {
  phase: PhaseCode;
  next_phase: PhaseCode | null;
  gate: string | null;
  paused: boolean;
  paused_at: string | null;
  auto_advance: boolean;
  trading: "OPEN" | "HALTED" | "PAUSED";
  phase_started_at: string | null;
  /** Projected from when the phase actually started, its duration, pauses and extensions; null when untimed. */
  phase_ends_at: string | null;
  /** An untimed phase stays open until an organiser ends it. */
  phase_untimed: boolean;
  phase_paused_seconds: number;
  open_round: { number: number; closes_at: string } | null;
  next_round: { number: number; opens_at: string } | null;
  next_deadline: { code: DeadlineCode; at: string } | null;
  drawn: boolean;
  leaderboard_frozen: boolean;
  /** When an organiser started the night (left Setup), and ended it (from the awards). */
  started_at: string | null;
  ended_at: string | null;
  /** The projected end of the night, or (when something ahead is untimed) the phase after which it is unknown. */
  event_ends_at: string | null;
  event_ends_after: PhaseCode | null;
  /** Bumped by every organiser timing change; sent back with each change so a stale console is refused. */
  timing_version: number;
  timing_changed_at: string | null;
  timing_change: { action: string; at: string; changes: TimingChange[] } | null;
  server_time: string;
}

export const loadEventStatus = cache(async (eventId: string): Promise<EventStatus> => {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("event_status", { p_event: eventId });
  if (error) throw new Error(`event_status: ${error.message}`);
  return data as EventStatus;
});
