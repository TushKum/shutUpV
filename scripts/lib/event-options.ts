// Shared between seed.ts and login-cards.ts so both derive exactly the same plan (and passwords).

import { readFileSync } from "node:fs";
import { eventStartIST } from "@msim/engine";
import { required } from "./args";
import {
  bulletinFromCsv,
  crisisCardsFromCsv,
  problemCardsFromCsv,
  staffFromCsv,
  teamRowsFromCsv,
  type SeedOptions,
} from "./seed-plan";

export const USAGE = `Options:
  --slug <slug>            event id, e.g. live-2026 (required)
  --name <name>            event name (default "PRIMUS")
  --date <YYYY-MM-DD>      event day; 20:00 IST that day is the planned start (the night starts when an organiser starts it)
  --starts-at <ISO time>   exact planned start instead of --date (rehearsals: the autopilot starts the night then)
  --rehearsal              rehearsal event: X001… codes, may have fewer teams
  --speed <n>              clock speed: every default duration divided by it (default 1; rehearsal default 10)
  --team-count <n>         number of teams (default 150; rehearsals may use fewer)
  --code-letter <A-Z>      rehearsal team-code letter (default X)
  --backups <n>            backup teams an organiser can activate before the draw (default 10 live: B001–B010;
                           0 in a rehearsal, whose backups are Y001…)
  --backup-teams <csv>     names and members of the backup teams (optional, same columns as --teams)
  --teams <csv>            team names and members (optional)
  --staff <csv>            organiser, fairness officer and display logins (optional)
  --problems <csv>         problem deck (default seed/problem-cards.csv)
  --crises <csv>           crisis deck (default seed/crisis-cards.csv)
  --twist <csv>            the twist, published an hour into Build (default seed/twist.csv; it can be edited in /admin)
  --commitment <sha256>    published SHA-256 of the secret lottery seed (pnpm new-seed; can be set in /admin until the event starts)
Environment: CARD_SECRET, TEAM_EMAIL_DOMAIN`;

export function optionsFromArgs(args: Record<string, string | true>): SeedOptions {
  const str = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : undefined);
  const slug = str("slug");
  if (!slug) throw new Error(`--slug is required\n\n${USAGE}`);
  const rehearsal = args.rehearsal === true;
  const startsAt = str("starts-at")
    ? new Date(str("starts-at")!)
    : str("date")
      ? eventStartIST(str("date")!)
      : null;
  if (!startsAt || Number.isNaN(startsAt.getTime())) throw new Error(`--date or --starts-at is required\n\n${USAGE}`);
  const read = (path: string) => readFileSync(path, "utf8");
  return {
    slug,
    name: str("name") ?? (rehearsal ? "PRIMUS (rehearsal)" : "PRIMUS"),
    rehearsal,
    clockSpeed: Number(str("speed") ?? (rehearsal ? 10 : 1)),
    startsAt,
    teamCount: Number(str("team-count") ?? 150),
    codeLetter: str("code-letter"),
    backupCount: str("backups") !== undefined ? Number(str("backups")) : undefined,
    backupRows: str("backup-teams") ? teamRowsFromCsv(read(str("backup-teams")!)) : undefined,
    cardSecret: required("CARD_SECRET"),
    emailDomain: required("TEAM_EMAIL_DOMAIN"),
    teamRows: str("teams") ? teamRowsFromCsv(read(str("teams")!)) : undefined,
    staff: str("staff") ? staffFromCsv(read(str("staff")!)) : undefined,
    problemCards: problemCardsFromCsv(read(str("problems") ?? "seed/problem-cards.csv")),
    crisisCards: crisisCardsFromCsv(read(str("crises") ?? "seed/crisis-cards.csv")),
    twist: bulletinFromCsv(read(str("twist") ?? "seed/twist.csv"), "twist"),
    seedCommitment: str("commitment"),
  };
}
