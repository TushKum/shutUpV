import { describe, expect, test } from "vitest";
import { detailsText, hasFilter, pageOf, parsePublicLedgerQuery, publicLedgerHref, publicLedgerLines, resolvePublicFilter, type PublicLedgerRow } from "./public-ledger";

describe("the filter in the address", () => {
  test("kind, company, team, side and page; a changed filter goes back to page 1", () => {
    const q = parsePublicLedgerQuery({ company: "aqs", kind: "trade", team: "a101", side: "buy", page: "2" });
    expect(q).toEqual({ company: "AQS", kind: "TRADE", team: "A101", side: "BUY", page: 2 });
    expect(parsePublicLedgerQuery({ page: "abc" })).toEqual({ company: null, kind: null, team: null, side: null, page: 1 });
    expect(publicLedgerHref("/team/ledger", q)).toBe("/team/ledger?kind=TRADE&company=AQS&team=A101&side=BUY&page=2");
    expect(publicLedgerHref("/team/ledger", q, { side: "SELL" })).toBe("/team/ledger?kind=TRADE&company=AQS&team=A101&side=SELL");
    expect(publicLedgerHref("/team/ledger", q, { page: 3 })).toBe("/team/ledger?kind=TRADE&company=AQS&team=A101&side=BUY&page=3");
    expect(hasFilter(q)).toBe(true);
    expect(hasFilter(parsePublicLedgerQuery({}))).toBe(false);
  });
  test("an unknown company, team, kind or side is said plainly", () => {
    const companies = [{ id: "a", ticker: "AQS" }];
    expect(resolvePublicFilter({ company: "AQS", kind: "ROUND", team: "B204", side: "SELL", page: 1 }, companies)).toEqual({
      companyId: "a",
      team: "B204",
      kind: "ROUND",
      side: "SELL",
      problems: [],
    });
    expect(resolvePublicFilter({ company: "ZZZ", kind: "FEE", team: "X", side: "SHORT", page: 1 }, companies).problems).toEqual([
      "No listed company ZZZ.",
      "X is not a team code (a letter and three digits, like A101).",
      "No ledger kind FEE.",
      "No side SHORT (BUY or SELL).",
    ]);
  });
  test("paging, 50 a page; a page past the end shows the last one", () => {
    expect(pageOf(0, 1)).toMatchObject({ page: 1, pages: 1, label: "No rows" });
    expect(pageOf(120, 2)).toMatchObject({ page: 2, pages: 3, from: 50, to: 99, label: "Rows 51–100 of 120" });
    expect(pageOf(120, 9)).toMatchObject({ page: 3, from: 100, label: "Rows 101–120 of 120" });
    expect(pageOf(30, 1, 25, "Questions").label).toBe("Questions 1–25 of 30");
  });
});

describe("lines", () => {
  const row = (r: Partial<PublicLedgerRow> & Pick<PublicLedgerRow, "id" | "kind" | "label">): PublicLedgerRow => ({
    created_at: "2026-11-20T21:30:05Z",
    team_code: null,
    company_id: null,
    ticker: null,
    side: null,
    cash_cents: null,
    shares: null,
    price_cents: null,
    round_number: null,
    details: {},
    ...r,
  });
  test("trades, round totals and corrections, in words; money stays exact", () => {
    const lines = publicLedgerLines(
      [
        row({ id: 3, kind: "TRADE", label: "A101 buys 1000 AQS", team_code: "A101", company_id: "a", ticker: "AQS", side: "BUY", shares: 1000, price_cents: 1082, cash_cents: "1082000", round_number: 1 }),
        row({ id: 2, kind: "ROUND", label: "Round 1", company_id: "a", shares: -300, price_cents: 1082, round_number: 1, details: { buy: 200, sell: 500, net: -300, before: 1050 } }),
        row({ id: 1, kind: "CORRECTION", label: "Ledger correction", details: { reason: "Double-counted fill", entries: 2 } }),
      ],
      [{ id: "a", ticker: "AQS" }],
    );
    expect(lines.map((l) => [l.kindLabel, l.round, l.team, l.ticker, l.side, l.shares, l.price, l.value])).toEqual([
      ["Trade", "1", "A101", "AQS", "BUY", "1,000", "$10.82", "$10,820.00"],
      ["Round totals", "1", "—", "AQS", "—", "−300", "$10.82", "—"],
      ["Correction", "—", "—", "—", "—", "—", "—", "—"],
    ]);
    expect(lines[1]!.details).toBe("bought 200 · sold 500 · was $10.50");
    expect(lines[2]!.details).toBe("Double-counted fill · 2 entries");
    expect(lines[0]!.time).toMatch(/^\d\d:\d\d:05$/);
  });
  test("details of a kind with nothing extra are empty", () => {
    expect(detailsText("TRADE", { x: 1 })).toBe("");
    expect(detailsText("CORRECTION", null)).toBe("");
  });
});
