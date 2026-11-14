// Reads what the control panel's "To do now" list needs: deck sizes, and per judged type the state of its scores.
// Light queries (ids and statuses only); the judge page reads the full detail.

import type { DeadlineCode, SubmissionType } from "@msim/engine";
import { supabaseServer } from "@/lib/supabase/server";
import { fetchPages } from "./export";
import { judgeTypesFor, scoringClosed } from "./judge";
import type { AdminEvent } from "./event";
import type { TodoInput, TypeJudging } from "./todo";

export async function loadTodoInput(event: AdminEvent, now = Date.now()): Promise<TodoInput> {
  const sb = await supabaseServer();
  const count = async (table: string, status?: string) => {
    const q = sb.from(table).select("id", { count: "exact", head: true }).eq("event_id", event.id);
    const { count: n } = await (status ? q.eq("status", status) : q);
    return n ?? 0;
  };
  const [problems, crises, statements, appealsReady, deadlines, submissions, scores, failed] = await Promise.all([
    count("problem_cards"),
    count("crisis_cards"),
    count("problem_statements"),
    count("appeals", "READY"),
    sb.from("deadlines").select("code, at").eq("event_id", event.id),
    fetchPages<{ company_id: string; type: SubmissionType }>(
      (from, to) => sb.from("submissions").select("id, company_id, type").eq("event_id", event.id).is("superseded_at", null).order("id").range(from, to),
      "the submissions",
    ),
    fetchPages<{ company_id: string; type: SubmissionType; status: string }>(
      (from, to) => sb.from("scores").select("id, company_id, type, status").eq("event_id", event.id).order("id").range(from, to),
      "the scores",
    ),
    fetchPages<{ company_id: string; type: SubmissionType }>(
      (from, to) => sb.from("judge_runs").select("id, company_id, type").eq("event_id", event.id).eq("status", "FAILED").order("id").range(from, to),
      "the failed judge runs",
    ),
  ]);
  const dl: Partial<Record<DeadlineCode, string>> = {};
  for (const d of (deadlines.data ?? []) as { code: DeadlineCode; at: string }[]) dl[d.code] = d.at;
  const scoreOf = new Map(scores.map((s) => [`${s.company_id}:${s.type}`, s.status]));

  const judging: TypeJudging[] = judgeTypesFor(event.format).map((type) => {
    const subs = submissions.filter((s) => s.type === type);
    const own = scores.filter((s) => s.type === type);
    const status = (st: string) => own.filter((s) => s.status === st).length;
    return {
      type,
      closed: scoringClosed(type, dl, now, event.paused ? event.paused_at : null),
      unscored: subs.filter((s) => (scoreOf.get(`${s.company_id}:${type}`) ?? "PENDING") === "PENDING").length,
      scoring: status("SCORING"),
      failed: failed.filter((r) => r.type === type && scoreOf.get(`${r.company_id}:${type}`) === "SCORING").length,
      sealed: status("SEALED"),
      released: status("RELEASED"),
    };
  });
  return { format: event.format, drawn: event.drawn_at !== null, deck: { problems, crises, statements }, judging, appealsReady };
}
