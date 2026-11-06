import { describe, expect, test } from "vitest";
import { checkLotteryRecord, type LotteryRecord } from "../src/lottery-record";
import { Rng, assignCrises, dealProblemCards, drawLottery, rescueCircle, rootSeed, sha256Hex, verifyCommitment } from "../src/lottery";
import { teamCode } from "../src/identity";

const teams = Array.from({ length: 150 }, (_, i) => teamCode(i + 1));
const problems = Array.from({ length: 50 }, (_, i) => String(i + 1));
const crisisDeck = Array.from({ length: 10 }, (_, i) => ({ id: `crisis-${i + 1}`, number: i + 1 }));

describe("hashing and commitment", () => {
  test("SHA-256 test vector", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  test("the root is SHA-256(seed + dice)", () => {
    expect(rootSeed("primus-night", "4")).toBe(sha256Hex("primus-night4"));
  });
  test("the commitment verifies the seed; a wrong seed is rejected", () => {
    const c = sha256Hex("primus-night");
    expect(verifyCommitment("primus-night", c)).toBe(true);
    expect(verifyCommitment("primus-night", ` ${c.toUpperCase()} `)).toBe(true);
    expect(verifyCommitment("primus-nigh", c)).toBe(false);
  });
});

describe("generator", () => {
  test("deterministic per root and stream, independent across streams", () => {
    const seq = (s: "problems" | "crisis" | "circle") => {
      const r = new Rng("root", s);
      return Array.from({ length: 20 }, () => r.nextUint32());
    };
    expect(seq("problems")).toEqual(seq("problems"));
    expect(seq("crisis")).not.toEqual(seq("problems"));
  });
  test("first words are the big-endian words of SHA-256(root:stream:0)", () => {
    const hex = sha256Hex("root:circle:0");
    const rng = new Rng("root", "circle");
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

describe("the draws", () => {
  const root = rootSeed("primus-night", "4");
  test("problem cards: 150 teams, 50 cards, exactly 3 each", () => {
    const m = dealProblemCards(root, teams, problems);
    expect(m.size).toBe(150);
    const per = new Map<string, number>();
    for (const c of m.values()) per.set(c, (per.get(c) ?? 0) + 1);
    expect(per.size).toBe(50);
    expect([...per.values()].every((n) => n === 3)).toBe(true);
  });
  test("problem cards spread evenly with an uneven deck; too small a deck is refused", () => {
    const m = dealProblemCards(root, teams, problems.slice(0, 60 - 10).concat(["51", "52", "53", "54", "55", "56", "57", "58", "59", "60"]));
    const per = new Map<string, number>();
    for (const c of m.values()) per.set(c, (per.get(c) ?? 0) + 1);
    expect(Math.max(...per.values()) - Math.min(...per.values())).toBeLessThanOrEqual(1);
    expect(() => dealProblemCards(root, teams, problems.slice(0, 49))).toThrow(/at least 50/);
    expect(() => dealProblemCards(root, ["T001", "T001"], problems)).toThrow(/duplicate/);
  });
  test("crisis cards: 10 types × 15 companies", () => {
    const m = assignCrises(root, teams, crisisDeck);
    const per = new Map<string, number>();
    for (const c of m.values()) per.set(c, (per.get(c) ?? 0) + 1);
    expect(per.size).toBe(10);
    expect([...per.values()].every((n) => n === 15)).toBe(true);
  });
  test("rescue circle: 150 assignments, nobody rescues itself, every company has exactly one rescuer, one cycle", () => {
    const m = rescueCircle(root, teams);
    expect(m.size).toBe(150);
    for (const [rescuer, founder] of m) expect(rescuer).not.toBe(founder);
    expect(new Set(m.values()).size).toBe(150);
    let t = teams[0]!;
    const seen = new Set<string>();
    while (!seen.has(t)) {
      seen.add(t);
      t = m.get(t)!;
    }
    expect(seen.size).toBe(150);
  });
  test("identical every time from the same seed and dice, whatever the input order; different with another dice", () => {
    const a = drawLottery("primus-night", "4", teams, problems, crisisDeck);
    const b = drawLottery("primus-night", "4", [...teams].reverse(), problems, [...crisisDeck].reverse());
    expect([...b.problems].sort()).toEqual([...a.problems].sort());
    expect([...b.crises].sort()).toEqual([...a.crises].sort());
    expect([...b.circle].sort()).toEqual([...a.circle].sort());
    const c = drawLottery("primus-night", "5", teams, problems, crisisDeck);
    expect([...c.circle].sort()).not.toEqual([...a.circle].sort());
  });
  test("small rehearsal (3 teams) works; 1 team is refused", () => {
    const m = rescueCircle(root, ["X001", "X002", "X003"]);
    expect(new Set(m.values()).size).toBe(3);
    expect(() => rescueCircle(root, ["X001"])).toThrow();
  });
});

describe("the published record", () => {
  const seed = "primus-night";
  const dice = "4";
  const commitment = sha256Hex(seed);
  const deck = crisisDeck.map((c) => String(c.number));
  const d = drawLottery(seed, dice, teams, problems, deck.map((n) => ({ id: n, number: Number(n) })));
  const record: LotteryRecord = {
    seed,
    dice,
    commitment,
    teams,
    problemCards: problems,
    crisisCards: deck,
    draws: teams.map((t) => ({ team: t, problem: d.problems.get(t)!, crisis: d.crises.get(t)!, rescues: d.circle.get(t)! })),
  };
  test("a true record checks out", () => {
    expect(checkLotteryRecord(record, commitment)).toEqual([]);
  });
  test("a wrong seed, a swapped draw or another commitment is caught", () => {
    expect(checkLotteryRecord({ ...record, seed: "other" })).toContain("the seed does not match the commitment published before the draw");
    const draws = record.draws.map((x) => ({ ...x }));
    [draws[0]!.rescues, draws[1]!.rescues] = [draws[1]!.rescues, draws[0]!.rescues];
    expect(checkLotteryRecord({ ...record, draws }).length).toBeGreaterThan(0);
    expect(checkLotteryRecord(record, sha256Hex("x"))).toContain("the record's commitment is not the one published before the event");
  });
});
