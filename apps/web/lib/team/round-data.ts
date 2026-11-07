// Reads what the two writing rounds need, as the signed-in team, through RLS: its own draft, the lock, its problem card
// (its own before 23:30), the twist once published, a revealed score, a company's crisis card (from 23:45) and a
// company's locked PRD (public from 23:30).

import type { SubmissionType } from "@msim/engine";
import { supabaseServer } from "@/lib/supabase/server";
import { NO_DRAFT, toSnapshot, type DraftSnapshot } from "./editor";
import type { WritingFacts } from "./writing";
import type { TeamContext } from "./context";

export interface Card {
  number: number;
  title: string;
  body: string;
  /** The problem card's sector, or the crisis card's type. */
  kind: string;
}

export interface ScoreRow {
  final_score: number | null;
  median: number | null;
  penalty: number;
  missing: boolean;
  breakdown: Record<string, unknown> | null;
  rationale: string | null;
}

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T | null {
  if (r.error) throw new Error(`Could not read ${what}: ${r.error.message}`);
  return r.data;
}

export async function loadDraft(teamId: string, type: SubmissionType): Promise<DraftSnapshot> {
  const sb = await supabaseServer();
  const row = must(await sb.from("drafts").select("version, content, updated_at").eq("team_id", teamId).eq("type", type).maybeSingle(), "your draft");
  return toSnapshot(row) ?? NO_DRAFT;
}

export async function loadDeadline(eventId: string, code: string): Promise<string | null> {
  const sb = await supabaseServer();
  const row = must(await sb.from("deadlines").select("at").eq("event_id", eventId).eq("code", code).maybeSingle<{ at: string }>(), "the deadline");
  return row?.at ?? null;
}

export async function loadProblemCard(id: string | null): Promise<Card | null> {
  if (!id) return null;
  const sb = await supabaseServer();
  const row = must(await sb.from("problem_cards").select("number, sector, title, body").eq("id", id).maybeSingle<{ number: number; sector: string; title: string; body: string }>(), "the problem card");
  return row ? { number: row.number, title: row.title, body: row.body, kind: row.sector } : null;
}

export async function loadCrisisCard(id: string | null): Promise<Card | null> {
  if (!id) return null;
  const sb = await supabaseServer();
  const row = must(await sb.from("crisis_cards").select("number, category, title, body").eq("id", id).maybeSingle<{ number: number; category: string; title: string; body: string }>(), "the crisis card");
  return row ? { number: row.number, title: row.title, body: row.body, kind: row.category } : null;
}

export async function loadTwist(eventId: string): Promise<{ title: string; body: string; published_at: string } | null> {
  const sb = await supabaseServer();
  return must(
    await sb.from("bulletins").select("title, body, published_at").eq("event_id", eventId).eq("kind", "TWIST").not("published_at", "is", null).maybeSingle<{ title: string; body: string; published_at: string }>(),
    "the twist",
  );
}

/** A company's score of one type, once revealed (RLS hides it before). */
export async function loadRevealedScore(companyId: string, type: SubmissionType): Promise<ScoreRow | null> {
  const sb = await supabaseServer();
  return must(
    await sb
      .from("scores")
      .select("final_score, median, penalty, missing, breakdown, rationale")
      .eq("company_id", companyId)
      .eq("type", type)
      .eq("status", "REVEALED")
      .maybeSingle<ScoreRow>(),
    "the score",
  );
}

/** A company's locked submission of one type (its own team's always; others' once public). */
export async function loadSubmission(companyId: string, type: SubmissionType): Promise<{ body_text: string; word_count: number; content: Record<string, unknown> } | null> {
  const sb = await supabaseServer();
  return must(await sb.from("submissions").select("body_text, word_count, content").eq("company_id", companyId).eq("type", type).maybeSingle<{ body_text: string; word_count: number; content: Record<string, unknown> }>(), "the submission");
}

/** The facts writingOpen needs, from the team's context. */
export function writingFacts(ctx: TeamContext, lock: string | null): WritingFacts {
  return {
    phase: ctx.status.phase,
    paused: ctx.status.paused,
    pausedAt: ctx.status.paused_at,
    nowMs: new Date(ctx.status.server_time).getTime(),
    drawnAt: ctx.event.drawn_at,
    prdsLockedAt: ctx.event.prds_locked_at,
    crisisAppliedAt: ctx.event.crisis_applied_at,
    solutionsLockedAt: ctx.event.solutions_locked_at,
    lock,
  };
}
