// Reads what the judge console needs, as the signed-in staff member (RLS: staff read every table of the event): the
// companies, current submissions, judge runs, scores, appeals and re-runs, the judging deadlines and the event's
// model slot. The judge runs are read without the stored request and raw response (large) and in pages of 1,000 rows.

import type { DeadlineCode } from "@msim/engine";
import { supabaseServer } from "@/lib/supabase/server";
import { fetchPages } from "./export";
import type { JudgeAppealRow, JudgeCompanyRow, JudgeRows, JudgeRunRow, JudgeScoreRow, JudgeSlot, JudgeSubmissionRow } from "./judge";

export interface JudgeData extends JudgeRows {
  deadlines: Partial<Record<DeadlineCode, string>>;
  /** events.judge_model_slot: the model that runs claimed from now on use. */
  modelSlot: JudgeSlot;
}

const JUDGE_DEADLINES: DeadlineCode[] = ["PITCH", "CALL_1", "DEAL", "PLAN", "FLASH", "FLASH_TIER"];

export async function loadJudgeData(eventId: string): Promise<JudgeData> {
  const sb = await supabaseServer();
  const [companies, submissions, runs, scores, appeals, deadlines, event] = await Promise.all([
    fetchPages<{ id: string; ticker: string | null; name: string | null; squads: { number: number } | null }>(
      (from, to) =>
        sb.from("companies").select("id, ticker, name, squads(number)").eq("event_id", eventId).not("squad_id", "is", null).order("id").range(from, to),
      "the companies",
    ),
    fetchPages<JudgeSubmissionRow>(
      (from, to) =>
        sb
          .from("submissions")
          .select("id, company_id, type, word_count, submitted_at, body_text")
          .eq("event_id", eventId)
          .is("superseded_at", null)
          .order("id")
          .range(from, to),
      "the submissions",
    ),
    fetchPages<JudgeRunRow>(
      (from, to) =>
        sb
          .from("judge_runs")
          .select("id, submission_id, company_id, type, generation, run_no, model, status, attempts, breakdown, total, rationale, error, latency_ms, created_at, finished_at")
          .eq("event_id", eventId)
          .order("id")
          .range(from, to),
      "the judge runs",
    ),
    fetchPages<JudgeScoreRow>(
      (from, to) =>
        sb
          .from("scores")
          .select("company_id, type, submission_id, generation, status, run_totals, median, missing, capped, penalty, final_score, tier_bp, breakdown, rationale, released_at")
          .eq("event_id", eventId)
          .order("id")
          .range(from, to),
      "the scores",
    ),
    fetchPages<JudgeAppealRow>(
      (from, to) =>
        sb
          .from("appeals")
          .select(
            "id, company_id, type, submission_id, generation, after_release, reason, status, requested_at, old_score, new_score, ready_at, decided_at, note, effects",
          )
          .eq("event_id", eventId)
          .order("id")
          .range(from, to),
      "the appeals",
    ),
    sb.from("deadlines").select("code, at").eq("event_id", eventId).in("code", JUDGE_DEADLINES),
    sb.from("events").select("judge_model_slot").eq("id", eventId).maybeSingle<{ judge_model_slot: JudgeSlot }>(),
  ]);
  if (deadlines.error) throw new Error(`Could not read the deadlines: ${deadlines.error.message}`);
  if (event.error || !event.data) throw new Error(`Could not read the judge model: ${event.error?.message ?? "no such event"}`);

  return {
    companies: companies.map((c): JudgeCompanyRow => ({ id: c.id, ticker: c.ticker, name: c.name, squad: c.squads?.number ?? null })),
    submissions,
    runs,
    scores,
    appeals,
    deadlines: Object.fromEntries((deadlines.data ?? []).map((d) => [d.code, d.at])),
    modelSlot: event.data.judge_model_slot,
  };
}
