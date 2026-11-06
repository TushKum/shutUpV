// The published lottery record and its check: the seed matches the commitment made before the draw, and the problem
// cards, crisis cards and rescue circle are exactly what the seed and the dice produce. Used by `pnpm verify-lottery`
// (scripts/verify-lottery.ts) and by the control panel's independent check of the draw.

import { drawLottery, verifyCommitment } from "./lottery";

export interface LotteryRecord {
  seed: string;
  dice: string;
  commitment: string;
  /** Every team code. */
  teams: string[];
  /** Problem card numbers, as strings. */
  problemCards: string[];
  /** Crisis card numbers, as strings. */
  crisisCards: string[];
  /** Per team: the problem card number it drew, the crisis card number its company drew, the team it rescues. */
  draws: { team: string; problem: string; crisis: string; rescues: string }[];
}

/**
 * Every difference between the record and a fresh draw (an empty list means the record checks out). `published` is the
 * commitment the checker saw before the event; it must equal the record's.
 */
export function checkLotteryRecord(record: LotteryRecord, published?: string): string[] {
  const problems: string[] = [];
  if (published !== undefined && published.trim().toLowerCase() !== record.commitment.trim().toLowerCase()) {
    problems.push("the record's commitment is not the one published before the event");
  }
  if (!verifyCommitment(record.seed, record.commitment)) {
    problems.push("the seed does not match the commitment published before the draw");
  }
  let draw;
  try {
    draw = drawLottery(
      record.seed,
      record.dice,
      record.teams,
      record.problemCards,
      record.crisisCards.map((n) => ({ id: n, number: Number(n) })),
    );
  } catch (err) {
    return [...problems, `the draw cannot be repeated: ${(err as Error).message}`];
  }
  if (record.draws.length !== record.teams.length) {
    problems.push(`expected ${record.teams.length} teams, the record has ${record.draws.length}`);
  }
  for (const team of [...record.teams].sort()) {
    const got = record.draws.find((d) => d.team === team);
    if (!got) {
      problems.push(`${team} is missing`);
      continue;
    }
    const want = { problem: draw.problems.get(team)!, crisis: draw.crises.get(team)!, rescues: draw.circle.get(team)! };
    if (got.problem !== want.problem) problems.push(`${team}: problem card should be #${want.problem}, the record says #${got.problem}`);
    if (got.crisis !== want.crisis) problems.push(`${team}: crisis card should be #${want.crisis}, the record says #${got.crisis}`);
    if (got.rescues !== want.rescues) problems.push(`${team}: should rescue ${want.rescues}'s company, the record says ${got.rescues}'s`);
  }
  return problems;
}
