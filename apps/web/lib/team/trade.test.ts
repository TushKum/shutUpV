import { describe, expect, it } from "vitest";
import { ORDER_MESSAGES, maxQuantity, validateOrder } from "@msim/engine";
import {
  CLIENT_REF_RE,
  buildOrderContext,
  cashSummary,
  clientRef,
  companyPosition,
  editContext,
  maxOrder,
  newNonce,
  nextRound,
  notTradable,
  openOrders,
  openOrdersState,
  orderHistory,
  orderLabel,
  orderSummary,
  parseShares,
  previewOrder,
  tradingNotice,
  type OrderRow,
  type RoundRow,
  type TradeCompanyRow,
  type TraderInput,
} from "./trade";

const A = "aaaaaaaa-0000-0000-0000-000000000001"; // built by the team
const B = "bbbbbbbb-0000-0000-0000-000000000002"; // rescued by the team
const C = "cccccccc-0000-0000-0000-000000000003";
const D = "dddddddd-0000-0000-0000-000000000004";

const companies: TradeCompanyRow[] = [
  { id: A, ticker: "AQS", name: "AquaSense", market_price: 1050, closing_price: null },
  { id: B, ticker: "BRT", name: "Bright", market_price: 1000, closing_price: null },
  { id: C, ticker: "CMP", name: "Campus", market_price: 2000, closing_price: null },
  { id: D, ticker: "DLV", name: "Deliver", market_price: 500, closing_price: null },
];

const rounds: RoundRow[] = [
  { id: "r1", number: 1, phase: "MARKET_BLIND", status: "CLEARED", opens_at: "2026-11-21T02:15:00Z", closes_at: "2026-11-21T02:30:00Z" },
  { id: "r2", number: 2, phase: "MARKET_BLIND", status: "OPEN", opens_at: "2026-11-21T02:30:00Z", closes_at: "2026-11-21T02:45:00Z" },
  { id: "r3", number: 3, phase: "MARKET", status: "SCHEDULED", opens_at: "2026-11-21T02:45:00Z", closes_at: "2026-11-21T03:00:00Z" },
];

const order = (o: Partial<OrderRow> & Pick<OrderRow, "id" | "round_id" | "company_id" | "type" | "qty">): OrderRow => ({
  status: "PENDING",
  entry_price: 2000,
  reserve_cents: 0,
  fill_price: null,
  created_at: "2026-11-21T02:31:00Z",
  filled_at: null,
  cancelled_at: null,
  ...o,
});

const input = (over: Partial<TraderInput> = {}): TraderInput => ({
  trading: "OPEN",
  cash: 10_000_000,
  builtCompanyId: A,
  rescuedCompanyId: B,
  companies,
  holdings: [{ company_id: C, qty: 1000, cost_cents: "1800000" }],
  orders: [
    order({ id: "o1", round_id: "r2", company_id: C, type: "BUY", qty: 500, reserve_cents: "1100000" }),
    order({ id: "o2", round_id: "r2", company_id: C, type: "SELL", qty: 200 }),
    order({ id: "o0", round_id: "r1", company_id: C, type: "BUY", qty: 1000, status: "FILLED", fill_price: 1800, created_at: "2026-11-21T02:16:00Z" }),
  ],
  rounds,
  ...over,
});

describe("buildOrderContext", () => {
  it("builds the engine's view: prices, positions with exact cost, pending orders of the open round only", () => {
    const ctx = buildOrderContext(input());
    expect(ctx.prices).toEqual({ [A]: 1050, [B]: 1000, [C]: 2000, [D]: 500 });
    expect(ctx.trader.positions).toEqual({ [C]: { qty: 1000, cost: 1_800_000 } });
    expect(ctx.trader.pending.map((p) => p.id)).toEqual(["o1", "o2"]);
    expect(ctx.trader.pending[0]!.reserve).toBe(1_100_000);
    expect(ctx.trader.builtCompanyId).toBe(A);
    expect(ctx.trader.rescuedCompanyId).toBe(B);
  });
});

describe("previewOrder and maxOrder agree with the engine", () => {
  const ctx = buildOrderContext(input());
  it("refuses the built and the rescued company", () => {
    expect(previewOrder(ctx, A, "BUY", "10")).toMatchObject({ state: "REFUSED", code: "OWN_COMPANY" });
    expect(previewOrder(ctx, B, "BUY", "10")).toMatchObject({ state: "REFUSED", code: "RESCUED_COMPANY" });
  });
  it("prices a buy with its 10% reserve and the cash left", () => {
    const p = previewOrder(ctx, D, "BUY", "1,000");
    expect(p).toEqual({ state: "OK", qty: 1000, price: 500, value: 500_000, reserve: 550_000, availableAfter: 10_000_000 - 1_100_000 - 550_000 });
  });
  it("holds the 5,000-share limit with pending buys", () => {
    expect(previewOrder(ctx, C, "BUY", "3501")).toMatchObject({ state: "REFUSED", code: "HOLD_LIMIT" });
    expect(previewOrder(ctx, C, "BUY", "3500")).toMatchObject({ state: "OK" });
  });
  it("sells only shares owned minus pending sells", () => {
    expect(previewOrder(ctx, C, "SELL", "801")).toMatchObject({ state: "REFUSED", code: "NOT_ENOUGH_SHARES", message: ORDER_MESSAGES.NOT_ENOUGH_SHARES });
    expect(maxOrder(ctx, C, "SELL")).toEqual({ max: 800, reason: null });
  });
  it("Max equals the engine's maxQuantity and the engine accepts it", () => {
    for (const id of [C, D]) {
      const m = maxOrder(ctx, id, "BUY");
      expect(m.max).toBe(maxQuantity(ctx, id, "BUY"));
      expect(validateOrder(ctx, { companyId: id, type: "BUY", qty: m.max }).ok).toBe(true);
    }
    expect(maxOrder(ctx, A, "BUY")).toEqual({ max: 0, reason: ORDER_MESSAGES.OWN_COMPANY });
  });
  it("empty and bad quantities", () => {
    expect(previewOrder(ctx, C, "BUY", " ")).toEqual({ state: "EMPTY" });
    expect(previewOrder(ctx, C, "BUY", "1.5")).toMatchObject({ state: "REFUSED", code: "BAD_QUANTITY" });
  });
  it("refuses when trading is halted", () => {
    expect(previewOrder(buildOrderContext(input({ trading: "HALTED" })), C, "BUY", "1")).toMatchObject({ state: "REFUSED", code: "TRADING_HALTED" });
  });
  it("an edited order no longer counts against itself", () => {
    expect(companyPosition(editContext(ctx, "o1"), C).room).toBe(4000);
    expect(previewOrder(editContext(ctx, "o1"), C, "BUY", "4000")).toMatchObject({ state: "OK" });
  });
});

describe("position, cash and tradability", () => {
  const ctx = buildOrderContext(input());
  it("companyPosition", () => {
    expect(companyPosition(ctx, C)).toEqual({ price: 2000, owned: 1000, pending: { BUY: 500, SELL: 200 }, room: 3500, sellable: 800 });
    expect(companyPosition(ctx, D)).toEqual({ price: 500, owned: 0, pending: { BUY: 0, SELL: 0 }, room: 5000, sellable: 0 });
  });
  it("cashSummary", () => {
    expect(cashSummary(ctx)).toEqual({ cash: 10_000_000, reserved: 1_100_000, available: 8_900_000 });
  });
  it("notTradable", () => {
    expect(notTradable(ctx, A)).toBe("you built it");
    expect(notTradable(ctx, B)).toBe("you rescued it");
    expect(notTradable(ctx, C)).toBeNull();
    expect(notTradable(ctx, "eeeeeeee-0000-0000-0000-000000000005")).toBe("no price yet");
  });
});

describe("text helpers", () => {
  it("labels and summaries", () => {
    expect(orderLabel("BUY", 1000, "CMP")).toBe("BUY 1,000 CMP");
    expect(orderSummary("SELL", 200, "CMP", 400_000)).toBe("You sell 200 CMP for about $4,000.00.");
  });
  it("parseShares", () => {
    expect(parseShares("1,000")).toBe(1000);
    expect(parseShares("2 500")).toBe(2500);
    expect(parseShares("-5")).toBeNull();
    expect(parseShares("")).toBeNull();
  });
  it("client references match the pattern the action accepts", () => {
    const nonce = newNonce({ getRandomValues: <T extends ArrayBufferView | null>(a: T) => a, randomUUID: () => "12345678-1234-1234-1234-123456789abc" } as Crypto);
    expect(CLIENT_REF_RE.test(clientRef(nonce, C, "BUY", 100))).toBe(true);
    expect(CLIENT_REF_RE.test(`${nonce}|${C}|SHORT|100`)).toBe(false);
    const hex = newNonce({ getRandomValues: <T extends ArrayBufferView | null>(a: T) => a } as Crypto);
    expect(hex).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("tradingNotice", () => {
  const base = { phase: "MARKET_BLIND" as const, trading: "HALTED" as const, paused: false, marketClosed: false, nowMs: Date.parse("2026-11-21T02:40:00Z"), gate: null };
  it("null while a round accepts orders", () => {
    expect(tradingNotice({ ...base, trading: "OPEN" }, rounds)).toBeNull();
  });
  it("before trading starts", () => {
    expect(tradingNotice({ ...base, phase: "RESCUE" }, rounds)?.text).toContain("starts after Round 2");
  });
  it("paused with a round open", () => {
    expect(tradingNotice({ ...base, paused: true }, rounds)?.text).toContain("Round 2 carries on");
  });
  it("waiting for the reveal before round 3", () => {
    const after = rounds.map((r) => (r.number === 2 ? { ...r, status: "CLEARED" as const } : r));
    const n = tradingNotice({ ...base, nowMs: Date.parse("2026-11-21T02:46:00Z"), gate: "scores" }, after);
    expect(n?.text).toBe("Round 3 opens after the score reveal (waiting for every crisis-solution score).");
    expect(n?.next?.number).toBe(3);
  });
  it("a closed round being cleared", () => {
    expect(tradingNotice({ ...base, nowMs: Date.parse("2026-11-21T02:46:00Z") }, rounds)?.text).toBe("Round 2 has closed and is being cleared.");
  });
  it("after the close", () => {
    expect(tradingNotice({ ...base, phase: "SETTLEMENT", marketClosed: true }, rounds)).toMatchObject({ tone: "slate", next: null });
  });
  it("nextRound is the lowest scheduled", () => {
    expect(nextRound(rounds)?.number).toBe(3);
  });
});

describe("open orders and history", () => {
  const i = input();
  it("openOrders: pending in the open round, oldest first", () => {
    const o = openOrders(i.orders, rounds, companies);
    expect(o.map((l) => [l.id, l.roundNumber, l.ticker, l.reserve])).toEqual([
      ["o1", 2, "CMP", 1_100_000],
      ["o2", 2, "CMP", 0],
    ]);
  });
  it("openOrdersState", () => {
    const closesAt = "2026-11-21T02:45:00Z";
    expect(openOrdersState({ accepting: true, paused: false, closesAt, nowMs: Date.parse("2026-11-21T02:40:00Z") })).toBe("EDITABLE");
    expect(openOrdersState({ accepting: false, paused: true, closesAt, nowMs: Date.parse("2026-11-21T02:40:00Z") })).toBe("PAUSED");
    expect(openOrdersState({ accepting: true, paused: false, closesAt, nowMs: Date.parse("2026-11-21T02:45:00Z") })).toBe("CLEARING");
  });
  it("orderHistory: past rounds, with the cash each fill moved", () => {
    const h = orderHistory([...i.orders, order({ id: "o9", round_id: "r1", company_id: D, type: "SELL", qty: 10, status: "CANCELLED" })], rounds, companies);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ number: 1, status: "CLEARED", cash: -1_800_000 });
    expect(h[0]!.lines.map((l) => [l.id, l.cash])).toEqual([
      ["o9", null],
      ["o0", -1_800_000],
    ]);
  });
});
