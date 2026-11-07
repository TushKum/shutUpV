// Reads what Home, the "Do this now" bar and the alerts need, as the signed-in team, once per request: the event's
// schedule (deadlines and phase starts, public to the event), the versions of its own drafts, its questions and the
// unanswered questions about its company (the Q&A board is public), and its pending orders (only the open round has any: a closed round clears them). Every
// query runs at once; RLS decides what the team can see.

import { cache } from "react";
import type { DeadlineCode, PhaseCode } from "@msim/engine";
import type { TeamContext } from "@/lib/team/context";
import { supabaseServer } from "@/lib/supabase/server";
import type { HomeFacts, HomeProgress } from "./home";

export interface HomeBulletin {
  id: string;
  kind: string;
  title: string;
  body: string;
  published_at: string;
}

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`Could not read ${what}: ${r.error.message}`);
  return r.data as T;
}

export interface PlanRows {
  deadlines: { code: DeadlineCode; at: string }[];
  phases: { code: PhaseCode; starts_at: string }[];
  drafts: { type: "PRD" | "SOLUTION"; version: number }[];
  asked: number;
  /** Ids of the questions about the company the team built, and the question ids that have an answer. */
  questions: string[];
  answered: string[];
  pendingOrders: number;
}

/** The plan's facts from the context and the rows. Pure. */
export function planFacts(ctx: Pick<TeamContext, "event" | "status" | "built" | "rescued">, rows: PlanRows): HomeFacts {
  const { event, status, built, rescued } = ctx;
  const version = (t: "PRD" | "SOLUTION") => rows.drafts.find((d) => d.type === t)?.version ?? 0;
  const answered = new Set(rows.answered);
  const progress: HomeProgress = {
    prdVersion: version("PRD"),
    solutionVersion: version("SOLUTION"),
    asked: rows.asked,
    unanswered: rows.questions.filter((q) => !answered.has(q)).length,
    pendingOrders: rows.pendingOrders,
  };
  return {
    phase: status.phase,
    paused: status.paused,
    pausedAt: status.paused_at,
    nowMs: new Date(status.server_time).getTime(),
    drawnAt: event.drawn_at,
    prdsLockedAt: event.prds_locked_at,
    pricesStartedAt: event.prices_started_at,
    crisisAppliedAt: event.crisis_applied_at,
    solutionsLockedAt: event.solutions_locked_at,
    scoresRevealedAt: event.scores_revealed_at,
    marketClosedAt: event.market_closed_at,
    leaderboardFrozen: status.leaderboard_frozen,
    deadlines: Object.fromEntries(rows.deadlines.map((d) => [d.code, d.at])),
    phaseStarts: Object.fromEntries(rows.phases.map((p) => [p.code, p.starts_at])),
    openRound: status.open_round,
    nextRound: status.next_round,
    builtTicker: built?.ticker ?? null,
    rescuedTicker: rescued?.ticker ?? null,
    progress,
  };
}

/** Once per request: the facts the team's plan is made from (the layout's bar and alerts, and Home). */
export const loadPlanFacts = cache(async (ctx: TeamContext): Promise<HomeFacts> => {
  const sb = await supabaseServer();
  const { event, team, built, rescued, status } = ctx;
  const none = Promise.resolve([] as { id: string }[]);
  const [deadlines, phases, drafts, asked, questions, pending] = await Promise.all([
    sb.from("deadlines").select("code, at").eq("event_id", event.id).then((r) => must(r, "the deadlines") as PlanRows["deadlines"]),
    sb.from("phases").select("code, starts_at").eq("event_id", event.id).then((r) => must(r, "the schedule") as PlanRows["phases"]),
    sb.from("drafts").select("type, version").eq("team_id", team.id).then((r) => must(r, "your drafts") as PlanRows["drafts"]),
    rescued
      ? sb
          .from("qa_questions")
          .select("id", { count: "exact", head: true })
          .eq("company_id", rescued.id)
          .eq("asker_team_id", team.id)
          .then((r) => {
            if (r.error) throw new Error(`Could not read your questions: ${r.error.message}`);
            return r.count ?? 0;
          })
      : Promise.resolve(0),
    built && event.crisis_applied_at
      ? sb.from("qa_questions").select("id").eq("company_id", built.id).then((r) => must(r, "the questions about your company") as { id: string }[])
      : none,
    status.open_round
      ? sb
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("team_id", team.id)
          .eq("status", "PENDING")
          .then((r) => {
            if (r.error) throw new Error(`Could not read your orders: ${r.error.message}`);
            return r.count ?? 0;
          })
      : Promise.resolve(0),
  ]);
  const ids = questions.map((q) => q.id);
  const answered = ids.length
    ? (must(await sb.from("qa_answers").select("question_id").in("question_id", ids), "the answers") as { question_id: string }[]).map((a) => a.question_id)
    : [];
  return planFacts(ctx, { deadlines, phases, drafts, asked, questions: ids, answered, pendingOrders: pending });
});

/** The latest published bulletins (at most `n`). */
export async function loadLatestBulletins(eventId: string, n = 3): Promise<HomeBulletin[]> {
  const sb = await supabaseServer();
  return must(
    await sb.from("bulletins").select("id, kind, title, body, published_at").eq("event_id", eventId).not("published_at", "is", null).order("published_at", { ascending: false }).limit(n),
    "the bulletins",
  ) as HomeBulletin[];
}
