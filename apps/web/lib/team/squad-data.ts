// Reads the squad workspace as the signed-in team, through RLS: the cards dealt to its squad, the squad's drafts and
// its own submissions (every version), the deadlines, the squad's deal (for the plan's cap), the flash bulletin once
// published, and whether the flash scores are out (which closes the flash answer). A team reads nothing of another
// squad here.

import { DEADLINE_CODES, type DeadlineCode, type SubmissionType } from "@msim/engine";
import type { TeamContext } from "@/lib/team/context";
import { supabaseServer } from "@/lib/supabase/server";
import type { DealRow, DraftRow, PauseState, SubmissionRow, WindowInput } from "./squad";

export interface ProblemCard {
  id: string;
  number: number;
  sector: string;
  title: string;
  body: string;
}

export interface FlashBulletin {
  id: string;
  title: string;
  body: string;
  published_at: string;
}

export interface SquadWorkspace {
  /** The dealt cards, in the order they were dealt (the first is the default). */
  cards: ProblemCard[];
  drafts: Partial<Record<SubmissionType, DraftRow>>;
  submissions: SubmissionRow[];
  deadlines: Partial<Record<DeadlineCode, string>>;
  deal: DealRow | null;
  flash: FlashBulletin | null;
  flashReleased: boolean;
}

export async function loadSquadWorkspace(ctx: TeamContext): Promise<SquadWorkspace> {
  const sb = await supabaseServer();
  const eventId = ctx.event.id;
  const squad = ctx.squad;
  const [deadlines, flash, released, cards, drafts, submissions, deal] = await Promise.all([
    sb.from("deadlines").select("code, at").eq("event_id", eventId),
    sb
      .from("bulletins")
      .select("id, title, body, published_at")
      .eq("event_id", eventId)
      .eq("kind", "FLASH")
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle<FlashBulletin>(),
    sb.from("scores").select("id").eq("event_id", eventId).eq("type", "FLASH").eq("status", "RELEASED").limit(1),
    squad && squad.dealt_card_ids.length > 0
      ? sb.from("problem_cards").select("id, number, sector, title, body").in("id", squad.dealt_card_ids)
      : Promise.resolve({ data: [] as ProblemCard[], error: null }),
    squad
      ? sb.from("submission_drafts").select("type, content, version, updated_at, updated_by_team").eq("squad_id", squad.id)
      : Promise.resolve({ data: [] as DraftRow[], error: null }),
    squad
      ? sb
          .from("submissions")
          .select("id, type, content, word_count, submitted_at, submitted_by_team, superseded_at")
          .eq("squad_id", squad.id)
          .order("submitted_at", { ascending: false })
      : Promise.resolve({ data: [] as SubmissionRow[], error: null }),
    squad
      ? sb.from("deals").select("executed_at, signed_product_at, signed_consulting_at, signed_finance_at").eq("squad_id", squad.id).maybeSingle<DealRow>()
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const [what, r] of [
    ["the deadlines", deadlines],
    ["the flash bulletin", flash],
    ["the flash scores", released],
    ["your problem cards", cards],
    ["your squad's drafts", drafts],
    ["your squad's submissions", submissions],
    ["your squad's deal", deal],
  ] as const) {
    if (r.error) throw new Error(`Could not read ${what}: ${r.error.message}`);
  }
  const byId = new Map(((cards.data ?? []) as ProblemCard[]).map((c) => [c.id, c]));
  return {
    cards: (squad?.dealt_card_ids ?? []).map((id) => byId.get(id)).filter((c): c is ProblemCard => !!c),
    drafts: Object.fromEntries(((drafts.data ?? []) as DraftRow[]).map((d) => [d.type, d])),
    submissions: (submissions.data ?? []) as SubmissionRow[],
    deadlines: Object.fromEntries(
      ((deadlines.data ?? []) as { code: DeadlineCode; at: string }[]).filter((d) => DEADLINE_CODES.includes(d.code)).map((d) => [d.code, d.at]),
    ),
    deal: (deal.data as DealRow | null) ?? null,
    flash: (flash.data as FlashBulletin | null) ?? null,
    flashReleased: (released.data ?? []).length > 0,
  };
}

export function pauseOf(ctx: TeamContext): PauseState {
  return { paused: ctx.status.paused, pausedAt: ctx.status.paused_at };
}

/** What the submission windows depend on, judged at the server's time of this render. */
export function windowInput(ctx: TeamContext, ws: SquadWorkspace): WindowInput {
  return {
    ...pauseOf(ctx),
    phase: ctx.status.phase,
    drawn: ctx.status.drawn,
    nowMs: new Date(ctx.status.server_time).getTime(),
    deadlines: ws.deadlines,
    flashPublishedAt: ws.flash?.published_at ?? null,
    flashReleased: ws.flashReleased,
  };
}
