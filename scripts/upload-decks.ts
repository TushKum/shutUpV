// Uploads the three Content-page files (problem deck, crisis deck, Round 3 statements) into an event from the
// organiser laptop, exactly as the Content page does: each file is checked with the page's own parsers, then sent to
// the same database functions, signed in as an organiser (so the database's own rules apply: the decks lock at the
// squad draw, statements can be replaced until the first pick).
//
//   pnpm upload-decks --slug live-2026 [--dir seed/sectors] [--staff seed/staff.csv] [--email lead@…]
//
// The organiser is the first ORGANISER in the staff file (or --email); its password is derived from CARD_SECRET, as
// printed in out/<slug>-staff-logins.txt. Needs SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and CARD_SECRET in .env.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parseCsv } from "@msim/engine";
import { parseCrisisDeck, parseProblemDeck, parseStatements } from "../apps/web/lib/admin/content";
import { parseArgs, required } from "./lib/args";
import { derivePassword } from "./lib/credentials";

/** The first ORGANISER's email in a staff CSV (columns: email, role, name, roll_number). */
export function organiserEmail(staffCsv: string): string | null {
  const [head, ...rows] = parseCsv(staffCsv);
  const e = head?.indexOf("email") ?? -1;
  const r = head?.indexOf("role") ?? -1;
  if (e < 0 || r < 0) return null;
  const row = rows.find((x) => (x[r] ?? "").trim().toUpperCase() === "ORGANISER" && (x[e] ?? "").includes("@"));
  return row ? row[e]!.trim().toLowerCase() : null;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const slug = typeof args.slug === "string" ? args.slug : "";
  if (!slug || args.help) {
    console.log("pnpm upload-decks --slug <event> [--dir seed/sectors] [--staff seed/staff.csv] [--email organiser@…]");
    return slug ? 0 : 1;
  }
  const dir = typeof args.dir === "string" ? args.dir : "seed/sectors";
  const email = typeof args.email === "string" ? args.email.trim().toLowerCase() : organiserEmail(readFileSync(typeof args.staff === "string" ? args.staff : "seed/staff.csv", "utf8"));
  if (!email) {
    console.log("No ORGANISER in the staff file: pass --email with an organiser's login.");
    return 1;
  }

  // 1. Check every file before sending anything.
  const read = (name: string) => readFileSync(join(dir, name), "utf8");
  const problems = parseProblemDeck(read("problem-cards.csv"));
  const crises = parseCrisisDeck(read("crisis-cards.csv"));
  const statements = parseStatements(read("statements.csv"));
  for (const [name, p] of [["problem-cards.csv", problems], ["crisis-cards.csv", crises], ["statements.csv", statements]] as const) {
    if (!p.ok) {
      console.log(`✘ ${dir}/${name}: ${p.message}`);
      return 1;
    }
  }

  // 2. Sign in as the organiser, as the Content page would be used.
  const sb = createClient(required("SUPABASE_URL"), required("NEXT_PUBLIC_SUPABASE_ANON_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await sb.auth.signInWithPassword({ email, password: derivePassword(required("CARD_SECRET"), "staff", email) });
  if (signInError) {
    console.log(`✘ cannot sign in as ${email}: ${signInError.message} (is CARD_SECRET the one the event was seeded with?)`);
    return 1;
  }
  const { data: event } = await sb.from("events").select("id, name, current_phase").eq("slug", slug).maybeSingle();
  if (!event) {
    console.log(`✘ no event "${slug}" visible to ${email}`);
    return 1;
  }
  console.log(`Event "${event.name}" (${event.current_phase}), signed in as ${email}\n`);

  // 3. Upload, as the Content page's three buttons do.
  let failed = 0;
  const send = async (label: string, fn: string, params: Record<string, unknown>, count: number) => {
    const { data, error } = await sb.rpc(fn, params);
    const r = data as { ok?: boolean; message?: string; code?: string } | null;
    if (error || !r?.ok) {
      failed++;
      console.log(`✘ ${label}: ${error?.message ?? r?.message ?? r?.code ?? "refused"}`);
    } else console.log(`✔ ${label}: ${count} uploaded (the previous ones were replaced)`);
  };
  if (problems.ok) await send("Problem deck", "upload_problem_deck", { p_event: event.id, p_cards: problems.value }, problems.value.length);
  if (crises.ok) await send("Crisis deck", "upload_crisis_deck", { p_event: event.id, p_cards: crises.value }, crises.value.length);
  if (statements.ok) await send("Round 3 statements", "set_problem_statements", { p_event: event.id, p_rows: statements.value }, statements.value.length);

  console.log(failed ? `\n${failed} upload${failed === 1 ? "" : "s"} refused: the message says why (for example, the decks lock at the squad draw).` : "\nAll three uploaded. Check them on the control panel's Content page.");
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
