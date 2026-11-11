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
import { createClient } from "@supabase/supabase-js";
import { parseArgs, required } from "./lib/args";
import { renderLoginCards } from "./lib/cards";
import { USAGE, optionsFromArgs } from "./lib/event-options";
import { buildSeedPlan } from "./lib/seed-plan";
import { seedWithLogins } from "./lib/seed-run";

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
    const { eventId } = await seedWithLogins(sb, plan, { replace: args.replace === true });
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
