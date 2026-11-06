import { describe, expect, test } from "vitest";
import { checkLotteryRecord, drawLottery, sha256Hex } from "@msim/engine";
import { buildLotteryRecord, cardSpread, checkDraw, crisisSpread, normaliseCommitment, recordFileName, teamDrawViews, type LotteryRows } from "./lottery";

// A stored draw exactly as run_lottery and apply_crisis would leave it, made with the engine (the SQL port is
// parity-tested against it): 6 teams, a 2-card problem deck, 3 crisis types.
const SEED = sha256Hex("lottery-page");
const DICE = "4";
const CODES = ["X004", "X002", "X006", "X001", "X005", "X003"]; // stored in no particular order

function storedDraw({ crisis = true } = {}): LotteryRows {
  const teams = CODES.map((code) => ({ id: `t-${code}`, code }));
  const problemCards = [2, 1].map((n) => ({ id: `p-${n}`, number: n, sector: "Snacks", title: `Problem ${n}` }));
  const crisisCards = [3, 1, 2].map((n) => ({ id: `c-${n}`, number: n, category: `Type ${n}`, title: `Crisis ${n}` }));
  const d = drawLottery(SEED, DICE, CODES, ["1", "2"], [1, 2, 3].map((n) => ({ id: String(n), number: n })));
  const companies = CODES.map((code) => {
    const rescuer = [...d.circle].find(([, founder]) => founder === code)![0];
    return {
      founder_team_id: `t-${code}`,
      rescuer_team_id: crisis ? `t-${rescuer}` : null,
      problem_card_id: `p-${d.problems.get(code)}`,
      crisis_card_id: crisis ? `c-${d.crises.get(code)}` : null,
      ticker: code === "X001" ? "MLBT" : null,
      name: code === "X001" ? "Masala Labs Bites" : null,
    };
  });
  return { commitment: sha256Hex(SEED), seed: SEED, dice: DICE, teams, problemCards, crisisCards, companies, crisisApplied: crisis };
}

describe("the lottery record from the stored draw", () => {
  test("has the verify-lottery format: sorted team codes, card numbers as strings", () => {
    const r = buildLotteryRecord(storedDraw());
    expect(r.teams).toEqual(["X001", "X002", "X003", "X004", "X005", "X006"]);
    expect(r.problemCards).toEqual(["1", "2"]);
    expect(r.crisisCards).toEqual(["1", "2", "3"]);
    expect(checkLotteryRecord(r, sha256Hex(SEED))).toEqual([]);
  });

  test("before the crisis the crisis card and the rescued team are empty", () => {
    const r = buildLotteryRecord(storedDraw({ crisis: false }));
    expect(r.draws.every((d) => d.crisis === "" && d.rescues === "" && d.problem !== "")).toBe(true);
  });
});

describe("the independent check", () => {
  test("verifies a faithful draw, before the crisis (problem cards) and after it (everything)", () => {
    expect(checkDraw(storedDraw({ crisis: false }))).toEqual({ seedMatches: true, problems: [], scope: "problems" });
    expect(checkDraw(storedDraw())).toEqual({ seedMatches: true, problems: [], scope: "all" });
  });

  test("names a swapped problem card, crisis card or rescuer", () => {
    const rows = storedDraw();
    const a = rows.companies[0]!;
    a.problem_card_id = a.problem_card_id === "p-1" ? "p-2" : "p-1";
    const problems = checkDraw(rows).problems;
    expect(problems.length).toBeGreaterThan(0);

    const before = storedDraw({ crisis: false });
    before.companies[0]!.problem_card_id = before.companies[0]!.problem_card_id === "p-1" ? "p-2" : "p-1";
    expect(checkDraw(before).problems).toEqual([expect.stringMatching(/^X004: problem card should be/)]);

    const circle = storedDraw();
    [circle.companies[0]!.rescuer_team_id, circle.companies[1]!.rescuer_team_id] = [circle.companies[1]!.rescuer_team_id, circle.companies[0]!.rescuer_team_id];
    expect(checkDraw(circle).problems.some((p) => /rescue/.test(p))).toBe(true);
  });

  test("a seed that does not match the commitment, or another dice roll, fails", () => {
    expect(checkDraw({ ...storedDraw(), seed: sha256Hex("other") }).seedMatches).toBe(false);
    expect(checkDraw({ ...storedDraw({ crisis: false }), seed: sha256Hex("other") }).problems[0]).toMatch(/does not match/);
    expect(checkDraw({ ...storedDraw(), dice: "5" }).problems.length).toBeGreaterThan(0);
  });

  test("a draw the engine cannot redo is reported, not thrown", () => {
    const rows = storedDraw({ crisis: false });
    rows.problemCards = [rows.problemCards[0]!];
    expect(checkDraw(rows).problems[0]).toMatch(/cannot be repeated/);
  });
});

describe("the teams table", () => {
  test("one row per team by code: problem card, crisis card, whom it rescues and who rescues it", () => {
    const views = teamDrawViews(storedDraw());
    expect(views.map((v) => v.code)).toEqual(["X001", "X002", "X003", "X004", "X005", "X006"]);
    expect(views[0]).toMatchObject({ ticker: "MLBT", name: "Masala Labs Bites" });
    for (const v of views) {
      expect(v.rescues).not.toBe(v.code);
      expect(views.find((o) => o.code === v.rescues)!.rescuedBy).toBe(v.code);
    }
    expect(cardSpread(views)).toEqual({ min: 3, max: 3, cards: 2 });
    expect(crisisSpread(views).map((c) => c.companies)).toEqual([2, 2, 2]);
  });
});

test("normaliseCommitment and the file name", () => {
  expect(normaliseCommitment(` ${"AB".repeat(32)} `)).toBe("ab".repeat(32));
  expect(normaliseCommitment("xyz")).toBeNull();
  expect(recordFileName("primus")).toBe("lottery-record-primus.json");
});
