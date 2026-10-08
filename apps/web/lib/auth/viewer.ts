import { cache } from "react";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountRole, Track } from "@msim/engine";
import { supabaseServer } from "@/lib/supabase/server";
import { homeFor } from "./routes";

export interface Viewer {
  userId: string;
  role: AccountRole;
  displayName: string;
  team: { id: string; code: string; track: Track; name: string; eventId: string } | null;
}

interface AccountRow {
  role: AccountRole;
  display_name: string;
  teams: { id: string; code: string; track: Track; name: string; event_id: string } | null;
}

/** The signed-in account, read through RLS (a caller can only read its own account row). */
export async function getViewer(client?: SupabaseClient): Promise<Viewer | null> {
  const sb = client ?? (await supabaseServer());
  const { data: claims } = await sb.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;
  const { data } = await sb
    .from("accounts")
    .select("role, display_name, teams(id, code, track, name, event_id)")
    .eq("user_id", userId)
    .maybeSingle<AccountRow>();
  if (!data) return null;
  return {
    userId,
    role: data.role,
    displayName: data.display_name,
    team: data.teams
      ? { id: data.teams.id, code: data.teams.code, track: data.teams.track, name: data.teams.name, eventId: data.teams.event_id }
      : null,
  };
}

/** Server-side gate for a layout or page. */
export async function requireRole(roles: readonly AccountRole[], from: string): Promise<Viewer> {
  const viewer = await currentViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(from)}`);
  if (!roles.includes(viewer.role)) redirect(homeFor(viewer.role));
  return viewer;
}

/** The signed-in account, once per request (layouts and pages share it). */
export const currentViewer = cache(() => getViewer());
