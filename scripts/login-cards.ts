// Prints the login cards for an event. Passwords are re-derived from CARD_SECRET, so this can be run
// again at any time (for example to reprint a lost card) with the same options used for seeding.
//
//   CARD_SECRET=… TEAM_EMAIL_DOMAIN=… APP_URL=https://… \
//     pnpm cards --slug live-2026 --date 2026-11-14 [--teams seed/teams.csv] [--only P07,F12]

import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "./lib/args";
import { renderLoginCards } from "./lib/cards";
import { optionsFromArgs } from "./lib/event-options";
import { buildSeedPlan } from "./lib/seed-plan";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = buildSeedPlan(optionsFromArgs(args));
  const only = typeof args.only === "string" ? new Set(args.only.toUpperCase().split(",").map((s) => s.trim())) : null;
  const teams = plan.teams.filter((t) => !only || only.has(t.code));
  const appUrl = (process.env.APP_URL ?? "https://your-app.vercel.app").replace(/\/$/, "");

  const pdf = await renderLoginCards(
    teams.map((t) => ({ code: t.code, password: t.password, track: t.track, teamName: t.name })),
    { eventName: plan.event.name, loginUrl: `${appUrl}/login`, rehearsal: plan.event.is_rehearsal },
  );
  mkdirSync("out", { recursive: true });
  const file = `out/${plan.event.slug}-login-cards${only ? "-reprint" : ""}.pdf`;
  writeFileSync(file, pdf);
  console.log(`Wrote ${teams.length} cards to ${file}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
