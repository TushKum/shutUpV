// A rehearsal night played by bots. Every team of a rehearsal event signs in with the password on its card and plays
// through the real public game functions: its PRD (a first draft and a revision), the Q&A board (the rescuer asks,
// the founders answer), its crisis solution and orders in every trading round. With --autopilot the script also does
// the organisers' part (as the service role): the seed commitment, the start of the night (at --starts-at), "advance
// when timer expires", the lottery
// draw, judging (the judge worker in-process: the fake judge with JUDGE_FAKE=1, else the real models), a rumour and
// the fairness decisions. The database's own clock (the 2-second tick) does the rest: the twist, the locks, the
// reveals, the crisis, the rounds and the close. Humans can watch (and play) on /admin, /display and /team at the same
// time.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… NEXT_PUBLIC_SUPABASE_ANON_KEY=… CARD_SECRET=… TEAM_EMAIL_DOMAIN=… \
//     pnpm rehearse --slug rehearsal [--autopilot] [--teams 150] [--except X050,X051] [--interval 5000] [--minutes 90]
//
// Seed the event first (pnpm seed --rehearsal --slug rehearsal --starts-at … --speed 10). Refuses a live event.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sha256Hex, type PhaseCode } from "@msim/engine";
import { createJudge, judgeConfig, promptLoader, runWorker, supabaseJudgeDb } from "../apps/web/lib/judge/index";
import { parseArgs, required } from "./lib/args";
import { Bot, emptyStats, pool, signInTeam, sleep, type Env, type TeamLogin } from "./lib/bot-runner";

const HELP = `pnpm rehearse --slug <rehearsal slug> [--autopilot] [--teams N] [--except CODES] [--interval ms] [--minutes N]
  --autopilot   also play the organisers: commitment, start, draw, judge, a rumour, flags
  --teams N     how many teams play (default: all)
  --except CODES  teams the bots leave alone, for people to play (comma-separated, e.g. X050,X051)
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

  // Bots play the active teams only (a backup an organiser has not activated sits the night out).
  const { data: teams } = await admin.from("teams").select("id, code").eq("event_id", event.id).eq("status", "ACTIVE").order("code");
  const except = new Set(typeof args.except === "string" ? args.except.toUpperCase().split(",").map((c) => c.trim()) : []);
  const all: TeamLogin[] = (teams ?? []).map((t, index) => ({ id: t.id as string, code: t.code as string, index }));
  const playing = all.filter((t) => !except.has(t.code)).slice(0, typeof args.teams === "string" ? Number(args.teams) : undefined);
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

  let rumoured = false;
  while (!done()) {
    const { data: ev, error: evError } = await sb.from("events").select("current_phase, seed_commitment, drawn_at, auto_advance, starts_at, ended_at, timing_version").eq("id", eventId).single();
    if (evError || !ev) {
      say(`could not read the event (${evError?.message ?? "no answer"}); trying again`);
      await sleep(2000);
      continue;
    }
    const phase = ev.current_phase as PhaseCode;

    if (phase === "SETUP" && !ev.seed_commitment) {
      seed = randomBytes(32).toString("hex");
      mkdirSync("out", { recursive: true });
      writeFileSync(seedFile, seed + "\n");
      say(`seed commitment: ${(await rpc("set_seed_commitment", { p_event: eventId, p_commitment: sha256Hex(seed) })).ok ? "set" : "refused"}`);
    }
    // The night starts only when an organiser starts it (the heartbeat never ticks an event in SETUP): the autopilot
    // is that organiser, at the event's planned start (--starts-at); every time then follows from the durations.
    if (phase === "SETUP" && ev.seed_commitment && Date.parse(ev.starts_at) <= Date.now()) {
      const r = await rpc("start_event", { p_event: eventId, p_expected_version: ev.timing_version });
      say(`start the night: ${r.ok ? "CHECKIN" : r.message}`);
    }
    if (!ev.auto_advance && phase !== "SETUP") say(`advance when timer expires: ${(await rpc("set_auto_advance", { p_event: eventId, p_on: true, p_advance_now: false })).ok}`);
    // 21:15 the lottery deals the problem cards (the same seed and dice give the crisis cards and the circle at 23:45).
    if (phase === "BRIEFING" && !ev.drawn_at) {
      if (!seed) throw new Error(`the seed of ${slug} is not in ${seedFile}; run the lottery in /admin instead`);
      const r = await rpc("run_lottery", { p_event: eventId, p_seed: seed, p_dice: "4" });
      say(`lottery: ${r.ok ? "the problem cards are dealt" : r.message}`);
    }
    // A market rumour during Round 2 (rumours never move a price).
    if (phase === "RESCUE" && !rumoured) {
      const r = await rpc("publish_bulletin", { p_event: eventId, p_kind: "RUMOUR", p_title: "A big buyer is said to be circling the snack companies", p_body: "Unconfirmed." });
      rumoured = r.ok;
      if (r.ok) say("rumour published");
    }
    if (phase === "SETTLEMENT") {
      const { data: flags } = await sb.from("flags").select("id").eq("event_id", eventId).eq("status", "OPEN");
      for (const f of flags ?? []) await rpc("decide_flag", { p_flag: f.id, p_status: "CLEARED", p_reason: "Rehearsal: cleared by the autopilot." });
      if (flags?.length) say(`${flags.length} flags cleared`);
    }
    if (phase === "AWARDS") {
      say("the awards are up (untimed): end the night on Event timing when the last award is shown");
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
