"use server";

// A consultant's call: BUY or SELL on one covered company in one window (make_call, run as the signed-in team). The
// database checks the team, the coverage and the window (its due time, and that the price it is judged at is not
// known yet); its refusal is shown as it comes.

import { rpc, type ActionResult } from "@/lib/rpc";
import { clock } from "@/lib/format";
import { callSentText, type CallNo } from "@/lib/team/calls";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function makeCall(companyId: string, no: number, direction: string, label: string, due: string | null): Promise<ActionResult> {
  if (!UUID.test(companyId)) return { ok: false, code: "NOT_ASSIGNED", message: "You can only call your two assigned companies." };
  if (no !== 1 && no !== 2 && no !== 3) return { ok: false, code: "CALL_CLOSED", message: "There are three calls: 1, 2 and 3." };
  if (direction !== "BUY" && direction !== "SELL") return { ok: false, code: "BAD_DIRECTION", message: "A call is BUY or SELL." };
  const r = await rpc("make_call", { p_company: companyId, p_call_no: no, p_direction: direction });
  if (!r.ok) return r.code === "CALL_CLOSED" ? { ...r, message: `Call ${no} is not open: it was not changed.` } : r;
  return { ...r, message: callSentText(direction, label.slice(0, 40), no as CallNo, due ? clock(due) : null) };
}
