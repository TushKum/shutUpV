"use server";

// The hire chat: a company and a firm it hired write to each other (post_hire_message). The database checks that the
// caller is one side of an engagement, the phase, the length and the rate limit, and its refusal is shown as it comes.

import { rpc, type ActionResult } from "@/lib/rpc";
import { chatCheck } from "@/lib/team/chat";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function postHireMessage(companyId: string, firmId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  if (!UUID.test(companyId) || !UUID.test(firmId)) return { ok: false, code: "BAD_INPUT", message: "Pick a chat first." };
  const body = String(form.get("body") ?? "").trim();
  const check = chatCheck(body);
  if (!check.ok) return { ok: false, code: "BAD_LENGTH", message: check.message };
  return rpc("post_hire_message", { p_company: companyId, p_firm: firmId, p_body: body });
}
