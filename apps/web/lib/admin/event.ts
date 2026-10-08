// The event an admin page is about, by slug (staff read every event through RLS), once per request.

import { cache } from "react";
import { notFound } from "next/navigation";
import type { PhaseCode } from "@msim/engine";
import { supabaseServer } from "@/lib/supabase/server";

export interface AdminEvent {
  id: string;
  slug: string;
  name: string;
  is_rehearsal: boolean;
  clock_speed: number;
  starts_at: string;
  current_phase: PhaseCode;
  paused: boolean;
  paused_at: string | null;
  auto_advance: boolean;
  seed_commitment: string | null;
  seed_revealed: string | null;
  dice: string | null;
  drawn_at: string | null;
}

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

export const loadAdminEvent = cache(async (slug: string): Promise<AdminEvent> => {
  const sb = await supabaseServer();
  const { data } = await sb
    .from("events")
    .select("id, slug, name, is_rehearsal, clock_speed, starts_at, current_phase, paused, paused_at, auto_advance, seed_commitment, seed_revealed, dice, drawn_at")
    .eq("slug", slug)
    .maybeSingle<AdminEvent>();
  if (!data) notFound();
  return data;
});

export const loadEventStatus = cache(async (eventId: string): Promise<EventStatus> => {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("event_status", { p_event: eventId });
  if (error) throw new Error(`event_status: ${error.message}`);
  return data as EventStatus;
});
