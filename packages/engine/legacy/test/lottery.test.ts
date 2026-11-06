import { describe, expect, test } from "vitest";
import { Rng, assignCoverage, assignCrises, dealProblemCards, drawLottery, formSquads, rootSeed, sha256Hex, verifyCommitment } from "../src/lottery";

const teams = {
  product: Array.from({ length: 50 }, (_, i) => `P${String(i + 1).padStart(2, "0")}`),
  consulting: Array.from({ length: 50 }, (_, i) => `C${String(i + 1).padStart(2, "0")}`),
  finance: Array.from({ length: 50 }, (_, i) => `F${String(i + 1).padStart(2, "0")}`),
};
const cards = Array.from({ length: 60 }, (_, i) => `card-${i + 1}`);
const crisisDeck = [
  "Supply shortage", "Regulation", "Legal dispute", "Partner exit", "Data breach",
  "Funding freeze", "Competitor launch", "Safety recall", "Demand collapse", "Operations outage",
].map((category, i) => ({ id: `crisis-${i}`, category, number: 1 }));

describe("hashing and commitment", () => {
  test("SHA-256 test vector", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  test("the root is SHA-256(seed + dice) by plain concatenation", () => {
    expect(rootSeed("market-night", "4")).toBe(sha256Hex("market-night4"));
  });
  test("the published commitment verifies the seed", () => {
    const commitment = sha256Hex("market-night");
    expect(verifyCommitment("market-night", commitment)).toBe(true);
    expect(verifyCommitment("market-night", commitment.toUpperCase())).toBe(true);
    expect(verifyCommitment("market-nigh", commitment)).toBe(false);
  });
});

describe("generator", () => {
  test("deterministic per root and stream, independent across streams", () => {
    const a = new Rng("root", "squads");
    const b = new Rng("root", "squads");
    const c = new Rng("root", "crisis");
    const seqA = Array.from({ length: 20 }, () => a.nextUint32());
    expect(Array.from({ length: 20 }, () => b.nextUint32())).toEqual(seqA);
    expect(Array.from({ length: 20 }, () => c.nextUint32())).not.toEqual(seqA);
  });

  test("first words are the big-endian words of SHA-256(root:stream:0)", () => {
    const hex = sha256Hex("root:squads:0");
    const rng = new Rng("root", "squads");
    expect(rng.nextUint32()).toBe(parseInt(hex.slice(0, 8), 16));
    expect(rng.nextUint32()).toBe(parseInt(hex.slice(8, 16), 16));
  });

  test("int(n) stays in range and is roughly uniform", () => {
    const rng = new Rng("uniform", "problems");
    const counts = new Array(6).fill(0);
    for (let i = 0; i < 6000; i++) counts[rng.int(6)]++;
    for (const c of counts) expect(Math.abs(c - 1000)).toBeLessThan(150);
  });
});

describe("the 21:00 draw", () => {
  const draw = drawLottery("market-night", "4", teams, cards);

  test("50 squads, each with one Product, one Consulting and one Finance team, every team exactly once", () => {
    expect(draw.squads).toHaveLength(50);
    expect(draw.squads.map((s) => s.number)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    for (const track of ["product", "consulting", "finance"] as const) {
      expect(new Set(draw.squads.map((s) => s[track])).size).toBe(50);
      expect([...draw.squads.map((s) => s[track])].sort()).toEqual(teams[track]);
    }
    // It is a real shuffle, not the identity.
    expect(draw.squads.filter((s) => s.product === `P${String(s.number).padStart(2, "0")}`).length).toBeLessThan(10);
  });

  test("3 distinct problem cards per squad, no card used more than 3 times", () => {
    const uses = new Map<string, number>();
    for (const s of draw.squads) {
      expect(s.cards).toHaveLength(3);
      expect(new Set(s.cards).size).toBe(3);
      for (const c of s.cards) uses.set(c, (uses.get(c) ?? 0) + 1);
    }
    expect(Math.max(...uses.values())).toBeLessThanOrEqual(3);
    expect([...uses.values()].reduce((a, b) => a + b, 0)).toBe(150);
  });

  test("each consultant covers 2 companies outside its squad; each company is covered by exactly 2", () => {
    const coveredBy = new Map<string, number>();
    for (const s of draw.squads) {
      expect(s.covers).toHaveLength(2);
      expect(s.covers[0]).not.toBe(s.covers[1]);
      expect(s.covers).not.toContain(s.product);
      for (const p of s.covers) coveredBy.set(p, (coveredBy.get(p) ?? 0) + 1);
    }
    expect(coveredBy.size).toBe(50);
    for (const n of coveredBy.values()) expect(n).toBe(2);
  });

  test("the same seed and dice always give the same draw; a different dice roll gives a different one", () => {
    expect(drawLottery("market-night", "4", teams, cards)).toEqual(draw);
    // Input order does not matter: teams are sorted by code first.
    const shuffled = { product: [...teams.product].reverse(), consulting: teams.consulting, finance: teams.finance };
    expect(drawLottery("market-night", "4", shuffled, cards)).toEqual(draw);
    expect(drawLottery("market-night", "5", teams, cards).squads[0]).not.toEqual(draw.squads[0]);
  });

  test("works for a small rehearsal (3 squads)", () => {
    const small = { product: ["XP01", "XP02", "XP03"], consulting: ["XC01", "XC02", "XC03"], finance: ["XF01", "XF02", "XF03"] };
    const d = drawLottery("seed", "1", small, cards.slice(0, 5));
    expect(d.squads).toHaveLength(3);
    for (const s of d.squads) expect(s.covers).not.toContain(s.product);
  });

  test("refuses impossible inputs", () => {
    expect(() => assignCoverage("r", 2)).toThrow();
    expect(() => dealProblemCards("r", 3, ["a", "b", "c", "d"])).toThrow(/2 more cards/);
    expect(() => formSquads("r", { product: ["a"], consulting: [], finance: ["c"] })).toThrow();
  });
});

describe("the 00:30 crisis draw", () => {
  test("10 categories × 5 companies", () => {
    const root = rootSeed("market-night", "4");
    const crises = assignCrises(root, 50, crisisDeck);
    const perCategory = new Map<string, number>();
    for (const id of crises) perCategory.set(id, (perCategory.get(id) ?? 0) + 1);
    expect(perCategory.size).toBe(10);
    for (const n of perCategory.values()) expect(n).toBe(5);
    expect(assignCrises(root, 50, crisisDeck)).toEqual(crises);
  });

  test("with several cards in a category, one is chosen per company", () => {
    const deck = [
      { id: "a1", category: "A", number: 1 },
      { id: "a2", category: "A", number: 2 },
      { id: "b1", category: "B", number: 1 },
    ];
    const out = assignCrises(rootSeed("s", "1"), 10, deck);
    expect(out.filter((id) => id.startsWith("a"))).toHaveLength(5);
    expect(out.filter((id) => id === "b1")).toHaveLength(5);
  });
});
