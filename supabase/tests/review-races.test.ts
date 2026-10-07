// Regression tests for the concurrency findings of the SQL review (CONC-1 … CONC-5).
//
// Each test replays the reviewer's failure scenario against the real game functions and asserts the fixed
// behaviour. Races are made deterministic: one transaction is held open (or a superuser row lock pauses a clearing
// at a known point), and the test polls pg_stat_activity until the other sessions are waiting on a lock before it
// lets the first one finish. With the pre-fix functions (dd355ea) every CONC test here fails: the scenarios skipped
// a phase, deadlocked (40P01), reopened a cleared round, froze clearing, or moved another event's prices.
//
// The CONC-2 follow-up tests cover the same lock-order inversion in the deal and fee signatures, found while writing
// these tests; they pass since those functions take the squad's deal or fee row before any team.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { sha256Hex } from "@msim/engine";
import { createTestDb } from "./pg";
import { Night } from "./night";
import { holdAsSuperuser, holdTx, lockWaiters, settle, sleep, value, waitForLockWaiters, waitForLockWaitersOr } from "./race";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

// ───────────────────────────── Game setup ─────────────────────────────

const SEED = sha256Hex("review-races"); // 64 hex characters, as run_lottery requires

type Game = { n: Night; ss: any[] };

/** A small event in READING with every pitch judged and released (IPO prices set). */
async function toReading(pool: pg.Pool, squads: number): Promise<Game> {
  const n = await Night.create(pool, squads);
  await n.org("set_seed_commitment", n.eventId, sha256Hex(SEED));
  await n.advanceTo("SQUAD_DRAW");
  await n.org("run_lottery", n.eventId, SEED, "2");
  const ss: any[] = [];
  for (let i = 1; i <= squads; i++) ss.push(await n.squad(i));
  await n.advanceTo("BUILD");
  for (const [i, s] of ss.entries()) {
    await n.ok(n.team(s.p_code), "save_draft", "PITCH", { company_name: `Co ${i}`, ticker: `TK${"ABCDEFGH"[i]}`, problem: "A real problem." }, 0);
    await n.ok(n.team(s.p_code), "submit_submission", "PITCH");
  }
  await n.deadlinePassed("PITCH");
  await n.advanceTo("READING");
  for (const s of ss) expect(await n.judge(s.company_id, "PITCH", [60, 60, 60])).toMatchObject({ ok: true });
  await n.deadlinePassed("CALL_1");
  await n.org("release_scores", n.eventId, "PITCH");
  return { n, ss };
}

async function toIpo(pool: pg.Pool, squads: number): Promise<Game> {
  const g = await toReading(pool, squads);
  await g.n.advanceTo("IPO");
  return g;
}

const roundStatus = async (n: Night, num: number) =>
  (await n.one("select status from rounds where event_id = $1 and number = $2", [n.eventId, num])).status;

/** Every listed company's price is the last price row recorded for it (prices move only through round_prices). */
async function pricesExplained(n: Night) {
  const rows = await n.q(
    `select c.ticker, c.market_price,
            (select rp.market_after from round_prices rp where rp.company_id = c.id order by rp.id desc limit 1) as last
       from companies c where c.event_id = $1 and c.market_price is not null`,
    [n.eventId],
  );
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.filter((r) => r.market_price !== r.last), "market_price = last round_prices.market_after").toEqual([]);
}

// ───────────────────────────── CONC-1 ─────────────────────────────

describe("CONC-1: a tick racing an organiser's advance never advances a second time", () => {
  test("IPO → ROUNDS_1_4: the tick that waited on the advance leaves the event in ROUNDS_1_4", async () => {
    const { n, ss } = await toIpo(db.pool, 3);
    const fund = ss[1].f_code;
    await n.ok(n.team(fund), "place_ipo_bid", ss[0].company_id, 1000);
    await n.org("set_auto_advance", n.eventId, true);
    await n.q(
      "update phases set starts_at = now() - interval '15 minutes', ends_at = now() - interval '1 second' where event_id = $1 and code = 'IPO'",
      [n.eventId],
    );

    // The organiser advances; while that transaction is open a tick (pg_cron or the console) starts.
    const org = holdTx(db.pool, n.lead, async (c) => (await c.query("select public.advance_phase($1, 'IPO') as r", [n.eventId])).rows[0].r);
    expect(await org.started).toMatchObject({ ok: true, phase: "ROUNDS_1_4" });
    const tickP = settle(n.call(n.lead, "tick", n.eventId));
    await waitForLockWaiters(db.pool, 1);
    await org.commit();

    // Pre-fix: {"actions":["advanced to CRISIS"]}, rounds 1-4 force-cleared with no orders, the crisis applied.
    expect(value(await tickP, "tick")).toMatchObject({ ok: true, actions: [] });
    expect(await n.phase()).toBe("ROUNDS_1_4");
    const rounds = await n.q("select number, status from rounds where event_id = $1 and phase = 'ROUNDS_1_4' order by number", [n.eventId]);
    expect(rounds.map((r) => r.status)).toEqual(["SCHEDULED", "SCHEDULED", "SCHEDULED", "SCHEDULED"]);
    expect((await n.one("select crisis_applied_at from events where id = $1", [n.eventId])).crisis_applied_at).toBeNull();
    expect((await n.one("select count(*)::int as c from round_prices where event_id = $1 and kind in ('CLEARING', 'CRISIS')", [n.eventId])).c).toBe(0);
    // The IPO was allocated exactly once.
    expect((await n.one("select qty from holdings where team_id = $1 and company_id = $2 and lot = 'EXCHANGE'", [n.teamId(fund), ss[0].company_id])).qty).toBe(1000);
    expect((await n.one("select count(distinct txn_id)::int as c from ledger_entries where event_id = $1 and kind = 'IPO_ALLOCATION'", [n.eventId])).c).toBe(1);

    // do_advance itself leaves only the phase its caller saw.
    expect((await n.one("select app.do_advance($1, 'IPO') as r", [n.eventId])).r).toMatchObject({ ok: false, code: "STALE" });
    expect(await n.phase()).toBe("ROUNDS_1_4");
    await n.checkInvariants();
  }, 240_000);

  test("READING → IPO: the waiting tick does not allocate the IPO at once with an empty book", async () => {
    const { n, ss } = await toReading(db.pool, 3);
    await n.org("set_auto_advance", n.eventId, true);
    await n.q(
      "update phases set starts_at = now() - interval '15 minutes', ends_at = now() - interval '1 second' where event_id = $1 and code = 'READING'",
      [n.eventId],
    );
    const org = holdTx(db.pool, n.lead, async (c) => (await c.query("select public.advance_phase($1, 'READING') as r", [n.eventId])).rows[0].r);
    expect(await org.started).toMatchObject({ ok: true, phase: "IPO" });
    const tickP = settle(n.call(n.lead, "tick", n.eventId));
    await waitForLockWaiters(db.pool, 1);
    await org.commit();

    expect(value(await tickP, "tick")).toMatchObject({ ok: true, actions: [] });
    expect(await n.phase()).toBe("IPO");
    expect((await n.one("select ipo_allocated_at from events where id = $1", [n.eventId])).ipo_allocated_at).toBeNull();
    // The IPO is still open for bids.
    await n.ok(n.team(ss[1].f_code), "place_ipo_bid", ss[0].company_id, 100);
    await n.checkInvariants();
  }, 240_000);
});

// ───────────────────────────── CONC-2 ─────────────────────────────

describe("CONC-2: team actions in flight during a clearing or the IPO allocation never deadlock", () => {
  /** Each case gets its own event in ROUNDS_1_4 with round 1 open, so one case's failure cannot cascade. */
  async function trading() {
    const { n, ss } = await toIpo(db.pool, 4);
    await n.advanceTo("ROUNDS_1_4");
    await n.openRound(1);
    // Company 1 is traded by the three funds that are not its own squad's; company 2's row is used to pause.
    return { n, c1: ss[0].company_id as string, c2: ss[1].company_id as string, funds: [ss[1].f_code, ss[2].f_code, ss[3].f_code] as string[] };
  }

  test("(a) the tick clears round 1 while three funds cancel: the round clears, every cancel is NOT_EDITABLE", async () => {
    const { n, c1, c2, funds } = await trading();
    const orders: string[] = [];
    for (const f of funds) orders.push((await n.ok(n.team(f), "place_order", c1, "BUY", 10)).order.id);
    await n.q("update rounds set closes_at = now() - interval '1 millisecond' where event_id = $1 and number = 1", [n.eventId]);

    // A superuser lock on another company's row pauses the clearing right after it has locked the round.
    const hold = await holdAsSuperuser(db.pool, "select 1 from companies where id = $1 for update", [c2]);
    const tickP = settle(n.call(n.lead, "tick", n.eventId));
    await waitForLockWaiters(db.pool, 1);
    const cancels = funds.map((f, i) => settle(n.call(n.team(f), "cancel_order", orders[i])));
    await waitForLockWaiters(db.pool, 4);
    await hold.release();

    // Pre-fix: 'deadlock detected' for the tick (round left uncleared) and/or the cancels after about 1 s.
    expect(value(await tickP, "tick")).toMatchObject({ ok: true, actions: ["cleared 1"] });
    for (const [i, c] of (await Promise.all(cancels)).entries()) {
      expect(value(c, `cancel_order ${i}`)).toMatchObject({ ok: false, code: "NOT_EDITABLE" });
    }
    expect(await roundStatus(n, 1)).toBe("CLEARED");
    const st = await n.q("select status from orders where id = any($1)", [orders]);
    expect(st.map((o) => o.status)).toEqual(["FILLED", "FILLED", "FILLED"]);
    // The refusals are audited (a deadlock would have rolled the audit row back with everything else).
    expect((await n.one(
      "select count(*)::int as c from audit_log where event_id = $1 and action = 'rejected' and entity = 'cancel_order' and after ->> 'code' = 'NOT_EDITABLE'",
      [n.eventId])).c).toBe(3);
    await n.checkInvariants();
  }, 240_000);

  test("(b) close_round_now while three funds place orders: the close succeeds, every order is TRADING_HALTED", async () => {
    const { n, c1, c2, funds } = await trading();
    const round1 = (await n.one("select id from rounds where event_id = $1 and number = 1", [n.eventId])).id;
    const hold = await holdAsSuperuser(db.pool, "select 1 from companies where id = $1 for update", [c2]);
    const closeP = settle(n.call(n.lead, "close_round_now", n.eventId));
    await waitForLockWaiters(db.pool, 1);
    const places = funds.map((f) => settle(n.call(n.team(f), "place_order", c1, "BUY", 5)));
    await waitForLockWaiters(db.pool, 4);
    await hold.release();

    // Pre-fix: close_round_now itself got 'deadlock detected', and so did a place_order.
    expect(value(await closeP, "close_round_now")).toMatchObject({ ok: true, round: 1 });
    for (const [i, p] of (await Promise.all(places)).entries()) {
      expect(value(p, `place_order ${i}`)).toMatchObject({ ok: false, code: "TRADING_HALTED" });
    }
    expect(await roundStatus(n, 1)).toBe("CLEARED");
    expect((await n.one("select count(*)::int as c from orders where round_id = $1", [round1])).c).toBe(0);
    await n.checkInvariants();
  }, 240_000);

  test("(c) the organiser leaves ROUNDS_1_4 (forced clearing) while three funds edit: the advance succeeds, every edit is NOT_EDITABLE", async () => {
    const { n, c1, c2, funds } = await trading();
    const orders: string[] = [];
    for (const f of funds) orders.push((await n.ok(n.team(f), "place_order", c1, "BUY", 10)).order.id);
    const hold = await holdAsSuperuser(db.pool, "select 1 from companies where id = $1 for update", [c2]);
    const advP = settle(n.call(n.lead, "advance_phase", n.eventId, "ROUNDS_1_4"));
    await waitForLockWaiters(db.pool, 1);
    const edits = funds.map((f, i) => settle(n.call(n.team(f), "edit_order", orders[i], 20)));
    await waitForLockWaiters(db.pool, 4);
    await hold.release();

    // Pre-fix: the edits held their team and order and waited for the round, while the clearing waited for the orders.
    expect(value(await advP, "advance_phase")).toMatchObject({ ok: true, phase: "CRISIS" });
    for (const [i, e] of (await Promise.all(edits)).entries()) {
      expect(value(e, `edit_order ${i}`)).toMatchObject({ ok: false, code: "NOT_EDITABLE" });
    }
    const st = await n.q("select status, qty from orders where id = any($1)", [orders]);
    expect(st).toEqual([{ status: "FILLED", qty: 10 }, { status: "FILLED", qty: 10 }, { status: "FILLED", qty: 10 }]);
    const rounds = await n.q("select status from rounds where event_id = $1 and phase = 'ROUNDS_1_4'", [n.eventId]);
    expect(rounds.every((r) => r.status === "CLEARED")).toBe(true);
    await n.checkInvariants();
  }, 240_000);

  test("(d) a fund changes its IPO bid while the organiser leaves IPO: the advance succeeds, the bid is IPO_CLOSED", async () => {
    const { n: m, ss: s } = await toIpo(db.pool, 3);
    const co = s[0].company_id;
    const [x, y] = [s[1].f_code, s[2].f_code];
    await m.ok(m.team(x), "place_ipo_bid", co, 100);
    await m.ok(m.team(y), "place_ipo_bid", co, 100);
    const yBid = (await m.one("select id from ipo_bids where team_id = $1 and company_id = $2", [m.teamId(y), co])).id;

    // A superuser lock on y's bid pauses the allocation after it has locked the event.
    const hold = await holdAsSuperuser(db.pool, "select 1 from ipo_bids where id = $1 for update", [yBid]);
    const advP = settle(m.call(m.lead, "advance_phase", m.eventId, "IPO"));
    await waitForLockWaiters(db.pool, 1);
    const bidP = settle(m.call(m.team(x), "place_ipo_bid", co, 200));
    await waitForLockWaiters(db.pool, 2);
    await hold.release();

    // Pre-fix: the bid got 'deadlock detected' instead of IPO_CLOSED.
    expect(value(await advP, "advance_phase")).toMatchObject({ ok: true, phase: "ROUNDS_1_4" });
    expect(value(await bidP, "place_ipo_bid")).toMatchObject({ ok: false, code: "IPO_CLOSED" });
    const bid = await m.one("select qty_requested, qty_allocated from ipo_bids where team_id = $1 and company_id = $2", [m.teamId(x), co]);
    expect(bid).toEqual({ qty_requested: 100, qty_allocated: 100 });
    await m.checkInvariants();
  }, 240_000);
});

// The same lock-order inversion outside the paths the CONC-2 fix covered: the squad's shared deal and fee rows.
// Every signer locks its own team (lock_caller_team), then the deal or fee row; the last signature then locks the
// squad's other teams. A second squad team acting on the same row at that moment holds its team and waits for the
// row, so the two transactions deadlock. These tests FAIL on the current code ('deadlock detected' after 1 s); either
// outcome below is acceptable once the lock order is consistent.
describe("CONC-2 follow-up: deal and fee signatures follow one lock order", () => {
  /** An event in CRISIS (deal and fee windows open) and its squad 1. */
  async function inCrisis() {
    const { n, ss } = await toIpo(db.pool, 3);
    await n.advanceTo("ROUNDS_1_4");
    await n.advanceTo("CRISIS");
    return { n, s: ss[0] };
  }

  test("the fund edits the deal while the consultant gives the last signature: no deadlock", async () => {
    const { n, s } = await inCrisis();
    const post = (await n.one("select post_crisis_price from companies where id = $1", [s.company_id])).post_crisis_price;
    await n.ok(n.team(s.c_code), "edit_deal", null, post);
    const d = (await n.ok(n.team(s.f_code), "edit_deal", 6_000_000, null)).deal;
    await n.ok(n.team(s.p_code), "sign_deal", d.version);
    await n.ok(n.team(s.f_code), "sign_deal", d.version);

    // The fund's edit is paused (superuser lock on its rate-limit row) right after it has locked its own team.
    const hold = await holdAsSuperuser(db.pool, "select 1 from rate_limits where team_id = $1 and bucket = 'actions' for update", [n.teamId(s.f_code)]);
    const editP = settle(n.call(n.team(s.f_code), "edit_deal", 6_500_000, null));
    await waitForLockWaiters(db.pool, 1);
    const signP = settle(n.call(n.team(s.c_code), "sign_deal", d.version));
    await waitForLockWaitersOr(db.pool, 2, signP);
    await hold.release();

    // Today: sign_deal raises 'deadlock detected' (it holds the deal and waits for the fund's team; the edit holds the
    // fund's team and waits for the deal).
    const sign = value(await signP, "sign_deal");
    const edit = value(await editP, "edit_deal");
    const deal = await n.one("select executed_at, amount_cents from deals where squad_id = $1", [s.id]);
    if (deal.executed_at) {
      expect(sign).toMatchObject({ ok: true });
      expect(edit).toMatchObject({ ok: false, code: "ALREADY_SIGNED" });
      expect(Number(deal.amount_cents)).toBe(6_000_000);
    } else {
      expect(edit).toMatchObject({ ok: true });
      expect(sign).toMatchObject({ ok: false, code: "VERSION_CONFLICT" });
    }
    await n.checkInvariants();
  }, 240_000);

  test("the product team proposes new fee terms while the consultant gives the last confirmation: no deadlock", async () => {
    const { n, s } = await inCrisis();
    const f = (await n.ok(n.team(s.c_code), "propose_fee", 1_500_000, 0)).fee;
    await n.ok(n.team(s.p_code), "confirm_fee", f.version);

    const hold = await holdAsSuperuser(db.pool, "select 1 from rate_limits where team_id = $1 and bucket = 'actions' for update", [n.teamId(s.p_code)]);
    const proposeP = settle(n.call(n.team(s.p_code), "propose_fee", 2_000_000, 0));
    await waitForLockWaiters(db.pool, 1);
    const confirmP = settle(n.call(n.team(s.c_code), "confirm_fee", f.version));
    await waitForLockWaitersOr(db.pool, 2, confirmP);
    await hold.release();

    // Today: confirm_fee raises 'deadlock detected' (it holds the fee and waits for the product team; the proposal
    // holds the product team and waits for the fee).
    const confirm = value(await confirmP, "confirm_fee");
    const propose = value(await proposeP, "propose_fee");
    const fee = await n.one("select executed_at, cash_cents from fees where squad_id = $1", [s.id]);
    if (fee.executed_at) {
      expect(confirm).toMatchObject({ ok: true });
      expect(propose).toMatchObject({ ok: false, code: "ALREADY_AGREED" });
      expect(Number(fee.cash_cents)).toBe(1_500_000);
    } else {
      expect(propose).toMatchObject({ ok: true });
      expect(confirm).toMatchObject({ ok: false, code: "VERSION_CONFLICT" });
    }
    await n.checkInvariants();
  }, 240_000);
});

// ───────────────────────────── CONC-3 ─────────────────────────────

describe("CONC-3: clearing cannot be frozen by a correction, and one failing event does not stop the heartbeat", () => {
  test("a share correction that undercuts a pending SELL or COVER is refused; the rounds then clear normally", async () => {
    const { n, ss } = await toIpo(db.pool, 3);
    const c1 = ss[0].company_id;
    const [seller, shorter] = [ss[1].f_code, ss[2].f_code];
    await n.ok(n.team(seller), "place_ipo_bid", c1, 100);
    await n.advanceTo("ROUNDS_1_4");
    expect((await n.one("select qty from holdings where team_id = $1 and company_id = $2 and lot = 'EXCHANGE'", [n.teamId(seller), c1])).qty).toBe(100);

    await n.openRound(1);
    const sell = await n.ok(n.team(seller), "place_order", c1, "SELL", 100);
    await n.ok(n.team(shorter), "place_order", c1, "SHORT", 100);
    const correction = async (team: string, lot: string, shareDelta: number) =>
      (await n.org("request_correction", n.eventId, "Reverse a double-booked IPO allocation",
        JSON.stringify([{ team_id: n.teamId(team), company_id: c1, lot, share_delta: shareDelta, cash_delta_cents: 0 }]))).correction_id;

    // The reviewer's case: the whole lot under a SELL of the whole lot. Pre-fix this was approved, and afterwards
    // tick / close_round_now / advance_phase all raised 'refusing to clear round 1' for good.
    const all = await correction(seller, "EXCHANGE", -100);
    await expect(n.call(n.second, "decide_correction", all, true, "Checked.")).rejects.toThrow(/pending sell or cover/);
    // One share is enough to be refused.
    const one = await correction(seller, "EXCHANGE", -1);
    await expect(n.call(n.second, "decide_correction", one, true, "Checked.")).rejects.toThrow(/pending sell or cover/);
    expect((await n.q("select status from corrections where id = any($1)", [[all, one]])).map((c) => c.status)).toEqual(["PENDING", "PENDING"]);
    expect((await n.one("select qty from holdings where team_id = $1 and company_id = $2 and lot = 'EXCHANGE'", [n.teamId(seller), c1])).qty).toBe(100);

    // Once the team has edited its order down, the same correction is approved (checked against the state then).
    await n.ok(n.team(seller), "edit_order", sell.order.id, 99);
    await n.ok(n.second, "decide_correction", one, true, "Order edited first.");
    await n.ok(n.second, "decide_correction", all, false, "Wrong amount.");
    expect((await n.one("select qty from holdings where team_id = $1 and company_id = $2 and lot = 'EXCHANGE'", [n.teamId(seller), c1])).qty).toBe(99);

    await n.clearRound(1); // through tick(), checked against the engine
    expect((await n.one("select qty from holdings where team_id = $1 and company_id = $2 and lot = 'EXCHANGE'", [n.teamId(seller), c1])).qty).toBe(0);

    // The same for a COVER: fewer shares short than the pending cover is refused.
    await n.openRound(2);
    await n.ok(n.team(shorter), "place_order", c1, "COVER", 100);
    const cover = await correction(shorter, "SHORT", -100);
    await expect(n.call(n.second, "decide_correction", cover, true, "Checked.")).rejects.toThrow(/pending sell or cover/);
    await n.clearRound(2);
    expect((await n.one("select qty from holdings where team_id = $1 and company_id = $2 and lot = 'SHORT'", [n.teamId(shorter), c1])).qty).toBe(0);
    await n.checkInvariants();
  }, 240_000);

  test("app.tick_all keeps ticking the other events when one event's tick fails, and logs the failure", async () => {
    // Its own database: tick_all ticks every running event in the database.
    const hb = await createTestDb();
    try {
      const games: Game[] = [];
      for (let i = 0; i < 2; i++) {
        const g = await toIpo(hb.pool, 3);
        await g.n.advanceTo("ROUNDS_1_4");
        await g.n.openRound(1);
        await g.n.ok(g.n.team(g.ss[1].f_code), "place_order", g.ss[0].company_id, "BUY", 50);
        games.push(g);
      }
      // tick_all goes through the events in id order: make the first one the failing one, so the good event is
      // ticked after the failure.
      const ordered = (await hb.pool.query("select id from events where id = any($1) order by id", [games.map((g) => g.n.eventId)])).rows.map((r) => r.id);
      const bad = games.find((g) => g.n.eventId === ordered[0])!;
      const good = games.find((g) => g.n.eventId === ordered[1])!;

      // Test-only edit: the bad event's order becomes a SELL of shares the fund does not hold, so its clearing raises.
      const badOrder = (await bad.n.one("select id from orders where event_id = $1", [bad.n.eventId])).id;
      await bad.n.q("update orders set type = 'SELL' where id = $1", [badOrder]);
      for (const g of games) {
        await g.n.q("update rounds set closes_at = now() - interval '1 millisecond' where event_id = $1 and number = 1", [g.n.eventId]);
      }

      // Pre-fix heartbeat ("select public.tick(e.id) from public.events e where …") failed as a whole: the good
      // event's round 1 stayed OPEN.
      const ticked = (await hb.pool.query("select app.tick_all() as n")).rows[0].n;
      expect(ticked).toBe(1);
      expect(await roundStatus(good.n, 1)).toBe("CLEARED");
      expect(await roundStatus(bad.n, 1)).toBe("OPEN");
      const logged = (await hb.pool.query("select event_id, message, context from error_log where source = 'tick'")).rows;
      expect(logged).toHaveLength(1);
      expect(logged[0].event_id).toBe(bad.n.eventId);
      expect(logged[0].message).toMatch(/refusing to clear round 1/);
      expect(logged[0].context).toMatchObject({ sqlstate: "P0001" });

      // Once the cause is fixed, the next heartbeat clears the stuck event too.
      await bad.n.q("update orders set type = 'BUY' where id = $1", [badOrder]);
      expect((await hb.pool.query("select app.tick_all() as n")).rows[0].n).toBe(2);
      expect(await roundStatus(bad.n, 1)).toBe("CLEARED");
      for (const g of games) await g.n.checkInvariants();
    } finally {
      await hb.drop();
    }
  }, 240_000);
});

// ───────────────────────────── CONC-4 ─────────────────────────────

describe("CONC-4: a round that has been cleared never reopens", () => {
  test("a tick racing the organiser's advance out of ROUNDS_1_4 does not reopen round 3; round 5 then opens normally", async () => {
    const { n } = await toIpo(db.pool, 3);
    await n.advanceTo("ROUNDS_1_4");
    await n.openRound(1);
    await n.clearRound(1);
    await n.openRound(2);
    await n.clearRound(2);
    await n.q(
      "update rounds set opens_at = now() - interval '1 second', closes_at = now() + interval '15 minutes' where event_id = $1 and number = 3",
      [n.eventId],
    );

    const org = holdTx(db.pool, n.lead, async (c) => (await c.query("select public.advance_phase($1, 'ROUNDS_1_4') as r", [n.eventId])).rows[0].r);
    expect(await org.started).toMatchObject({ ok: true, phase: "CRISIS" });
    const tickP = settle(n.call(n.lead, "tick", n.eventId));
    await waitForLockWaiters(db.pool, 1);
    await org.commit();

    // Pre-fix: {"actions":["opened 3"]} and round 3 OPEN with cleared_at set.
    expect(value(await tickP, "tick")).toMatchObject({ ok: true, actions: [] });
    expect(await roundStatus(n, 3)).toBe("CLEARED");
    expect(await n.phase()).toBe("CRISIS");

    // Pre-fix the event then stayed HALTED for the rest of the night: the tick did nothing and close_round_now failed
    // on round_prices_clearing_uq.
    await n.advanceTo("RESCUE_1");
    await n.q(
      "update rounds set opens_at = now() - interval '1 second', closes_at = now() + interval '15 minutes' where event_id = $1 and number = 5",
      [n.eventId],
    );
    expect((await n.ok(n.lead, "tick", n.eventId)).actions).toEqual(["opened 5"]);
    expect((await n.one("select app.trading_state($1) as s", [n.eventId])).s).toBe("OPEN");
    expect(await n.call(n.lead, "close_round_now", n.eventId)).toMatchObject({ ok: true, round: 5 });
    await n.checkInvariants();
  }, 240_000);

  test("the tick opens a round only if it is still SCHEDULED when it gets the row", async () => {
    // Every clearing path now holds the event row, so the race above is closed twice. This checks the second guard
    // on its own: a writer changes the round under the tick (a test-only superuser edit standing in for it) after
    // the tick has read the round as SCHEDULED.
    const { n } = await toIpo(db.pool, 3);
    await n.advanceTo("ROUNDS_1_4");
    await n.q(
      "update rounds set opens_at = now() - interval '1 second', closes_at = now() + interval '15 minutes' where event_id = $1 and number = 1",
      [n.eventId],
    );
    const edit = await holdAsSuperuser(
      db.pool,
      "update rounds set status = 'CLEARED', closed_at = now(), cleared_at = now() where event_id = $1 and number = 1",
      [n.eventId],
    );
    const tickP = settle(n.call(n.lead, "tick", n.eventId));
    await waitForLockWaiters(db.pool, 1);
    await edit.release(true);

    // Pre-fix: {"actions":["opened 1"]}, the cleared round set back to OPEN.
    expect(value(await tickP, "tick")).toMatchObject({ ok: true, actions: [] });
    expect(await roundStatus(n, 1)).toBe("CLEARED");
  }, 240_000);
});

// ───────────────────────────── CONC-5 ─────────────────────────────

describe("CONC-5: price updates in one event never change another event's prices", () => {
  test("release_scores (PLAN tier) in event B leaves event A's prices alone", async () => {
    const A = await toIpo(db.pool, 3);
    const B = await toIpo(db.pool, 3);
    for (const g of [A, B]) {
      await g.n.advanceTo("ROUNDS_1_4");
      await g.n.advanceTo("PLANS_PUBLISHED");
      await g.n.org("seal_missing_scores", g.n.eventId, "PLAN");
    }
    const a = A.n;
    const cA = A.ss[0].company_id;
    await a.org("release_scores", a.eventId, "PLAN");
    const tierA = (await a.one("select market_after from round_prices where company_id = $1 and kind = 'PLAN_TIER'", [cA])).market_after;
    await a.advanceTo("ROUNDS_13_21");
    await a.openRound(13);
    await a.ok(a.team(A.ss[1].f_code), "place_order", cA, "BUY", 4000);
    await a.clearRound(13);
    const pricesA = await a.prices();
    expect(pricesA[cA]).not.toBe(tierA); // round 13 moved it away from its tier price (714 -> 743)
    await pricesExplained(a);

    // Pre-fix A's company went back to its own PLAN_TIER price (714), with no price row to explain it.
    await B.n.org("release_scores", B.n.eventId, "PLAN");
    expect(await a.prices()).toEqual(pricesA);
    await pricesExplained(a);
    await pricesExplained(B.n); // B's own companies did take B's tier
    for (const g of [A, B]) await g.n.checkInvariants();
  }, 300_000);

  test("apply_crisis in event C leaves the prices of an event that had its crisis earlier alone", async () => {
    // A: crisis applied, then a round moves a price away from its post-crisis level.
    const A = await toIpo(db.pool, 3);
    const a = A.n;
    const cA = A.ss[0].company_id;
    await a.advanceTo("ROUNDS_1_4");
    await a.advanceTo("CRISIS");
    await a.advanceTo("RESCUE_1");
    await a.openRound(5);
    await a.ok(a.team(A.ss[1].f_code), "place_order", cA, "BUY", 4000);
    await a.clearRound(5);
    const crisisA = (await a.one("select market_after from round_prices where company_id = $1 and kind = 'CRISIS'", [cA])).market_after;
    const pricesA = await a.prices();
    expect(pricesA[cA]).not.toBe(crisisA);

    // Pre-fix C's crisis set every company with a CRISIS row, in any event, back to its own post-crisis price.
    const C = await toIpo(db.pool, 3);
    await C.n.advanceTo("ROUNDS_1_4");
    await C.n.advanceTo("CRISIS");
    expect(await a.prices()).toEqual(pricesA);
    expect((await a.one("select post_crisis_price from companies where id = $1", [cA])).post_crisis_price).toBe(crisisA);
    for (const g of [A, C]) {
      await pricesExplained(g.n);
      await g.n.checkInvariants();
    }
    // C's own crisis was applied.
    const crisisC = await C.n.q("select company_id, market_after from round_prices where event_id = $1 and kind = 'CRISIS'", [C.n.eventId]);
    expect(crisisC).toHaveLength(3);
    const pricesC = await C.n.prices();
    for (const r of crisisC) expect(pricesC[r.company_id]).toBe(r.market_after);
  }, 300_000);
});
