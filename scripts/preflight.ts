// Checks a deployment end to end from the organiser laptop and says exactly what to fix: the .env, the Supabase
// project and its migrations, the event and its team logins (a real sign-in with a card's password), and the deployed
// app (/api/health: the same Supabase project and team-login domain as this .env).
//
//   pnpm preflight --slug live-2026
//   pnpm preflight --slug live-2026 --rush 60   (also: 60 sign-ins by different teams at 4 a second, a busy check-in,
//                                                to catch a sign-in rate limit too low for the room; it uses up that
//                                                many sign-ins from this laptop's address)
//
// Reads .env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY, CARD_SECRET, TEAM_EMAIL_DOMAIN,
// APP_URL). Exits 1 when a check fails. It changes nothing.

import { createClient } from "@supabase/supabase-js";
import { teamEmail, type Track } from "@msim/engine";
import { EXPECTED_SCHEMA } from "../apps/web/lib/schema";
import { parseArgs } from "./lib/args";
import { derivePassword } from "./lib/credentials";
import { limitRows, projectRef, readAuthConfig } from "./lib/auth-limits";

type Level = "PASS" | "WARN" | "FAIL";
const results: { level: Level; text: string; fix?: string }[] = [];
const say = (level: Level, text: string, fix?: string) => {
  results.push({ level, text, fix });
  console.log(`${level === "PASS" ? "✔" : level === "WARN" ? "!" : "✘"} ${level}  ${text}${fix ? `\n         → ${fix}` : ""}`);
};
const env = (k: string) => process.env[k]?.trim() || "";
const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const slug = typeof args.slug === "string" ? args.slug : "";
  if (!slug || args.help) {
    console.log("pnpm preflight --slug <event slug>   (checks .env, Supabase, the event's logins and the deployed app)");
    return slug ? 0 : 1;
  }

  // 1. The .env.
  console.log("\n.env");
  const need = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "CARD_SECRET", "TEAM_EMAIL_DOMAIN", "APP_URL"];
  const missing = need.filter((k) => !env(k));
  if (missing.length) say("FAIL", `missing in .env: ${missing.join(", ")}`, "add them (see .env.example and docs/DEPLOY.md section 3)");
  else say("PASS", "every variable is set");
  if (!env("SUPABASE_URL") || !env("SUPABASE_SERVICE_ROLE_KEY")) return finish();
  const domain = env("TEAM_EMAIL_DOMAIN").toLowerCase();
  const appUrl = env("APP_URL").replace(/\/$/, "");
  if (appUrl && !appUrl.startsWith("https://")) say("WARN", `APP_URL is ${appUrl}`, "use your site's https:// address: the login cards' QR codes open it");

  // 2. Supabase and its migrations.
  console.log("\nSupabase");
  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  const ping = await admin.from("events").select("id").limit(1);
  if (ping.error) {
    say("FAIL", `cannot read the database at ${hostOf(env("SUPABASE_URL"))}: ${ping.error.message}`, "check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Supabase → Project Settings → API), and that migrations were applied");
    return finish();
  }
  say("PASS", `database reachable at ${hostOf(env("SUPABASE_URL"))}`);
  const v = await admin.rpc("schema_version");
  const version = typeof v.data === "string" ? v.data : null;
  if (version === EXPECTED_SCHEMA) say("PASS", `migrations up to date (${version})`);
  else
    say(
      "FAIL",
      `database at ${version ?? "a version before 20261117000050"}, this code needs ${EXPECTED_SCHEMA}`,
      "apply the migrations: supabase link --project-ref <ref> && supabase db push",
    );

  // 2b. Auth's rate limits, read exactly (Management API; no sign-ins used) when a personal access token is set.
  const pat = env("SUPABASE_ACCESS_TOKEN");
  const ref = projectRef(env("SUPABASE_URL"));
  if (pat && ref) {
    try {
      const rows = limitRows(await readAuthConfig(pat, ref)).filter((r) => r.min !== null);
      for (const r of rows) {
        if (r.ok) say("PASS", `Auth limit "${r.label}" is ${r.value} per 5 minutes (needs ≥ ${r.min})`);
        else
          say(
            "FAIL",
            `Auth limit "${r.label}" is ${r.value ?? "unknown"} per 5 minutes, too low for 600 people (needs ≥ ${r.min})`,
            "run pnpm auth-limits --set, or Supabase → Authentication → Rate Limits, then Save changes",
          );
      }
    } catch (e) {
      say("WARN", `could not read the Auth rate limits: ${(e as Error).message}`, "check SUPABASE_ACCESS_TOKEN (supabase.com/dashboard/account/tokens)");
    }
  } else {
    say("WARN", "Auth rate limits not checked", "add SUPABASE_ACCESS_TOKEN to .env (supabase.com/dashboard/account/tokens) to check them exactly, or use --rush 60");
  }

  // 3. The event and its team logins.
  console.log(`\nEvent ${slug}`);
  const { data: event } = await admin.from("events").select("id, name, format, current_phase, is_rehearsal").eq("slug", slug).maybeSingle();
  if (!event) {
    say("FAIL", `no event with slug "${slug}"`, "create it with pnpm seed (same --slug), or pass the slug you seeded");
    return finish();
  }
  say("PASS", `"${event.name}": ${event.format}, phase ${event.current_phase}${event.is_rehearsal ? " (rehearsal)" : ""}`);
  const { data: teams } = await admin.from("teams").select("id, code, track").eq("event_id", event.id).order("code");
  const list = (teams ?? []) as { id: string; code: string; track: Track }[];
  const { data: accounts } = await admin.from("accounts").select("team_id, user_id").in("team_id", list.map((t) => t.id));
  const accountOf = new Map((accounts ?? []).map((a) => [a.team_id as string, a.user_id as string]));
  const without = list.filter((t) => !accountOf.has(t.id));
  if (!list.length) say("FAIL", "the event has no teams", "run pnpm seed for this event");
  else if (without.length) say("FAIL", `${without.length} of ${list.length} teams have no login (e.g. ${without[0]!.code})`, "run pnpm seed again with the same options: it creates the missing logins");
  else say("PASS", `${list.length} teams, each with a login`);

  const anon = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const samples = (["PRODUCT", "CONSULTING", "FINANCE"] as Track[]).map((tr) => list.find((t) => t.track === tr && accountOf.has(t.id))).filter(Boolean) as typeof list;
  for (const t of samples) {
    const user = await admin.auth.admin.getUserById(accountOf.get(t.id)!);
    const email = user.data.user?.email ?? "";
    const expected = teamEmail(t.code, domain);
    if (email !== expected) {
      say(
        "FAIL",
        `${t.code}'s login is ${email || "missing"}, but TEAM_EMAIL_DOMAIN makes it ${expected}`,
        `set TEAM_EMAIL_DOMAIN (laptop .env) and NEXT_PUBLIC_TEAM_EMAIL_DOMAIN (Vercel) both to "${email.split("@")[1] ?? domain}", then redeploy Vercel`,
      );
      continue;
    }
    if (!anon || !env("CARD_SECRET")) continue;
    const sb = createClient(env("SUPABASE_URL"), anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await sb.auth.signInWithPassword({ email, password: derivePassword(env("CARD_SECRET"), slug, t.code) });
    if (!error) say("PASS", `${t.code} signs in with the password on its card`);
    else if (error.status === 429) say("WARN", `${t.code}: too many sign-in attempts right now`, "wait a minute; before the night raise Auth → Rate Limits (docs/DEPLOY.md section 2)");
    else
      say(
        "FAIL",
        `${t.code} cannot sign in with its card's password (${error.message})`,
        "CARD_SECRET is not the one used by pnpm seed. Put the original back, or run pnpm seed again with the same options to reset every password to this CARD_SECRET, then reprint the cards (pnpm cards)",
      );
  }

  // 3b. Optional: the sign-in rate limit, with a burst of real sign-ins (check-in puts hundreds behind a few addresses).
  const rushN = typeof args.rush === "string" ? Number(args.rush) : args.rush === true ? 60 : 0;
  if (rushN > 0 && anon && env("CARD_SECRET") && list.length) {
    // Like check-in: different teams (round the list), not one account signing in again and again.
    const rushTeams = Array.from({ length: rushN }, (_, i) => list[i % list.length]!);
    let ok = 0;
    let limited = 0;
    let other = 0;
    const one = async (t: { code: string }) => {
      const sb = createClient(env("SUPABASE_URL"), anon, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error } = await sb.auth.signInWithPassword({ email: teamEmail(t.code, domain), password: derivePassword(env("CARD_SECRET"), slug, t.code) });
      if (!error) ok++;
      else if (error.status === 429) limited++;
      else other++;
    };
    // Paced like a busy check-in (4 sign-ins a second), not all at once: Supabase lets about 30 through in one instant
    // and then refills at the configured rate; the app also retries a refused sign-in quietly.
    await Promise.all(rushTeams.map((t, i) => new Promise<void>((done) => setTimeout(() => void one(t).then(done), i * 250))));
    if (limited)
      say(
        "FAIL",
        `${limited} of ${rushN} quick sign-ins (${Math.min(rushN, list.length)} different teams) were refused by the sign-in rate limit`,
        "Supabase → Authentication → Rate Limits: \"token refreshes\" 1800 (password sign-ins count against it) and \"sign-ups and sign-ins\" 1000, click Save changes (reload to confirm), then wait 5 minutes without signing in from this laptop and run this once",
      );
    else if (other) say("WARN", `${other} of ${rushN} quick sign-ins failed (not the rate limit)`, "look at Supabase → Logs → Auth for the errors");
    else say("PASS", `${ok} quick sign-ins by ${Math.min(rushN, list.length)} different teams were all accepted (no rate limit hit)`);
  }

  // 4. The deployed app.
  console.log(`\nApp ${appUrl || "(APP_URL not set)"}`);
  if (appUrl) {
    let health: Record<string, unknown> | null = null;
    try {
      const r = await fetch(`${appUrl}/api/health`, { signal: AbortSignal.timeout(20_000), headers: { "user-agent": "msim-doctor" } });
      health = (await r.json()) as Record<string, unknown>;
    } catch (e) {
      say("FAIL", `cannot open ${appUrl}/api/health (${(e as Error).message})`, "check the domain's DNS in Vercel → Settings → Domains, and that the latest deployment is live");
    }
    if (health) {
      if (health.database === "ok") say("PASS", "the app reaches its database");
      else say("FAIL", "the app cannot reach its database", "check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel, then redeploy");
      if (health.schema === "ok") say("PASS", "the app and its database are on the same version");
      else if (health.schema === "unknown") say("WARN", "the app cannot read the database version", "set SUPABASE_SERVICE_ROLE_KEY in Vercel (server only), then redeploy");
      else if (health.schema !== undefined) say("FAIL", `the app reports the database ${String(health.schema)} (${String(health.schemaVersion)} vs ${String(health.expectedSchema)})`, "apply the migrations (supabase db push) or deploy the latest code");
      if (health.supabaseHost === undefined) say("WARN", "the deployed app is older than this code", "redeploy the latest commit on Vercel, then run pnpm preflight again");
      else {
        if (health.supabaseHost === hostOf(env("SUPABASE_URL"))) say("PASS", `the app uses the same Supabase project (${String(health.supabaseHost)})`);
        else
          say(
            "FAIL",
            `the app uses Supabase ${String(health.supabaseHost)}, the laptop seeded ${hostOf(env("SUPABASE_URL"))}`,
            "point Vercel's NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY at the seeded project, then redeploy",
          );
        if (health.teamEmailDomain === domain) say("PASS", `the app uses the same team-login domain (${domain})`);
        else
          say(
            "FAIL",
            `the app's NEXT_PUBLIC_TEAM_EMAIL_DOMAIN is ${String(health.teamEmailDomain ?? "not set")}, the cards were made with ${domain}: every team login fails`,
            `set NEXT_PUBLIC_TEAM_EMAIL_DOMAIN=${domain} in Vercel (Production), then redeploy (it is built into the app)`,
          );
      }
    }
  }
  return finish();
}

function finish(): number {
  const failed = results.filter((r) => r.level === "FAIL").length;
  const warned = results.filter((r) => r.level === "WARN").length;
  console.log(`\n${failed ? `${failed} problem${failed === 1 ? "" : "s"} to fix` : "All checks passed"}${warned ? `, ${warned} warning${warned === 1 ? "" : "s"}` : ""}.`);
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
