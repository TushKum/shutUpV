// The app-server load test: 600 people on their phones, as the night's peak. Each team gets --screens signed-in
// sessions (default 4: 150 teams × 4 = 600), each a virtual screen that opens its track's pages one after another
// with a pause between them (--think seconds, random around it), for --duration seconds. It measures what the people
// in the room feel: how long each page takes to come back from the Next.js server, and how many fail.
//
//   pnpm app-load-test --base http://127.0.0.1:3200 --slug primus-reh [--screens 4] [--duration 120] [--think 6]
//   pnpm app-load-test --base … --slug primus-reh --burst 1.2
//   pnpm app-load-test --base … --slug primus-reh --rush 60
//
// --rush S is check-in: every one of the 600 phones signs in with its team's card (its own session, 4 per team login)
// at a random moment within S seconds, with the app's own retry, then opens its home page. The report gives the sign-in times and how many were
// refused (429: the project's sign-in rate limit is too low for the room).
//
// --burst S is the night's peak instead: a round clears and every open screen re-reads its page within S seconds (the
// screens' random spread). Each screen loads one page once; the report says how long until the last one had it.
//
// Run it against a production build (next build && next start), never the dev server, with the event's
// env (SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, CARD_SECRET, TEAM_EMAIL_DOMAIN).
// Targets: p95 under 2 s and under 1% errors. Writes a JSON report to out/ and exits 1 when a target is missed.

import { mkdirSync, writeFileSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { teamEmail, type Track } from "@msim/engine";
import { derivePassword } from "./lib/credentials";
import { parseArgs, required } from "./lib/args";
import { pool, sleep } from "./lib/bot-runner";
import { signInWithRetry } from "../apps/web/lib/auth/retry";

const P95_TARGET_MS = 2000;
const ERROR_TARGET = 0.01;

const PAGES: Record<Track, string[]> = {
  PRODUCT: ["/team", "/team/squad", "/team/crisis", "/team/market", "/team/bulletins", "/team"],
  CONSULTING: ["/team", "/team/crisis", "/team/squad", "/team/market", "/team/bulletins", "/team"],
  FINANCE: ["/team", "/team/market", "/team/trade", "/team/crisis", "/team/bulletins", "/team/market"],
};

const pct = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!);
};

/** The cookies the app sets after a team signs in (the same @supabase/ssr format), as one Cookie header. */
async function sessionCookie(url: string, anonKey: string, email: string, password: string, once = false): Promise<string> {
  const jar = new Map<string, string>();
  const sb = createServerClient(url, anonKey, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach((c) => (c.value ? jar.set(c.name, c.value) : jar.delete(c.name))) },
  });
  // The same retry as the app's login action (lib/auth/retry.ts); without `once`, a few more for the set-up sign-ins.
  const { error } = await signInWithRetry(() => sb.auth.signInWithPassword({ email, password }), once ? {} : { attempts: 6 });
  if (error) throw Object.assign(new Error(`${email} could not sign in: ${(error as { message?: string }).message ?? error.status}`), { status: error.status });
  return [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || typeof args.slug !== "string" || typeof args.base !== "string") {
    console.log("pnpm app-load-test --base <app url> --slug <rehearsal slug> [--screens 4] [--duration 120] [--think 6]");
    return args.help ? 0 : 1;
  }
  const num = (k: string, d: number) => (typeof args[k] === "string" ? Number(args[k]) : d);
  // Several app servers, comma-separated, stand in for a host that scales out (Vercel): screens are spread over them.
  const bases = args.base.split(",").map((b) => b.trim().replace(/\/$/, ""));
  const base = bases.join(",");
  const screens = num("screens", 4);
  const durationMs = num("duration", 120) * 1000;
  const thinkMs = num("think", 6) * 1000;
  const burstMs = typeof args.burst === "string" ? Number(args.burst) * 1000 : null;
  const url = required("SUPABASE_URL");
  const anonKey = required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const admin = createClient(url, required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const { data: event } = await admin.from("events").select("id, is_rehearsal").eq("slug", args.slug).single();
  if (!event?.is_rehearsal) throw new Error(`${args.slug} is not a rehearsal event`);
  const { data: teams } = await admin.from("teams").select("code, track").eq("event_id", event.id).order("code");
  const list = (teams ?? []) as { code: string; track: Track }[];

  if (typeof args.rush === "string") return rush(list, Number(args.rush) * 1000, screens, bases, url, anonKey, args.slug as string);

  // 1. Sign every team in once; its screens share the session, as a team's phones do after one login each.
  let t0 = Date.now();
  const cookies = await pool(list, 10, (t) =>
    sessionCookie(url, anonKey, teamEmail(t.code, required("TEAM_EMAIL_DOMAIN")), derivePassword(required("CARD_SECRET"), args.slug as string, t.code)),
  );
  console.log(`${list.length} teams signed in in ${((Date.now() - t0) / 1000).toFixed(1)} s; ${list.length * screens} screens start`);

  // 2. Every screen browses until the end, starting at a random moment in the first think time (a room filling up).
  const latencies: number[] = [];
  const byPage = new Map<string, number[]>();
  const errors: Record<string, number> = {};
  let requests = 0;
  const end = Date.now() + durationMs;
  t0 = Date.now();
  let lastDone = 0;
  const screen = async (team: number, n: number) => {
    const { track } = list[team]!;
    await sleep(Math.random() * (burstMs ?? thinkMs));
    for (let i = n; burstMs !== null ? i === n : Date.now() < end; i++) {
      const path = PAGES[track][i % PAGES[track].length]!;
      const started = Date.now();
      requests++;
      try {
        const r = await fetch(bases[(team * screens + n) % bases.length] + path, { headers: { cookie: cookies[team]!, "user-agent": "app-load-test" }, redirect: "manual", signal: AbortSignal.timeout(30_000) });
        await r.arrayBuffer();
        const ms = Date.now() - started;
        lastDone = Math.max(lastDone, Date.now());
        if (r.status !== 200) errors[`${r.status} ${path}`] = (errors[`${r.status} ${path}`] ?? 0) + 1;
        else {
          latencies.push(ms);
          byPage.set(path, [...(byPage.get(path) ?? []), ms]);
        }
      } catch (e) {
        const k = `${(e as Error).name} ${path}`;
        errors[k] = (errors[k] ?? 0) + 1;
      }
      if (burstMs === null) await sleep(thinkMs * (0.5 + Math.random()));
    }
  };
  await Promise.all(list.flatMap((_, team) => Array.from({ length: screens }, (_, n) => screen(team, n))));

  const failed = Object.values(errors).reduce((a, b) => a + b, 0);
  const seconds = (Date.now() - t0) / 1000;
  const report = {
    base,
    slug: args.slug,
    screens: list.length * screens,
    seconds: Math.round(seconds),
    ...(burstMs !== null ? { burstSpreadS: burstMs / 1000, allServedAfterS: Math.round((lastDone - t0) / 100) / 10 } : {}),
    requests,
    perSecond: Math.round((requests / seconds) * 10) / 10,
    latencyMs: { p50: pct(latencies, 50), p95: pct(latencies, 95), p99: pct(latencies, 99), max: pct(latencies, 100) },
    pagesP95: Object.fromEntries([...byPage].map(([p, xs]) => [p, pct(xs, 95)])),
    errorRate: requests ? failed / requests : 0,
    errors,
    targets: { p95Ms: P95_TARGET_MS, errorRate: ERROR_TARGET },
  };
  const ok = (report.latencyMs.p95 ?? Infinity) <= P95_TARGET_MS && report.errorRate <= ERROR_TARGET;
  mkdirSync("out", { recursive: true });
  const file = `out/app-load-test-${args.slug}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify({ ...report, ok }, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`${ok ? "PASS" : "FAIL"}: p95 ${report.latencyMs.p95} ms (target ${P95_TARGET_MS}), errors ${(report.errorRate * 100).toFixed(2)}% (target ${ERROR_TARGET * 100}%). Report: ${file}`);
  return ok ? 0 : 1;
}

/** Check-in: every phone signs in itself within `spreadMs`, then loads its home page once. */
async function rush(
  list: { code: string; track: Track }[],
  spreadMs: number,
  screens: number,
  bases: string[],
  url: string,
  anonKey: string,
  slug: string,
): Promise<number> {
  const signIns: number[] = [];
  const pages: number[] = [];
  const refused: Record<string, number> = {};
  const t0 = Date.now();
  let last = 0;
  const phone = async (team: number, n: number) => {
    const t = list[team]!;
    await sleep(Math.random() * spreadMs);
    const started = Date.now();
    let cookie: string;
    try {
      cookie = await sessionCookie(url, anonKey, teamEmail(t.code, required("TEAM_EMAIL_DOMAIN")), derivePassword(required("CARD_SECRET"), slug, t.code), true);
      signIns.push(Date.now() - started);
    } catch (e) {
      const k = `sign-in ${(e as { status?: number }).status ?? (e as Error).name}`;
      refused[k] = (refused[k] ?? 0) + 1;
      return;
    }
    const p0 = Date.now();
    try {
      const r = await fetch(bases[(team * screens + n) % bases.length] + "/team", { headers: { cookie, "user-agent": "app-load-test" }, redirect: "manual", signal: AbortSignal.timeout(30_000) });
      const html = await r.text();
      if (r.status === 200 && html.includes("<title>Home")) pages.push(Date.now() - p0);
      else refused[`home ${r.status}`] = (refused[`home ${r.status}`] ?? 0) + 1;
    } catch (e) {
      refused[`home ${(e as Error).name}`] = (refused[`home ${(e as Error).name}`] ?? 0) + 1;
    }
    last = Math.max(last, Date.now());
  };
  await Promise.all(list.flatMap((_, team) => Array.from({ length: screens }, (_, n) => phone(team, n))));
  const phones = list.length * screens;
  const failed = Object.values(refused).reduce((a, b) => a + b, 0);
  const report = {
    phones,
    spreadS: spreadMs / 1000,
    signedIn: signIns.length,
    homeLoaded: pages.length,
    signInMs: { p50: pct(signIns, 50), p95: pct(signIns, 95), max: pct(signIns, 100) },
    homeMs: { p50: pct(pages, 50), p95: pct(pages, 95), max: pct(pages, 100) },
    allDoneAfterS: Math.round((last - t0) / 100) / 10,
    failures: refused,
  };
  const ok = failed === 0 && (report.signInMs.p95 ?? Infinity) <= P95_TARGET_MS;
  mkdirSync("out", { recursive: true });
  const file = `out/app-load-test-rush-${slug}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify({ ...report, ok }, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(
    `${ok ? "PASS" : "FAIL"}: ${signIns.length} of ${phones} phones signed in (p95 ${report.signInMs.p95} ms), ${pages.length} opened their home page.` +
      (refused["sign-in 429"] ? ` ${refused["sign-in 429"]} were refused by the sign-in rate limit: raise it (Supabase → Authentication → Rate Limits).` : "") +
      ` Report: ${file}`,
  );
  return ok ? 0 : 1;
}

main().then((code) => process.exit(code), (e) => {
  console.error(e);
  process.exit(1);
});
