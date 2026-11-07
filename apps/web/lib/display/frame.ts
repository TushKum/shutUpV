// What every frame of the big screen needs, read as the display account (RLS: the public set only, never a team's
// private rows): the event, where it is (event_status), the latest bulletin, the twist and the moments that start
// takeovers.

import { cache } from "react";
import { notFound } from "next/navigation";
import type { PhaseCode } from "@msim/engine";
import { supabaseServer } from "@/lib/supabase/server";
import { loadEventStatus, type EventStatus } from "@/lib/event-status";
import type { TakeoverMoments } from "./takeover";

export interface DisplayEvent {
  id: string;
  slug: string;
  name: string;
  is_rehearsal: boolean;
  clock_speed: number;
  current_phase: PhaseCode;
  phase_started_at: string | null;
  seed_commitment: string | null;
  seed_revealed: string | null;
  dice: string | null;
  drawn_at: string | null;
  prices_started_at: string | null;
  crisis_applied_at: string | null;
  scores_revealed_at: string | null;
  market_closed_at: string | null;
  leaderboard_frozen_at: string | null;
}

export interface DisplayBulletin {
  id: string;
  kind: string;
  title: string;
  body: string;
  published_at: string;
}

export interface DisplayFrame {
  event: DisplayEvent;
  status: EventStatus;
  bulletin: DisplayBulletin | null;
  moments: TakeoverMoments;
}

export const loadDisplayEvent = cache(async (slug: string): Promise<DisplayEvent> => {
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from("events")
    .select(
      "id, slug, name, is_rehearsal, clock_speed, current_phase, phase_started_at, seed_commitment, seed_revealed, dice, drawn_at, prices_started_at, crisis_applied_at, scores_revealed_at, market_closed_at, leaderboard_frozen_at",
    )
    .eq("slug", slug)
    .maybeSingle<DisplayEvent>();
  if (error) throw new Error(`Could not read the event: ${error.message}`);
  if (!data) notFound();
  return data;
});

export async function loadDisplayFrame(slug: string): Promise<DisplayFrame> {
  const event = await loadDisplayEvent(slug);
  const sb = await supabaseServer();
  const [status, latest, twist] = await Promise.all([
    loadEventStatus(event.id),
    sb
      .from("bulletins")
      .select("id, kind, title, body, published_at")
      .eq("event_id", event.id)
      .not("published_at", "is", null)
      .lte("published_at", new Date().toISOString())
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle<DisplayBulletin>(),
    loadTwist(event.id),
  ]);
  if (latest.error) throw new Error(`Could not read the screen: ${latest.error.message}`);
  return {
    event,
    status,
    bulletin: latest.data ?? null,
    moments: {
      twistAt: twist?.published_at ?? null,
      pricesAt: event.prices_started_at,
      crisisAt: event.crisis_applied_at,
      revealAt: event.scores_revealed_at,
      closedAt: event.market_closed_at,
      awardsAt: event.current_phase === "AWARDS" ? (event.phase_started_at ?? status.server_time) : null,
    },
  };
}

/** The twist once it is published (22:15); null before. An organiser sees the draft too, so the filter is explicit. */
export const loadTwist = cache(async (eventId: string): Promise<DisplayBulletin | null> => {
  const sb = await supabaseServer();
  const r = await sb
    .from("bulletins")
    .select("id, kind, title, body, published_at")
    .eq("event_id", eventId)
    .eq("kind", "TWIST")
    .not("published_at", "is", null)
    .lte("published_at", new Date().toISOString())
    .maybeSingle<DisplayBulletin>();
  if (r.error) throw new Error(`Could not read the twist: ${r.error.message}`);
  return r.data ?? null;
});
