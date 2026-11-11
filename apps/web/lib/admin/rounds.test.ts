import { describe, expect, test } from "vitest";
import {
  aggregateOrders,
  cents,
  fetchAll,
  focusRound,
  roundWait,
  fundBooks,
  ipoBook,
  listedPrices,
  orderLines,
  previewClearing,
  roundHistory,
  signedCount,
  signedMoney,
  type ClearingPriceRow,
  type CompanyRow,
  type HoldingRow,
  type IpoBidRow,
  type PendingOrderRow,
  type RoundRow,
  type TeamRow,
} from "./rounds";

const company = (id: string, ticker: string, market: number | null, ipo: number | null = market): CompanyRow => ({
  id,
  ticker,
  name: `${ticker} Inc`,
  market_price: market,
  ipo_price: ipo,
});
const fund = (id: string, code: string, cash: number | string, collateral: number | string = 0): TeamRow => ({
  id,
  code,
  track: "FINANCE",
  cash_cents: cash,
  collateral_cents: collateral,
});
let seq = 0;
const order = (team: string, companyId: string, type: PendingOrderRow["type"], qty: number, reserve: number | string = 0): PendingOrderRow => ({
  id: `o${++seq}`,
  team_id: team,
  company_id: companyId,
  type,
  qty,
  reserve_cents: reserve,
  created_at: `2026-11-14T18:00:${String(seq).padStart(2, "0")}Z`,
});
const round = (n: number, status: RoundRow["status"], closesAt = "2026-11-14T18:15:00Z"): RoundRow => ({
  id: `r${n}`,
  number: n,
  phase: "ROUNDS_1_4",
  status,
  opens_at: "2026-11-14T18:00:00Z",
  closes_at: closesAt,
  cleared_at: status === "CLEARED" ? "2026-11-14T18:00:00Z" : null,
});

describe("conversions", () => {
  test("cents accepts whole numbers and their string form, never fractions", () => {
    expect(cents(1050)).toBe(1050);
    expect(cents("50000000")).toBe(50_000_000);
    expect(cents("-216400")).toBe(-216_400);
    expect(cents(12n)).toBe(12);
    expect(() => cents("12.5")).toThrow();
    expect(() => cents(1.5)).toThrow();
    expect(() => cents(null)).toThrow();
    expect(() => cents("90071992547409930")).toThrow();
  });

  test("signed counts and money for changes", () => {
    expect([signedCount(3000), signedCount(-500), signedCount(0)]).toEqual(["+3,000", "−500", "0"]);
    expect([signedMoney(533_000), signedMoney(-2_132_000), signedMoney(0)]).toEqual(["+$5,330.00", "−$21,320.00", "$0.00"]);
  });

  test("listed prices skip companies with no market price yet", () => {
    expect(listedPrices([company("a", "AQS", 1050), company("b", "CCT", null)])).toEqual({ a: 1050 });
  });

  test("fund books: Finance teams only, EXCHANGE and SHORT lots (the SQUAD lot is not traded)", () => {
    const teams: TeamRow[] = [fund("f1", "F01", "50000000", "1500"), { ...fund("p1", "P01", 0), track: "PRODUCT" }];
    const holdings: HoldingRow[] = [
      { team_id: "f1", company_id: "a", lot: "EXCHANGE", qty: 3110, cost_cents: "3265500" },
      { team_id: "f1", company_id: "a", lot: "SHORT", qty: 0, cost_cents: 0 },
      { team_id: "f1", company_id: "b", lot: "SHORT", qty: 100, cost_cents: 100000 },
      { team_id: "f1", company_id: "c", lot: "SQUAD", qty: 5000, cost_cents: 5000000 },
      { team_id: "p1", company_id: "a", lot: "RETAINED", qty: 60000, cost_cents: 0 },
    ];
    expect(fundBooks(teams, holdings)).toEqual({
      f1: {
        cash: 50_000_000,
        collateral: 1500,
        positions: {
          a: { exchangeQty: 3110, exchangeCost: 3_265_500, shortQty: 0, shortProceeds: 0 },
          b: { exchangeQty: 0, exchangeCost: 0, shortQty: 100, shortProceeds: 100_000 },
        },
      },
    });
  });
});

describe("which round", () => {
  const now = new Date("2026-11-14T18:10:00Z").getTime();

  test("the open round, flagged overdue once its closing time has passed", () => {
    const f = focusRound([round(2, "SCHEDULED"), round(1, "OPEN")], now);
    expect(f).toMatchObject({ kind: "OPEN", round: { number: 1 }, overdue: false });
    const late = focusRound([round(1, "OPEN", "2026-11-14T18:09:59Z")], now);
    expect(late).toMatchObject({ kind: "OPEN", overdue: true });
  });

  test("otherwise the next scheduled round; nothing when every round has cleared", () => {
    expect(focusRound([round(1, "CLEARED"), round(3, "SCHEDULED"), round(2, "SCHEDULED")], now)).toMatchObject({ kind: "NEXT", round: { number: 2 } });
    expect(focusRound([round(1, "CLEARED")], now)).toBeNull();
    expect(focusRound([], now)).toBeNull();
  });
});

describe("why a round waits", () => {
  const now = Date.parse("2026-11-14T18:10:00Z");
  const r = (number: number, status: RoundRow["status"], phase = "ROUNDS_13_21", at = "2026-11-14T18:09:00Z"): RoundRow => ({
    id: `r${number}`,
    number,
    phase,
    status,
    opens_at: at,
    closes_at: at,
    cleared_at: null,
  });
  const state = { nowMs: now, paused: false, phase: "ROUNDS_13_21", autoAdvance: false, flashReleased: false };
  const label = (p: string) => (p === "ROUNDS_5_12" ? "Rounds 5–12" : p);

  test("paused: nothing clears or opens, whatever the clock says", () => {
    expect(roundWait({ kind: "OPEN", round: r(3, "OPEN"), overdue: true }, { ...state, paused: true }, label)?.text).toMatch(/^The event is paused: the round does not clear/);
    expect(roundWait({ kind: "NEXT", round: r(4, "SCHEDULED") }, { ...state, paused: true }, label)?.text).toBe("The event is paused: no round opens until it resumes.");
  });

  test("on time: nothing to explain", () => {
    expect(roundWait({ kind: "OPEN", round: r(3, "OPEN", "ROUNDS_13_21", "2026-11-14T18:20:00Z"), overdue: false }, state, label)).toBeNull();
    expect(roundWait(null, state, label)).toBeNull();
  });

  test("an overdue round clears on the next heartbeat", () => {
    expect(roundWait({ kind: "OPEN", round: r(3, "OPEN"), overdue: true }, state, label)?.text).toMatch(/clears on the next heartbeat/);
  });

  test("a round of the next phase waits for the advance; round 18 waits for the flash scores", () => {
    expect(roundWait({ kind: "NEXT", round: r(5, "SCHEDULED", "ROUNDS_5_12") }, { ...state, phase: "CRISIS" }, label)?.text).toBe(
      "Round 5 opens when the event advances to Rounds 5–12. Auto-advance is off: advance the phase on the Phase page.",
    );
    expect(roundWait({ kind: "NEXT", round: r(5, "SCHEDULED", "ROUNDS_5_12") }, { ...state, phase: "CRISIS", autoAdvance: true }, label)?.text).toBe(
      "Round 5 opens when the event advances to Rounds 5–12 (auto-advance is on).",
    );
    expect(roundWait({ kind: "NEXT", round: r(18, "SCHEDULED") }, state, label)?.text).toMatch(/^Round 18 waits for the flash scores/);
    expect(roundWait({ kind: "NEXT", round: r(18, "SCHEDULED") }, { ...state, flashReleased: true }, label)?.text).toMatch(/opens on the next heartbeat/);
  });
});

describe("order book", () => {
  const companies = [company("a", "AQS", 1050), company("b", "CCT", 1000), company("c", "SNP", 900)];

  test("aggregated per company (acceptance tests 1 and 2: net +3,000; net +15,000 capped at +10,000)", () => {
    const orders = [
      order("f1", "a", "BUY", 2000),
      order("f2", "a", "BUY", 1500),
      order("f3", "a", "SELL", 500),
      order("f1", "b", "BUY", 15000),
      order("f2", "c", "SHORT", 300),
      order("f3", "c", "COVER", 100),
    ];
    expect(aggregateOrders(orders, companies)).toEqual([
      { companyId: "a", ticker: "AQS", name: "AQS Inc", buy: 3500, sell: 500, short: 0, cover: 0, net: 3000, cappedNet: 3000, price: 1050, orders: 3 },
      { companyId: "b", ticker: "CCT", name: "CCT Inc", buy: 15000, sell: 0, short: 0, cover: 0, net: 15000, cappedNet: 10000, price: 1000, orders: 1 },
      { companyId: "c", ticker: "SNP", name: "SNP Inc", buy: 0, sell: 0, short: 300, cover: 100, net: -200, cappedNet: -200, price: 900, orders: 2 },
    ]);
    expect(aggregateOrders([], companies)).toEqual([]);
  });

  test("individual orders with team code and ticker, oldest first", () => {
    const later = { ...order("f2", "b", "SELL", 10, "0"), created_at: "2026-11-14T18:05:00Z" };
    const earlier = { ...order("f1", "a", "BUY", 100, "115500"), created_at: "2026-11-14T18:01:00Z" };
    const lines = orderLines([later, earlier], [fund("f1", "F01", 0), fund("f2", "F02", 0)], companies);
    expect(lines.map((l) => [l.code, l.ticker, l.type, l.qty, l.reserve])).toEqual([
      ["F01", "AQS", "BUY", 100, 115_500],
      ["F02", "CCT", "SELL", 10, 0],
    ]);
  });
});

describe("clearing preview", () => {
  test("acceptance test 1: $10.50 with buys 2,000 + 1,500 and a sell of 500 → $10.82, every fund's cash change", () => {
    const companies = [company("a", "AQS", 1050), company("b", "CCT", 1000), company("c", "SNP", 900)];
    const teams = [fund("f1", "F01", "50000000"), fund("f2", "F02", "50000000"), fund("f3", "F03", "40000000"), fund("f4", "F04", "60000000", "135000")];
    const holdings: HoldingRow[] = [
      { team_id: "f3", company_id: "a", lot: "EXCHANGE", qty: 1000, cost_cents: "1050000" },
      // F04 is short 100 CCT and places no order: its collateral follows CCT's price.
      { team_id: "f4", company_id: "b", lot: "SHORT", qty: 100, cost_cents: "90000" },
    ];
    const orders = [order("f1", "a", "BUY", 2000), order("f2", "a", "BUY", 1500), order("f3", "a", "SELL", 500), order("f1", "b", "BUY", 15000)];
    const p = previewClearing(companies, orders, teams, holdings);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.companies).toEqual([
      { companyId: "a", ticker: "AQS", oldPrice: 1050, newPrice: 1082, net: 3000, cappedNet: 3000 },
      { companyId: "b", ticker: "CCT", oldPrice: 1000, newPrice: 1100, net: 15000, cappedNet: 10000 },
    ]);
    expect(p.unchanged).toBe(1);
    expect(p.funds.map((f) => [f.code, f.orders, f.cashChange, f.collateralAfter])).toEqual([
      ["F01", 2, -(2000 * 1082 + 15000 * 1100), 0],
      ["F02", 1, -1500 * 1082, 0],
      ["F03", 1, 500 * 1082, 0],
      ["F04", 0, 0, 165_000], // 150% × 100 × $11.00
    ]);
    expect(p.funds[0]).toMatchObject({ cashBefore: 50_000_000, cashAfter: 50_000_000 - 2_164_000 - 16_500_000 });
    expect(p.exchangeCashDelta).toBe(3000 * 1082 + 15000 * 1100);
  });

  test("a book the engine refuses is reported, not thrown", () => {
    const p = previewClearing([company("a", "AQS", 1050)], [order("f1", "a", "SELL", 10)], [fund("f1", "F01", 0)], []);
    expect(p).toEqual({ ok: false, message: expect.stringContaining("sells more") });
  });

  test("no orders: every price is unchanged and no fund moves", () => {
    const p = previewClearing([company("a", "AQS", 1050)], [], [fund("f1", "F01", 100)], []);
    expect(p).toMatchObject({ ok: true, companies: [], unchanged: 1, funds: [], exchangeCashDelta: 0 });
  });
});

describe("IPO book", () => {
  test("acceptance test 3: 45,000 requested for 35,000 shares, a 4,000-share request receives 3,110", () => {
    const teams = Array.from({ length: 12 }, (_, i) => fund(`f${i + 1}`, `F${String(i + 1).padStart(2, "0")}`, 0));
    const bids: IpoBidRow[] = [
      ...Array.from({ length: 11 }, (_, i) => ({ team_id: `f${i + 1}`, company_id: "a", qty_requested: 4000, qty_allocated: null, price: 1050 })),
      { team_id: "f12", company_id: "a", qty_requested: 1000, qty_allocated: null, price: 1050 },
      { team_id: "f12", company_id: "b", qty_requested: 0, qty_allocated: null, price: 900 }, // withdrawn
      { team_id: "f1", company_id: "b", qty_requested: 2500, qty_allocated: null, price: 900 },
    ];
    const book = ipoBook([company("b", "CCT", 900), company("a", "AQS", 1050), company("x", "NOP", null)], bids, teams);
    expect(book.map((b) => b.ticker)).toEqual(["AQS", "CCT"]);
    const [aqs, cct] = book;
    expect(aqs).toMatchObject({ bidders: 12, requested: 45_000, available: 35_000, subscribedPct: 129, oversubscribed: true, ipoPrice: 1050 });
    expect(aqs!.bids[0]).toEqual({ teamId: "f1", code: "F01", requested: 4000, allocated: 3110 });
    expect(aqs!.bids.at(-1)).toEqual({ teamId: "f12", code: "F12", requested: 1000, allocated: 770 });
    expect(aqs!.allocated).toBe(11 * 3110 + 770);
    expect(cct).toMatchObject({ bidders: 1, requested: 2500, subscribedPct: 7, oversubscribed: false, allocated: 2500 });
    expect(cct!.bids).toEqual([{ teamId: "f1", code: "F01", requested: 2500, allocated: 2500 }]);
  });
});

describe("history", () => {
  test("cleared rounds latest first, one row per company by ticker, with the number of traded companies", () => {
    const row = (roundId: string, companyId: string, before: number, after: number, buy = 0): ClearingPriceRow => ({
      round_id: roundId,
      company_id: companyId,
      market_before: before,
      market_after: after,
      buy_qty: buy,
      sell_qty: 0,
      short_qty: 0,
      cover_qty: 0,
      net_qty: buy,
      capped_net: buy,
    });
    const rounds = [round(1, "CLEARED"), round(2, "CLEARED")];
    const companies = [company("a", "ZED", 1000), company("b", "AQS", 1000)];
    const h = roundHistory([row("r1", "a", 1000, 1000), row("r1", "b", 1000, 1010, 1000), row("r2", "a", 1000, 1000), row("r2", "b", 1010, 1010)], rounds, companies);
    expect(h.map((r) => [r.number, r.traded, r.rows.map((x) => x.ticker)])).toEqual([
      [2, 0, ["AQS", "ZED"]],
      [1, 1, ["AQS", "ZED"]],
    ]);
  });
});

describe("paging", () => {
  const source = (n: number) => Array.from({ length: n }, (_, i) => i);
  const pager = (rows: number[], calls: [number, number][]) => async (from: number, to: number) => {
    calls.push([from, to]);
    return { data: rows.slice(from, to + 1), error: null };
  };

  test("reads every page until a short one", async () => {
    const calls: [number, number][] = [];
    expect(await fetchAll(pager(source(2500), calls))).toHaveLength(2500);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    const exact: [number, number][] = [];
    expect(await fetchAll(pager(source(1000), exact))).toHaveLength(1000);
    expect(exact).toHaveLength(2);
  });

  test("an error stops the read", async () => {
    await expect(fetchAll(async () => ({ data: null, error: { message: "boom" } }))).rejects.toThrow("boom");
  });
});
