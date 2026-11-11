// Where an event is (event_status): what every screen's header shows. Anyone who can see the event may read it.

import { cache } from "react";
import type { PhaseCode } from "@msim/engine";
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
  phase_ends_at: string | null;
  open_round: { number: number; closes_at: string } | null;
  next_round: { number: number; opens_at: string } | null;
  drawn: boolean;
  server_time: string;
}

export const loadEventStatus = cache(async (eventId: string): Promise<EventStatus> => {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("event_status", { p_event: eventId });
  if (error) throw new Error(`event_status: ${error.message}`);
  return data as EventStatus;
});
