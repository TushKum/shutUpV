// Builds everything the seed needs, without touching the network: team codes, names, members,
// derived passwords, staff, the night's schedule and the content decks.

import {
  TRACKS,
  buildSchedule,
  teamCode,
  teamEmail,
  type BuiltSchedule,
  type Track,
} from "@msim/engine";
import { derivePassword } from "./credentials";
import { parseCsvObjects } from "./csv";

export const STARTING_CASH_CENTS: Record<Track, number> = {
  PRODUCT: 0, // receives $50,000 seed money when its squad is formed
  CONSULTING: 0,
  FINANCE: 50_000_000, // $500,000
};

export interface MemberRow {
  full_name: string;
  roll_number?: string;
}

export interface TeamRow {
  track: Track;
  name?: string;
  members?: MemberRow[];
}

export interface StaffRow {
  email: string;
  role: "ORGANISER" | "FAIRNESS" | "DISPLAY";
  name: string;
  roll_number?: string;
}

export interface ProblemCard {
  number: number;
  sector: string;
  title: string;
  body: string;
}

export interface CrisisCard {
  category: string;
  number: number;
  title: string;
  body: string;
}

export interface SeedOptions {
  slug: string;
  name: string;
  rehearsal: boolean;
  clockSpeed: number;
  startsAt: Date;
  teamsPerTrack: number;
  cardSecret: string;
  emailDomain: string;
  teamRows?: TeamRow[];
  staff?: StaffRow[];
  problemCards?: ProblemCard[];
  crisisCards?: CrisisCard[];
  seedCommitment?: string;
  /** Letter before every team code. Default: none for the live event, "X" for a rehearsal. */
  codePrefix?: string;
}

export interface PlannedTeam {
  code: string;
  track: Track;
  name: string;
  email: string;
  password: string;
  members: MemberRow[];
}

export interface PlannedStaff extends StaffRow {
  password: string;
}

export interface SeedPlan {
  event: {
    slug: string;
    name: string;
    is_rehearsal: boolean;
    clock_speed: number;
    timezone: "Asia/Kolkata";
    starts_at: string;
    seed_commitment: string | null;
  };
  schedule: BuiltSchedule;
  teams: PlannedTeam[];
  staff: PlannedStaff[];
  problem_cards: ProblemCard[];
  crisis_cards: CrisisCard[];
  starting_cash_cents: Record<Track, number>;
}

const DEFAULT_NAME: Record<Track, (code: string) => string> = {
  PRODUCT: (c) => `Product Team ${c}`,
  CONSULTING: (c) => `Consulting Team ${c}`,
  FINANCE: (c) => `Finance Team ${c}`,
};

export function buildSeedPlan(o: SeedOptions): SeedPlan {
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(o.slug)) throw new Error(`bad event slug: ${o.slug}`);
  if (!o.rehearsal && o.teamsPerTrack !== 50) throw new Error("the live event has exactly 50 teams per track");
  if (o.teamsPerTrack < 3 || o.teamsPerTrack > 50) throw new Error("between 3 and 50 teams per track");
  if (o.seedCommitment && !/^[0-9a-f]{64}$/.test(o.seedCommitment)) {
    throw new Error("seed commitment must be a lower-case SHA-256 hex digest");
  }
  const prefix = o.codePrefix ?? (o.rehearsal ? "X" : "");
  if (!o.rehearsal && prefix !== "") throw new Error("live team codes have no prefix");

  const teams: PlannedTeam[] = [];
  for (const track of TRACKS) {
    const rows = (o.teamRows ?? []).filter((r) => r.track === track);
    if (rows.length > o.teamsPerTrack) {
      throw new Error(`${rows.length} ${track} teams in the CSV, but only ${o.teamsPerTrack} per track`);
    }
    for (let i = 1; i <= o.teamsPerTrack; i++) {
      const code = teamCode(track, i, prefix);
      const row = rows[i - 1];
      teams.push({
        code,
        track,
        name: row?.name?.trim() || DEFAULT_NAME[track](code),
        email: teamEmail(code, o.emailDomain),
        password: derivePassword(o.cardSecret, o.slug, code),
        members: (row?.members ?? []).filter((m) => m.full_name.trim() !== ""),
      });
    }
  }

  const staff: PlannedStaff[] = (o.staff ?? []).map((s) => ({
    ...s,
    email: s.email.trim().toLowerCase(),
    password: derivePassword(o.cardSecret, "staff", s.email.trim().toLowerCase()),
  }));

  const memberRolls = new Set(teams.flatMap((t) => t.members.map((m) => m.roll_number).filter(Boolean)));
  for (const s of staff) {
    if (s.roll_number && memberRolls.has(s.roll_number)) {
      throw new Error(`${s.name} (${s.roll_number}) is listed as a team member; organisers cannot belong to a team`);
    }
  }
  const allRolls = teams.flatMap((t) => t.members.map((m) => m.roll_number).filter(Boolean));
  const dup = allRolls.find((r, i) => allRolls.indexOf(r) !== i);
  if (dup) throw new Error(`roll number ${dup} appears in more than one team`);

  return {
    event: {
      slug: o.slug,
      name: o.name,
      is_rehearsal: o.rehearsal,
      clock_speed: o.clockSpeed,
      timezone: "Asia/Kolkata",
      starts_at: o.startsAt.toISOString(),
      seed_commitment: o.seedCommitment ?? null,
    },
    schedule: buildSchedule(o.startsAt, o.clockSpeed),
    teams,
    staff,
    problem_cards: o.problemCards ?? [],
    crisis_cards: o.crisisCards ?? [],
    starting_cash_cents: STARTING_CASH_CENTS,
  };
}

/** The JSON passed to public.seed_event(). Auth users must already exist (email → user id). */
export function toSeedPayload(plan: SeedPlan, userIds: ReadonlyMap<string, string>) {
  const idOf = (email: string) => {
    const id = userIds.get(email);
    if (!id) throw new Error(`no auth user for ${email}`);
    return id;
  };
  return {
    event: plan.event,
    schedule: plan.schedule,
    teams: plan.teams.map((t) => ({
      code: t.code,
      track: t.track,
      name: t.name,
      user_id: idOf(t.email),
      members: t.members,
    })),
    staff: plan.staff.map((s) => ({
      user_id: idOf(s.email),
      role: s.role,
      display_name: s.name,
      roll_number: s.roll_number ?? null,
    })),
    problem_cards: plan.problem_cards,
    crisis_cards: plan.crisis_cards,
    starting_cash_cents: plan.starting_cash_cents,
  };
}

// ───────────────────────────── CSV inputs ─────────────────────────────

const TRACK_ALIASES: Record<string, Track> = {
  product: "PRODUCT",
  p: "PRODUCT",
  consulting: "CONSULTING",
  c: "CONSULTING",
  finance: "FINANCE",
  f: "FINANCE",
};

/** Columns: track, team_name, member1_name, member1_roll, … member4_name, member4_roll. */
export function teamRowsFromCsv(text: string): TeamRow[] {
  return parseCsvObjects(text).map((r, i) => {
    const track = TRACK_ALIASES[(r.track ?? "").toLowerCase()];
    if (!track) throw new Error(`teams CSV row ${i + 2}: unknown track "${r.track}"`);
    const members: MemberRow[] = [];
    for (let m = 1; m <= 4; m++) {
      const full_name = r[`member${m}_name`] ?? "";
      if (full_name) members.push({ full_name, roll_number: r[`member${m}_roll`] || undefined });
    }
    return { track, name: r.team_name, members };
  });
}

/** Columns: email, role (ORGANISER | FAIRNESS | DISPLAY), name, roll_number. */
export function staffFromCsv(text: string): StaffRow[] {
  return parseCsvObjects(text).map((r, i) => {
    const role = (r.role ?? "").toUpperCase();
    if (role !== "ORGANISER" && role !== "FAIRNESS" && role !== "DISPLAY") {
      throw new Error(`staff CSV row ${i + 2}: role must be ORGANISER, FAIRNESS or DISPLAY`);
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email ?? "")) throw new Error(`staff CSV row ${i + 2}: bad email`);
    return { email: r.email!, role, name: r.name || r.email!, roll_number: r.roll_number || undefined };
  });
}

/** Columns: number, sector, title, body. */
export function problemCardsFromCsv(text: string): ProblemCard[] {
  const cards = parseCsvObjects(text).map((r, i) => {
    const number = Number(r.number);
    if (!Number.isInteger(number) || number < 1) throw new Error(`problem CSV row ${i + 2}: bad number`);
    if (!r.title || !r.body) throw new Error(`problem CSV row ${i + 2}: title and body are required`);
    return { number, sector: r.sector ?? "", title: r.title, body: r.body };
  });
  const numbers = new Set(cards.map((c) => c.number));
  if (numbers.size !== cards.length) throw new Error("problem CSV: card numbers must be unique");
  return cards;
}

/** Columns: category, number, title, body. */
export function crisisCardsFromCsv(text: string): CrisisCard[] {
  return parseCsvObjects(text).map((r, i) => {
    if (!r.category || !r.title || !r.body) throw new Error(`crisis CSV row ${i + 2}: category, title and body are required`);
    return { category: r.category, number: Number(r.number || 1), title: r.title, body: r.body };
  });
}
