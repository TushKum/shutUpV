// Works the AI judge queue from an organiser's laptop: the same loop as the control panel's "Run the judge here",
// with no time limit (docs/JUDGE.md "Work").
//
//   pnpm judge-worker --event <slug> [--once]
//
// Reads .env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY and the
// JUDGE_* settings. It claims runs until neither the judge queue nor the calibration queue has anything queued or
// running, waiting for runs that are backing off or that another worker holds, then exits. --once does one turn of
// JUDGE_WORK_BUDGET_MS instead. Before each turn with the real model it checks the API with the model of the event's
// current slot (no run used), and stops if that fails. Ctrl-C once stops claiming and lets the calls in flight
// finish; Ctrl-C twice aborts them (they go back to the queue). The fake judge (JUDGE_FAKE=1) is refused on a live
// event.

import { createClient } from "@supabase/supabase-js";
import {
  checkJudgeModel,
  createJudge,
  fakeJudgeRefusal,
  hasApiCredential,
  judgeConfig,
  promptLoader,
  queueCounts,
  runWorker,
  supabaseJudgeDb,
  type JudgeSlot,
  type QueueCounts,
  type WorkerSummary,
} from "../apps/web/lib/judge/index";
import { parseArgs } from "./lib/args";

const USAGE = "usage: pnpm judge-worker --event <slug> [--once]";
const WAIT_MS = 5_000;
const PROGRESS_EVERY_MS = 5_000;

function need(...names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  throw new Error(`environment variable ${names.join(" or ")} is required`);
}

const time = () => new Date().toLocaleTimeString("en-GB", { hour12: false });

function line(s: Readonly<WorkerSummary>): string {
  const parts = [`done ${s.done}`, `retried ${s.retried}`, `failed ${s.failed}`];
  if (s.calibration) parts.push(`calibration ${s.calibration}`);
  parts.push(`sealed ${s.sealed}`);
  if (s.ignored) parts.push(`ignored ${s.ignored}`);
  if (s.errors) parts.push(`report errors ${s.errors}`);
  const t = s.tokens;
  if (t.input_tokens || t.output_tokens) {
    parts.push(`tokens in ${t.input_tokens} (cached ${t.cache_read_input_tokens}) out ${t.output_tokens}`);
  }
  return `${parts.join(" · ")} · ${(s.ms / 1000).toFixed(1)} s`;
}

const busy = (c: QueueCounts) => c.queued > 0 || c.running > 0;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || typeof args.event !== "string") {
    console.log(USAGE);
    return args.help ? 0 : 2;
  }
  const once = args.once === true;
  const config = judgeConfig();
  const sb = createClient(need("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: event, error } = await sb
    .from("events")
    .select("id, slug, name, is_rehearsal, judge_model_slot")
    .eq("slug", args.event)
    .maybeSingle<{ id: string; slug: string; name: string; is_rehearsal: boolean; judge_model_slot: JudgeSlot }>();
  if (error) throw new Error(`could not read the event: ${error.message}`);
  if (!event) throw new Error(`there is no event with the slug ${args.event}`);

  const refusal = fakeJudgeRefusal(config, event);
  if (refusal) throw new Error(refusal);
  if (!config.fake && !hasApiCredential()) throw new Error("ANTHROPIC_API_KEY is not set");
  const prompts = promptLoader();
  for (const t of ["PITCH", "PLAN", "FLASH"] as const) prompts(t);

  const judgeName = config.fake
    ? `the FAKE judge (${config.fakeLatencyMs} ms a call)`
    : `${config.models.PRIMARY} (backup ${config.models.BACKUP}; this event uses the ${event.judge_model_slot} slot), effort ${config.effort}` +
      (config.temperature !== undefined ? `, temperature ${config.temperature}` : "");
  console.log(`Judging ${event.name} (${event.slug}${event.is_rehearsal ? ", rehearsal" : ""}) with ${judgeName}, ${config.concurrency} calls at a time.`);

  const stopper = new AbortController();
  const aborter = new AbortController();
  process.on("SIGINT", () => {
    if (!stopper.signal.aborted) {
      stopper.abort();
      console.log("\nStopping: no new runs; the calls in flight finish first (Ctrl-C again to abort them).");
    } else if (!aborter.signal.aborted) {
      aborter.abort();
      console.log("\nAborting the calls in flight: they go back to the queue.");
    }
  });

  const db = supabaseJudgeDb(sb, event.id);
  const judge = createJudge(config);
  let lastWait = "";
  for (;;) {
    if (!config.fake) {
      // The slot may have been switched since the last turn (set_judge_model): check the model it uses now.
      const { data: current, error: slotError } = await sb
        .from("events")
        .select("judge_model_slot")
        .eq("id", event.id)
        .single<{ judge_model_slot: JudgeSlot }>();
      if (slotError) throw new Error(`could not read the event: ${slotError.message}`);
      const slot: JudgeSlot = current.judge_model_slot === "BACKUP" ? "BACKUP" : "PRIMARY";
      const check = await checkJudgeModel(config.models[slot]);
      if (!check.ok) {
        console.error(`Stopped before claiming: the API check of ${config.models[slot]} (the ${slot} model) failed: ${check.error}`);
        return 1;
      }
    }

    let lastPrint = Date.now();
    const s = await runWorker({
      db,
      judge,
      budgetMs: once ? config.budgetMs : Number.POSITIVE_INFINITY,
      concurrency: config.concurrency,
      models: config.models,
      prompts,
      eventId: event.id,
      stopSignal: stopper.signal,
      abortSignal: aborter.signal,
      log: (l) => console.log(`${time()}  ${l}`),
      onProgress: (p) => {
        if (Date.now() - lastPrint >= PROGRESS_EVERY_MS) {
          lastPrint = Date.now();
          console.log(`${time()}  ${line(p)}`);
        }
      },
    });
    if (s.claimed > 0) console.log(`${time()}  ${line(s)}${s.stopped !== "empty" ? ` · stopped: ${s.stopped}` : ""}`);
    if (s.stopped === "fatal" || s.stopped === "error") {
      console.error(`Stopped: ${s.reason ?? s.stopped}`);
      return 1;
    }
    if (once || s.stopped === "stopped" || s.stopped === "aborted") break;

    const [c, cal] = await Promise.all([queueCounts(sb, event.id), queueCounts(sb, event.id, "calibration_runs")]);
    if (!busy(c) && !busy(cal)) {
      const calibration = cal.done || cal.failed ? `; calibration ${cal.done} done, ${cal.failed} failed` : "";
      console.log(`${time()}  Nothing left to judge: ${c.done} runs done, ${c.failed} failed${calibration}.`);
      break;
    }
    const wait =
      `judge runs ${c.queued} queued (waiting to be tried again) and ${c.running} running elsewhere, ` +
      `calibration runs ${cal.queued} queued and ${cal.running} running elsewhere; looking again every ${WAIT_MS / 1000} s`;
    if (wait !== lastWait) console.log(`${time()}  ${wait}`);
    lastWait = wait;
    await sleep(WAIT_MS, stopper.signal);
    if (stopper.signal.aborted) break;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
