// The hire chats' messages, read through RLS as the signed-in team: only the threads of the company–firm pairs it
// belongs to are readable (policy hire_messages_read), so one query returns every thread of this team.

import { supabaseServer } from "@/lib/supabase/server";

export interface HireMessage {
  id: number;
  company_id: string;
  firm_team_id: string;
  team_id: string;
  body: string;
  created_at: string;
}

/** How many of the latest messages (across this team's threads) the page reads. */
export const HIRE_CHAT_PAGE = 600;

export const pairKey = (companyId: string, firmId: string) => `${companyId}:${firmId}`;

/** This team's hire-chat messages, oldest first, grouped by company–firm pair. */
export async function loadHireMessages(eventId: string): Promise<Map<string, HireMessage[]>> {
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from("hire_messages")
    .select("id, company_id, firm_team_id, team_id, body, created_at")
    .eq("event_id", eventId)
    .order("id", { ascending: false })
    .limit(HIRE_CHAT_PAGE);
  if (error) throw new Error(`Could not read your hire chats: ${error.message}`);
  const byPair = new Map<string, HireMessage[]>();
  for (const m of ((data ?? []) as HireMessage[]).reverse()) {
    const key = pairKey(m.company_id, m.firm_team_id);
    const list = byPair.get(key) ?? [];
    list.push({ ...m, id: Number(m.id) });
    byPair.set(key, list);
  }
  return byPair;
}
