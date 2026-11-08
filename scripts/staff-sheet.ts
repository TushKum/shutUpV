// The staff logins as a printable PDF, from the text file the seed wrote (nothing is read from the database, and the
// passwords never leave this laptop).
//
//   APP_URL=https://… pnpm staff-sheet --slug rehearsal [--name "PRIMUS (rehearsal)"] [--rehearsal]
//   → out/<slug>-staff-logins.pdf

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "./lib/args";
import { parseStaffLogins, renderStaffLogins } from "./lib/cards";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const slug = typeof args.slug === "string" ? args.slug : null;
  if (!slug) throw new Error("--slug is required (the event slug used with pnpm seed)");
  const file = `out/${slug}-staff-logins.txt`;
  const staff = parseStaffLogins(readFileSync(file, "utf8"));
  const appUrl = (process.env.APP_URL ?? "https://your-app.example").replace(/\/$/, "");
  const rehearsal = args.rehearsal === true || slug.includes("rehearsal");
  const name = typeof args.name === "string" ? args.name : rehearsal ? "PRIMUS (rehearsal)" : "PRIMUS";
  const pdf = await renderStaffLogins(staff, { eventName: name, loginUrl: `${appUrl}/login`, rehearsal });
  const out = `out/${slug}-staff-logins.pdf`;
  writeFileSync(out, pdf);
  console.log(`Wrote ${staff.length} staff logins to ${out}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
