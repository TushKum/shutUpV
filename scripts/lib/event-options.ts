// Shared between seed.ts and login-cards.ts so both derive exactly the same plan (and passwords).

import { readFileSync } from "node:fs";
import { EVENT_FORMATS, eventStartIST, type EventFormat } from "@msim/engine";
import { required } from "./args";
import {
  crisisCardsFromCsv,
  problemCardsFromCsv,
  staffFromCsv,
  teamRowsFromCsv,
  type SeedOptions,
} from "./seed-plan";

export const USAGE = `Options:
  --slug <slug>            event id, e.g. live-2026 (required)
  --name <name>            event name (default "Market Simulation")
  --date <YYYY-MM-DD>      event day; 20:00 IST that day is the start (live events)
  --starts-at <ISO time>   exact start instead of --date (rehearsals)
  --rehearsal              rehearsal event: X-prefixed codes, may have fewer teams
  --speed <n>              clock speed (default 1; rehearsal default 10)
  --teams-per-track <n>    default 50
  --teams <csv>            team names and members (optional)
  --staff <csv>            organiser, fairness officer and display logins (optional)
  --problems <csv>         problem deck (default seed/problem-cards.csv)
  --crises <csv>           crisis deck (default seed/crisis-cards.csv)
  --format <CLASSIC|PRIMUS> CLASSIC: the one-night game; PRIMUS: three rounds (docs/PRIMUS.md). Default PRIMUS
  --commitment <sha256>    published SHA-256 of the secret lottery seed (pnpm new-seed; can be set in /admin until the event starts)
Environment: CARD_SECRET, TEAM_EMAIL_DOMAIN`;

function parseFormat(raw: string | undefined): EventFormat {
  const f = (raw ?? "PRIMUS").toUpperCase();
  if (!(EVENT_FORMATS as readonly string[]).includes(f)) throw new Error(`--format is CLASSIC or PRIMUS (got ${raw})`);
  return f as EventFormat;
}

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
    name: str("name") ?? (rehearsal ? "Market Simulation (rehearsal)" : "Market Simulation"),
    rehearsal,
    clockSpeed: Number(str("speed") ?? (rehearsal ? 10 : 1)),
    startsAt,
    teamsPerTrack: Number(str("teams-per-track") ?? 50),
    cardSecret: required("CARD_SECRET"),
    emailDomain: required("TEAM_EMAIL_DOMAIN"),
    teamRows: str("teams") ? teamRowsFromCsv(read(str("teams")!)) : undefined,
    staff: str("staff") ? staffFromCsv(read(str("staff")!)) : undefined,
    problemCards: problemCardsFromCsv(read(str("problems") ?? "seed/problem-cards.csv")),
    crisisCards: crisisCardsFromCsv(read(str("crises") ?? "seed/crisis-cards.csv")),
    seedCommitment: str("commitment"),
    format: parseFormat(str("format")),
  };
}
