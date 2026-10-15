// POST /api/judge/work {event: <id>} — one turn of judge work, for organisers (401 signed out, 403 for anyone else).
// While an organiser keeps "Run the judge here" on, the control panel calls this again and again: each call claims
// runs from the queue for JUDGE_WORK_BUDGET_MS (50 s) with up to JUDGE_CONCURRENCY calls in parallel, waits for them,
// and answers with what it did and what is left. Several open consoles share the queue (claims skip locked rows).
// The fake judge (JUDGE_FAKE) is refused on a live event. With the real model, the API is checked first with the
// model of the event's current slot (no run used; a success is trusted for 60 s). It answers 502 when that check fails
// or when the worker stopped on an error it cannot get past (lib/judge/reply.ts), so the console's loop switches off.
// The queue is worked as the service role; the organiser check happens here first, and the claim and report
// functions are not callable by signed-in users at all. prompts/ is read at run time: next.config.ts traces it in.

import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth/viewer";
import {
  checkJudgeModel,
  createJudge,
  fakeJudgeRefusal,
  hasApiCredential,
  judgeConfig,
  modelCheckReply,
  promptLoader,
  queueCounts,
  runWorker,
  supabaseJudgeDb,
  workReply,
  type JudgeSlot,
} from "@/lib/judge";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
// The budget (50 s) plus the calls still in flight when it ends; calls still running near this limit are aborted
// and go back to the queue (below), rather than being cut off by the platform and waiting out their 3-minute lease.
export const maxDuration = 300;
const ABORT_AFTER_MS = 280_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reply(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const viewer = await getViewer(await supabaseServer());
  if (!viewer) return reply(401, { error: "Sign in to run the judge." });
  if (viewer.role !== "ORGANISER") return reply(403, { error: "Only organisers can run the judge." });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return reply(400, { error: "Send JSON: {\"event\": \"<id>\"}." });
  }
  const eventId = (body as { event?: unknown } | null)?.event;
  if (typeof eventId !== "string" || !UUID.test(eventId)) return reply(400, { error: "Say which event: {\"event\": \"<id>\"}." });

  let config;
  try {
    config = judgeConfig();
  } catch (e) {
    return reply(500, { error: `The judge settings are wrong: ${e instanceof Error ? e.message : String(e)}` });
  }

  let sb;
  try {
    sb = supabaseService();
  } catch (e) {
    return reply(500, { error: e instanceof Error ? e.message : String(e) });
  }

  const { data: event, error: eventError } = await sb
    .from("events")
    .select("id, is_rehearsal, judge_model_slot")
    .eq("id", eventId)
    .maybeSingle<{ id: string; is_rehearsal: boolean; judge_model_slot: JudgeSlot }>();
  if (eventError) return reply(500, { error: "Could not read the event." });
  if (!event) return reply(404, { error: "There is no such event." });

  const refusal = fakeJudgeRefusal(config, event);
  if (refusal) return reply(409, { error: refusal, fake: true });
  if (!config.fake && !hasApiCredential()) {
    return reply(503, { error: "ANTHROPIC_API_KEY is not set on the server, so the judge cannot run." });
  }

  // Check the prompts before claiming anything, so a deployment without them fails here and not run by run.
  const prompts = promptLoader();
  try {
    prompts("PITCH");
    prompts("PLAN");
    prompts("FLASH");
  } catch (e) {
    return reply(500, { error: e instanceof Error ? e.message : String(e) });
  }

  // A bad key, no access or an unknown model shows here, before a run is claimed.
  if (!config.fake) {
    const slot: JudgeSlot = event.judge_model_slot === "BACKUP" ? "BACKUP" : "PRIMARY";
    const check = await checkJudgeModel(config.models[slot]);
    if (!check.ok) {
      const r = modelCheckReply(config.models[slot], slot, check);
      return reply(r.status, r.body);
    }
  }

  const summary = await runWorker({
    db: supabaseJudgeDb(sb, event.id),
    judge: createJudge(config),
    budgetMs: config.budgetMs,
    concurrency: config.concurrency,
    models: config.models,
    prompts,
    eventId: event.id,
    abortSignal: AbortSignal.timeout(ABORT_AFTER_MS),
    log: (line) => console.warn(line),
  });

  let remaining = null;
  try {
    remaining = await queueCounts(sb, event.id);
  } catch {
    // The counts are a convenience; the work is done either way.
  }
  const r = workReply(summary, { fake: config.fake, remaining });
  return reply(r.status, r.body);
}
