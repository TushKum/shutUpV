"use server";

// The squad workspace's actions. Each runs a game function as the signed-in team (pick_problem_card, save_draft,
// submit_submission), which checks the team, the window, the deadline and every rule; its refusals are shown as
// they come. A save names the version it was based on, so a save over a newer version is refused with that version.

import { SUBMISSION_TYPES, type SubmissionType } from "@msim/engine";
import { rpc, type ActionResult } from "@/lib/rpc";
import { clock } from "@/lib/format";
import { draftPayload, toSnapshot, toSubmitted, type DraftSnapshot, type Fields } from "@/lib/team/editor";
import { sameContent } from "@/lib/team/squad";
import { supabaseServer } from "@/lib/supabase/server";

export interface DraftResult extends ActionResult {
  /** The squad's draft after the action: the version saved, or the newer version a save was refused for. */
  draft?: DraftSnapshot;
}

const badType = (type: unknown): DraftResult | null =>
  SUBMISSION_TYPES.includes(type as SubmissionType) ? null : { ok: false, code: "BAD_TYPE", message: "Unknown submission type." };

export async function pickProblemCard(cardId: string, title: string): Promise<ActionResult> {
  const r = await rpc("pick_problem_card", { p_card: cardId });
  return r.ok ? { ...r, message: `You picked “${title}”.` } : r;
}

export async function saveDraft(type: SubmissionType, fields: Fields, expectedVersion: number): Promise<DraftResult> {
  const bad = badType(type);
  if (bad) return bad;
  if (!Number.isSafeInteger(expectedVersion)) return { ok: false, code: "BAD_VERSION", message: "Reload the page and try again." };
  const r = await rpc("save_draft", { p_type: type, p_content: draftPayload(type, fields ?? {}), p_expected_version: expectedVersion });
  const draft = toSnapshot(r.data?.draft) ?? undefined;
  if (r.ok && draft) return { ...r, draft, message: `Saved version ${draft.version} at ${clock(draft.updatedAt, true)}.` };
  if (r.code === "VERSION_CONFLICT") return { ...r, draft, message: "Not saved: a newer version was saved meanwhile. Your text is still here." };
  return { ...r, draft };
}

/**
 * Submits the squad's draft. With `fields` (text not saved yet), saves it first; without, checks that the saved
 * version is still the one on screen. submit_submission submits the saved draft.
 */
export async function submitDraft(type: SubmissionType, fields: Fields | null, expectedVersion: number): Promise<DraftResult> {
  const bad = badType(type);
  if (bad) return bad;
  let draft: DraftSnapshot | undefined;
  if (fields) {
    const saved = await saveDraft(type, fields, expectedVersion);
    if (!saved.ok) return saved.code === "VERSION_CONFLICT" ? { ...saved, message: "Not submitted: a newer version was saved meanwhile. Your text is still here." } : saved;
    draft = saved.draft;
  } else {
    const sb = await supabaseServer();
    const { data, error } = await sb.from("submission_drafts").select("version, content, updated_at, updated_by_team").eq("type", type).maybeSingle();
    if (error || !data) return { ok: false, code: "NOT_ALLOWED", message: "Your team cannot submit this." };
    draft = toSnapshot(data) ?? undefined;
    if (draft && draft.version !== expectedVersion) {
      return { ok: false, code: "VERSION_CONFLICT", message: "Not submitted: a newer version was saved meanwhile. Check it, then submit.", draft };
    }
  }
  const r = await rpc("submit_submission", { p_type: type });
  if (!r.ok) return { ...r, draft };
  const sub = toSubmitted(r.data?.submission);
  if (!sub) return { ok: true, message: "Submitted.", draft };
  const at = clock(sub.submittedAt, true);
  const ticker = type === "PITCH" && typeof sub.content.ticker === "string" ? ` Ticker ${sub.content.ticker.toUpperCase()} is yours.` : "";
  if (draft && !sameContent(sub.content, draft.content)) {
    return { ok: true, draft, message: `Submitted at ${at}, but a newer version was saved just before: that version (${sub.words} words) is the one submitted. Check it.` };
  }
  if (r.data?.duplicate === true) return { ok: true, draft, message: `Already submitted: this text is the version submitted at ${at}.` };
  return { ok: true, draft, message: `Submitted at ${at} (${sub.words} words).${ticker} This version is the one judged; you can submit again until the deadline.` };
}
