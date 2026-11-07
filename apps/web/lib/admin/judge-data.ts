// Reads what the judge console needs, as the signed-in organiser (RLS: organisers read every score; the fairness
// officer only revealed ones): companies, teams, locked submissions, the judge's readings (without the stored request
// and raw answer, which are large), scores, the injection checks, each round's model slot, the appeals, and the latest
// calibration batch with its readings.

import { supabaseServer } from "@/lib/supabase/server";
import { fetchPages } from "./export";
import type { AppealRow, CalibrationRunRow, CalibrationSampleRow, JudgeCompanyRow, JudgeRows, JudgeRunRow, JudgeScoreRow, JudgeSlot, JudgeSubmissionRow } from "./judge";

export interface JudgeData extends JudgeRows {
  slots: { PRD: JudgeSlot; SOLUTION: JudgeSlot };
  crisisApplied: boolean;
  appeals: AppealRow[];
  calibration: { batch: number | null; samples: CalibrationSampleRow[]; runs: CalibrationRunRow[] };
}

export async function loadJudgeData(eventId: string): Promise<JudgeData> {
  const sb = await supabaseServer();
  const [companies, teams, submissions, runs, scores, checks, event, appeals, samples] = await Promise.all([
    fetchPages<JudgeCompanyRow>(
      (from, to) => sb.from("companies").select("id, ticker, name, founder_team_id, rescuer_team_id").eq("event_id", eventId).order("id").range(from, to),
      "the companies",
    ),
    fetchPages<{ id: string; code: string }>((from, to) => sb.from("teams").select("id, code").eq("event_id", eventId).order("id").range(from, to), "the teams"),
    fetchPages<JudgeSubmissionRow>(
      (from, to) => sb.from("submissions").select("id, company_id, team_id, type, word_count, saved_at").eq("event_id", eventId).order("id").range(from, to),
      "the submissions",
    ),
    fetchPages<JudgeRunRow>(
      (from, to) => sb.from("judge_runs").select("submission_id, generation, run_no, status, total, error").eq("event_id", eventId).order("id").range(from, to),
      "the judge readings",
    ),
    fetchPages<JudgeScoreRow>(
      (from, to) =>
        sb.from("scores").select("company_id, team_id, type, status, missing, median, penalty, final_score, rationale").eq("event_id", eventId).order("id").range(from, to),
      "the scores",
    ),
    fetchPages<{ submission_id: string; hits: number }>(
      (from, to) => sb.from("judge_injection_checks").select("submission_id, hits").eq("event_id", eventId).order("submission_id").range(from, to),
      "the injection checks",
    ),
    sb
      .from("events")
      .select("prd_model_slot, solution_model_slot, crisis_applied_at")
      .eq("id", eventId)
      .maybeSingle<{ prd_model_slot: JudgeSlot; solution_model_slot: JudgeSlot; crisis_applied_at: string | null }>(),
    fetchPages<AppealRow>(
      (from, to) =>
        sb
          .from("appeals")
          .select("id, company_id, type, status, after_reveal, reason, requested_by, requested_at, old_score, new_score, decided_by, decided_at, note")
          .eq("event_id", eventId)
          .order("requested_at", { ascending: false })
          .range(from, to),
      "the appeals",
    ),
    fetchPages<CalibrationSampleRow>(
      (from, to) =>
        sb.from("calibration_samples").select("batch, sample_no, type, title, expected_min, expected_max").eq("event_id", eventId).order("batch").order("sample_no").range(from, to),
      "the calibration samples",
    ),
  ]);
  if (event.error || !event.data) throw new Error(`Could not read the event: ${event.error?.message ?? "no such event"}`);
  const batch = samples.length ? Math.max(...samples.map((s) => s.batch)) : null;
  const calRuns =
    batch === null
      ? []
      : await fetchPages<CalibrationRunRow>(
          (from, to) =>
            sb.from("calibration_runs").select("sample_no, run_no, status, total, model, error").eq("event_id", eventId).eq("batch", batch).order("id").range(from, to),
          "the calibration readings",
        );
  return {
    companies,
    teams,
    submissions,
    runs,
    scores,
    hits: Object.fromEntries(checks.map((c) => [c.submission_id, c.hits])),
    slots: { PRD: event.data.prd_model_slot, SOLUTION: event.data.solution_model_slot },
    crisisApplied: !!event.data.crisis_applied_at,
    appeals,
    calibration: { batch, samples: samples.filter((s) => s.batch === batch), runs: calRuns },
  };
}
