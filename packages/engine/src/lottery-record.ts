// The published lottery record and its check: the seed matches the commitment made before the draw, and the
// squads, problem cards, coverage and crisis cards are exactly what the seed and the dice produce. Used by
// `pnpm verify-lottery` (scripts/verify-lottery.ts) and by the control panel's independent check of the draw.

import { assignCrises, drawLottery, verifyCommitment } from "./lottery";

export interface LotteryRecord {
  seed: string;
  dice: string;
  commitment: string;
  teams: { product: string[]; consulting: string[]; finance: string[] };
  /** Problem card numbers, as strings. */
  problemCards: string[];
  /** `cards` in the order dealt (the first is the default pick); `covers` are the covered companies' Product team codes. */
  squads: { number: number; product: string; consulting: string; finance: string; cards: string[]; covers: string[] }[];
  /** Optional until 00:30: the crisis deck and the card each squad's company drew ("Category #number"). */
  crisisDeck?: { category: string; number: number }[];
  crises?: { squad: number; card: string }[];
}

const cardLabel = (c: { category: string; number: number }) => `${c.category} #${c.number}`;

/** The two covered companies are a set: the database stores coverage without an order. */
const sameSet = (a: readonly string[], b: readonly string[]) => [...a].sort().join(",") === [...b].sort().join(",");

/**
 * Every difference between the record and a fresh draw (an empty list means the record checks out).
 * `published` is the commitment the checker saw before the event; it must equal the record's.
 */
export function checkLotteryRecord(record: LotteryRecord, published?: string): string[] {
  const problems: string[] = [];
  if (published !== undefined && published.trim().toLowerCase() !== record.commitment.trim().toLowerCase()) {
    problems.push("the record's commitment is not the one published before the event");
  }
  if (!verifyCommitment(record.seed, record.commitment)) {
    problems.push("the seed does not match the commitment published before the draw");
  }
  const draw = drawLottery(record.seed, record.dice, record.teams, record.problemCards);
  if (record.squads.length !== draw.squads.length) {
    problems.push(`expected ${draw.squads.length} squads, the record has ${record.squads.length}`);
  }
  for (const want of draw.squads) {
    const got = record.squads.find((s) => s.number === want.number);
    if (!got) {
      problems.push(`squad ${want.number} is missing`);
      continue;
    }
    for (const key of ["product", "consulting", "finance"] as const) {
      if (got[key] !== want[key]) problems.push(`squad ${want.number}: ${key} should be ${want[key]}, the record says ${got[key]}`);
    }
    if (got.cards.join(",") !== want.cards.join(",")) {
      problems.push(`squad ${want.number}: problem cards should be ${want.cards.join(", ")}, the record says ${got.cards.join(", ")}`);
    }
    if (!sameSet(got.covers, want.covers)) {
      problems.push(`squad ${want.number}: covered companies should be ${want.covers.join(", ")}, the record says ${got.covers.join(", ")}`);
    }
  }
  if (record.crisisDeck && record.crises) {
    const deck = record.crisisDeck.map((c) => ({ id: cardLabel(c), category: c.category, number: c.number }));
    const crises = assignCrises(draw.root, draw.squads.length, deck);
    crises.forEach((card, i) => {
      const got = record.crises!.find((c) => c.squad === i + 1)?.card;
      if (got !== card) problems.push(`squad ${i + 1}: crisis card should be ${card}, the record says ${got ?? "nothing"}`);
    });
  }
  return problems;
}
