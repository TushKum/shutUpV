import { describe, expect, test } from "vitest";
import { assignCrises, drawLottery, sha256Hex } from "@msim/engine";
import { checkLotteryRecord, type LotteryRecord } from "../lib/lottery-record";

const teams = {
  product: Array.from({ length: 6 }, (_, i) => `P0${i + 1}`),
  consulting: Array.from({ length: 6 }, (_, i) => `C0${i + 1}`),
  finance: Array.from({ length: 6 }, (_, i) => `F0${i + 1}`),
};
const problemCards = Array.from({ length: 8 }, (_, i) => String(i + 1));
const crisisDeck = ["Regulation", "Data breach", "Partner exit"].map((category) => ({ category, number: 1 }));

function record(): LotteryRecord {
  const draw = drawLottery("night-seed", "5", teams, problemCards);
  const crises = assignCrises(draw.root, 6, crisisDeck.map((c) => ({ ...c, id: `${c.category} #${c.number}` })));
  return {
    seed: "night-seed",
    dice: "5",
    commitment: sha256Hex("night-seed"),
    teams,
    problemCards,
    squads: draw.squads.map((s) => ({ ...s, cards: [...s.cards], covers: [...s.covers] })),
    crisisDeck,
    crises: crises.map((card, i) => ({ squad: i + 1, card })),
  };
}

describe("verify-lottery", () => {
  test("a faithful record checks out", () => {
    expect(checkLotteryRecord(record())).toEqual([]);
  });

  test("a seed that does not match the commitment is caught", () => {
    expect(checkLotteryRecord({ ...record(), commitment: sha256Hex("another-seed") })).toEqual([
      "the seed does not match the commitment published before the draw",
    ]);
  });

  test("swapped teams, cards, coverage or crises are caught", () => {
    const r = record();
    [r.squads[0]!.finance, r.squads[1]!.finance] = [r.squads[1]!.finance, r.squads[0]!.finance];
    r.squads[2]!.cards.reverse();
    r.crises![3]!.card = r.crises![3]!.card === "Regulation #1" ? "Data breach #1" : "Regulation #1";
    const problems = checkLotteryRecord(r);
    expect(problems).toHaveLength(4);
    expect(problems[0]).toMatch(/squad 1: finance should be/);
    expect(problems.some((p) => /squad 3: problem cards/.test(p))).toBe(true);
    expect(problems.some((p) => /squad 4: crisis card/.test(p))).toBe(true);
  });

  test("the record's commitment must be the one published the day before", () => {
    expect(checkLotteryRecord(record(), sha256Hex("night-seed"))).toEqual([]);
    expect(checkLotteryRecord(record(), sha256Hex("swapped-seed"))).toEqual([
      "the record's commitment is not the one published before the event",
    ]);
  });

  test("a different dice roll does not reproduce the record", () => {
    expect(checkLotteryRecord({ ...record(), dice: "6" }).length).toBeGreaterThan(0);
  });
});
