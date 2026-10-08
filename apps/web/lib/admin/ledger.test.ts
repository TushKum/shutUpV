import { describe, expect, test } from "vitest";
import {
  EXCHANGE,
  booksLine,
  checkBooks,
  ledgerHref,
  ledgerLines,
  ledgerRefs,
  paging,
  parseLedgerQuery,
  resolveFilter,
  signedCount,
  signedMoney,
  type BooksRow,
  type CompanyRef,
  type LedgerRow,
  type TeamRef,
} from "./ledger";

const TEAMS: TeamRef[] = [
  { id: "p1", code: "MP01", track: "PRODUCT", name: "Product 1" },
  { id: "c1", code: "MC01", track: "CONSULTING", name: "Consulting 1" },
  { id: "f1", code: "MF01", track: "FINANCE", name: "Finance 1" },
  { id: "f2", code: "MF02", track: "FINANCE", name: "Finance 2" },
];
const COMPANIES: CompanyRef[] = [
  { id: "co1", ticker: "EMA", product_team_id: "p1" },
  { id: "co2", ticker: null, product_team_id: "p2" },
];

describe("the filter in the address", () => {
  test("page, team, kind and ticker; anything odd falls back to page 1 and no filter", () => {
    expect(parseLedgerQuery({})).toEqual({ page: 1, team: null, kind: null, ticker: null });
    expect(parseLedgerQuery({ page: "3", team: " mf01 ", kind: "trade", ticker: "ema" })).toEqual({ page: 3, team: "MF01", kind: "TRADE", ticker: "EMA" });
    expect(parseLedgerQuery({ page: "0" }).page).toBe(1);
    expect(parseLedgerQuery({ page: "-2" }).page).toBe(1);
    expect(parseLedgerQuery({ page: "2.5" }).page).toBe(1);
    expect(parseLedgerQuery({ page: "abc" }).page).toBe(1);
    expect(parseLedgerQuery({ page: ["4", "5"], team: ["exchange"] })).toMatchObject({ page: 4, team: EXCHANGE });
  });

  test("links keep the filter; a changed filter goes back to page 1", () => {
    const base = "/admin/e2e/ledger";
    const q = { page: 3, team: "MF01", kind: "TRADE", ticker: null };
    expect(ledgerHref(base, q)).toBe(`${base}?team=MF01&kind=TRADE&page=3`);
    expect(ledgerHref(base, q, { page: 4 })).toBe(`${base}?team=MF01&kind=TRADE&page=4`);
    expect(ledgerHref(base, q, { kind: "FEE" })).toBe(`${base}?team=MF01&kind=FEE`);
    expect(ledgerHref(base, q, { team: null, kind: null })).toBe(base);
    expect(ledgerHref(base, { page: 1, team: null, kind: null, ticker: "EMA" }, { page: 1 })).toBe(`${base}?ticker=EMA`);
  });

  test("codes and tickers become ids; a value that matches nothing is named", () => {
    expect(resolveFilter({ page: 1, team: "MF02", kind: "TRADE", ticker: "EMA" }, TEAMS, COMPANIES)).toEqual({
      teamId: "f2",
      exchange: false,
      kind: "TRADE",
      companyId: "co1",
      problems: [],
    });
    expect(resolveFilter({ page: 1, team: EXCHANGE, kind: null, ticker: null }, TEAMS, COMPANIES)).toMatchObject({ teamId: null, exchange: true });
    expect(resolveFilter({ page: 1, team: "XX99", kind: "BRIBE", ticker: "NOPE" }, TEAMS, COMPANIES).problems).toEqual([
      "No team XX99 in this event.",
      "No ledger kind BRIBE.",
      "No company NOPE in this event.",
    ]);
  });

  test("paging: 50 rows a page, a page past the end shows the last", () => {
    expect(paging(0, 1)).toEqual({ page: 1, pages: 1, from: 0, to: 49, label: "No rows" });
    expect(paging(57, 1)).toEqual({ page: 1, pages: 2, from: 0, to: 49, label: "Rows 1–50 of 57" });
    expect(paging(57, 2)).toEqual({ page: 2, pages: 2, from: 50, to: 99, label: "Rows 51–57 of 57" });
    expect(paging(57, 9).page).toBe(2);
    expect(paging(100, 2).label).toBe("Rows 51–100 of 100");
    expect(paging(2500, 3).label).toBe("Rows 101–150 of 2,500");
  });
});

describe("table lines", () => {
  test("signed money and shares, exact for bigint strings", () => {
    expect(signedMoney(1234)).toBe("+$12.34");
    expect(signedMoney("-50")).toBe("−$0.50");
    expect(signedMoney(0)).toBe("$0.00");
    expect(signedMoney("900719925474099300")).toBe("+$9,007,199,254,740,993.00");
    expect(signedCount(3000)).toBe("+3,000");
    expect(signedCount(-500)).toBe("−500");
    expect(signedCount(0)).toBe("0");
  });

  test("a team's row and the exchange's row of one trade", () => {
    const refs = ledgerRefs(TEAMS, COMPANIES, [{ id: "r1", number: 1 }]);
    const rows: LedgerRow[] = [
      {
        id: 12,
        created_at: "2026-10-08T18:00:00Z",
        txn_id: "a97837aa-c323-4ae9-afe6-441e845c05a1",
        kind: "TRADE",
        team_id: "f1",
        company_id: "co1",
        lot: "EXCHANGE",
        cash_delta_cents: "-1630500",
        share_delta: 1500,
        price_cents: 1087,
        round_id: "r1",
        memo: "BUY round 1",
      },
      {
        id: "13",
        created_at: "2026-10-08T18:00:00Z",
        txn_id: "a97837aa-c323-4ae9-afe6-441e845c05a1",
        kind: "TRADE",
        team_id: null,
        company_id: "co2",
        lot: null,
        cash_delta_cents: 1630500,
        share_delta: -1500,
        price_cents: null,
        round_id: null,
        memo: null,
      },
    ];
    const [a, b] = ledgerLines(rows, refs);
    expect(a).toEqual({
      id: "12",
      at: "2026-10-08T18:00:00Z",
      txnId: "a97837aa-c323-4ae9-afe6-441e845c05a1",
      txn: "a97837aa",
      kind: "TRADE",
      kindLabel: "Trade",
      party: "MF01",
      exchange: false,
      ticker: "EMA",
      lot: "EXCHANGE",
      cash: "−$16,305.00",
      cashSign: -1,
      shares: "+1,500",
      price: "$10.87",
      round: "1",
      memo: "BUY round 1",
    });
    expect(b).toMatchObject({ party: "Exchange", exchange: true, ticker: "?’s company", cash: "+$16,305.00", cashSign: 1, shares: "−1,500", price: "", round: "", memo: "" });
  });

  test("a company without a ticker yet is named after its Product team", () => {
    const refs = ledgerRefs(TEAMS, [{ id: "co3", ticker: null, product_team_id: "p1" }], []);
    const [line] = ledgerLines(
      [{ id: 1, created_at: "x", txn_id: "t", kind: "ISSUE", team_id: "p1", company_id: "co3", lot: "RETAINED", cash_delta_cents: 0, share_delta: 60000, price_cents: null, round_id: null, memo: null }],
      refs,
    );
    expect(line).toMatchObject({ ticker: "MP01’s company", cash: "", cashSign: 0, shares: "+60,000", kindLabel: "Share issue" });
  });
});

describe("books check", () => {
  const T = "11111111-0000-0000-0000-000000000000";
  const U = "22222222-0000-0000-0000-000000000000";
  const V = "33333333-0000-0000-0000-000000000000";
  // The draw (issue + seed), starting cash and a trade, as the game functions write them.
  const ROWS: BooksRow[] = [
    { txn_id: T, kind: "STARTING_CASH", team_id: "f1", company_id: null, cash_delta_cents: 50000000, share_delta: 0 },
    { txn_id: T, kind: "STARTING_CASH", team_id: null, company_id: null, cash_delta_cents: -50000000, share_delta: 0 },
    { txn_id: U, kind: "ISSUE", team_id: "p1", company_id: "co1", cash_delta_cents: 0, share_delta: 60000 },
    { txn_id: U, kind: "ISSUE", team_id: null, company_id: "co1", cash_delta_cents: 0, share_delta: 35000 },
    { txn_id: U, kind: "SEED", team_id: "f1", company_id: "co1", cash_delta_cents: "-5000000", share_delta: 5000 },
    { txn_id: U, kind: "SEED", team_id: "p1", company_id: "co1", cash_delta_cents: "5000000", share_delta: 0 },
    { txn_id: V, kind: "TRADE", team_id: "f1", company_id: "co1", cash_delta_cents: -1050000, share_delta: 1000 },
    { txn_id: V, kind: "TRADE", team_id: null, company_id: "co1", cash_delta_cents: 1050000, share_delta: -1000 },
  ];
  const BOOKS_TEAMS = [
    { id: "p1", code: "MP01", cash_cents: "5000000" },
    { id: "c1", code: "MC01", cash_cents: 0 },
    { id: "f1", code: "MF01", cash_cents: 50000000 - 5000000 - 1050000 },
  ];
  const EXCH = -50000000 + 1050000;

  test("balanced books", () => {
    const r = checkBooks(ROWS, BOOKS_TEAMS, String(EXCH), COMPANIES);
    expect(r).toEqual({ ok: true, transactions: 3, rows: 8, problems: [] });
    expect(booksLine(r)).toBe(
      "The books balance: 3 transactions (8 rows) balance, and every team’s cash and the exchange’s equal the sum of their ledger rows.",
    );
  });

  test("no ledger yet", () => {
    const r = checkBooks([], [{ id: "f1", code: "MF01", cash_cents: 0 }], 0);
    expect(r).toEqual({ ok: true, transactions: 0, rows: 0, problems: [] });
  });

  test("a team whose cash differs from its rows, and the exchange's", () => {
    const teams = BOOKS_TEAMS.map((t) => (t.code === "MF01" ? { ...t, cash_cents: Number(t.cash_cents) + 1 } : t));
    const r = checkBooks(ROWS, teams, EXCH - 100, COMPANIES);
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual([
      "MF01: cash is $439,500.01 but its ledger rows sum to $439,500.00.",
      "Exchange: cash is −$489,501.00 but its ledger rows sum to −$489,500.00.",
    ]);
    expect(booksLine(r)).toBe("The books do not balance: 2 problems.");
  });

  test("a transaction whose cash or shares do not balance", () => {
    const rows = ROWS.map((r) => (r.txn_id === V && r.team_id === null ? { ...r, cash_delta_cents: 1049999, share_delta: -990 } : r));
    const teams = BOOKS_TEAMS;
    const r = checkBooks(rows, teams, EXCH - 1, COMPANIES);
    expect(r.problems).toEqual(["Transaction 33333333 (Trade): cash is off by −$0.01.", "Transaction 33333333 (Trade): EMA’s shares are off by +10."]);
  });

  test("the issue must create exactly 100,000 shares per company", () => {
    const rows = ROWS.map((r) => (r.kind === "ISSUE" && r.team_id === null ? { ...r, share_delta: 34990 } : r));
    expect(checkBooks(rows, BOOKS_TEAMS, EXCH, COMPANIES).problems).toEqual(["EMA: 99,990 shares issued, not 100,000."]);
  });

  test("a row of a team that is not in the event; a team with no rows must have no cash", () => {
    const rows: BooksRow[] = [
      { txn_id: T, kind: "CORRECTION", team_id: "zz", company_id: null, cash_delta_cents: 5, share_delta: 0 },
      { txn_id: T, kind: "CORRECTION", team_id: null, company_id: null, cash_delta_cents: -5, share_delta: 0 },
    ];
    expect(checkBooks(rows, [{ id: "f9", code: "MF09", cash_cents: 1 }], -5).problems).toEqual([
      "MF09: cash is $0.01 but its ledger rows sum to $0.00.",
      "A ledger row names a team that is not in this event.",
    ]);
  });

  test("refuses amounts that are not whole cents rather than guessing", () => {
    expect(() => checkBooks([{ ...ROWS[0]!, cash_delta_cents: "12.5" }], [], 0)).toThrow(/not a whole number of cents/);
    expect(() => checkBooks([{ ...ROWS[0]!, cash_delta_cents: 0.5 }], [], 0)).toThrow(/not a whole number of cents/);
  });
});
