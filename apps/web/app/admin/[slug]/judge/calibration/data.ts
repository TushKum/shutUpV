// Reads what the calibration page needs, as the signed-in staff member (RLS: staff read calibration_samples,
// calibration_runs and the event): every batch's samples and runs, without the sample texts and the stored requests
// and raw responses (large), and the event's model slot; then, for the batch on screen, its sample texts and the
// requests of the runs it shows (one per sample).

import { supabaseServer } from "@/lib/supabase/server";
import { fetchPages } from "@/lib/admin/export";
import type { CalibrationRunRow, CalibrationSampleRow } from "@/lib/admin/calibration";
import type { JudgeSlot } from "@/lib/admin/judge";

export interface CalibrationRows {
  samples: CalibrationSampleRow[];
  runs: CalibrationRunRow[];
  /** events.judge_model_slot: the model that runs claimed from now on use. */
  modelSlot: JudgeSlot;
}

export async function loadCalibrationRows(eventId: string): Promise<CalibrationRows> {
  const sb = await supabaseServer();
  const [samples, runs, event] = await Promise.all([
    fetchPages<CalibrationSampleRow>(
      (from, to) =>
        sb
          .from("calibration_samples")
          .select("batch, sample_no, title, expected_min, expected_max, company_name, ticker, created_at")
          .eq("event_id", eventId)
          .order("batch")
          .order("sample_no")
          .range(from, to),
      "the calibration samples",
    ),
    fetchPages<CalibrationRunRow>(
      (from, to) =>
        sb
          .from("calibration_runs")
          .select("id, batch, sample_no, run_no, status, attempts, model, prompt_sha, breakdown, total, rationale, error, latency_ms, created_at, locked_at, finished_at")
          .eq("event_id", eventId)
          .order("id")
          .range(from, to),
      "the calibration runs",
    ),
    sb.from("events").select("judge_model_slot").eq("id", eventId).maybeSingle<{ judge_model_slot: JudgeSlot }>(),
  ]);
  if (event.error || !event.data) throw new Error(`Could not read the judge model: ${event.error?.message ?? "no such event"}`);
  return { samples, runs, modelSlot: event.data.judge_model_slot };
}

export interface BatchDetail {
  /** The stored text of each sample of the batch, by sample number. */
  texts: Map<number, string>;
  /** The request each of these runs was sent, by run id. */
  requests: Map<string, string>;
}

export async function loadBatchDetail(eventId: string, batch: number, runIds: readonly string[]): Promise<BatchDetail> {
  const sb = await supabaseServer();
  const [texts, requests] = await Promise.all([
    sb.from("calibration_samples").select("sample_no, body_text").eq("event_id", eventId).eq("batch", batch),
    runIds.length
      ? sb.from("calibration_runs").select("id, request_text").eq("event_id", eventId).in("id", [...runIds])
      : Promise.resolve({ data: [] as { id: string; request_text: string | null }[], error: null }),
  ]);
  if (texts.error) throw new Error(`Could not read the calibration samples: ${texts.error.message}`);
  if (requests.error) throw new Error(`Could not read the calibration requests: ${requests.error.message}`);
  return {
    texts: new Map((texts.data ?? []).map((s: { sample_no: number; body_text: string }) => [s.sample_no, s.body_text])),
    requests: new Map(
      (requests.data ?? []).flatMap((r: { id: string; request_text: string | null }) => (r.request_text ? [[r.id, r.request_text] as const] : [])),
    ),
  };
}
