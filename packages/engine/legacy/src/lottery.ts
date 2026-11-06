// The verifiable lottery.
//
// The day before, organisers publish SHA-256(secret seed). At 21:00 they enter the seed and a dice roll.
//   root = hex(SHA-256(seed + dice))                     (plain string concatenation, UTF-8)
// Each draw uses its own stream of the same generator, so one draw can never shift another:
//   block i of stream "squads" = SHA-256(root + ":squads:" + i), read as 8 big-endian unsigned 32-bit words
// Integers below n are drawn by rejection sampling (no modulo bias). Shuffles are Fisher–Yates from the end.
// Everything here is also implemented in SQL (app.lottery_*) and both are tested against the same fixtures.

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)));
}

export function verifyCommitment(seed: string, commitment: string): boolean {
  return sha256Hex(seed) === commitment.trim().toLowerCase();
}

export function rootSeed(seed: string, dice: string): string {
  return sha256Hex(seed + dice);
}

export type Stream = "squads" | "problems" | "coverage" | "crisis";

export class Rng {
  private block = 0;
  private words: number[] = [];

  constructor(
    private readonly root: string,
    private readonly stream: Stream,
  ) {}

  nextUint32(): number {
    if (this.words.length === 0) {
      const bytes = sha256(utf8ToBytes(`${this.root}:${this.stream}:${this.block++}`));
      for (let i = 0; i < 32; i += 4) {
        this.words.push(((bytes[i]! << 24) | (bytes[i + 1]! << 16) | (bytes[i + 2]! << 8) | bytes[i + 3]!) >>> 0);
      }
    }
    return this.words.shift()!;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    if (!Number.isInteger(n) || n < 1 || n > 2 ** 32) throw new Error(`bad range ${n}`);
    const limit = 2 ** 32 - (2 ** 32 % n);
    for (;;) {
      const u = this.nextUint32();
      if (u < limit) return u % n;
    }
  }

  shuffle<T>(items: readonly T[]): T[] {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }
}

export interface SquadDraw {
  number: number;
  product: string;
  consulting: string;
  finance: string;
}

/**
 * 1 Product + 1 Consulting + 1 Finance per squad. Each list is first sorted by team code, so the result
 * depends only on the seed, the dice and the set of teams.
 */
export function formSquads(
  root: string,
  teams: { product: readonly string[]; consulting: readonly string[]; finance: readonly string[] },
): SquadDraw[] {
  const n = teams.product.length;
  if (teams.consulting.length !== n || teams.finance.length !== n) throw new Error("tracks must be the same size");
  const rng = new Rng(root, "squads");
  const sort = (a: readonly string[]) => [...a].sort();
  const p = rng.shuffle(sort(teams.product));
  const c = rng.shuffle(sort(teams.consulting));
  const f = rng.shuffle(sort(teams.finance));
  return p.map((product, i) => ({ number: i + 1, product, consulting: c[i]!, finance: f[i]! }));
}

/**
 * Deals 3 distinct cards to each squad (in squad-number order). No card is used more than 3 times.
 * @param cards card ids in deck order (by card number)
 */
export function dealProblemCards(root: string, squadCount: number, cards: readonly string[]): string[][] {
  if (new Set(cards).size !== cards.length) throw new Error("duplicate card ids");
  // With at least squads + 2 cards, every hand (including the last) still has 3 distinct cards to choose from:
  // before the last hand 3 × (cards − squads + 1) uses remain, spread over at least cards − squads + 1 ≥ 3 cards.
  if (cards.length < squadCount + 2) throw new Error("the deck needs at least 2 more cards than there are squads");
  const rng = new Rng(root, "problems");
  const left = new Map(cards.map((c) => [c, 3]));
  const hands: string[][] = [];
  for (let s = 0; s < squadCount; s++) {
    const hand: string[] = [];
    for (let k = 0; k < 3; k++) {
      const candidates = cards.filter((c) => left.get(c)! > 0 && !hand.includes(c));
      if (candidates.length === 0) throw new Error("the deck cannot deal 3 distinct cards to every squad");
      const card = candidates[rng.int(candidates.length)]!;
      hand.push(card);
      left.set(card, left.get(card)! - 1);
    }
    hands.push(hand);
  }
  return hands;
}

/**
 * Each consultant covers 2 companies outside its own squad and every company is covered by exactly 2:
 * squads are put in a random cycle, and the consultant of each squad covers the next two squads' companies.
 * @returns for squad index i (0-based, squad number i+1), the two covered squad indices
 */
export function assignCoverage(root: string, squadCount: number): [number, number][] {
  if (squadCount < 3) throw new Error("coverage needs at least 3 squads");
  const rng = new Rng(root, "coverage");
  const cycle = rng.shuffle(Array.from({ length: squadCount }, (_, i) => i));
  const out: [number, number][] = new Array(squadCount);
  cycle.forEach((squad, k) => {
    out[squad] = [cycle[(k + 1) % squadCount]!, cycle[(k + 2) % squadCount]!];
  });
  return out;
}

/**
 * At 00:30 each company gets one crisis card. Companies (in squad-number order) are shuffled and dealt round
 * the categories (sorted by name), so with 50 companies and 10 categories each category gets exactly 5.
 * Within a category with several cards, one is picked per company.
 * @returns for squad index i, the crisis card id
 */
export function assignCrises(
  root: string,
  squadCount: number,
  deck: readonly { id: string; category: string; number: number }[],
): string[] {
  const categories = [...new Set(deck.map((c) => c.category))].sort();
  if (categories.length === 0) throw new Error("the crisis deck is empty");
  const byCategory = new Map(
    categories.map((cat) => [cat, deck.filter((c) => c.category === cat).sort((a, b) => a.number - b.number)]),
  );
  const rng = new Rng(root, "crisis");
  const order = rng.shuffle(Array.from({ length: squadCount }, (_, i) => i));
  const out: string[] = new Array(squadCount);
  order.forEach((squad, k) => {
    const cards = byCategory.get(categories[k % categories.length]!)!;
    out[squad] = cards.length === 1 ? cards[0]!.id : cards[rng.int(cards.length)]!.id;
  });
  return out;
}

export interface LotteryResult {
  root: string;
  squads: (SquadDraw & { cards: string[]; covers: [string, string] })[];
}

/** The 21:00 draw in one call (the crisis draw happens separately at 00:30 with the same root). */
export function drawLottery(
  seed: string,
  dice: string,
  teams: { product: readonly string[]; consulting: readonly string[]; finance: readonly string[] },
  problemCards: readonly string[],
): LotteryResult {
  const root = rootSeed(seed, dice);
  const squads = formSquads(root, teams);
  const hands = dealProblemCards(root, squads.length, problemCards);
  const coverage = assignCoverage(root, squads.length);
  return {
    root,
    squads: squads.map((s, i) => ({
      ...s,
      cards: hands[i]!,
      covers: [squads[coverage[i]![0]]!.product, squads[coverage[i]![1]]!.product],
    })),
  };
}
