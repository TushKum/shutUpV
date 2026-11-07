// Builds everything the seed needs, without touching the network: team codes, names, members, derived passwords,
// staff, the night's schedule, the content decks and the twist.

import {
  parseCsvObjects,
  buildSchedule,
  teamCode,
  teamEmail,
  type BuiltSchedule,
  type CrisisCard,
  type PreparedBulletin,
  type ProblemCard,
} from "@msim/engine";
import { derivePassword } from "./credentials";

/** Every team starts Round 3 with $100,000 of virtual cash. */
export const STARTING_CASH_CENTS = 10_000_000;
export const LIVE_TEAMS = 150;

export interface MemberRow {
  full_name: string;
  roll_number?: string;
}

export interface TeamRow {
  name?: string;
  members?: MemberRow[];
}

export interface StaffRow {
  email: string;
  role: "ORGANISER" | "FAIRNESS" | "DISPLAY";
  name: string;
  roll_number?: string;
}

export interface SeedOptions {
  slug: string;
  name: string;
  rehearsal: boolean;
  clockSpeed: number;
  startsAt: Date;
  teamCount: number;
  cardSecret: string;
  emailDomain: string;
  teamRows?: TeamRow[];
  staff?: StaffRow[];
  problemCards?: ProblemCard[];
  crisisCards?: CrisisCard[];
  twist?: PreparedBulletin;
  seedCommitment?: string;
  /** The letter of every team code. Default: "T" for the live event, "X" for a rehearsal. */
  codeLetter?: string;
}

export interface PlannedTeam {
  code: string;
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
  twist: PreparedBulletin | null;
  starting_cash_cents: number;
}

export function buildSeedPlan(o: SeedOptions): SeedPlan {
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(o.slug)) throw new Error(`bad event slug: ${o.slug}`);
  if (!o.rehearsal && o.teamCount !== LIVE_TEAMS) throw new Error(`the live event has exactly ${LIVE_TEAMS} teams`);
  if (!Number.isInteger(o.teamCount) || o.teamCount < 3 || o.teamCount > LIVE_TEAMS) {
    throw new Error(`between 3 and ${LIVE_TEAMS} teams`);
  }
  if (o.seedCommitment && !/^[0-9a-f]{64}$/.test(o.seedCommitment)) {
    throw new Error("seed commitment must be a lower-case SHA-256 hex digest");
  }
  const letter = o.codeLetter ?? (o.rehearsal ? "X" : "T");
  if (!o.rehearsal && letter !== "T") throw new Error("live team codes start with T");
  if (o.rehearsal && letter === "T") throw new Error("rehearsal team codes use another letter than T");

  const rows = o.teamRows ?? [];
  if (rows.length > o.teamCount) throw new Error(`${rows.length} teams in the CSV, but only ${o.teamCount} teams`);
  const teams: PlannedTeam[] = [];
  for (let i = 1; i <= o.teamCount; i++) {
    const code = teamCode(i, letter);
    const row = rows[i - 1];
    const members = (row?.members ?? []).filter((m) => m.full_name.trim() !== "");
    if (members.length > 4) throw new Error(`team ${code}: at most four members`);
    teams.push({
      code,
      name: row?.name?.trim() || `Team ${code}`,
      email: teamEmail(code, o.emailDomain),
      password: derivePassword(o.cardSecret, o.slug, code),
      members,
    });
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
  if (dup) throw new Error(`roll number ${dup} appears more than once: each person may be in one team only`);

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
    schedule: buildSchedule(o.clockSpeed),
    teams,
    staff,
    problem_cards: o.problemCards ?? [],
    crisis_cards: o.crisisCards ?? [],
    twist: o.twist ?? null,
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
    teams: plan.teams.map((t) => ({ code: t.code, name: t.name, user_id: idOf(t.email), members: t.members })),
    staff: plan.staff.map((s) => ({
      user_id: idOf(s.email),
      role: s.role,
      display_name: s.name,
      roll_number: s.roll_number ?? null,
    })),
    problem_cards: plan.problem_cards,
    crisis_cards: plan.crisis_cards,
    twist: plan.twist,
    starting_cash_cents: plan.starting_cash_cents,
  };
}

// ───────────────────────────── CSV inputs ─────────────────────────────

/** Columns: team_name, member1_name, member1_roll, … member4_name, member4_roll. */
export function teamRowsFromCsv(text: string): TeamRow[] {
  return parseCsvObjects(text).map((r, i) => {
    if (r.track !== undefined) throw new Error("teams CSV: PRIMUS teams have no track column (every team plays all three rounds)");
    const members: MemberRow[] = [];
    for (let m = 1; m <= 4; m++) {
      const full_name = r[`member${m}_name`] ?? "";
      if (full_name) members.push({ full_name, roll_number: r[`member${m}_roll`] || undefined });
    }
    if (members.length > 0 && members.length < 3) {
      throw new Error(`teams CSV row ${i + 2}: a team has 3 or 4 members (found ${members.length})`);
    }
    return { name: r.team_name, members };
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

// The deck formats live in the engine (shared with the control panel's content upload).
export {
  bulletinFromCsv,
  crisisCardsFromCsv,
  problemCardsFromCsv,
  type CrisisCard,
  type PreparedBulletin,
  type ProblemCard,
} from "@msim/engine";
