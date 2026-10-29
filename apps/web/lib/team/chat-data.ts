// The squad chat's messages, read through RLS as the signed-in team (only its own squad's are readable).

import { supabaseServer } from "@/lib/supabase/server";
import { CHAT_PAGE } from "./chat";

export interface ChatMessage {
  id: number;
  team_id: string;
  body: string;
  created_at: string;
}

/** The latest messages of the squad, oldest first, and whether older ones were left out. */
export async function loadChat(squadId: string): Promise<{ messages: ChatMessage[]; more: boolean }> {
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from("squad_messages")
    .select("id, team_id, body, created_at")
    .eq("squad_id", squadId)
    .order("id", { ascending: false })
    .limit(CHAT_PAGE + 1);
  if (error) throw new Error(`Could not read the squad chat: ${error.message}`);
  const rows = (data ?? []) as ChatMessage[];
  return { messages: rows.slice(0, CHAT_PAGE).map((m) => ({ ...m, id: Number(m.id) })).reverse(), more: rows.length > CHAT_PAGE };
}
