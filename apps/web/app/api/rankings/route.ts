// GET /api/rankings[?event=<id>] — final values, ranks and awards.
// Teams read their own event; staff and the display pass ?event=. 401 when signed out, 403 before the reveal
// (teams and the display: AWARDS; organisers and the fairness officer: SETTLEMENT). Row-level security applies the
// same rule in the database, so this check is a second lock, not the only one.

import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth/viewer";
import { decideRankingsAccess } from "@/lib/rankings";
import { supabaseServer } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reply(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const sb = await supabaseServer();
  const viewer = await getViewer(sb);
  if (!viewer) return reply(401, { error: "Sign in to see the rankings." });

  const eventId = viewer.team?.eventId ?? new URL(request.url).searchParams.get("event");
  if (!eventId || !UUID.test(eventId)) return reply(400, { error: "Say which event: ?event=<id>." });

  const { data: event, error: eventError } = await sb
    .from("events")
    .select("id, current_phase")
    .eq("id", eventId)
    .maybeSingle<{ id: string; current_phase: string }>();
  if (eventError) return reply(500, { error: "Could not read the event." });

  const decision = decideRankingsAccess(viewer.role, event?.current_phase ?? null);
  if (!decision.ok) return reply(decision.status, { error: decision.error });

  const [results, awards] = await Promise.all([
    sb
      .from("results")
      .select("track, final_value_cents, start_value_cents, return_bp, rank, eligible, teams(code, name)")
      .eq("event_id", eventId)
      .order("track")
      .order("rank", { ascending: true, nullsFirst: false }),
    sb
      .from("awards")
      .select("code, place, metric, teams(code, name), companies(ticker, name)")
      .eq("event_id", eventId)
      .order("code")
      .order("place"),
  ]);
  if (results.error || awards.error) return reply(500, { error: "Could not read the rankings." });
  return reply(200, { event: eventId, phase: event!.current_phase, results: results.data, awards: awards.data });
}
