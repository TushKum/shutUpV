// A test driver that plays a PRIMUS night through the real game functions: teams and organisers call the public
// functions as themselves (RLS and SECURITY DEFINER exactly as in production), the judge worker's part is played by
// writing its readings and calling seal_score as the service role, and the clock is moved by editing the schedule.
// After every clearing it checks the database against the TypeScript engine, and it checks the ledger invariants.

import assert from "node:assert/strict";
import type pg from "pg";
import {
  RUBRICS,
  clearRound,
  sha256Hex,
  stripInjections,
  type ClearingOrder,
  type OrderType,
  type SubmissionType,
  type TraderBook,
} from "@msim/engine";
import { as, seedEvent, service, user, type Caller, type SeededEvent } from "./helpers";

/** The seed every test night uses (64 hex characters) and its commitment. */
export const SEED = "5eed".repeat(16);
export const COMMITMENT = sha256Hex(SEED);

export class Night {
  readonly lead: Caller;
  readonly second: Caller;
  readonly fairness: Caller;
  readonly display: Caller;
  readonly clearings: { round: number; orders: number; ms: number }[] = [];

  constructor(
    readonly pool: pg.Pool,
    readonly ev: SeededEvent,
  ) {
    this.lead = user(ev.staff.get("lead@example.org")!);
    this.second = user(ev.staff.get("exchange@example.org")!);
    this.fairness = user(ev.staff.get("fairness@example.org")!);
    this.display = user(ev.staff.get("display@example.org")!);
  }

  static async create(pool: pg.Pool, teamCount = 6): Promise<Night> {
    const ev = await seedEvent(pool, {
      teamCount,
      seedCommitment: COMMITMENT,
      problemCards: Array.from({ length: Math.max(2, Math.ceil(teamCount / 3)) }, (_, i) => ({
        number: i + 1,
        sector: "Snacks",
        title: `Problem ${i + 1}`,
        body: "A problem.",
      })),
    });
    return new Night(pool, ev);
  }

  get eventId() {
    return this.ev.eventId;
  }

  get codes(): string[] {
    return this.ev.plan.teams.map((t) => t.code);
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
    if (r?.ok !== true) throw new Error(`${fn}(${JSON.stringify(args)}) was refused: ${JSON.stringify(r)}`);
    return r;
  }

  async org(fn: string, ...args: unknown[]) {
    return this.ok(this.lead, fn, ...args);
  }

  team(code: string): Caller {
    return user(this.ev.teams.get(code)!.userId);
  }

  teamId(code: string): string {
    return this.ev.teams.get(code)!.teamId;
  }

  async codeOf(teamId: string): Promise<string> {
    return (await this.one("select code from teams where id = $1", [teamId])).code;
  }

  // ───────────── Clock ─────────────

  async phase(): Promise<string> {
    return (await this.one("select current_phase from events where id = $1", [this.eventId])).current_phase;
  }

  /** Puts a deadline just in the past (or far in the future). */
  async deadlinePassed(code: string, passed = true) {
    await this.q(`update deadlines set at = now() ${passed ? "- interval '1 second'" : "+ interval '6 hours'"} where event_id = $1 and code = $2`, [
      this.eventId,
      code,
    ]);
  }

  /** Advances phase by phase until `target`, keeping every later phase and deadline in the future. */
  async advanceTo(target: string) {
    for (let i = 0; i < 15 && (await this.phase()) !== target; i++) {
      const from = await this.phase();
      await this.q(
        "update phases set starts_at = now() + interval '1 hour', ends_at = now() + interval '2 hours' where event_id = $1 and seq > (select seq from phases where event_id = $1 and code = $2)",
        [this.eventId, from],
      );
      const r = await this.call(this.lead, "advance_phase", this.eventId, from);
      if (!r.ok) throw new Error(`cannot leave ${from}: ${r.message}`);
    }
    assert.equal(await this.phase(), target);
  }

  async openRound(n: number) {
    await this.q("update rounds set opens_at = now() - interval '1 second', closes_at = now() + interval '1 hour' where event_id = $1 and number = $2", [
      this.eventId,
      n,
    ]);
    await this.ok(this.lead, "tick", this.eventId);
    const r = await this.one("select status from rounds where event_id = $1 and number = $2", [this.eventId, n]);
    assert.equal(r.status, "OPEN", `round ${n} opens`);
  }

  // ───────────── Writing and judging ─────────────

  async company(code: string) {
    return this.one("select * from companies where founder_team_id = $1", [this.teamId(code)]);
  }

  async rescued(code: string) {
    return this.one("select * from companies where rescuer_team_id = $1", [this.teamId(code)]);
  }

  async draftVersion(code: string, type: SubmissionType): Promise<number> {
    const rows = await this.q("select version from drafts where team_id = $1 and type = $2", [this.teamId(code), type]);
    return rows[0]?.version ?? 0;
  }

  async save(code: string, type: SubmissionType, content: Record<string, string>) {
    return this.call(this.team(code), "save_draft", type, content, await this.draftVersion(code, type));
  }

  /**
   * The judge worker's part for one submission: strips lines aimed at the judge (logged), writes three readings with
   * the given totals (each with a breakdown that fits the rubric) and seals the score as the service role.
   */
  async judge(companyId: string, type: SubmissionType, totals: [number, number, number]) {
    const sub = await this.one("select * from submissions where company_id = $1 and type = $2", [companyId, type]);
    const { hits } = stripInjections(sub.body_text);
    for (const h of hits) {
      await this.q(
        "insert into injection_logs (event_id, submission_id, team_id, company_id, type, line, pattern) values ($1, $2, $3, $4, $5, $6, $7)",
        [sub.event_id, sub.id, sub.team_id, companyId, type, h.line, h.pattern],
      );
    }
    await this.q(
      "insert into judge_injection_checks (submission_id, event_id, hits) values ($1, $2, $3) on conflict do nothing",
      [sub.id, sub.event_id, hits.length],
    );
    for (const [i, total] of totals.entries()) {
      let left = total;
      const breakdown = Object.fromEntries(
        RUBRICS[type].map((line) => {
          const v = Math.min(line.max, left);
          left -= v;
          return [line.key, v];
        }),
      );
      await this.q(
        `update judge_runs set status = 'DONE', model = 'test-model', breakdown = $3, total = $4, rationale = $5, finished_at = now()
          where submission_id = $1 and generation = 1 and run_no = $2`,
        [sub.id, i + 1, breakdown, total, `One. Two. Three. (reading ${i + 1})`],
      );
    }
    return this.call(service, "seal_score", companyId, type);
  }

  /** Judges every locked submission of a type that is not sealed yet, all with the same three totals. */
  async judgeAll(type: SubmissionType, totals: [number, number, number] = [60, 62, 64], except: Record<string, [number, number, number]> = {}) {
    const subs = await this.q(
      "select s.company_id, t.code from submissions s join teams t on t.id = s.team_id join scores sc on sc.company_id = s.company_id and sc.type = s.type where s.event_id = $1 and s.type = $2 and sc.status = 'PENDING'",
      [this.eventId, type],
    );
    for (const s of subs) {
      const r = await this.judge(s.company_id, type, except[s.code] ?? totals);
      assert.equal(r.ok, true, JSON.stringify(r));
    }
  }

  // ───────────── Trading ─────────────

  async prices(): Promise<Record<string, number>> {
    const rows = await this.q("select id, market_price from companies where event_id = $1 and market_price is not null", [this.eventId]);
    return Object.fromEntries(rows.map((r) => [r.id, r.market_price]));
  }

  async books(): Promise<Record<string, TraderBook>> {
    const teams = await this.q("select id, cash_cents from teams where event_id = $1", [this.eventId]);
    const holdings = await this.q("select team_id, company_id, qty, cost_cents from holdings where event_id = $1", [this.eventId]);
    const books: Record<string, TraderBook> = {};
    for (const t of teams) books[t.id] = { cash: Number(t.cash_cents), positions: {} };
    for (const h of holdings) books[h.team_id]!.positions[h.company_id] = { qty: h.qty, cost: Number(h.cost_cents) };
    return books;
  }

  /** Closes and clears round n through tick(), and checks the result against the engine's clearRound. */
  async clearRound(n: number) {
    const round = await this.one("select * from rounds where event_id = $1 and number = $2", [this.eventId, n]);
    const prices = await this.prices();
    const before = await this.books();
    const orders = (
      await this.q("select id, team_id, company_id, type, qty from orders where round_id = $1 and status = 'PENDING' order by created_at", [round.id])
    ).map((o): ClearingOrder => ({ id: o.id, teamId: o.team_id, companyId: o.company_id, type: o.type as OrderType, qty: o.qty }));
    const expected = clearRound(prices, orders, before);

    await this.q("update rounds set closes_at = now() - interval '1 millisecond' where id = $1", [round.id]);
    const started = performance.now();
    await this.ok(this.lead, "tick", this.eventId);
    this.clearings.push({ round: n, orders: orders.length, ms: performance.now() - started });
    assert.equal((await this.one("select status from rounds where id = $1", [round.id])).status, "CLEARED", `round ${n} clears`);

    const after = await this.books();
    const newPrices = await this.prices();
    for (const [companyId, c] of Object.entries(expected.companies)) assert.equal(newPrices[companyId], c.newPrice, `price ${companyId}`);
    for (const [teamId, book] of Object.entries(expected.traders)) {
      assert.equal(after[teamId]!.cash, book.cash, `cash ${teamId}`);
      for (const [companyId, p] of Object.entries(book.positions)) {
        assert.deepEqual(after[teamId]!.positions[companyId] ?? { qty: 0, cost: 0 }, p, `position ${teamId}/${companyId}`);
      }
    }
    const rp = await this.q("select count(*)::int as n from round_prices where round_id = $1", [round.id]);
    assert.equal(rp[0].n, Object.keys(prices).length, "a price for every company, traded or not");
    return expected;
  }

  // ───────────── Invariants ─────────────

  async checkInvariants() {
    const cash = await this.q(
      `select t.code, t.cash_cents, coalesce(sum(l.cash_delta_cents), 0) as ledger
         from teams t left join ledger_entries l on l.team_id = t.id
        where t.event_id = $1 group by t.id having t.cash_cents <> coalesce(sum(l.cash_delta_cents), 0)`,
      [this.eventId],
    );
    assert.deepEqual(cash, [], "team cash = Σ ledger");

    const holdings = await this.q(
      `select h.team_id, h.company_id, h.qty, coalesce(sum(l.share_delta), 0) as ledger
         from holdings h left join ledger_entries l on l.team_id = h.team_id and l.company_id = h.company_id
        where h.event_id = $1 group by h.id having h.qty <> coalesce(sum(l.share_delta), 0)`,
      [this.eventId],
    );
    assert.deepEqual(holdings, [], "holdings = Σ ledger");

    const money = await this.one(
      "select e.exchange_cash_cents + (select coalesce(sum(cash_cents), 0) from teams where event_id = e.id) as total from events e where e.id = $1",
      [this.eventId],
    );
    assert.equal(Number(money.total), 0, "money is conserved (teams + exchange = 0)");

    const cashTxn = await this.q(
      "select txn_id from ledger_entries where event_id = $1 group by txn_id having sum(cash_delta_cents) <> 0",
      [this.eventId],
    );
    assert.deepEqual(cashTxn, [], "every transaction's cash balances");
    const shareTxn = await this.q(
      "select txn_id, company_id from ledger_entries where event_id = $1 group by txn_id, company_id having sum(share_delta) <> 0",
      [this.eventId],
    );
    assert.deepEqual(shareTxn, [], "every transaction's shares balance");

    const caps = await this.q("select * from holdings where event_id = $1 and (qty < 0 or qty > 5000)", [this.eventId]);
    assert.deepEqual(caps, [], "0 ≤ shares ≤ 5,000");
    const negative = await this.q("select code from teams where event_id = $1 and cash_cents < 0", [this.eventId]);
    assert.deepEqual(negative, [], "no team's cash goes below zero");
  }
}
