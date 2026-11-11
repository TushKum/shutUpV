import { describe, expect, test } from "vitest";
import { detailsText, pageOf, parsePublicLedgerQuery, publicLedgerHref, publicLedgerLines, resolvePublicFilter, type PublicLedgerRow } from "./public-ledger";

describe("the filter in the address", () => {
  test("company (a ticker), kind and page; a changed filter goes back to page 1", () => {
    const q = parsePublicLedgerQuery({ company: "aqs", kind: "deal", page: "2" });
    expect(q).toEqual({ company: "AQS", kind: "DEAL", page: 2 });
    expect(parsePublicLedgerQuery({ page: "abc" })).toEqual({ company: null, kind: null, page: 1 });
    expect(publicLedgerHref("/team/ledger", q)).toBe("/team/ledger?company=AQS&kind=DEAL&page=2");
    expect(publicLedgerHref("/team/ledger", q, { kind: "FEE" })).toBe("/team/ledger?company=AQS&kind=FEE");
    expect(publicLedgerHref("/team/ledger", q, { page: 3 })).toBe("/team/ledger?company=AQS&kind=DEAL&page=3");
  });
  test("an unknown company or kind is said plainly", () => {
    const companies = [{ id: "a", ticker: "AQS" }, { id: "x", ticker: null }];
    expect(resolvePublicFilter({ company: "AQS", kind: "ROUND", page: 1 }, companies)).toEqual({ companyId: "a", kind: "ROUND", problems: [] });
    expect(resolvePublicFilter({ company: "ZZZ", kind: "TRADE", page: 1 }, companies).problems).toEqual(["No listed company ZZZ.", "No ledger kind TRADE."]);
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
    created_at: "2026-10-08T18:00:05Z",
    company_id: null,
    ticker: null,
    cash_cents: null,
    shares: null,
    price_cents: null,
    round_number: null,
    details: {},
    ...r,
  });
  test("seed, IPO, round totals, fee, deal, bonus and correction rows, in words; money stays exact", () => {
    const companies = [{ id: "a", ticker: "AQS" }];
    const lines = publicLedgerLines(
      [
        row({ id: 7, kind: "ROUND", label: "Round 1", company_id: "a", ticker: "AQS", shares: 3000, price_cents: 1082, round_number: 1, details: { buy: 3500, sell: 500, short: 0, cover: 0, net: 3000, before: 1050 } }),
        row({ id: 6, kind: "IPO", label: "IPO allocation", company_id: "a", ticker: "AQS", cash_cents: "36750000", shares: 35000, price_cents: 1050, details: { requested: 45000, available: 35000, bidders: 12 } }),
        row({ id: 5, kind: "SEED", label: "Squad 07 · Finance → company", company_id: "a", cash_cents: 5000000, shares: 5000, price_cents: 1000, details: { squad: 7 } }),
        row({ id: 4, kind: "FEE", label: "Squad 07 · advisor fee", company_id: "a", cash_cents: 2000000, shares: 1000, details: { squad: 7, value: 3050000 } }),
        row({ id: 3, kind: "DEAL", label: "Squad 07 · rescue deal", company_id: "a", cash_cents: 6000000, shares: 8000, price_cents: 750, details: { post_crisis_price: 956 } }),
        row({ id: 2, kind: "BONUS_PLAN", label: "Squad 07 · consultant bonus plan", company_id: "a", cash_cents: -250000 }),
        row({ id: 1, kind: "CORRECTION", label: "Ledger correction", details: { reason: "Double-counted fee", entries: 2 } }),
      ],
      companies,
    );
    expect(lines.map((l) => [l.kindLabel, l.ticker, l.cash, l.shares, l.price])).toEqual([
      ["Round totals", "AQS", "—", "+3,000", "$10.82"],
      ["IPO allocation", "AQS", "$367,500.00", "35,000", "$10.50"],
      ["Seed money", "AQS", "$50,000.00", "5,000", "$10.00"],
      ["Advisor fee", "AQS", "$20,000.00", "1,000", "—"],
      ["Rescue deal", "AQS", "$60,000.00", "8,000", "$7.50"],
      ["Plan bonus", "AQS", "−$2,500.00", "—", "—"],
      ["Correction", "—", "—", "—", "—"],
    ]);
    expect(lines[0]!.details).toBe("buy 3,500 · sell 500 · short 0 · cover 0 · was $10.50");
    expect(lines[1]!.details).toBe("45,000 requested of 35,000 · 12 funds");
    expect(lines[3]!.details).toBe("Total value $30,500.00 (shares at the IPO price)");
    expect(lines[4]!.details).toBe("Post-crisis price $9.56");
    expect(lines[6]!.details).toBe("Double-counted fee · 2 entries");
    expect(lines[0]!.time).toBe("23:30:05");
  });
  test("details of a kind with nothing extra, or missing facts, are empty", () => {
    expect(detailsText("SEED", { squad: 7 })).toBe("");
    expect(detailsText("FEE", null)).toBe("");
    expect(detailsText("IPO", {})).toBe("");
  });
});
