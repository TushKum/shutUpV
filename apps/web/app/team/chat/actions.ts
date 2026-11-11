"use server";

// The squad chat: a team posts a message to its squad (post_squad_message). The database checks the caller, the
// squad, the phase, the length and the rate limit, and its refusal is shown as it comes.

import { rpc, type ActionResult } from "@/lib/rpc";
import { chatCheck } from "@/lib/team/chat";

export async function postSquadMessage(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const body = String(form.get("body") ?? "").trim();
  const check = chatCheck(body);
  if (!check.ok) return { ok: false, code: "BAD_LENGTH", message: check.message };
  return rpc("post_squad_message", { p_body: body });
}
