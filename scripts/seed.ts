// Seeds an event: creates (or refreshes) the auth logins, then calls public.seed_event() which writes the
// event, schedule, 150 teams, members, accounts, companies, starting cash and decks in one transaction.
// Finally prints the login cards and the staff credentials.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… CARD_SECRET=… TEAM_EMAIL_DOMAIN=… APP_URL=… \
//     pnpm seed --slug live-2026 --date 2026-11-14 --teams seed/teams.csv --staff seed/staff.csv
//
// Add --dry-run to only build the plan and the PDF. Add --replace to purge and re-seed an event that is
// still in SETUP (or any rehearsal event).

import { mkdirSync, writeFileSync } from "node:fs";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { parseArgs, required } from "./lib/args";
import { renderLoginCards } from "./lib/cards";
import { USAGE, optionsFromArgs } from "./lib/event-options";
import { buildSeedPlan, toSeedPayload, type SeedPlan } from "./lib/seed-plan";

async function allUsers(sb: SupabaseClient): Promise<Map<string, User>> {
  const users = new Map<string, User>();
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) if (u.email) users.set(u.email.toLowerCase(), u);
    if (data.users.length < 1000) return users;
  }
}

/** Creates missing logins and resets existing ones to the derived password. Returns email → user id. */
async function ensureLogins(sb: SupabaseClient, plan: SeedPlan): Promise<Map<string, string>> {
  const existing = await allUsers(sb);
  const wanted = [
    ...plan.teams.map((t) => ({ email: t.email, password: t.password, role: "TEAM" })),
    ...plan.staff.map((s) => ({ email: s.email, password: s.password, role: s.role })),
  ];
  const ids = new Map<string, string>();
  let created = 0;
  let updated = 0;
  // Small batches keep well inside the Auth admin rate limits.
  for (let i = 0; i < wanted.length; i += 10) {
    await Promise.all(
      wanted.slice(i, i + 10).map(async (w) => {
        const user = existing.get(w.email);
        if (user) {
          const { error } = await sb.auth.admin.updateUserById(user.id, {
            password: w.password,
            app_metadata: { msim_role: w.role },
          });
          if (error) throw new Error(`update ${w.email}: ${error.message}`);
          ids.set(w.email, user.id);
          updated++;
        } else {
          const { data, error } = await sb.auth.admin.createUser({
            email: w.email,
            password: w.password,
            email_confirm: true,
            app_metadata: { msim_role: w.role },
          });
          if (error || !data.user) throw new Error(`create ${w.email}: ${error?.message}`);
          ids.set(w.email, data.user.id);
          created++;
        }
      }),
    );
  }
  console.log(`Logins: ${created} created, ${updated} refreshed`);
  return ids;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const plan = buildSeedPlan(optionsFromArgs(args));
  const appUrl = (process.env.APP_URL ?? "https://your-app.vercel.app").replace(/\/$/, "");
  console.log(
    `Event ${plan.event.slug}: ${plan.teams.length} teams, ${plan.staff.length} staff, ` +
      `${plan.problem_cards.length} problem cards, ${plan.crisis_cards.length} crisis cards, ` +
      `starts ${plan.event.starts_at} at ${plan.event.clock_speed}×`,
  );

  if (args["dry-run"] !== true) {
    const sb = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const ids = await ensureLogins(sb, plan);
    if (args.replace === true) {
      const { error } = await sb.rpc("purge_event", { p_slug: plan.event.slug });
      if (error) throw new Error(`purge_event: ${error.message}`);
    }
    const { data: eventId, error } = await sb.rpc("seed_event", { p: toSeedPayload(plan, ids) });
    if (error) throw new Error(`seed_event: ${error.message}`);
    console.log(`Seeded event ${eventId}`);
  }

  mkdirSync("out", { recursive: true });
  const pdf = await renderLoginCards(
    plan.teams.map((t) => ({ code: t.code, password: t.password, track: t.track, teamName: t.name })),
    { eventName: plan.event.name, loginUrl: `${appUrl}/login`, rehearsal: plan.event.is_rehearsal },
  );
  writeFileSync(`out/${plan.event.slug}-login-cards.pdf`, pdf);
  if (plan.staff.length) {
    writeFileSync(
      `out/${plan.event.slug}-staff-logins.txt`,
      plan.staff.map((s) => `${s.role.padEnd(9)} ${s.email}  ${s.password}`).join("\n") + "\n",
    );
  }
  console.log(`Wrote out/${plan.event.slug}-login-cards.pdf${plan.staff.length ? " and the staff logins" : ""}`);
  console.log("The out/ folder holds live passwords: print it, then keep it off shared drives.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
