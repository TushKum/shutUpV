"use server";

// Bulletins: the general composer (publish_bulletin, never FLASH) and the 04:00 flash bulletin
// (publish_flash_bulletin). Each action is one game function, run as the signed-in organiser.

import { rpc, type ActionResult } from "@/lib/rpc";
import { USE_FLASH, bulletinFromForm } from "@/lib/admin/content-bulletins";

export async function publishBulletin(eventId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const b = bulletinFromForm({ kind: form.get("kind"), title: form.get("title"), body: form.get("body") });
  if (!b.ok) return { ok: false, code: b.message === USE_FLASH ? "USE_FLASH" : "BAD_BULLETIN", message: b.message };
  const r = await rpc("publish_bulletin", { p_event: eventId, p_kind: b.value.kind, p_title: b.value.title, p_body: b.value.body });
  return r.ok ? { ...r, message: `Published “${b.value.title}” to every screen.` } : r;
}

/** Publishes the draft the page showed (`bulletinId`): a draft replaced since is refused (DRAFT_CHANGED). */
export async function publishFlashBulletin(eventId: string, bulletinId: string | null): Promise<ActionResult> {
  const r = await rpc("publish_flash_bulletin", { p_event: eventId, p_bulletin: bulletinId });
  return r.ok ? { ...r, message: "Flash bulletin published. The flash answers are open." } : r;
}
