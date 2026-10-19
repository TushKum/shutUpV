// The Phase 7 load test: many live screens and every fund trading in the last minute of a round, measured against
// the plan's targets (a clearing under 5 s, every screen updated within 2 s of it).
//
//   1. Signs in every team of a rehearsal event and opens --connections realtime connections (default 500) on the
//      event's private channel, as the team screens do.
//   2. Waits for an open round with --window seconds (default 60) or less to go, then every fund places
//      --orders-per-fund orders (default 6) at random moments in that window, while the other teams re-read their
//      pages every 5 s.
//   3. At the close it watches the round (as the service role) until it is CLEARED, and records when each screen hears
//      "round_cleared" and how long a sample of screens takes to read the new prices.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… NEXT_PUBLIC_SUPABASE_ANON_KEY=… CARD_SECRET=… TEAM_EMAIL_DOMAIN=… \
//     pnpm load-test --slug rehearsal [--connections 500] [--orders-per-fund 6] [--window 60] [--sample 50]
//
// Run it against a rehearsal event in ROUNDS (e.g. while `pnpm rehearse --autopilot` plays it). Writes a JSON report
// to out/ and exits 1 when a target is missed.

import { mkdirSync, writeFileSync } from "node:fs";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { parseArgs, required } from "./lib/args";
import { call, pool, signInTeam, sleep, snapshot, type Env, type TeamLogin } from "./lib/bot-runner";
import { rng, roundOrders } from "./lib/bots";

const CLEARING_TARGET_MS = 5000;
const SCREEN_TARGET_MS = 2000;

const pct = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!);
};
const summary = (xs: number[]) => ({ n: xs.length, p50: pct(xs, 50), p95: pct(xs, 95), max: pct(xs, 100) });
const time = () => new Date().toISOString().slice(11, 19);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || typeof args.slug !== "string") {
    console.log("pnpm load-test --slug <rehearsal slug> [--connections 500] [--orders-per-fund 6] [--window 60] [--sample 50]");
    return args.help ? 0 : 1;
  }
  const slug = args.slug;
  const num = (k: string, d: number) => (typeof args[k] === "string" ? Number(args[k]) : d);
  const connections = num("connections", 500);
  const ordersPerFund = num("orders-per-fund", 6);
  const windowMs = num("window", 60) * 1000;
  const sample = num("sample", 50);
  const env: Env = {
    url: required("SUPABASE_URL"),
    anonKey: required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    cardSecret: required("CARD_SECRET"),
    emailDomain: required("TEAM_EMAIL_DOMAIN"),
  };
  const admin = createClient(env.url, required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: event } = await admin.from("events").select("id, name, is_rehearsal").eq("slug", slug).single();
  if (!event?.is_rehearsal) throw new Error(`${slug} is not a rehearsal event`);
  const { data: teamRows } = await admin.from("teams").select("id, code, track").eq("event_id", event.id).order("code");
  const teams = (teamRows ?? []) as TeamLogin[];

  // 1. Sign-ins.
  let t0 = Date.now();
  const clients = await pool(teams, 10, (t) => signInTeam(env, slug, t.code));
  const signInMs = Date.now() - t0;
  console.log(`${time()}  ${teams.length} teams signed in in ${(signInMs / 1000).toFixed(1)} s`);
  const tokens = await Promise.all(clients.map(async (c) => (await c.auth.getSession()).data.session!.access_token));

  // The server's clock: offset = server − local, from the quickest of a few round trips.
  let offset = 0;
  let best = Infinity;
  for (let i = 0; i < 5; i++) {
    const a = Date.now();
    const { data } = await admin.rpc("server_time");
    const b = Date.now();
    if (b - a < best) {
      best = b - a;
      offset = Date.parse(data as string) - (a + b) / 2;
    }
  }
  const serverNow = () => Date.now() + offset;

  // 2. Realtime connections (each its own socket, like a phone), on the event's private channel.
  type Screen = { sb: SupabaseClient; channel: RealtimeChannel; heard: Map<number, number> };
  // The clearing transaction's start (the broadcast's "at"), per round, from the first screen that hears it.
  const txnStarts = new Map<number, number>();
  const screens: Screen[] = [];
  const joinFailures: Record<string, number> = {};
  t0 = Date.now();
  const joined = await pool(Array.from({ length: connections }, (_, i) => i), 25, async (i) => {
    const token = tokens[i % tokens.length]!;
    const sb = createClient(env.url, env.anonKey, { accessToken: async () => token });
    await sb.realtime.setAuth(token);
    const screen: Screen = { sb, channel: sb.channel(`event:${event.id}`, { config: { private: true } }), heard: new Map() };
    screen.channel.on("broadcast", { event: "round_cleared" }, (msg) => {
      const p = msg.payload as { round?: number; at?: string };
      const round = Number(p.round);
      if (!screen.heard.has(round)) screen.heard.set(round, serverNow());
      if (p.at && !txnStarts.has(round)) txnStarts.set(round, Date.parse(p.at));
    });
    const ok = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 30_000);
      screen.channel.subscribe((s, err) => {
        if (s === "SUBSCRIBED") {
          clearTimeout(timer);
          resolve(true);
        } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
          clearTimeout(timer);
          const why = `${s}${err ? `: ${err.message}` : ""}`.slice(0, 120);
          joinFailures[why] = (joinFailures[why] ?? 0) + 1;
          resolve(false);
        }
      });
    });
    if (ok) screens.push(screen);
    return ok;
  });
  const joinMs = Date.now() - t0;
  const failedJoins = joined.filter((x) => !x).length;
  console.log(`${time()}  ${screens.length} of ${connections} screens joined in ${(joinMs / 1000).toFixed(1)} s (${failedJoins} failed${failedJoins ? `: ${JSON.stringify(joinFailures)}` : ""})`);

  // 3. Wait for an open round with at most the window left.
  let round: { number: number; closes_at: string } | null = null;
  for (;;) {
    const { data } = await admin.rpc("event_status", { p_event: event.id });
    const open = (data as { open_round: { number: number; closes_at: string } | null } | null)?.open_round ?? null;
    if (open && Date.parse(open.closes_at) - serverNow() <= windowMs && Date.parse(open.closes_at) - serverNow() > 5000) {
      round = open;
      break;
    }
    process.stdout.write(`\r${time()}  waiting for an open round with ${windowMs / 1000} s or less to go…   `);
    await sleep(1000);
  }
  const closesAt = Date.parse(round.closes_at);
  console.log(`\n${time()}  round ${round.number} closes in ${((closesAt - serverNow()) / 1000).toFixed(0)} s: trading`);

  // 4. Funds trade in the window; the other teams re-read their pages every 5 s.
  const orderMs: number[] = [];
  const readMs: number[] = [];
  const outcomes: Record<string, number> = {};
  const end = closesAt - 3000;
  const work = teams.map(async (t, i) => {
    const sb = clients[i]!;
    if (t.track === "FINANCE") {
      let s;
      try {
        s = await snapshot(sb, event.id, t);
      } catch (e) {
        const key = `read failed: ${e instanceof Error ? e.message : e}`;
        outcomes[key] = (outcomes[key] ?? 0) + 1;
        return;
      }
      const companies = s.companies.filter((c) => c.squad_id !== null && c.squad_id !== s.squad?.id);
      const orders = roundOrders(s, companies, rng(`${t.code}-${round!.number}`), ordersPerFund);
      const at = orders.map(() => serverNow() + Math.random() * Math.max(0, end - serverNow())).sort((a, b) => a - b);
      for (const [k, o] of orders.entries()) {
        await sleep(Math.max(0, at[k]! - serverNow()));
        const a = Date.now();
        const r = await call(sb, o.fn, o.args as Record<string, unknown>);
        orderMs.push(Date.now() - a);
        const key = r.ok ? "ok" : (r.code ?? "?");
        outcomes[key] = (outcomes[key] ?? 0) + 1;
      }
    } else {
      while (serverNow() < end) {
        const a = Date.now();
        await Promise.all([
          sb.rpc("event_status", { p_event: event.id }),
          sb.from("companies").select("id, ticker, market_price").eq("event_id", event.id),
          sb.from("teams").select("cash_cents").eq("id", t.id),
        ]);
        readMs.push(Date.now() - a);
        await sleep(5000 * (0.8 + Math.random() * 0.4));
      }
    }
  });
  await Promise.all(work);
  console.log(`${time()}  ${orderMs.length} orders placed (${JSON.stringify(outcomes)}); waiting for the clearing…`);

  // 5. The clearing, seen from the database: when the round is CLEARED (polled every 100 ms).
  let clearedAt: number | null = null;
  const deadline = closesAt + 60_000;
  while (serverNow() < deadline) {
    const { data } = await admin.from("rounds").select("status").eq("event_id", event.id).eq("number", round.number).single();
    if (data?.status === "CLEARED") {
      clearedAt = serverNow();
      break;
    }
    await sleep(100);
  }
  if (clearedAt === null) throw new Error(`round ${round.number} did not clear within 60 s of its close`);
  // 6. Screens: when each heard it, and a sample re-reads the new prices.
  const listen = serverNow() + 15_000;
  while (serverNow() < listen && screens.some((s) => !s.heard.has(round!.number))) await sleep(100);
  const heard = screens.map((s) => s.heard.get(round!.number)).filter((x): x is number => x !== undefined);
  // The commit is seen either by the poll or by the first screen to hear it, whichever came first.
  const commitSeen = Math.min(clearedAt, ...heard);
  const delivery = heard.map((h) => Math.max(0, h - commitSeen));
  // A screen is updated once it has heard the clearing and read its page again: its delivery time plus a typical
  // re-read (measured on a sample of screens right after the clearing).
  const rereadMs: number[] = [];
  await pool(screens.slice(0, sample), 25, async (x) => {
    const a = Date.now();
    await Promise.all([
      x.sb.rpc("event_status", { p_event: event.id }),
      x.sb.from("companies").select("id, ticker, market_price").eq("event_id", event.id),
    ]);
    rereadMs.push(Date.now() - a);
  });
  const reread50 = pct(rereadMs, 50) ?? 0;
  const screenUpdated = delivery.map((d) => d + reread50);
  const txnStart = txnStarts.get(round.number) ?? null;

  const report = {
    slug,
    at: new Date().toISOString(),
    teams: teams.length,
    signInMs,
    screens: { requested: connections, joined: screens.length, failed: failedJoins, failures: joinFailures, joinMs },
    round: round.number,
    orders: { placed: orderMs.length, outcomes, latencyMs: summary(orderMs) },
    pageReadsMs: summary(readMs),
    clearing: {
      closeToClearedMs: Math.round(clearedAt - closesAt),
      transactionMs: txnStart !== null ? Math.round(clearedAt - txnStart) : null,
      target: CLEARING_TARGET_MS,
    },
    screensHeard: { heard: heard.length, of: screens.length, deliveryMs: summary(delivery), note: "after the first sign of the commit (poll every 100 ms or the first screen)" },
    rereadMs: summary(rereadMs),
    screenUpdatedMs: { ...summary(screenUpdated), target: SCREEN_TARGET_MS, note: "delivery after the commit + a typical re-read" },
  };
  const clearingOk = (report.clearing.transactionMs ?? report.clearing.closeToClearedMs) < CLEARING_TARGET_MS;
  const screensOk = heard.length === screens.length && (report.screenUpdatedMs.p95 ?? Infinity) < SCREEN_TARGET_MS;
  console.log(JSON.stringify(report, null, 2));
  console.log(`Clearing under ${CLEARING_TARGET_MS / 1000} s: ${clearingOk ? "yes" : "NO"} · every screen updated within ${SCREEN_TARGET_MS / 1000} s (p95): ${screensOk ? "yes" : "NO"}`);
  mkdirSync("out", { recursive: true });
  const file = `out/load-test-${slug}-${report.at.replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
  console.log(`Report: ${file}`);
  for (const s of screens) void s.sb.removeChannel(s.channel);
  return clearingOk && screensOk ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
