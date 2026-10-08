// Reads what the health view needs, as the signed-in staff member: admin_health (staff only), the event's teams,
// the team screens' heartbeats (client_pings, staff only) and the latest error_log rows (staff only).

import { rpc } from "@/lib/rpc";
import { supabaseServer } from "@/lib/supabase/server";
import { parseHealth, type AdminHealth, type HealthTeam, type PingRow } from "./health";
import { fetchAll } from "./rounds";

export interface ErrorRow {
  id: number;
  at: string;
  source: string;
  message: string;
  context: Record<string, unknown> | null;
}

export interface HealthData {
  health: AdminHealth;
  teams: HealthTeam[];
  pings: PingRow[];
  errors: ErrorRow[];
}

export const ERROR_ROWS = 50;

export async function loadHealthData(eventId: string): Promise<HealthData> {
  const sb = await supabaseServer();
  const [health, teams, pings, errors] = await Promise.all([
    rpc("admin_health", { p_event: eventId }).then((r) => {
      if (!r.ok) throw new Error(`admin_health: ${r.message ?? r.code}`);
      return parseHealth(r.data);
    }),
    sb
      .from("teams")
      .select("id, code, track")
      .eq("event_id", eventId)
      .order("code")
      .then((r) => {
        if (r.error) throw new Error(`teams: ${r.error.message}`);
        return r.data as HealthTeam[];
      }),
    fetchAll<PingRow>((from, to) =>
      sb
        .from("client_pings")
        .select("client_id, team_id, role, area, realtime, first_seen, last_seen")
        .eq("event_id", eventId)
        .not("team_id", "is", null)
        .order("client_id")
        .range(from, to),
    ),
    sb
      .from("error_log")
      .select("id, at, source, message, context")
      .eq("event_id", eventId)
      .order("at", { ascending: false })
      .order("id", { ascending: false })
      .limit(ERROR_ROWS)
      .then((r) => {
        if (r.error) throw new Error(`error_log: ${r.error.message}`);
        return r.data as ErrorRow[];
      }),
  ]);
  return { health, teams, pings, errors };
}
