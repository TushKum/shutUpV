"use server";

// Saving a draft (the PRD or the crisis solution): one game function, save_draft, run as the signed-in team. It checks
// the team, the window, the lock, the word limit and the ticker (claimed by the first team to save it); its refusals
// are shown as they come. A save names the version it was based on, so a save over a newer version is refused with
// that version.

import { SUBMISSION_TYPES, type SubmissionType } from "@msim/engine";
import { rpc, type ActionResult } from "@/lib/rpc";
import { clock } from "@/lib/format";
import { draftPayload, toSnapshot, type DraftSnapshot, type Fields } from "@/lib/team/editor";

export interface DraftResult extends ActionResult {
  /** The team's draft after the action: the version saved, or the newer version a save was refused for. */
  draft?: DraftSnapshot;
}

export async function saveDraft(type: SubmissionType, fields: Fields, expectedVersion: number): Promise<DraftResult> {
  if (!SUBMISSION_TYPES.includes(type)) return { ok: false, code: "BAD_TYPE", message: "Unknown draft." };
  if (!Number.isSafeInteger(expectedVersion)) return { ok: false, code: "BAD_VERSION", message: "Reload the page and try again." };
  const r = await rpc("save_draft", { p_type: type, p_content: draftPayload(type, fields ?? {}), p_expected_version: expectedVersion });
  const draft = toSnapshot(r.data?.draft) ?? undefined;
  if (r.ok && draft) return { ...r, draft, message: `Saved at ${clock(draft.updatedAt, true)}.` };
  if (r.code === "VERSION_CONFLICT") return { ...r, draft, message: "Not saved: another screen of your team saved a newer version. Your text is still here." };
  return { ...r, draft };
}
