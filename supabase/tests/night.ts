// A test driver that plays the night through the real game functions: teams and organisers call the public
// functions as themselves (RLS and SECURITY DEFINER exactly as in production), and the clock is moved by editing
// the schedule. After every clearing it checks the database against the TypeScript engine, and it can check the
// ledger invariants at any point.

import { expect } from "vitest";
import type pg from "pg";
import { RUBRICS, clearRound, type ClearingOrder, type FundBook, type OrderType, type SubmissionType } from "@msim/engine";
import { as, seedEvent, service, user, type Caller, type SeededEvent } from "./helpers";

export const CRISIS_DECK = [
  "Supply shortage", "Regulation", "Legal dispute", "Partner exit", "Data breach",
  "Funding freeze", "Competitor launch", "Safety recall", "Demand collapse", "Operations outage",
].map((category) => ({ category, number: 1, title: category, body: `A ${category.toLowerCase()} hits the company.` }));

export class Night {
  readonly lead: Caller;
  readonly second: Caller;
  readonly fairness: Caller;
  /** How long each clearing tick took (the whole tick transaction, as pg_cron would run it). */
  readonly clearings: { round: number; orders: number; ms: number }[] = [];

  constructor(
    readonly pool: pg.Pool,
    readonly ev: SeededEvent,
  ) {
    this.lead = user(ev.staff.get("lead@example.org")!);
    this.second = user(ev.staff.get("exchange@example.org")!);
    this.fairness = user(ev.staff.get("fairness@example.org")!);
  }

  static async create(pool: pg.Pool, squads: number): Promise<Night> {
    const ev = await seedEvent(pool, {
      teamsPerTrack: squads,
      problemCards: Array.from({ length: squads + 2 }, (_, i) => ({
        number: i + 1,
        sector: "Test",
        title: `Problem ${i + 1}`,
        body: "A problem.",
      })),
      crisisCards: CRISIS_DECK,
    });
    return new Night(pool, ev);
  }

  get eventId() {
    return this.ev.eventId;
  }

  async q<R extends pg.QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<R[]> {
    return (await this.pool.query<R>(sql, params)).rows;
  }

  async one<R extends pg.QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<R> {
    const rows = await this.q<R>(sql, params);
    if (rows.length !== 1) throw new Error(`expected one row, got ${rows.length}: ${sql}`);
    return rows[0]!;
  }

  /** Calls public.<fn>(args…) as `caller` and commits. Returns the jsonb result. */
  async call(caller: Caller, fn: string, ...args: unknown[]): Promise<any> {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    return as(this.pool, caller, async (c) => (await c.query(`select public.${fn}(${placeholders}) as r`, args)).rows[0].r, {
      commit: true,
    });
  }

  async ok(caller: Caller, fn: string, ...args: unknown[]): Promise<any> {
    const r = await this.call(caller, fn, ...args);
    expect(r, `${fn}(${JSON.stringify(args)})`).toMatchObject({ ok: true });
    return r;
  }

  async org(fn: string, ...args: unknown[]) {
    return this.ok(this.lead, fn, ...args);
  }

  /**
   * The judge worker's part: stores one DONE run per total (with a breakdown that fits the rubric) for the company's
   * current submission, then seals the score as the service role.
   */
  async judge(companyId: string, type: SubmissionType, totals: number[], rationale = "One. Two. Three.") {
    const sub = await this.one("select id, event_id from submissions where company_id = $1 and type = $2 and superseded_at is null", [companyId, type]);
    const gen = (await this.one("select coalesce(max(generation), 0) + 1 as g from judge_runs where submission_id = $1", [sub.id])).g;
    for (const [i, total] of totals.entries()) {
      let left = total;
      const breakdown = Object.fromEntries(RUBRICS[type].map((line) => {
        const v = Math.min(line.max, left);
        left -= v;
        return [line.key, v];
      }));
      await this.q(
        `insert into judge_runs (event_id, submission_id, company_id, type, generation, run_no, model, status, breakdown, total, rationale, finished_at)
         values ($1, $2, $3, $4, $5, $6, 'test-model', 'DONE', $7, $8, $9, now())`,
        [sub.event_id, sub.id, companyId, type, gen, i + 1, breakdown, total, `${rationale} (run ${i + 1})`],
      );
    }
    return this.call(service, "seal_score", companyId, type);
  }

  team(code: string): Caller {
    return user(this.ev.teams.get(code)!.userId);
  }

  teamId(code: string): string {
    return this.ev.teams.get(code)!.teamId;
  }

  // ───────────── Clock ─────────────

  async phase(): Promise<string> {
    return (await this.one("select current_phase from events where id = $1", [this.eventId])).current_phase;
  }

  /** Puts a deadline 1 second in the past (or far in the future). */
  async deadlinePassed(code: string, passed = true) {
    await this.q(`update deadlines set at = now() ${passed ? "- interval '1 millisecond'" : "+ interval '6 hours'"} where event_id = $1 and code = $2`, [
      this.eventId,
      code,
    ]);
  }

  /** Advance until `target`, making the current phase's scheduled end "now" so no schedule shift is needed. */
  async advanceTo(target: string) {
    for (let i = 0; i < 25 && (await this.phase()) !== target; i++) {
      const from = await this.phase();
      await this.q("update phases set starts_at = now() + interval '1 hour', ends_at = now() + interval '2 hours' where event_id = $1 and seq > (select seq from phases where event_id = $1 and code = $2)", [
        this.eventId,
        from,
      ]);
      const r = await this.call(this.lead, "advance_phase", this.eventId, from);
      if (!r.ok) throw new Error(`cannot leave ${from}: ${r.message}`);
    }
    expect(await this.phase()).toBe(target);
  }

  async openRound(n: number) {
    await this.q("update rounds set opens_at = now() - interval '1 second', closes_at = now() + interval '1 hour' where event_id = $1 and number = $2", [
      this.eventId,
      n,
    ]);
    await this.ok(this.lead, "tick", this.eventId);
    expect((await this.one("select status from rounds where event_id = $1 and number = $2", [this.eventId, n])).status).toBe("OPEN");
  }

  // ───────────── State ─────────────

  async companyByTicker(ticker: string) {
    return this.one("select * from companies where event_id = $1 and ticker = $2", [this.eventId, ticker]);
  }

  async squad(n: number) {
    return this.one(
      `select s.*, p.code as p_code, c.code as c_code, f.code as f_code, co.id as company_id
         from squads s join teams p on p.id = s.product_team_id join teams c on c.id = s.consulting_team_id
         join teams f on f.id = s.finance_team_id join companies co on co.squad_id = s.id
        where s.event_id = $1 and s.number = $2`,
      [this.eventId, n],
    );
  }

  async prices(): Promise<Record<string, number>> {
    const rows = await this.q("select id, market_price from companies where event_id = $1 and market_price is not null", [this.eventId]);
    return Object.fromEntries(rows.map((r) => [r.id, r.market_price]));
  }

  async fundBooks(): Promise<Record<string, FundBook & { collateral: number }>> {
    const teams = await this.q("select id, cash_cents, collateral_cents from teams where event_id = $1 and track = 'FINANCE'", [this.eventId]);
    const holdings = await this.q(
      "select team_id, company_id, lot, qty, cost_cents from holdings where event_id = $1 and lot in ('EXCHANGE', 'SHORT')",
      [this.eventId],
    );
    const books: Record<string, FundBook & { collateral: number }> = {};
    for (const t of teams) books[t.id] = { cash: Number(t.cash_cents), collateral: Number(t.collateral_cents), positions: {} };
    for (const h of holdings) {
      const pos = (books[h.team_id]!.positions[h.company_id] ??= { exchangeQty: 0, exchangeCost: 0, shortQty: 0, shortProceeds: 0 });
      if (h.lot === "EXCHANGE") {
        pos.exchangeQty = h.qty;
        pos.exchangeCost = Number(h.cost_cents);
      } else {
        pos.shortQty = h.qty;
        pos.shortProceeds = Number(h.cost_cents);
      }
    }
    return books;
  }

  /** Closes and clears round n through tick(), and checks the result against the engine's clearRound. */
  async clearRound(n: number) {
    const round = await this.one("select * from rounds where event_id = $1 and number = $2", [this.eventId, n]);
    const prices = await this.prices();
    const before = await this.fundBooks();
    const orders = (
      await this.q("select id, team_id, company_id, type, qty from orders where round_id = $1 and status = 'PENDING' order by created_at", [round.id])
    ).map((o): ClearingOrder => ({ id: o.id, teamId: o.team_id, companyId: o.company_id, type: o.type as OrderType, qty: o.qty }));
    const expected = clearRound(prices, orders, before);

    await this.q("update rounds set closes_at = now() - interval '1 millisecond' where id = $1", [round.id]);
    const started = performance.now();
    await this.ok(this.lead, "tick", this.eventId);
    this.clearings.push({ round: n, orders: orders.length, ms: performance.now() - started });
    expect((await this.one("select status from rounds where id = $1", [round.id])).status).toBe("CLEARED");

    const after = await this.fundBooks();
    const newPrices = await this.prices();
    for (const [companyId, c] of Object.entries(expected.companies)) expect(newPrices[companyId], `price ${companyId}`).toBe(c.newPrice);
    for (const [teamId, book] of Object.entries(expected.funds)) {
      expect(after[teamId]!.cash, `cash ${teamId}`).toBe(book.cash);
      expect(after[teamId]!.collateral, `collateral ${teamId}`).toBe(book.collateral);
      for (const [companyId, p] of Object.entries(book.positions)) {
        const got = after[teamId]!.positions[companyId] ?? { exchangeQty: 0, exchangeCost: 0, shortQty: 0, shortProceeds: 0 };
        expect(got, `position ${teamId}/${companyId}`).toEqual(p);
      }
    }
    const rp = await this.q("select count(*)::int as n from round_prices where round_id = $1", [round.id]);
    expect(rp[0].n).toBe(Object.keys(prices).length); // a price for every company, traded or not
    const unfilled = await this.q("select count(*)::int as n from orders where round_id = $1 and status = 'PENDING'", [round.id]);
    expect(unfilled[0].n).toBe(0);
    return expected;
  }

  /** Places orders that add up to `net` shares for a company, spread over funds that are allowed and have room. */
  async orderNet(companyId: string, net: number, fundCodes: string[]) {
    if (net === 0) return;
    const books = await this.fundBooks();
    const pending = await this.q(
      `select o.team_id, o.type, sum(o.qty)::int as qty from orders o join rounds r on r.id = o.round_id
        where o.company_id = $1 and o.status = 'PENDING' and r.status = 'OPEN' group by o.team_id, o.type`,
      [companyId],
    );
    const pend = (teamId: string, type: string) => pending.find((p) => p.team_id === teamId && p.type === type)?.qty ?? 0;
    let left = Math.abs(net);
    for (const code of fundCodes) {
      if (left === 0) break;
      const teamId = this.teamId(code);
      const pos = books[teamId]!.positions[companyId] ?? { exchangeQty: 0, shortQty: 0 };
      if (net > 0) {
        const room = Math.min(4000 - pos.exchangeQty - pend(teamId, "BUY"), left);
        if (room > 0) {
          await this.ok(this.team(code), "place_order", companyId, "BUY", room);
          left -= room;
        }
      } else {
        const sellable = Math.min(pos.exchangeQty - pend(teamId, "SELL"), left);
        if (sellable > 0) {
          await this.ok(this.team(code), "place_order", companyId, "SELL", sellable);
          left -= sellable;
        }
        const shortable = Math.min(2000 - pos.shortQty - pend(teamId, "SHORT"), left);
        if (left > 0 && shortable > 0) {
          await this.ok(this.team(code), "place_order", companyId, "SHORT", shortable);
          left -= shortable;
        }
      }
    }
    if (left !== 0) throw new Error(`could not place net ${net} (left ${left})`);
  }

  // ───────────── Invariants ─────────────

  async checkInvariants() {
    const cash = await this.q(`
      select t.code, t.cash_cents, coalesce(sum(l.cash_delta_cents), 0) as ledger
        from teams t left join ledger_entries l on l.team_id = t.id
       where t.event_id = $1 group by t.id having t.cash_cents <> coalesce(sum(l.cash_delta_cents), 0)`, [this.eventId]);
    expect(cash, "team cash = Σ ledger").toEqual([]);

    const lots = await this.q(`
      select h.team_id, h.company_id, h.lot, h.qty, coalesce(sum(l.share_delta), 0) as ledger
        from holdings h left join ledger_entries l on l.team_id = h.team_id and l.company_id = h.company_id and l.lot = h.lot
       where h.event_id = $1 group by h.id
      having h.qty <> case when h.lot = 'SHORT' then -1 else 1 end * coalesce(sum(l.share_delta), 0)`, [this.eventId]);
    expect(lots, "holdings = Σ ledger per lot (SHORT lot: −Σ)").toEqual([]);

    const exch = await this.q(`
      select c.ticker, c.exchange_inventory, coalesce(sum(l.share_delta), 0) as ledger
        from companies c left join ledger_entries l on l.company_id = c.id and l.team_id is null
       where c.event_id = $1 and c.squad_id is not null group by c.id having c.exchange_inventory <> coalesce(sum(l.share_delta), 0)`, [this.eventId]);
    expect(exch, "exchange inventory = Σ exchange ledger").toEqual([]);

    // 100,000 shares per company: Σ long lots + exchange inventory − Σ short = 100,000.
    const shares = await this.q(`
      select c.ticker,
             c.exchange_inventory + coalesce(sum(h.qty) filter (where h.lot <> 'SHORT'), 0) - coalesce(sum(h.qty) filter (where h.lot = 'SHORT'), 0) as total
        from companies c left join holdings h on h.company_id = c.id
       where c.event_id = $1 and c.squad_id is not null group by c.id`, [this.eventId]);
    for (const s of shares) expect(Number(s.total), `shares of ${s.ticker}`).toBe(100_000);

    // Money is conserved: every team's cash plus the exchange's sums to zero.
    const money = await this.one(
      "select e.exchange_cash_cents + (select coalesce(sum(cash_cents), 0) from teams where event_id = e.id) as total from events e where e.id = $1",
      [this.eventId],
    );
    expect(Number(money.total), "money is conserved").toBe(0);

    // Every ledger transaction balances: cash per transaction, and shares per transaction and company
    // (except the issue of new shares at the draw).
    const cashTxn = await this.q(
      "select txn_id, sum(cash_delta_cents) as cash from ledger_entries where event_id = $1 group by txn_id having sum(cash_delta_cents) <> 0",
      [this.eventId]);
    expect(cashTxn, "every transaction's cash balances").toEqual([]);
    const shareTxn = await this.q(
      `select txn_id, company_id, sum(share_delta) as shares from ledger_entries
        where event_id = $1 and kind not in ('ISSUE', 'SEED') group by txn_id, company_id having sum(share_delta) <> 0`,
      [this.eventId]);
    expect(shareTxn, "every transaction's shares balance").toEqual([]);
  }
}
