// A rehearsal night played by bots (Phase 7). Every team of a rehearsal event signs in with the password on its
// card and plays through the real public game functions: problem cards, pitches, IPO bids, orders every round, the
// fee, the deal, consultant calls, the plan and the flash answer. With --autopilot the script also does the
// organisers' part (as the service role): the seed commitment and the draw, auto-advance, judging (the judge worker
// in-process: the fake judge with JUDGE_FAKE=1, else the real model), the releases, the flash bulletin and the
// fairness decisions. Humans can watch (and act) on /admin, /display and /team at the same time.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… NEXT_PUBLIC_SUPABASE_ANON_KEY=… CARD_SECRET=… TEAM_EMAIL_DOMAIN=… \
//     pnpm rehearse --slug rehearsal [--autopilot] [--teams 150] [--except XP50,XC50] [--interval 5000] [--minutes 90]
//
// Seed the event first (pnpm seed --rehearsal --slug rehearsal --starts-at … --speed 10). Refuses a live event.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sha256Hex, type PhaseCode, type SubmissionType } from "@msim/engine";
import { createJudge, judgeConfig, promptLoader, runWorker, supabaseJudgeDb } from "../apps/web/lib/judge/index";
import { parseArgs, required } from "./lib/args";
import { Bot, emptyStats, pool, signInTeam, sleep, type Env, type TeamLogin } from "./lib/bot-runner";

const HELP = `pnpm rehearse --slug <rehearsal slug> [--autopilot] [--teams N] [--except CODES] [--interval ms] [--minutes N]
  --autopilot   also play the organisers: draw, advance, judge, release, flash bulletin, flags
  --teams N     how many teams play (default: all)
  --except CODES  teams the bots leave alone, for people to play (comma-separated, e.g. XP50,XC50)
  --interval ms how often each team takes a turn (default 5000)
  --minutes N   stop after N minutes (default: when the event reaches AWARDS)
Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY, CARD_SECRET, TEAM_EMAIL_DOMAIN
(and JUDGE_FAKE=1 or ANTHROPIC_API_KEY with --autopilot).`;

const time = () => new Date().toISOString().slice(11, 19);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || typeof args.slug !== "string") {
    console.log(HELP);
    return args.help ? 0 : 1;
  }
  const slug = args.slug;
  const env: Env = {
    url: required("SUPABASE_URL"),
    anonKey: required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    cardSecret: required("CARD_SECRET"),
    emailDomain: required("TEAM_EMAIL_DOMAIN"),
  };
  const admin = createClient(env.url, required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: event, error } = await admin.from("events").select("id, slug, name, is_rehearsal").eq("slug", slug).maybeSingle();
  if (error || !event) throw new Error(`no event ${slug}${error ? `: ${error.message}` : ""}`);
  if (!event.is_rehearsal) throw new Error(`${slug} is a live event: bots play rehearsal events only`);

  const { data: teams } = await admin.from("teams").select("id, code, track").eq("event_id", event.id).order("code");
  const except = new Set(typeof args.except === "string" ? args.except.toUpperCase().split(",").map((c) => c.trim()) : []);
  const playing = (teams ?? []).filter((t) => !except.has(t.code)).slice(0, typeof args.teams === "string" ? Number(args.teams) : undefined) as TeamLogin[];
  const interval = typeof args.interval === "string" ? Number(args.interval) : 5000;
  const until = typeof args.minutes === "string" ? Date.now() + Number(args.minutes) * 60_000 : Number.POSITIVE_INFINITY;

  console.log(`${time()}  Signing in ${playing.length} teams of ${event.name}…`);
  const stats = emptyStats();
  const bots = await pool(playing, 10, async (t) => new Bot(await signInTeam(env, slug, t.code), event.id, t, stats));
  console.log(`${time()}  ${bots.length} bots signed in; one turn each every ${interval / 1000} s.`);

  let stop = false;
  process.on("SIGINT", () => {
    stop = true;
    console.log("\nStopping after the current turns…");
  });
  const done = () => stop || Date.now() > until;

  const loops = bots.map(async (b, i) => {
    await sleep((interval * i) / bots.length); // spread the turns
    while (!done()) {
      await b.turn();
      await sleep(interval * (0.8 + Math.random() * 0.4));
    }
  });
  const pilot = args.autopilot === true
    ? autopilot(admin, event.id, slug, done).then(() => void (stop = true)) // the night is over (or the pilot stopped)
    : Promise.resolve();
  const report = setInterval(() => {
    const refused = Object.entries(stats.refused).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(", ");
    console.log(`${time()}  turns ${stats.turns} · calls ${stats.calls} · ok ${stats.ok} · errors ${stats.errors}${refused ? ` · refused: ${refused}` : ""}${stats.lastErrors.length ? ` · last error: ${stats.lastErrors.at(-1)}` : ""}`);
  }, 30_000);
  await Promise.all([...loops, pilot]);
  clearInterval(report);
  console.log(`${time()}  Done: ${JSON.stringify(stats)}`);
  return 0;
}

/** The organisers' part, as the service role (organiser functions accept the system caller). */
async function autopilot(sb: SupabaseClient, eventId: string, slug: string, done: () => boolean) {
  const rpc = async (fn: string, a: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, a);
    if (error) return { ok: false, code: "ERROR", message: error.message };
    return data as { ok: boolean; code?: string; message?: string };
  };
  const seedFile = `out/${slug}-rehearsal-seed.txt`;
  let seed = existsSync(seedFile) ? readFileSync(seedFile, "utf8").trim() : "";
  const started = new Set<string>();
  let over = false; // the awards are up: the judge loop stops too
  const finished = () => over || done();
  const say = (m: string) => console.log(`${time()}  [autopilot] ${m}`);

  // The judge, in-process: works whatever is queued.
  const config = judgeConfig();
  const judging = (async () => {
    const db = supabaseJudgeDb(sb, eventId);
    const judge = createJudge(config);
    const prompts = promptLoader();
    while (!finished()) {
      const s = await runWorker({ db, judge, budgetMs: 20_000, concurrency: config.concurrency, models: config.models, prompts, eventId });
      if (s.claimed === 0) await sleep(3000);
      else say(`judge: ${s.done} done, ${s.sealed} sealed, ${s.failed} failed`);
      if (s.stopped === "fatal") {
        say(`judge stopped: ${s.reason}`);
        return;
      }
    }
  })();

  while (!done()) {
    const { data: ev, error: evError } = await sb.from("events").select("current_phase, seed_commitment, drawn_at, auto_advance").eq("id", eventId).single();
    if (evError || !ev) {
      say(`could not read the event (${evError?.message ?? "no answer"}); trying again`);
      await sleep(2000);
      continue;
    }
    const phase = ev.current_phase as PhaseCode;
    const passed = async (code: string) =>
      ((await sb.from("deadlines").select("at").eq("event_id", eventId).eq("code", code).single()).data?.at ?? "9999") <= new Date().toISOString();

    if (phase === "SETUP" && !ev.seed_commitment) {
      seed = randomBytes(32).toString("hex");
      mkdirSync("out", { recursive: true });
      writeFileSync(seedFile, seed + "\n");
      say(`seed commitment: ${(await rpc("set_seed_commitment", { p_event: eventId, p_commitment: sha256Hex(seed) })).ok ? "set" : "refused"}`);
    }
    // The heartbeat never starts a night by itself (an event in SETUP is not ticked): start it at its planned time.
    if (phase === "SETUP" && ev.seed_commitment) {
      const { data: setup } = await sb.from("phases").select("ends_at").eq("event_id", eventId).eq("code", "SETUP").single();
      if (setup && setup.ends_at <= new Date().toISOString()) {
        const r = await rpc("advance_phase", { p_event: eventId, p_from: "SETUP" });
        say(`start the night: ${r.ok ? "CHECKIN" : r.message}`);
      }
    }
    if (!ev.auto_advance) say(`auto-advance on: ${(await rpc("set_auto_advance", { p_event: eventId, p_on: true })).ok}`);
    if (phase === "SQUAD_DRAW" && !ev.drawn_at) {
      if (!seed) throw new Error(`the seed of ${slug} is not in ${seedFile}; draw it in /admin instead`);
      const r = await rpc("run_lottery", { p_event: eventId, p_seed: seed, p_dice: "4" });
      say(`draw: ${r.ok ? "done" : r.message}`);
    }
    for (const [type, deadline] of [["PITCH", "PITCH"], ["PLAN", "PLAN"], ["FLASH", "FLASH"]] as [SubmissionType, string][]) {
      if (!started.has(type) && (await passed(deadline))) {
        const r = await rpc("start_judging", { p_event: eventId, p_type: type });
        if (r.ok || r.code === "ALREADY_RELEASED") {
          started.add(type);
          say(`start judging ${type}: ${JSON.stringify(r)}`);
        }
      }
    }
    const release = async (type: SubmissionType) => {
      await rpc("seal_missing_scores", { p_event: eventId, p_type: type });
      const r = await rpc("release_scores", { p_event: eventId, p_type: type });
      if (r.ok) say(`released ${type}`);
    };
    if (phase === "READING") await release("PITCH");
    if (phase === "VERDICTS") await release("PLAN");
    if (phase === "ROUNDS_13_21") {
      if (await passed("FLASH_BULLETIN")) {
        const { count } = await sb.from("bulletins").select("id", { count: "exact", head: true }).eq("event_id", eventId).eq("kind", "FLASH").not("published_at", "is", null);
        if (!count) {
          await rpc("prepare_flash_bulletin", { p_event: eventId, p_title: "Interest rates rise", p_body: "Investors now want a path to profit within 12 months." });
          say(`flash bulletin: ${(await rpc("publish_flash_bulletin", { p_event: eventId })).ok ? "published" : "refused"}`);
        }
      }
      await release("FLASH");
    }
    if (phase === "APPEALS") {
      const { data: flags } = await sb.from("flags").select("id").eq("event_id", eventId).eq("status", "OPEN");
      for (const f of flags ?? []) await rpc("decide_flag", { p_flag: f.id, p_status: "CLEARED", p_reason: "Rehearsal: cleared by the autopilot." });
    }
    if (phase === "AWARDS") {
      say("the awards are up: the night is over");
      over = true;
      break;
    }
    await sleep(2000);
  }
  await judging;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
