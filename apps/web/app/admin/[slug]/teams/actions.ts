"use server";

// Teams: activate a backup or withdraw a team before the draw (one game function, run as the signed-in organiser).

import { rpc, type ActionResult } from "@/lib/rpc";

const WORDS = { ACTIVE: "now plays tonight", BACKUP: "is a backup again", WITHDRAWN: "is withdrawn" } as const;

export async function setTeamStatus(eventId: string, code: string, status: keyof typeof WORDS): Promise<ActionResult> {
  const r = await rpc("set_team_status", { p_event: eventId, p_team_code: code, p_status: status, p_reason: null });
  if (!r.ok) return r;
  return { ...r, message: `${code} ${WORDS[status]}. ${String(r.data?.active ?? "")} teams are active.` };
}
