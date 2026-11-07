// GET /api/rankings[?event=<id>] — the leaderboard: live until the 03:30 freeze, the final results and awards at
// AWARDS. Teams read their own event; staff and the display pass ?event=. 401 when signed out; 403 to teams and the
// display after the freeze and before AWARDS (acceptance test 13). The database's leaderboard function applies the
// same rule again, so this check is a second lock, not the only one.

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
    .select("id, current_phase, leaderboard_frozen_at")
    .eq("id", eventId)
    .maybeSingle<{ id: string; current_phase: string; leaderboard_frozen_at: string | null }>();
  if (eventError) return reply(500, { error: "Could not read the event." });

  const decision = decideRankingsAccess(viewer.role, event?.current_phase ?? null, event?.leaderboard_frozen_at != null);
  if (!decision.ok) return reply(decision.status, { error: decision.error });

  const { data, error } = await sb.rpc("leaderboard", { p_event: eventId });
  if (error) return reply(error.code === "42501" ? 403 : 500, { error: error.code === "42501" ? "The leaderboard is frozen until the awards." : "Could not read the rankings." });
  const body = data as { ok?: boolean; final?: boolean; frozen?: boolean; rows?: unknown[] };
  let awards: unknown[] = [];
  if (body.final) {
    const a = await sb.from("awards").select("code, place, team_id, company_id, metric").eq("event_id", eventId);
    awards = a.data ?? [];
  }
  return reply(200, { event: eventId, phase: event!.current_phase, final: body.final === true, rows: body.rows ?? [], awards });
}
