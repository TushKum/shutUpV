import { describe, expect, it } from "vitest";
import { ORDER_MESSAGES, maxQuantity, validateOrder } from "@msim/engine";
import {
  CLIENT_REF_RE,
  buildOrderContext,
  clientRef,
  companyPosition,
  editContext,
  fundSummary,
  ipoBook,
  ipoMax,
  ipoResults,
  ipoView,
  ipoWindow,
  maxOrder,
  newNonce,
  nextRound,
  openOrders,
  openOrdersState,
  orderHistory,
  orderLabel,
  orderSummary,
  parseShares,
  previewIpoBid,
  previewOrder,
  tradingNotice,
  type FundInput,
  type OrderRow,
  type RoundRow,
  type TradeCompanyRow,
} from "./trade";

const A = "aaaaaaaa-0000-0000-0000-000000000001"; // the fund's own squad company
const B = "bbbbbbbb-0000-0000-0000-000000000002";
const C = "cccccccc-0000-0000-0000-000000000003";

const companies: TradeCompanyRow[] = [
  { id: A, ticker: "AQS", name: "AquaSense", ipo_price: 1050, market_price: 1050, closing_price: null },
  { id: B, ticker: "BRT", name: "Bright", ipo_price: 1050, market_price: 1000, closing_price: null },
  { id: C, ticker: "CMP", name: "Campus", ipo_price: 1000, market_price: 2000, closing_price: null },
];

const rounds: RoundRow[] = [
  { id: "r1", number: 1, phase: "ROUNDS_1_4", status: "CLEARED", opens_at: "2026-10-08T18:00:00Z", closes_at: "2026-10-08T18:15:00Z" },
  { id: "r2", number: 2, phase: "ROUNDS_1_4", status: "OPEN", opens_at: "2026-10-08T18:15:00Z", closes_at: "2026-10-08T18:30:00Z" },
  { id: "r3", number: 3, phase: "ROUNDS_1_4", status: "SCHEDULED", opens_at: "2026-10-08T18:30:00Z", closes_at: "2026-10-08T18:45:00Z" },
];

const order = (o: Partial<OrderRow> & Pick<OrderRow, "id" | "round_id" | "company_id" | "type" | "qty">): OrderRow => ({
  status: "PENDING",
  entry_price: 1000,
  reserve_cents: 0,
  fill_price: null,
  created_at: "2026-10-08T18:16:00Z",
  filled_at: null,
  cancelled_at: null,
  ...o,
});

const input = (over: Partial<FundInput> = {}): FundInput => ({
  trading: "OPEN",
  team: { track: "FINANCE", cash: 45_000_000, collateral: 0 },
  squadCompanyId: A,
  companies,
  holdings: [
    { company_id: A, lot: "SQUAD", qty: 5000, cost_cents: "5000000" },
    { company_id: B, lot: "EXCHANGE", qty: 1000, cost_cents: "1050000" },
    { company_id: C, lot: "SHORT", qty: 100, cost_cents: 200000 },
  ],
  orders: [
    order({ id: "o1", round_id: "r1", company_id: B, type: "BUY", qty: 1000, status: "FILLED", fill_price: 1050, reserve_cents: 1155000 }),
    order({ id: "o2", round_id: "r2", company_id: B, type: "BUY", qty: 500, reserve_cents: "550000", created_at: "2026-10-08T18:17:00Z" }),
    order({ id: "o3", round_id: "r2", company_id: B, type: "SELL", qty: 200, created_at: "2026-10-08T18:16:30Z" }),
    order({ id: "o4", round_id: "r2", company_id: C, type: "SHORT", qty: 50, reserve_cents: 165000, status: "CANCELLED" }),
  ],
  rounds,
  ...over,
});

describe("buildOrderContext (as app.order_context)", () => {
  it("prices, EXCHANGE and SHORT lots only, and the pending orders of the OPEN round, oldest first", () => {
    const ctx = buildOrderContext(input());
    expect(ctx.trading).toBe("OPEN");
    expect(ctx.prices).toEqual({ [A]: 1050, [B]: 1000, [C]: 2000 });
    expect(ctx.fund.positions).toEqual({ [B]: { exchangeQty: 1000, shortQty: 0 }, [C]: { exchangeQty: 0, shortQty: 100 } });
    expect(ctx.fund.pending.map((p) => p.id)).toEqual(["o3", "o2"]);
    expect(ctx.fund.pending[1]).toEqual({ id: "o2", companyId: B, type: "BUY", qty: 500, reserve: 550000 });
    expect(ctx.fund.squadCompanyId).toBe(A);
  });

  it("leaves out companies without a price and pending orders of a round that is not OPEN", () => {
    const ctx = buildOrderContext(
      input({
        companies: [...companies, { id: "d", ticker: "DDD", name: null, ipo_price: null, market_price: null, closing_price: null }],
        rounds: rounds.map((r) => (r.id === "r2" ? { ...r, status: "CLEARED" } : r)),
      }),
    );
    expect(Object.keys(ctx.prices)).not.toContain("d");
    expect(ctx.fund.pending).toEqual([]);
  });
});

describe("parseShares", () => {
  it("accepts whole numbers, with commas or spaces", () => {
    expect(parseShares("1000")).toBe(1000);
    expect(parseShares(" 1,000 ")).toBe(1000);
    expect(parseShares("4 000")).toBe(4000);
    expect(parseShares("0")).toBe(0);
  });
  it("refuses decimals, signs, letters and blanks", () => {
    for (const t of ["", "  ", "1.5", "-5", "+5", "1e3", "ten", "12a", null, undefined]) expect(parseShares(t)).toBeNull();
  });
});

describe("previewOrder", () => {
  const ctx = buildOrderContext(input());

  it("is empty until a company and a quantity are given", () => {
    expect(previewOrder(ctx, "", "BUY", "100")).toEqual({ state: "EMPTY" });
    expect(previewOrder(ctx, B, "BUY", " ")).toEqual({ state: "EMPTY" });
  });

  it("a BUY reserves qty × price × 1.10 and says what cash is left", () => {
    const p = previewOrder(ctx, B, "BUY", "1,000");
    // 1,000 × $10.00 × 1.10 = $11,000; available = $450,000 − $0 collateral − $5,500 reserved − $11,000
    expect(p).toEqual({ state: "OK", qty: 1000, price: 1000, value: 1_000_000, reserve: 1_100_000, availableAfter: 45_000_000 - 550_000 - 1_100_000 });
  });

  it("a SHORT reserves qty × price × 150% × 1.10", () => {
    const p = previewOrder(ctx, C, "SHORT", "100");
    expect(p).toMatchObject({ state: "OK", reserve: 330_000, value: 200_000 }); // 100 × $20 × 1.5 × 1.1
  });

  it("SELL and COVER reserve nothing", () => {
    expect(previewOrder(ctx, B, "SELL", "800")).toMatchObject({ state: "OK", reserve: 0 });
    expect(previewOrder(ctx, C, "COVER", "100")).toMatchObject({ state: "OK", reserve: 0 });
  });

  it("gives the exchange's exact refusal text", () => {
    expect(previewOrder(ctx, A, "BUY", "10")).toEqual({ state: "REFUSED", code: "INSIDER", message: ORDER_MESSAGES.INSIDER });
    expect(previewOrder(ctx, B, "BUY", "2501")).toMatchObject({ code: "LONG_LIMIT", message: ORDER_MESSAGES.LONG_LIMIT }); // 1,000 + 500 pending
    expect(previewOrder(ctx, B, "SELL", "801")).toMatchObject({ code: "NOT_ENOUGH_SHARES" }); // 1,000 − 200 pending
    expect(previewOrder(ctx, C, "COVER", "101")).toMatchObject({ code: "NOT_ENOUGH_SHORT" });
    expect(previewOrder(ctx, C, "SHORT", "1901")).toMatchObject({ code: "SHORT_LIMIT" });
    expect(previewOrder(ctx, B, "BUY", "1.5")).toEqual({ state: "REFUSED", code: "BAD_QUANTITY", message: ORDER_MESSAGES.BAD_QUANTITY });
    expect(previewOrder(ctx, B, "BUY", "0")).toMatchObject({ code: "BAD_QUANTITY" });
    expect(previewOrder({ ...ctx, trading: "HALTED" }, B, "BUY", "1")).toMatchObject({ code: "TRADING_HALTED", message: "Trading is closed right now." });
    expect(previewOrder({ ...ctx, trading: "PAUSED" }, B, "BUY", "1")).toMatchObject({ code: "TRADING_PAUSED" });
  });

  it("refuses buys and shorts during a collateral deficit, but not sells and covers", () => {
    const short = buildOrderContext(input({ team: { track: "FINANCE", cash: 100_000, collateral: 300_000 } }));
    expect(previewOrder(short, B, "BUY", "1")).toMatchObject({ code: "COLLATERAL_DEFICIT" });
    expect(previewOrder(short, C, "SHORT", "1")).toMatchObject({ code: "COLLATERAL_DEFICIT" });
    expect(previewOrder(short, B, "SELL", "1")).toMatchObject({ state: "OK" });
    expect(previewOrder(short, C, "COVER", "1")).toMatchObject({ state: "OK" });
  });

  it("checks the $250,000 short exposure, counting open and pending shorts", () => {
    // Open: 100 × $20 = $2,000. A short of 1,240 more of C: (100 + 1,240) × $20 = $26,800, under the cap.
    expect(previewOrder(ctx, C, "SHORT", "1240")).toMatchObject({ state: "OK" });
    const big = buildOrderContext(input({ companies: companies.map((c) => (c.id === C ? { ...c, market_price: 20_000 } : c)) }));
    // (100 + 1,150) × $200 = $250,000 is allowed; one more share is not.
    expect(previewOrder(big, C, "SHORT", "1150")).toMatchObject({ state: "OK" });
    expect(previewOrder(big, C, "SHORT", "1151")).toMatchObject({ code: "SHORT_EXPOSURE", message: ORDER_MESSAGES.SHORT_EXPOSURE });
  });

  it("agrees with the engine on every quantity it previews", () => {
    for (const type of ["BUY", "SELL", "SHORT", "COVER"] as const) {
      for (const qty of [1, 99, 100, 500, 1999, 2000, 2500, 4000, 40_000]) {
        const engine = validateOrder(ctx, { companyId: C, type, qty });
        const p = previewOrder(ctx, C, type, String(qty));
        expect(p.state === "OK").toBe(engine.ok);
        if (engine.ok && p.state === "OK") expect(p.reserve).toBe(engine.reserve);
      }
    }
  });

  it("when editing, the order being edited no longer counts", () => {
    const edit = editContext(ctx, "o2");
    // Without o2 (BUY 500 pending) there is room for 3,000 more.
    expect(previewOrder(edit, B, "BUY", "3000")).toMatchObject({ state: "OK", availableAfter: 45_000_000 - 3_300_000 });
    expect(previewOrder(ctx, B, "BUY", "3000")).toMatchObject({ code: "LONG_LIMIT" });
  });
});

describe("maxOrder", () => {
  const ctx = buildOrderContext(input());
  it("is the engine's maxQuantity", () => {
    for (const type of ["BUY", "SELL", "SHORT", "COVER"] as const) {
      for (const c of [B, C]) expect(maxOrder(ctx, c, type).max).toBe(maxQuantity(ctx, c, type));
    }
    expect(maxOrder(ctx, B, "BUY")).toEqual({ max: 2500, reason: null });
    expect(maxOrder(ctx, B, "SELL")).toEqual({ max: 800, reason: null });
    expect(maxOrder(ctx, C, "COVER")).toEqual({ max: 100, reason: null });
  });
  it("is limited by cash when cash is short", () => {
    const poor = buildOrderContext(input({ team: { track: "FINANCE", cash: 1_000_000, collateral: 0 } }));
    // Available $10,000 − $5,500 reserved = $4,500; a BUY of B reserves q × $11.00: 409 shares ($4,499.00).
    expect(maxOrder(poor, B, "BUY").max).toBe(409);
    expect(previewOrder(poor, B, "BUY", "410")).toMatchObject({ code: "INSUFFICIENT_CASH" });
  });
  it("is 0 with the reason when not even one share would pass", () => {
    expect(maxOrder(ctx, A, "BUY")).toEqual({ max: 0, reason: ORDER_MESSAGES.INSIDER });
    expect(maxOrder(ctx, C, "SELL")).toEqual({ max: 0, reason: ORDER_MESSAGES.NOT_ENOUGH_SHARES });
  });
});

describe("companyPosition and fundSummary", () => {
  const ctx = buildOrderContext(input());
  it("shows the room left under each limit, counting pending orders", () => {
    expect(companyPosition(ctx, B)).toEqual({
      price: 1000,
      exchangeQty: 1000,
      shortQty: 0,
      pending: { BUY: 500, SELL: 200, SHORT: 0, COVER: 0 },
      longRoom: 2500,
      sellable: 800,
      shortRoom: 2000,
      coverable: 0,
    });
    expect(companyPosition(editContext(ctx, "o2"), B).longRoom).toBe(3000);
  });
  it("cash, collateral, reserves, available cash and short exposure", () => {
    const f = fundSummary(buildOrderContext(input({ team: { track: "FINANCE", cash: 45_000_000, collateral: 300_000 } })));
    expect(f).toEqual({
      cash: 45_000_000,
      collateral: 300_000,
      reserved: 550_000,
      available: 45_000_000 - 300_000 - 550_000,
      deficit: 0,
      blocked: false,
      shortExposure: 200_000,
      shortExposureWithPending: 200_000,
      exposureCap: 25_000_000,
    });
    const withShort = buildOrderContext(input({ orders: [order({ id: "s", round_id: "r2", company_id: C, type: "SHORT", qty: 50, reserve_cents: 165000 })] }));
    expect(fundSummary(withShort).shortExposureWithPending).toBe(300_000);
    expect(fundSummary(buildOrderContext(input({ team: { track: "FINANCE", cash: 100, collateral: 300 } })))).toMatchObject({ deficit: 200, blocked: true });
  });
});

describe("client references", () => {
  it("repeat for the same order and differ for another", () => {
    const n = newNonce();
    expect(clientRef(n, B, "BUY", 100)).toBe(clientRef(n, B, "BUY", 100));
    expect(clientRef(n, B, "BUY", 100)).not.toBe(clientRef(n, B, "BUY", 101));
    expect(clientRef(n, B, "BUY", 100)).not.toBe(clientRef(newNonce(), B, "BUY", 100));
    expect(CLIENT_REF_RE.test(clientRef(n, B, "SHORT", 2000))).toBe(true);
  });
  it("falls back to random bytes without randomUUID", () => {
    const zeros = { getRandomValues: <T extends ArrayBufferView | null>(a: T) => a } as Pick<Crypto, "getRandomValues">;
    const n = newNonce(zeros);
    expect(n).toBe("0".repeat(32));
    expect(CLIENT_REF_RE.test(clientRef(n, C, "COVER", 1))).toBe(true);
    expect(CLIENT_REF_RE.test("x|y|BUY|1")).toBe(false);
  });
  it("labels an order", () => expect(orderLabel("BUY", 1500, "BRT")).toBe("BUY 1,500 BRT"));
  it("says an order in one plain sentence", () => {
    expect(orderSummary("BUY", 500, "AQS", 525_000)).toBe("You buy 500 AQS for about $5,250.00.");
    expect(orderSummary("SELL", 1000, "AQS", 1_082_000)).toBe("You sell 1,000 AQS for about $10,820.00.");
    expect(orderSummary("SHORT", 200, "SNAP", 206_000)).toBe("You borrow and sell 200 SNAP for about $2,060.00: you gain if the price falls, and lose if it rises.");
    expect(orderSummary("COVER", 200, "SNAP", 184_400)).toBe("You buy back 200 SNAP that you are short, for about $1,844.00.");
  });
});

describe("IPO", () => {
  const view = ipoView(45_000_000, A, [{ company_id: B, qty_requested: 4000, qty_allocated: null, price: 1050 }], companies);

  it("the saved book and what it leaves", () => {
    expect(ipoBook(view)).toEqual({ committed: 4_200_000, remaining: 40_800_000 });
  });

  it("previews a request with the rest of the book, as validateIpoBids", () => {
    expect(previewIpoBid(view, C, "3000")).toEqual({ state: "OK", qty: 3000, cost: 3_000_000, total: 7_200_000, remaining: 37_800_000, withdraw: false });
    // Replacing the saved request for B.
    expect(previewIpoBid(view, B, "1000")).toMatchObject({ state: "OK", cost: 1_050_000, total: 1_050_000 });
    expect(previewIpoBid(view, B, "0")).toMatchObject({ state: "OK", withdraw: true, total: 0 });
    expect(previewIpoBid(view, C, "")).toEqual({ state: "EMPTY" });
  });

  it("refuses with the database's messages", () => {
    expect(previewIpoBid(view, C, "4001")).toEqual({ state: "REFUSED", code: "BAD_QUANTITY", message: "Request 0 to 4,000 shares per company." });
    expect(previewIpoBid(view, C, "2.5")).toMatchObject({ code: "BAD_QUANTITY" });
    expect(previewIpoBid(view, A, "10")).toEqual({ state: "REFUSED", code: "INSIDER", message: "A fund cannot bid for its own squad's company." });
    const poor = ipoView(5_000_000, A, [{ company_id: B, qty_requested: 4000, qty_allocated: null, price: 1050 }], companies);
    expect(previewIpoBid(poor, C, "1000")).toEqual({
      state: "REFUSED",
      code: "INSUFFICIENT_CASH",
      message: "Your total requests cost more than your cash at IPO prices.",
    });
  });

  it("the largest request the cash allows", () => {
    expect(ipoMax(view, C)).toBe(4000);
    const poor = ipoView(5_000_000, A, [{ company_id: B, qty_requested: 4000, qty_allocated: null, price: 1050 }], companies);
    // $50,000 − $42,000 = $8,000 at $10.00: 800 shares.
    expect(ipoMax(poor, C)).toBe(800);
    expect(previewIpoBid(poor, C, "800")).toMatchObject({ state: "OK", remaining: 0 });
    expect(previewIpoBid(poor, C, "801")).toMatchObject({ code: "INSUFFICIENT_CASH" });
    // Replacing its own request: the whole cash at $10.50 is 4,761 shares, capped at 4,000.
    expect(ipoMax(poor, B)).toBe(4000);
    expect(ipoMax(view, A)).toBe(0);
    expect(ipoMax(ipoView(1000, null, [], companies), B)).toBe(0);
  });

  it("results: shares received and cash paid, withdrawn bids left out", () => {
    const r = ipoResults(
      [
        { company_id: C, qty_requested: 4000, qty_allocated: 3110, price: 1000 },
        { company_id: B, qty_requested: 1000, qty_allocated: 1000, price: 1050 },
        { company_id: A, qty_requested: 0, qty_allocated: 0, price: 1050 },
      ],
      companies,
    );
    expect(r.lines.map((l) => [l.ticker, l.requested, l.allocated, l.paid, l.scaledDown])).toEqual([
      ["BRT", 1000, 1000, 1_050_000, false],
      ["CMP", 4000, 3110, 3_110_000, true],
    ]);
    expect([r.requested, r.allocated, r.paid]).toEqual([5000, 4110, 4_160_000]);
    expect(ipoResults([{ company_id: B, qty_requested: 10, qty_allocated: null, price: 1050 }], companies).lines[0]).toMatchObject({ allocated: null, paid: 0 });
  });

  it("the window, as place_ipo_bid decides it", () => {
    const at = "2026-10-08T18:00:00Z";
    const t = new Date(at).getTime();
    const base = { phase: "IPO" as const, paused: false, allocatedAt: null, deadline: at, nowMs: t };
    expect(ipoWindow(base)).toBe("OPEN");
    expect(ipoWindow({ ...base, nowMs: t + 1 })).toBe("CLOSED");
    expect(ipoWindow({ ...base, paused: true })).toBe("PAUSED");
    expect(ipoWindow({ ...base, phase: "READING" })).toBe("NOT_YET");
    expect(ipoWindow({ ...base, phase: "ROUNDS_1_4" })).toBe("CLOSED");
    expect(ipoWindow({ ...base, phase: "ROUNDS_1_4", allocatedAt: at })).toBe("ALLOCATED");
  });
});

describe("tradingNotice", () => {
  const now = new Date("2026-10-08T18:20:00Z").getTime();
  const s = { phase: "ROUNDS_1_4" as const, trading: "OPEN" as const, paused: false, marketClosed: false, nowMs: now };

  it("is null while a round accepts orders", () => expect(tradingNotice(s, rounds)).toBeNull());

  it("says why and names the next round", () => {
    const between = rounds.map((r) => (r.id === "r2" ? { ...r, status: "CLEARED" as const } : r));
    expect(tradingNotice({ ...s, trading: "HALTED" }, between)).toEqual({
      tone: "blue",
      text: "Trading is closed between rounds.",
      next: { number: 3, opensAt: "2026-10-08T18:30:00Z", phase: "ROUNDS_1_4" },
    });
    expect(tradingNotice({ ...s, trading: "HALTED", nowMs: new Date("2026-10-08T18:30:01Z").getTime() }, between)?.text).toBe("Round 3 opens in a moment.");
    // Paused during round 2: round 2 carries on after the pause, so round 3 is not announced.
    expect(tradingNotice({ ...s, trading: "PAUSED", paused: true }, rounds)).toEqual({
      tone: "amber",
      text: "The event is paused: orders are refused until it resumes. Round 2 carries on then, and its closing time moves later by the length of the pause.",
      next: null,
    });
    // Paused between rounds: the next round is named (its time moves with the pause).
    expect(tradingNotice({ ...s, trading: "PAUSED", paused: true }, between)).toMatchObject({
      text: "The event is paused: orders are refused until it resumes. Round opening times and the rest of the schedule move later by the length of the pause.",
      next: { number: 3 },
    });
    expect(tradingNotice({ ...s, phase: "BREAK", trading: "PAUSED" }, rounds)?.text).toBe("Trading is paused for the break.");
    expect(tradingNotice({ ...s, phase: "CRISIS", trading: "HALTED" }, rounds)?.text).toMatch(/crisis/);
    expect(tradingNotice({ ...s, phase: "PLANS_PUBLISHED", trading: "HALTED" }, rounds)?.text).toMatch(/plans are scored/);
    expect(tradingNotice({ ...s, phase: "IPO", trading: "HALTED" }, rounds)?.text).toBe("Trading starts with round 1.");
    expect(tradingNotice({ ...s, phase: "READING", trading: "HALTED" }, rounds)?.text).toBe("Trading starts with round 1.");
    expect(tradingNotice({ ...s, phase: "CLOSE", trading: "HALTED" }, rounds)).toMatchObject({ next: null, text: expect.stringMatching(/market has closed/) });
  });

  it("a round past its closing time is being cleared", () => {
    const after = new Date("2026-10-08T18:30:01Z").getTime();
    expect(tradingNotice({ ...s, trading: "HALTED", nowMs: after }, rounds)).toEqual({
      tone: "blue",
      text: "Round 2 has closed and is being cleared.",
      next: { number: 3, opensAt: "2026-10-08T18:30:00Z", phase: "ROUNDS_1_4" },
    });
  });

  it("round 18 waits for the flash scores", () => {
    const r18: RoundRow[] = [{ id: "x", number: 18, phase: "ROUNDS_13_21", status: "SCHEDULED", opens_at: "2026-10-08T18:00:00Z", closes_at: "2026-10-08T18:10:00Z" }];
    expect(tradingNotice({ ...s, phase: "ROUNDS_13_21", trading: "HALTED" }, r18)?.text).toMatch(/^Round 18 opens once the flash scores are released/);
  });

  it("the next round is the lowest scheduled one", () => {
    expect(nextRound(rounds)?.number).toBe(3);
    expect(nextRound([])).toBeNull();
  });
});

describe("openOrdersState", () => {
  const closesAt = "2026-10-08T18:30:00Z";
  const before = new Date("2026-10-08T18:29:59Z").getTime();
  const after = new Date(closesAt).getTime();
  it("editable while the round accepts orders, frozen during a pause, clearing once the round has closed", () => {
    expect(openOrdersState({ accepting: true, paused: false, closesAt, nowMs: before })).toBe("EDITABLE");
    expect(openOrdersState({ accepting: false, paused: true, closesAt, nowMs: before })).toBe("PAUSED");
    expect(openOrdersState({ accepting: false, paused: false, closesAt, nowMs: before })).toBe("CLEARING");
    expect(openOrdersState({ accepting: true, paused: false, closesAt, nowMs: after })).toBe("CLEARING");
    expect(openOrdersState({ accepting: false, paused: true, closesAt, nowMs: after })).toBe("CLEARING");
  });
});

describe("open orders and history", () => {
  const all = input().orders;
  it("open orders: pending in an OPEN round, oldest first, with the round and the reserve", () => {
    const open = openOrders(all, rounds, companies);
    expect(open.map((o) => [o.id, o.roundNumber, o.ticker, o.reserve])).toEqual([
      ["o3", 2, "BRT", 0],
      ["o2", 2, "BRT", 550_000],
    ]);
  });
  it("history: by round, newest first, with the cash each fill moved", () => {
    const h = orderHistory(
      [
        ...all,
        order({ id: "o5", round_id: "r1", company_id: C, type: "SHORT", qty: 100, status: "FILLED", fill_price: 2000, created_at: "2026-10-08T18:05:00Z" }),
      ],
      rounds,
      companies,
    );
    expect(h.map((g) => [g.number, g.lines.map((l) => l.id), g.cash])).toEqual([
      [2, ["o4"], 0],
      [1, ["o1", "o5"], -1_050_000 + 200_000],
    ]);
    expect(h[1]!.lines[0]).toMatchObject({ type: "BUY", fillPrice: 1050, cash: -1_050_000, status: "FILLED" });
    expect(h[0]!.lines[0]).toMatchObject({ status: "CANCELLED", cash: null });
  });
});
