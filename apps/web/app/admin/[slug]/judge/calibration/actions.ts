"use server";

// Calibration: starting a new batch of the sample pitches. The samples are read from prompts/calibration/pitches.json
// here (on the server; a bad file is refused with what is wrong), then start_calibration runs as the signed-in
// organiser: the database checks the caller and the samples, stores them as a new batch and queues runs 1–3 of each.

import { rpc, type ActionResult } from "@/lib/rpc";
import { loadCalibrationSamples } from "@/lib/judge/calibration";
import { startCalibrationMessage } from "@/lib/admin/calibration";

export async function startCalibration(eventId: string): Promise<ActionResult> {
  let samples;
  try {
    samples = loadCalibrationSamples();
  } catch (e) {
    return { ok: false, code: "ERROR", message: e instanceof Error ? e.message : String(e) };
  }
  const r = await rpc("start_calibration", { p_event: eventId, p_samples: samples });
  return r.ok ? { ...r, message: startCalibrationMessage(Number(r.data?.batch ?? 0), Number(r.data?.queued ?? 0)) } : r;
}
