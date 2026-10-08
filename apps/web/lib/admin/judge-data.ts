// Reads what the judge view needs, as the signed-in staff member (RLS: staff read every table of the event). The
// judge runs are read without the stored request and raw response (large) and in pages of 1,000 rows.

import type { DeadlineCode } from "@msim/engine";
import { supabaseServer } from "@/lib/supabase/server";
import { fetchPages } from "./export";
import type { JudgeCompanyRow, JudgeRows, JudgeRunRow, JudgeScoreRow, JudgeSubmissionRow } from "./judge";

export interface JudgeData extends JudgeRows {
  deadlines: Partial<Record<DeadlineCode, string>>;
}

const JUDGE_DEADLINES: DeadlineCode[] = ["PITCH", "CALL_1", "DEAL", "PLAN", "FLASH", "FLASH_TIER"];

export async function loadJudgeData(eventId: string): Promise<JudgeData> {
  const sb = await supabaseServer();
  const [companies, submissions, runs, scores, deadlines] = await Promise.all([
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
    sb.from("deadlines").select("code, at").eq("event_id", eventId).in("code", JUDGE_DEADLINES),
  ]);
  if (deadlines.error) throw new Error(`Could not read the deadlines: ${deadlines.error.message}`);

  return {
    companies: companies.map((c): JudgeCompanyRow => ({ id: c.id, ticker: c.ticker, name: c.name, squad: c.squads?.number ?? null })),
    submissions,
    runs,
    scores,
    deadlines: Object.fromEntries((deadlines.data ?? []).map((d) => [d.code, d.at])),
  };
}
