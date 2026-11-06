import { describe, expect, test } from "vitest";
import {
  aggregateOrders,
  cents,
  fetchAll,
  focusRound,
  listedPrices,
  orderLines,
  previewClearing,
  roundHistory,
  roundWait,
  traderBooks,
  type ClearingPriceRow,
  type CompanyRow,
  type PendingOrderRow,
  type RoundRow,
  type TeamRow,
} from "./rounds";

const company = (id: string, ticker: string, market: number | null): CompanyRow => ({ id, ticker, name: `${ticker} Ltd`, market_price: market });
const team = (id: string, code: string, cash: number | string): TeamRow => ({ id, code, cash_cents: cash });
let seq = 0;
const order = (teamId: string, companyId: string, type: PendingOrderRow["type"], qty: number, reserve: number | string = 0): PendingOrderRow => ({
  id: `o${++seq}`,
  team_id: teamId,
  company_id: companyId,
  type,
  qty,
  reserve_cents: reserve,
  created_at: `2026-11-20T21:00:${String(seq).padStart(2, "0")}Z`,
});
const round = (n: number, status: RoundRow["status"], phase = "MARKET", closesAt = "2026-11-20T21:15:00Z"): RoundRow => ({
  id: `r${n}`,
  number: n,
  phase,
  status,
  opens_at: "2026-11-20T21:00:00Z",
  closes_at: closesAt,
  cleared_at: status === "CLEARED" ? "2026-11-20T21:00:00Z" : null,
});

test("cents accepts whole numbers and their string form", () => {
  expect(cents("10000000")).toBe(10_000_000);
  expect(cents(42)).toBe(42);
});

describe("which round", () => {
  test("the open round, even when overdue; otherwise the next scheduled", () => {
    const now = Date.parse("2026-11-20T21:20:00Z");
    expect(focusRound([round(2, "SCHEDULED"), round(1, "OPEN")], now)).toMatchObject({ kind: "OPEN", round: { number: 1 }, overdue: true });
    expect(focusRound([round(1, "CLEARED"), round(2, "SCHEDULED")], now)).toMatchObject({ kind: "NEXT", round: { number: 2 } });
    expect(focusRound([round(1, "CLEARED")], now)).toBeNull();
  });

  test("why a round waits: paused, overdue, its phase not reached (and the gate that holds it)", () => {
    const now = Date.parse("2026-11-20T21:20:00Z");
    const base = { nowMs: now, paused: false, phase: "MARKET_BLIND", autoAdvance: false, gate: null };
    const label = (p: string) => p;
    expect(roundWait(focusRound([round(1, "OPEN")], now), { ...base, paused: true }, label)?.text).toMatch(/paused/);
    expect(roundWait(focusRound([round(1, "OPEN")], now), base, label)?.text).toMatch(/clears on the next heartbeat/);
    const next = focusRound([round(2, "CLEARED", "MARKET_BLIND"), round(3, "SCHEDULED", "MARKET", "2026-11-20T21:30:00Z")], now);
    expect(roundWait(next, base, label)?.text).toMatch(/advances to MARKET.*Auto-advance is off/);
    expect(roundWait(next, { ...base, gate: "Some crisis-solution scores are not sealed yet." }, label)).toEqual({
      tone: "amber",
      text: "Round 3 opens in MARKET, but the phase cannot advance yet: Some crisis-solution scores are not sealed yet.",
    });
    const future = focusRound([round(1, "OPEN", "MARKET_BLIND", "2026-11-20T21:30:00Z")], now);
    expect(roundWait(future, base, label)).toBeNull();
  });
});

describe("order book", () => {
  test("acceptance tests 4 and 5: net +3,000; net +15,000 capped at +10,000", () => {
    const companies = [company("a", "MLBT", 1050), company("b", "CHAI", 1000)];
    const orders = [order("t1", "a", "BUY", 2000), order("t2", "a", "BUY", 1500), order("t3", "a", "SELL", 500), order("t1", "b", "BUY", 5000), order("t2", "b", "BUY", 5000), order("t3", "b", "BUY", 5000)];
    expect(aggregateOrders(orders, companies)).toEqual([
      { companyId: "b", ticker: "CHAI", name: "CHAI Ltd", buy: 15_000, sell: 0, net: 15_000, cappedNet: 10_000, price: 1000, orders: 3 },
      { companyId: "a", ticker: "MLBT", name: "MLBT Ltd", buy: 3500, sell: 500, net: 3000, cappedNet: 3000, price: 1050, orders: 3 },
    ]);
    const lines = orderLines(orders, [team("t1", "T001", 0), team("t2", "T002", 0)], companies);
    expect(lines[0]).toMatchObject({ code: "T001", ticker: "MLBT", type: "BUY", qty: 2000 });
    expect(lines[2]).toMatchObject({ code: "—" });
  });
});

describe("clearing preview", () => {
  test("acceptance test 4: $10.50 with buys 2,000 + 1,500 and a sell of 500 → $10.82, each team's cash change", () => {
    const companies = [company("a", "MLBT", 1050), company("b", "CHAI", 1000)];
    const teams = [team("t1", "T001", "10000000"), team("t2", "T002", 10_000_000), team("t3", "T003", 10_000_000), team("t4", "T004", 10_000_000)];
    const holdings = [{ team_id: "t3", company_id: "a", qty: 500, cost_cents: "500000" }];
    const orders = [order("t1", "a", "BUY", 2000), order("t2", "a", "BUY", 1500), order("t3", "a", "SELL", 500)];
    const p = previewClearing(companies, orders, teams, holdings);
    expect(p).toEqual({
      ok: true,
      companies: [{ companyId: "a", ticker: "MLBT", oldPrice: 1050, newPrice: 1082, net: 3000, cappedNet: 3000 }],
      unchanged: 1,
      teams: [
        { teamId: "t1", code: "T001", orders: 1, cashBefore: 10_000_000, cashAfter: 10_000_000 - 2000 * 1082, cashChange: -2000 * 1082 },
        { teamId: "t2", code: "T002", orders: 1, cashBefore: 10_000_000, cashAfter: 10_000_000 - 1500 * 1082, cashChange: -1500 * 1082 },
        { teamId: "t3", code: "T003", orders: 1, cashBefore: 10_000_000, cashAfter: 10_000_000 + 500 * 1082, cashChange: 500 * 1082 },
      ],
      exchangeCashDelta: 3000 * 1082,
    });
  });

  test("no orders: nothing moves; a book the engine refuses is reported", () => {
    const companies = [company("a", "MLBT", 1050)];
    expect(previewClearing(companies, [], [team("t1", "T001", 0)], [])).toEqual({ ok: true, companies: [], unchanged: 1, teams: [], exchangeCashDelta: 0 });
    const bad = previewClearing(companies, [order("t1", "a", "SELL", 10)], [team("t1", "T001", 0)], []);
    expect(bad).toMatchObject({ ok: false, message: expect.stringMatching(/sells more/) });
  });

  test("books and listed prices", () => {
    expect(listedPrices([company("a", "A", 100), company("b", "B", null)])).toEqual({ a: 100 });
    expect(traderBooks([team("t", "T001", "5")], [{ team_id: "t", company_id: "a", qty: 3, cost_cents: "300" }, { team_id: "t", company_id: "b", qty: 0, cost_cents: 0 }])).toEqual({
      t: { cash: 5, positions: { a: { qty: 3, cost: 300 } } },
    });
  });
});

test("history: latest round first, rows by ticker, traded companies counted", () => {
  const rounds = [round(1, "CLEARED"), round(2, "CLEARED")];
  const companies = [company("a", "MLBT", 1), company("b", "CHAI", 1)];
  const p = (r: string, c: string, buy: number): ClearingPriceRow => ({ round_id: r, company_id: c, market_before: 1000, market_after: 1000 + buy, buy_qty: buy, sell_qty: 0, net_qty: buy, capped_net: buy });
  const h = roundHistory([p("r1", "a", 10), p("r1", "b", 0), p("r2", "a", 0), p("r2", "b", 5)], rounds, companies);
  expect(h.map((r) => [r.number, r.traded, r.rows.map((x) => x.ticker)])).toEqual([
    [2, 1, ["CHAI", "MLBT"]],
    [1, 1, ["CHAI", "MLBT"]],
  ]);
});

test("fetchAll reads every page", async () => {
  const all = Array.from({ length: 5 }, (_, i) => i);
  const got = await fetchAll<number>(async (from, to) => ({ data: all.slice(from, to + 1), error: null }), 2);
  expect(got).toEqual(all);
});
