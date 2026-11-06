"use server";

// Lottery: the seed commitment (SETUP) and the 21:15 draw. Each action is one game function, run as the signed-in
// organiser; the database checks the caller, the phase, the formats and the seed against the commitment.

import { rpc, type ActionResult } from "@/lib/rpc";
import { normaliseCommitment } from "@/lib/admin/lottery";

const text = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
};

export async function setSeedCommitment(eventId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const commitment = normaliseCommitment(text(form, "commitment"));
  if (!commitment) {
    return { ok: false, code: "BAD_COMMITMENT", message: "The commitment is the SHA-256 of the seed: 64 hex characters (pnpm new-seed prints it)." };
  }
  const r = await rpc("set_seed_commitment", { p_event: eventId, p_commitment: commitment });
  return r.ok ? { ...r, message: "Commitment saved. It is fixed once the event starts." } : r;
}

export async function runLottery(eventId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const seed = text(form, "seed");
  const dice = text(form, "dice");
  if (!seed || !dice) return { ok: false, code: "MISSING", message: "Enter the secret seed and the dice roll." };
  const r = await rpc("run_lottery", { p_event: eventId, p_seed: seed, p_dice: dice });
  if (!r.ok) return r;
  const teams = Number(r.data?.teams ?? 0);
  return { ...r, message: `Seed matches the commitment. Problem cards dealt to ${teams} team${teams === 1 ? "" : "s"} with dice ${dice}.` };
}
