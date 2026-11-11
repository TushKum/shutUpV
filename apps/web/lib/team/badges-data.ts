// Reads the signed-in team's badge facts (public.team_badge_facts) and turns them into its badges. A database that
// does not have the function yet (an older deployment) gives no badges rather than a broken Home.

import { supabaseServer } from "@/lib/supabase/server";
import { badgeFactsFromRow, badgesFor, type Badge } from "./badges";

export async function loadBadges(valueNow: number | null): Promise<Badge[] | null> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("team_badge_facts");
  if (error || !data) {
    if (error) console.error("badges: could not read the facts:", error.message);
    return null;
  }
  return badgesFor(badgeFactsFromRow(data as Parameters<typeof badgeFactsFromRow>[0], valueNow));
}
