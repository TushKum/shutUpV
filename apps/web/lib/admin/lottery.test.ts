import { describe, expect, test } from "vitest";
import { assignCrises, checkLotteryRecord, drawLottery, sha256Hex } from "@msim/engine";
import { buildLotteryRecord, checkDraw, normaliseCommitment, recordFileName, squadViews, type LotteryRows } from "./lottery";

// A stored draw exactly as run_lottery and apply_crisis would leave it, made with the engine (the SQL port is
// parity-tested against it), for 4 squads and a 6-card deck.
const SEED = sha256Hex("lottery-page");
const DICE = "4";
const codes = (prefix: string) => ["04", "02", "03", "01"].map((n) => `${prefix}${n}`); // stored in no particular order

function storedDraw({ crisis = false } = {}): LotteryRows {
  const teams = [
    ...codes("DP").map((code) => ({ id: `t-${code}`, code, track: "PRODUCT" as const })),
    ...codes("DC").map((code) => ({ id: `t-${code}`, code, track: "CONSULTING" as const })),
    ...codes("DF").map((code) => ({ id: `t-${code}`, code, track: "FINANCE" as const })),
  ];
  const problemCards = [6, 2, 4, 1, 5, 3].map((n) => ({ id: `card-${n}`, number: n, sector: "Health", title: `Problem ${n}` }));
  const draw = drawLottery(
    SEED,
    DICE,
    { product: codes("DP"), consulting: codes("DC"), finance: codes("DF") },
    [1, 2, 3, 4, 5, 6].map(String),
  );
  const companies = codes("DP").map((code) => ({ id: `co-${code}`, product_team_id: `t-${code}`, ticker: null as string | null, crisis_card_id: null as string | null }));
  const crisisCards = ["Regulation", "Data breach", "Partner exit"].map((category, i) => ({ id: `crisis-${i}`, category, number: 1 }));
  if (crisis) {
    const dealt = assignCrises(draw.root, draw.squads.length, crisisCards);
    draw.squads.forEach((s, i) => (companies.find((c) => c.product_team_id === `t-${s.product}`)!.crisis_card_id = dealt[i]!));
  }
  return {
    commitment: sha256Hex(SEED),
    seed: SEED,
    dice: DICE,
    teams,
    problemCards,
    squads: draw.squads.map((s, i) => ({
      number: s.number,
      product_team_id: `t-${s.product}`,
      consulting_team_id: `t-${s.consulting}`,
      finance_team_id: `t-${s.finance}`,
      dealt_card_ids: s.cards.map((n) => `card-${n}`),
      chosen_card_id: i === 0 ? `card-${s.cards[1]}` : i === 1 ? `card-${s.cards[0]}` : null,
      chosen_by_default: i === 1,
    })).reverse(),
    // Coverage rows carry no order: store the second covered company first.
    coverage: draw.squads.flatMap((s) => [...s.covers].reverse().map((p) => ({ consultant_team_id: `t-${s.consulting}`, company_id: `co-${p}` }))),
    companies,
    crisisCards: crisis ? crisisCards : null,
  };
}

describe("the lottery record from the stored draw", () => {
  test("has the verify-lottery format: sorted team codes, card numbers as strings, squads in order", () => {
    const record = buildLotteryRecord(storedDraw());
    expect(record.seed).toBe(SEED);
    expect(record.dice).toBe(DICE);
    expect(record.commitment).toBe(sha256Hex(SEED));
    expect(record.teams).toEqual({ product: ["DP01", "DP02", "DP03", "DP04"], consulting: ["DC01", "DC02", "DC03", "DC04"], finance: ["DF01", "DF02", "DF03", "DF04"] });
    expect(record.problemCards).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(record.squads.map((s) => s.number)).toEqual([1, 2, 3, 4]);
    expect(record.squads.every((s) => s.cards.length === 3 && s.covers.length === 2)).toBe(true);
    expect(record.crisisDeck).toBeUndefined();
    expect(record.crises).toBeUndefined();
    // What pnpm verify-lottery would say about the downloaded file.
    expect(checkLotteryRecord(JSON.parse(JSON.stringify(record)), sha256Hex(SEED))).toEqual([]);
  });

  test("includes the crisis deck and each squad's crisis card once the crisis has been applied", () => {
    const record = buildLotteryRecord(storedDraw({ crisis: true }));
    expect(record.crisisDeck).toEqual([
      { category: "Data breach", number: 1 },
      { category: "Partner exit", number: 1 },
      { category: "Regulation", number: 1 },
    ]);
    expect(record.crises).toHaveLength(4);
    expect(record.crises!.every((c) => /^(Data breach|Partner exit|Regulation) #1$/.test(c.card))).toBe(true);
    expect(checkDraw(record)).toEqual({ seedMatches: true, problems: [] });
  });
});

describe("the independent check", () => {
  test("verifies a faithful draw, whatever order the coverage rows come back in", () => {
    expect(checkDraw(buildLotteryRecord(storedDraw()))).toEqual({ seedMatches: true, problems: [] });
  });

  test("names every difference between the stored draw and the engine's", () => {
    const rows = storedDraw();
    const one = rows.squads.find((s) => s.number === 1)!;
    const two = rows.squads.find((s) => s.number === 2)!;
    [one.finance_team_id, two.finance_team_id] = [two.finance_team_id, one.finance_team_id];
    one.dealt_card_ids = [...one.dealt_card_ids].reverse();
    const check = checkDraw(buildLotteryRecord(rows));
    expect(check.seedMatches).toBe(true);
    expect(check.problems).toHaveLength(3);
    expect(check.problems[0]).toMatch(/^squad 1: finance should be DF0\d, the record says DF0\d$/);
    expect(check.problems[1]).toMatch(/^squad 1: problem cards should be/);
    expect(check.problems[2]).toMatch(/^squad 2: finance should be/);
  });

  test("a changed coverage or crisis card is caught", () => {
    const rows = storedDraw({ crisis: true });
    const consultant = rows.squads.find((s) => s.number === 3)!.consulting_team_id;
    const own = rows.squads.find((s) => s.number === 3)!.product_team_id;
    const cover = rows.coverage.find((c) => c.consultant_team_id === consultant)!;
    cover.company_id = `co-${own.slice(2)}`; // its own company instead
    const company = rows.companies.find((c) => c.product_team_id === rows.squads.find((s) => s.number === 4)!.product_team_id)!;
    company.crisis_card_id = rows.crisisCards!.find((c) => c.id !== company.crisis_card_id)!.id;
    const problems = checkDraw(buildLotteryRecord(rows)).problems;
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^squad 3: covered companies should be/);
    expect(problems[1]).toMatch(/^squad 4: crisis card should be/);
  });

  test("a seed that does not match the commitment, or a different dice roll, fails", () => {
    const wrongSeed = checkDraw({ ...buildLotteryRecord(storedDraw()), commitment: sha256Hex("another") });
    expect(wrongSeed.seedMatches).toBe(false);
    expect(wrongSeed.problems).toEqual(["the seed does not match the commitment published before the draw"]);
    expect(checkDraw({ ...buildLotteryRecord(storedDraw()), dice: "5" }).problems.length).toBeGreaterThan(0);
  });

  test("a draw the engine cannot redo is reported, not thrown", () => {
    const record = buildLotteryRecord(storedDraw());
    const check = checkDraw({ ...record, problemCards: ["1", "2"] });
    expect(check.problems).toEqual(["the engine could not redo the draw: the deck needs at least 2 more cards than there are squads"]);
  });
});

describe("the squads table", () => {
  test("shows each squad's teams, dealt cards in order, the pick (default or picked) and the covered companies", () => {
    const rows = storedDraw();
    rows.companies[0]!.ticker = "AQS";
    const views = squadViews(rows);
    expect(views.map((v) => v.number)).toEqual([1, 2, 3, 4]);
    const record = buildLotteryRecord(rows);
    for (const [i, v] of views.entries()) {
      const s = record.squads[i]!;
      expect([v.product, v.consulting, v.finance]).toEqual([s.product, s.consulting, s.finance]);
      expect(v.dealt.map((c) => String(c.number))).toEqual(s.cards);
      expect(v.dealt.every((c) => c.title === `Problem ${c.number}`)).toBe(true);
      expect(v.covers.map((c) => c.product)).toEqual([...s.covers].sort());
    }
    expect(views[0]!.chosen).toEqual({ number: Number(record.squads[0]!.cards[1]), title: `Problem ${record.squads[0]!.cards[1]}` });
    expect(views[0]!.chosenByDefault).toBe(false);
    expect(views[1]!.chosen?.number).toBe(Number(record.squads[1]!.cards[0]));
    expect(views[1]!.chosenByDefault).toBe(true);
    expect(views[2]!.chosen).toBeNull();
    const aqs = views.flatMap((v) => v.covers).filter((c) => c.product === "DP04");
    expect(aqs).toHaveLength(2);
    expect(aqs.every((c) => c.ticker === "AQS")).toBe(true);
  });
});

describe("helpers", () => {
  test("a commitment is 64 hex characters (case and surrounding spaces are forgiven)", () => {
    const c = sha256Hex("x");
    expect(normaliseCommitment(`  ${c.toUpperCase()} `)).toBe(c);
    expect(normaliseCommitment(c.slice(1))).toBeNull();
    expect(normaliseCommitment(`${c.slice(1)}g`)).toBeNull();
  });

  test("the record's file name", () => {
    expect(recordFileName("live-2026")).toBe("lottery-record-live-2026.json");
  });
});
