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

export { loadEventStatus, type EventStatus } from "@/lib/event-status";
