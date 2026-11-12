import { describe, expect, test } from "vitest";
import { companyReport, firmReport, moveText, statementRank } from "./report";

const eng = (k: number, o: Partial<{ cash_cents: number; shares: number; escrow: "HELD" | "RELEASED" | "REFUNDED"; rating: number | null; bonus_cents: number | null }> = {}) => ({
  k,
  cash_cents: 50_000,
  shares: 0,
  escrow: "RELEASED" as const,
  rating: null,
  bonus_cents: null,
  ...o,
});

describe("your crises so far", () => {
  test("a company: scored, being judged, on now and still to come", () => {
    const rows = companyReport(
      3,
      [{ k: 1, title: "Supply shock" }, { k: 2, title: "Data leak" }, { k: 3, title: "Strike" }],
      [{ k: 1, score: 78, tierBp: 800 }],
      [{ k: 1, tierBp: 800 }],
      [eng(1, { rating: 4 }), eng(2)],
    );
    expect(rows.map((r) => r.state)).toEqual(["scored", "judging", "now", "later"]);
    expect(rows[0]).toMatchObject({ title: "Supply shock", score: 78, moveBp: 800, hired: true, rating: 4 });
    expect(rows[2]).toMatchObject({ hired: false, score: null });
  });

  test("Round 3 adds a fifth line; its move is the one applied after the ranking", () => {
    const rows = companyReport(5, [], [{ k: 5, score: 90, tierBp: 2500 }], [{ k: 5, tierBp: 1875 }], [], "Farm credit");
    expect(rows).toHaveLength(5);
    expect(rows[4]).toMatchObject({ title: "Farm credit", moveBp: 1875, state: "scored" });
  });

  test("a firm: clients, fees received, stars and the bonus", () => {
    const rows = firmReport(2, [eng(1, { rating: 5, bonus_cents: 1_200_000 }), eng(1, { rating: 3, bonus_cents: -100_000, shares: 200 }), eng(2, { escrow: "HELD" })]);
    expect(rows[0]).toMatchObject({ state: "scored", clients: 2, feesCents: 100_000, feeShares: 200, avgRating: 4, bonusCents: 1_100_000 });
    expect(rows[1]).toMatchObject({ state: "now", clients: 1, feesCents: 0, bonusCents: null });
    expect(rows[2]!.state).toBe("later");
  });

  test("a company's place on its statement", () => {
    const rivals = [{ companyId: "a", ticker: "AAA", score: 70 }, { companyId: "b", ticker: "BBB", score: 90 }, { companyId: "c", ticker: "CCC", score: 70 }];
    expect(statementRank("b", rivals)).toEqual({ place: 1, of: 3 });
    expect(statementRank("c", rivals)).toEqual({ place: 3, of: 3 }); // a tie goes to the lower ticker
    expect(statementRank("x", rivals)).toBeNull();
  });

  test("price moves in words", () => {
    expect(moveText(800)).toBe("+8%");
    expect(moveText(-2000)).toBe("−20%");
    expect(moveText(1875)).toBe("+18.8%");
  });
});
