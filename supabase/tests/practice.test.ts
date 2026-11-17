// The Round 1 practice market (migration 52) and each real trading round's high and low, through the real
// functions: the scripted paths stored by the service role, ticks hidden until their time, practice trades and their
// limits, the settlement into real cash on entering READING (profit only, capped, never twice, ledger balanced), and
// the indicative price tracked while a real round is open.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { candleTicks, practiceCandles, sha256Hex } from "@msim/engine";
import { Night } from "./night";
import { as, service, type Caller } from "./helpers";
import { createTestDb } from "./pg";

const read = (n: Night, who: Caller, sql: string, params: unknown[] = []) => as(n.pool, who, async (c) => (await c.query(sql, params)).rows);

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

describe("practice market", () => {
  test("scripted prices, trading rules, the edge paid into real cash, and live round ranges", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    const seed = sha256Hex("practice");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, seed, "3");
    const [a, b, c] = [await n.squad(1), await n.squad(2), await n.squad(3)];
    const products = await n.q("select id, code from teams where event_id = $1 and track = 'PRODUCT' order by code", [n.eventId]);

    // Before Round 1 the market is closed.
    expect((await n.call(n.team(a.f_code), "practice_trade", products[0].id, "BUY", 10)).code).toBe("PRACTICE_CLOSED");
    await n.advanceTo("BUILD");

    // Only the service role stores the paths; the first tick is 10 minutes ago (so 120 ticks have happened).
    const start = new Date(Date.now() - 600_000);
    const rows = products.map((p) => ({ ticker: p.id, prices: practiceCandles(`${n.eventId}:${p.code}`, 40).flatMap((k) => candleTicks(k)) }));
    await expect(n.call(n.team(a.f_code), "practice_prepare", n.eventId, start.toISOString(), 5, JSON.stringify(rows))).rejects.toThrow();
    expect((await n.call(service, "practice_prepare", n.eventId, start.toISOString(), 5, JSON.stringify(rows))).ok).toBe(true);
    expect((await n.call(service, "practice_prepare", n.eventId, start.toISOString(), 5, JSON.stringify(rows))).already).toBe(true);

    // A team reads ticks up to now only.
    const seen = await read(n, n.team(a.f_code), "select count(*)::int as c, max(step) as last from practice_ticks where ticker_team_id = $1", [products[0].id]);
    expect(seen[0].last).toBeGreaterThanOrEqual(119);
    expect(seen[0].last).toBeLessThanOrEqual(121);
    const priceNow = (id: string) => n.one("select price_cents from practice_ticks where ticker_team_id = $1 and at <= now() order by step desc limit 1", [id]);

    // Trades: Product teams cannot; limits and cover rules hold.
    expect((await n.call(n.team(a.p_code), "practice_trade", products[0].id, "BUY", 10)).code).toBe("NOT_FINANCE");
    const p0 = (await priceNow(products[0].id)).price_cents;
    const buy = await n.ok(n.team(a.f_code), "practice_trade", products[0].id, "BUY", 1000);
    expect(buy.price).toBe(p0);
    expect(buy.cash).toBe(10_000_000 - 1000 * p0);
    expect((await n.call(n.team(a.f_code), "practice_trade", products[0].id, "BUY", 3001)).code).toBe("LIMIT");
    expect((await n.call(n.team(a.f_code), "practice_trade", products[0].id, "SHORT", 10)).code).toBe("SELL_FIRST");
    expect((await n.call(n.team(a.f_code), "practice_trade", products[0].id, "SELL", 1001)).code).toBe("NOT_HELD");
    expect((await n.call(n.team(a.f_code), "practice_trade", products[1].id, "COVER", 5)).code).toBe("NOT_SHORT");
    await n.ok(n.team(a.f_code), "practice_trade", products[1].id, "SHORT", 500);
    expect((await n.call(n.team(a.f_code), "practice_trade", products[1].id, "SHORT", 1501)).code).toBe("LIMIT");
    // Another fund cannot see a's positions or trades; everyone sees the accounts (the leaderboard).
    expect(await read(n, n.team(b.f_code), "select * from practice_positions")).toEqual([]);
    expect(await read(n, n.team(b.f_code), "select * from practice_trades")).toEqual([]);
    expect((await read(n, n.team(b.f_code), "select team_id from practice_accounts")).length).toBe(1);

    // Fund b makes a profit by hand: its account is set to $130,000 of cash (as if it had traded well); c loses.
    await n.ok(n.team(b.f_code), "practice_trade", products[2].id, "BUY", 10);
    await n.ok(n.team(b.f_code), "practice_trade", products[2].id, "SELL", 10);
    await n.q("update practice_accounts set cash_cents = 13000000 where team_id = $1", [n.teamId(b.f_code)]);
    await n.ok(n.team(c.f_code), "practice_trade", products[2].id, "BUY", 10);
    await n.q("update practice_accounts set cash_cents = 9000000 where team_id = $1", [n.teamId(c.f_code)]);
    const cashBefore = Object.fromEntries((await n.q("select code, cash_cents from teams where event_id = $1 and track = 'FINANCE'", [n.eventId])).map((r) => [r.code, Number(r.cash_cents)]));

    // Round 1 ends: READING settles the practice market once.
    for (const [i, s] of [a, b, c].entries()) {
      await n.ok(n.team(s.p_code), "save_draft", "PITCH", { company_name: `Prac Co ${i}`, ticker: ["PCA", "PCB", "PCC"][i], problem: "A problem." }, 0);
      await n.ok(n.team(s.p_code), "submit_submission", "PITCH");
    }
    await n.deadlinePassed("PITCH");
    await n.advanceTo("READING");
    const acct = Object.fromEntries((await n.q("select t.code, a.equity_cents, a.edge_cents from practice_accounts a join teams t on t.id = a.team_id", [])).map((r) => [r.code, r]));
    expect(Number(acct[b.f_code].edge_cents)).toBe(3_000_000);
    expect(Number(acct[c.f_code].edge_cents)).toBe(0);
    const cashAfter = Object.fromEntries((await n.q("select code, cash_cents from teams where event_id = $1 and track = 'FINANCE'", [n.eventId])).map((r) => [r.code, Number(r.cash_cents)]));
    expect(cashAfter[b.f_code]! - cashBefore[b.f_code]!).toBe(3_000_000);
    expect(cashAfter[c.f_code]).toBe(cashBefore[c.f_code]);
    expect(cashAfter[a.f_code]! - cashBefore[a.f_code]!).toBe(Number(acct[a.f_code].edge_cents));
    expect((await n.call(n.team(a.f_code), "practice_trade", products[0].id, "BUY", 1)).code).toBe("PRACTICE_CLOSED");
    // Paid once, and the ledger balances.
    await n.q("select app.settle_practice($1)", [n.eventId]);
    expect((await n.one("select count(*)::int as c from ledger_entries where event_id = $1 and kind = 'PRACTICE_EDGE' and team_id is not null", [n.eventId])).c).toBe(
      Object.values(acct).filter((r) => Number(r.edge_cents) > 0).length,
    );
    await n.checkInvariants();

    // ── The real market: an open round's indicative price, high and low follow the orders.
    for (const [i, s] of [a, b, c].entries()) await n.judge(s.company_id, "PITCH", [[50, 50, 50], [60, 60, 60], [70, 70, 70]][i]!);
    await n.deadlinePassed("CALL_1");
    await n.org("release_scores", n.eventId, "PITCH");
    await n.advanceTo("IPO");
    await n.advanceTo("PRESSURE");
    const round = (await n.one("select min(number)::int as n from rounds where event_id = $1 and phase = 'PRESSURE'", [n.eventId])).n;
    await n.openRound(round);
    const co = a.company_id;
    const open = (await n.one("select market_price from companies where id = $1", [co])).market_price;
    const big = await n.ok(n.team(b.f_code), "place_order", co, "BUY", 2000);
    let r = await n.one("select * from round_ranges where company_id = $1", [co]);
    expect(r.open_cents).toBe(open);
    expect(r.last_cents).toBe(Math.round((open * 102000) / 100000));
    expect(r.high_cents).toBe(r.last_cents);
    const ord = await n.ok(n.team(c.f_code), "place_order", co, "SHORT", 1000);
    await n.ok(n.team(c.f_code), "place_order", co, "SHORT", 1000);
    expect((await n.one("select last_cents from round_ranges where company_id = $1", [co])).last_cents).toBe(open);
    await n.ok(n.team(b.f_code), "cancel_order", big.order.id);
    await n.ok(n.team(c.f_code), "cancel_order", ord.order.id);
    r = await n.one("select * from round_ranges where company_id = $1", [co]);
    expect(r.last_cents).toBe(Math.round((open * 99000) / 100000));
    expect(r.low_cents).toBe(Math.round((open * 98000) / 100000));
    expect(r.high_cents).toBe(Math.round((open * 102000) / 100000));
    // A team of the event reads it.
    expect((await read(n, n.team(a.p_code), "select last_cents from round_ranges where company_id = $1", [co]))[0].last_cents).toBe(r.last_cents);
    await n.clearRound(round);
    await n.checkInvariants();
  });
});
