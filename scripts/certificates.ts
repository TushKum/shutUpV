// Prints the certificates after the awards: one page per participant (scripts/lib/certificates.ts), from the final
// results and the awards. Run it once the event is in AWARDS.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… pnpm certificates --event primus-2026 [--date "20 November 2026"] [--only T007,T112]
//
// Writes out/<slug>-certificates.pdf. The out/ folder is never committed.

import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { AwardCode } from "@msim/engine";
import { parseArgs, required } from "./lib/args";
import { renderCertificates, type CertificateTeam } from "./lib/certificates";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || typeof args.event !== "string") {
    console.log('usage: pnpm certificates --event <slug> [--date "20 November 2026"] [--only CODES]');
    return args.help ? 0 : 2;
  }
  const sb = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: event, error } = await sb.from("events").select("id, slug, name, is_rehearsal, current_phase, settled_at").eq("slug", args.event).maybeSingle();
  if (error || !event) throw new Error(`no event ${args.event}${error ? `: ${error.message}` : ""}`);
  if (!event.settled_at) throw new Error("The results are not settled yet: print the certificates once the event is in AWARDS.");

  const [teams, members, results, awards] = await Promise.all([
    sb.from("teams").select("id, code, name").eq("event_id", event.id).order("code"),
    sb.from("members").select("team_id, full_name").eq("event_id", event.id).order("full_name"),
    sb.from("results").select("team_id, r1_points, r2_points, r3_points, total, rank, eligible").eq("event_id", event.id),
    sb.from("awards").select("team_id, code").eq("event_id", event.id),
  ]);
  for (const r of [teams, members, results, awards]) if (r.error) throw new Error(r.error.message);
  const only = typeof args.only === "string" ? new Set(args.only.toUpperCase().split(",").map((s) => s.trim())) : null;
  const byTeam = new Map((results.data ?? []).map((r) => [r.team_id as string, r]));
  const list: CertificateTeam[] = (teams.data ?? [])
    .filter((t) => !only || only.has(t.code as string))
    .map((t) => {
      const r = byTeam.get(t.id as string);
      return {
        code: t.code as string,
        name: t.name as string,
        members: (members.data ?? []).filter((m) => m.team_id === t.id).map((m) => m.full_name as string),
        rank: r?.eligible ? ((r.rank as number | null) ?? null) : null,
        r1: (r?.r1_points as number) ?? 0,
        r2: (r?.r2_points as number) ?? 0,
        r3: (r?.r3_points as number) ?? 0,
        total: (r?.total as number) ?? 0,
        awards: (awards.data ?? []).filter((a) => a.team_id === t.id).map((a) => a.code as AwardCode),
      };
    });
  const ranked = (results.data ?? []).filter((r) => r.eligible && r.rank !== null).length;
  const pdf = await renderCertificates(list, {
    eventName: event.name as string,
    date: typeof args.date === "string" ? args.date : "20 November 2026",
    ranked,
    rehearsal: event.is_rehearsal as boolean,
  });
  mkdirSync("out", { recursive: true });
  const file = `out/${event.slug}-certificates${only ? "-reprint" : ""}.pdf`;
  writeFileSync(file, pdf);
  console.log(`Wrote ${list.reduce((s, t) => s + t.members.length, 0)} certificates for ${list.length} teams to ${file}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
