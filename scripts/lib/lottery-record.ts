// Checks a published lottery record: the seed matches the commitment made before the draw, and the squads,
// problem cards, coverage and crisis cards are exactly what the seed and the dice produce.

import { assignCrises, drawLottery, verifyCommitment } from "@msim/engine";

export interface LotteryRecord {
  seed: string;
  dice: string;
  commitment: string;
  teams: { product: string[]; consulting: string[]; finance: string[] };
  /** Problem card numbers, as strings. */
  problemCards: string[];
  squads: { number: number; product: string; consulting: string; finance: string; cards: string[]; covers: string[] }[];
  /** Optional until 00:30: the crisis deck and the card each squad's company drew ("Category #number"). */
  crisisDeck?: { category: string; number: number }[];
  crises?: { squad: number; card: string }[];
}

const cardLabel = (c: { category: string; number: number }) => `${c.category} #${c.number}`;

/** Every difference between the record and a fresh draw (an empty list means the record checks out). */
export function checkLotteryRecord(record: LotteryRecord): string[] {
  const problems: string[] = [];
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
    if (got.covers.join(",") !== want.covers.join(",")) {
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
