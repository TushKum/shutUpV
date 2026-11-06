// The lottery as the control panel shows it: the stored draw (each team's problem card; after the crisis, its
// company's crisis card and the team it rescues) turned into the published lottery record, and the independent check
// of that record with the engine. Pure: the rows come from lottery-data.ts (or a test).

import { checkLotteryRecord, dealProblemCards, rootSeed, verifyCommitment, type LotteryRecord } from "@msim/engine";

export interface LotteryRows {
  commitment: string;
  /** The seed: secret (staff only) until the crisis, then published. */
  seed: string;
  dice: string;
  teams: { id: string; code: string; name?: string }[];
  problemCards: { id: string; number: number; sector?: string; title?: string }[];
  /** The crisis deck. */
  crisisCards: { id: string; number: number; category?: string; title?: string }[];
  companies: {
    founder_team_id: string;
    rescuer_team_id: string | null;
    problem_card_id: string | null;
    crisis_card_id: string | null;
    ticker: string | null;
    name: string | null;
  }[];
  /** Has the 23:45 crisis (crisis cards and the rescue circle) been drawn? */
  crisisApplied: boolean;
}

export interface TeamDrawView {
  code: string;
  name: string | null;
  ticker: string | null;
  problem: { number: number; title: string } | null;
  crisis: { number: number; category: string } | null;
  /** The code of the team whose company this team rescues (after the crisis). */
  rescues: string | null;
  /** The code of the team that rescues this team's company (after the crisis). */
  rescuedBy: string | null;
}

const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** One row per team, by team code. */
export function teamDrawViews(rows: LotteryRows): TeamDrawView[] {
  const code = new Map(rows.teams.map((t) => [t.id, t.code]));
  const problem = new Map(rows.problemCards.map((c) => [c.id, c]));
  const crisis = new Map(rows.crisisCards.map((c) => [c.id, c]));
  const companyOf = new Map(rows.companies.map((c) => [c.founder_team_id, c]));
  const rescuing = new Map(rows.companies.filter((c) => c.rescuer_team_id).map((c) => [c.rescuer_team_id!, c]));
  return [...rows.teams]
    .sort((a, b) => byCode(a.code, b.code))
    .map((t) => {
      const own = companyOf.get(t.id);
      const p = own?.problem_card_id ? problem.get(own.problem_card_id) : undefined;
      const c = own?.crisis_card_id ? crisis.get(own.crisis_card_id) : undefined;
      const r = rescuing.get(t.id);
      return {
        code: t.code,
        name: own?.name ?? null,
        ticker: own?.ticker ?? null,
        problem: p ? { number: p.number, title: p.title ?? "" } : null,
        crisis: c ? { number: c.number, category: c.category ?? "" } : null,
        rescues: r ? (code.get(r.founder_team_id) ?? "?") : null,
        rescuedBy: own?.rescuer_team_id ? (code.get(own.rescuer_team_id) ?? "?") : null,
      };
    });
}

/**
 * The published record (the engine's LotteryRecord, the format `pnpm verify-lottery` checks). Before the crisis the
 * crisis card and the rescued team are empty strings: the record is complete only from 23:45.
 */
export function buildLotteryRecord(rows: LotteryRows): LotteryRecord {
  const views = teamDrawViews(rows);
  return {
    seed: rows.seed,
    dice: rows.dice,
    commitment: rows.commitment,
    teams: views.map((v) => v.code),
    problemCards: [...rows.problemCards].sort((a, b) => a.number - b.number).map((c) => String(c.number)),
    crisisCards: [...rows.crisisCards].sort((a, b) => a.number - b.number).map((c) => String(c.number)),
    draws: views.map((v) => ({
      team: v.code,
      problem: v.problem ? String(v.problem.number) : "",
      crisis: v.crisis ? String(v.crisis.number) : "",
      rescues: v.rescues ?? "",
    })),
  };
}

export interface DrawCheck {
  seedMatches: boolean;
  /** Every difference between the stored draw and the engine's (empty when it checks out). */
  problems: string[];
  /** What the check covered. */
  scope: "problems" | "all";
}

/**
 * Re-does the draw with the engine and compares. Before the crisis only the problem cards exist, so only they are
 * checked; from the crisis on, the whole record (problem cards, crisis cards and the rescue circle).
 */
export function checkDraw(rows: LotteryRows): DrawCheck {
  const record = buildLotteryRecord(rows);
  const seedMatches = verifyCommitment(record.seed, record.commitment);
  if (rows.crisisApplied) return { seedMatches, problems: checkLotteryRecord(record), scope: "all" };
  const problems: string[] = [];
  if (!seedMatches) problems.push("the seed does not match the commitment published before the draw");
  try {
    const want = dealProblemCards(rootSeed(record.seed, record.dice), record.teams, record.problemCards);
    for (const d of record.draws) {
      if (d.problem !== want.get(d.team)) problems.push(`${d.team}: problem card should be #${want.get(d.team)}, the database says #${d.problem || "none"}`);
    }
  } catch (err) {
    problems.push(`the draw cannot be repeated: ${(err as Error).message}`);
  }
  return { seedMatches, problems, scope: "problems" };
}

/** Teams per problem card (the guide: at most 3), for the summary. */
export function cardSpread(views: readonly TeamDrawView[]): { min: number; max: number; cards: number } {
  const per = new Map<number, number>();
  for (const v of views) if (v.problem) per.set(v.problem.number, (per.get(v.problem.number) ?? 0) + 1);
  const counts = [...per.values()];
  return { min: counts.length ? Math.min(...counts) : 0, max: counts.length ? Math.max(...counts) : 0, cards: per.size };
}

/** Companies per crisis type (the guide: exactly 15 each with 150 teams). */
export function crisisSpread(views: readonly TeamDrawView[]): { number: number; category: string; companies: number }[] {
  const per = new Map<number, { number: number; category: string; companies: number }>();
  for (const v of views) {
    if (!v.crisis) continue;
    const e = per.get(v.crisis.number) ?? { ...v.crisis, companies: 0 };
    e.companies++;
    per.set(v.crisis.number, e);
  }
  return [...per.values()].sort((a, b) => a.number - b.number);
}

export function normaliseCommitment(text: string): string | null {
  const c = text.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(c) ? c : null;
}

/** File name of the downloaded record. */
export const recordFileName = (slug: string) => `lottery-record-${slug}.json`;
