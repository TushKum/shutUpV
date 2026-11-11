// GET /api/rankings[?event=<id>] — final values, ranks and awards.
// Teams read their own event; staff and the display pass ?event=. 401 when signed out, 403 before the reveal
// (teams and the display: AWARDS; organisers and the fairness officer: SETTLEMENT). Row-level security applies the
// same rule in the database (and public.rankings once more), so this check is a second lock, not the only one.

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

  // public.rankings applies the same rule again in the database and adds every team's code and name (a team may read
  // only its own row of `teams`, so names cannot come from a plain select).
  const { data, error } = await sb.rpc("rankings", { p_event: eventId });
  if (error) return reply(500, { error: "Could not read the rankings." });
  if (!data) return reply(403, { error: "Rankings are revealed at the awards." });
  const { results, awards } = data as { results: unknown[]; awards: unknown[] };
  return reply(200, { event: eventId, phase: event!.current_phase, results, awards });
}
