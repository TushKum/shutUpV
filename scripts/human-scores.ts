// The AI-outage fallback (RUNBOOK "The AI service is down"): works the judge queue of one submission type with the
// human panel's scores from a CSV instead of the model (scripts/lib/human-scores.ts has the format). Start judging on
// the Judge page first, as usual; release on the Judge page afterwards, as usual.
//
//   pnpm human-scores --event <slug> --type PITCH --file scores/pitch.csv [--check]
//
// --check only reads the CSV and lists the rows still missing. Reads .env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
// and SUPABASE_SERVICE_ROLE_KEY.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { SUBMISSION_TYPES, type SubmissionType } from "@msim/engine";
import { promptLoader, runWorker, supabaseJudgeDb } from "../apps/web/lib/judge/index";
import { parseArgs } from "./lib/args";
import { HUMAN_MODEL, humanColumns, humanJudge, missingRows, parseHumanScores } from "./lib/human-scores";

const USAGE = "usage: pnpm human-scores --event <slug> --type PITCH|PLAN|FLASH --file <scores.csv> [--check]";

function need(...names: string[]): string {
  for (const n of names) if (process.env[n]) return process.env[n]!;
  throw new Error(`environment variable ${names.join(" or ")} is required`);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const type = typeof args.type === "string" ? (args.type.toUpperCase() as SubmissionType) : null;
  if (args.help || typeof args.event !== "string" || typeof args.file !== "string" || !type || !SUBMISSION_TYPES.includes(type)) {
    console.log(`${USAGE}\nCSV columns for ${type ?? "PITCH"}: ${humanColumns(type && SUBMISSION_TYPES.includes(type) ? type : "PITCH").join(",")}`);
    return args.help ? 0 : 2;
  }
  const parsed = parseHumanScores(type, readFileSync(args.file, "utf8"));
  if (!parsed.ok) {
    console.error(`The CSV has errors; nothing was recorded:\n  ${parsed.errors.join("\n  ")}`);
    return 1;
  }
  const { scores } = parsed;

  const sb = createClient(need("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: event, error } = await sb.from("events").select("id, name").eq("slug", args.event).maybeSingle();
  if (error || !event) throw new Error(`no event ${args.event}${error ? `: ${error.message}` : ""}`);

  const { data: runs, error: runsError } = await sb
    .from("judge_runs")
    .select("type, run_no, status, companies(ticker)")
    .eq("event_id", event.id)
    .in("status", ["QUEUED", "RUNNING", "FAILED"]);
  if (runsError) throw new Error(`judge_runs: ${runsError.message}`);
  const open = (runs ?? []) as unknown as { type: SubmissionType; run_no: number; status: string; companies: { ticker: string } | null }[];
  const others = open.filter((r) => r.type !== type && r.status !== "FAILED");
  const failed = open.filter((r) => r.type === type && r.status === "FAILED");
  const pending = open.filter((r) => r.type === type && r.status !== "FAILED").map((r) => ({ ticker: r.companies?.ticker ?? "?", runNo: r.run_no }));

  const { missing, extra } = missingRows(scores, pending);
  console.log(`${event.name}: ${scores.size} companies in the CSV; ${pending.length} ${type} runs to judge.`);
  if (failed.length) console.log(`${failed.length} ${type} runs FAILED: click "Retry failed runs" on the Judge page, then run this again.`);
  if (extra.length) console.log(`Spread over 10 points:\n  ${extra.join("\n  ")}`);
  if (missing.length) console.log(`Rows missing for runs in the queue:\n  ${missing.join("\n  ")}`);
  if (others.length) {
    console.error(`${others.length} runs of another type are queued or running; finish those first (this script judges ${type} only).`);
    return 1;
  }
  if (!pending.length) {
    console.log(failed.length ? "" : `Nothing queued for ${type}. Click "Start judging" on the Judge page first.`);
    return failed.length ? 1 : 0;
  }
  if (args.check === true) return missing.length ? 1 : 0;
  if (missing.length) {
    console.error("Add the missing rows (or run with --check to list them again); nothing was recorded.");
    return 1;
  }

  const db = supabaseJudgeDb(sb, event.id);
  const total = { done: 0, sealed: 0, failed: 0 };
  for (;;) {
    const s = await runWorker({
      db: { ...db, claimCalibration: async () => [] }, // calibration samples are for the model, not the panel
      judge: humanJudge(scores),
      budgetMs: 30_000,
      concurrency: 8,
      models: { PRIMARY: HUMAN_MODEL, BACKUP: HUMAN_MODEL },
      prompts: promptLoader(),
      eventId: event.id,
      log: (l) => console.log(l),
    });
    total.done += s.done;
    total.sealed += s.sealed;
    total.failed += s.failed;
    if (s.stopped === "fatal" || s.stopped === "error") {
      console.error(`Stopped: ${s.reason}`);
      return 1;
    }
    if (s.claimed === 0) break;
  }
  console.log(`Recorded ${total.done} runs; ${total.sealed} companies sealed; ${total.failed} failed.`);
  console.log(`Now on the Judge page: check the scores, "Seal missing as 0", then "Release ${type.toLowerCase()} scores".`);
  return total.failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
