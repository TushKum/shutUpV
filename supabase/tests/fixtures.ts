// A small PRIMUS event filled in directly (as the database owner, the way the game functions will write it in Phase
// 2), so access rules can be checked phase by phase: six teams, each founding one company; the rescue circle
// T1 → C2, T2 → C3, …, T6 → C1; drafts, locked submissions, scores, trading, Q&A, bulletins, results, a flag.

import type pg from "pg";
import { seedEvent, setPhase, type SeededEvent } from "./helpers";

export interface Fixture extends SeededEvent {
  codes: string[];
  /** Company founded by team i (0-based). */
  company: string[];
  team(code: string): { teamId: string; userId: string };
  staffId(email: string): string;
  setPhase(phase: string): Promise<void>;
  /** Reveal (or hide again) the scores of one submission type. */
  revealScores(type: "PRD" | "SOLUTION", revealed: boolean): Promise<void>;
}

export async function buildFixture(pool: pg.Pool): Promise<Fixture> {
  const ev = await seedEvent(pool);
  const codes = ev.plan.teams.map((t) => t.code);
  const teamId = (i: number) => ev.teams.get(codes[i]!)!.teamId;
  const companies = (
    await pool.query<{ id: string; founder_team_id: string }>("select id, founder_team_id from companies where event_id = $1", [ev.eventId])
  ).rows;
  const company = codes.map((_, i) => companies.find((c) => c.founder_team_id === teamId(i))!.id);
  const problemCards = (await pool.query<{ id: string }>("select id from problem_cards where event_id = $1 order by number", [ev.eventId])).rows;
  const crisisCards = (await pool.query<{ id: string }>("select id from crisis_cards where event_id = $1 order by number", [ev.eventId])).rows;
  const round1 = (await pool.query<{ id: string }>("select id from rounds where event_id = $1 and number = 1", [ev.eventId])).rows[0]!.id;
  const n = codes.length;

  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.price_writer', 'START', true), set_config('app.score_writer', 'judge', true)");
    for (let i = 0; i < n; i++) {
      const ticker = `TK${String.fromCharCode(65 + i)}${String.fromCharCode(65 + i)}`;
      await c.query(
        `update companies set name = $2, ticker = $3, problem_card_id = $4, crisis_card_id = $5, rescuer_team_id = $6,
                start_price = 1000, market_price = 850, score_price = 850, post_crisis_price = 850 where id = $1`,
        [company[i], `Company ${i + 1}`, ticker, problemCards[i]!.id, crisisCards[i % 10]!.id, teamId((i + n - 1) % n)],
      );
      // T(i) wrote the PRD of company i and the solution for company i+1 (the company it rescues).
      const rescued = company[(i + 1) % n]!;
      await c.query(
        `insert into drafts (event_id, team_id, company_id, type, content, version) values
           ($1, $2, $3, 'PRD', '{"problem": "draft"}', 3), ($1, $2, $4, 'SOLUTION', '{"diagnosis": "draft"}', 2)`,
        [ev.eventId, teamId(i), company[i], rescued],
      );
      const prd = await c.query<{ id: string }>(
        `insert into submissions (event_id, team_id, company_id, type, content, body_text, word_count, draft_version, saved_at)
         values ($1, $2, $3, 'PRD', '{"problem": "x"}', 'x', 1, 3, now()) returning id`,
        [ev.eventId, teamId(i), company[i]],
      );
      const sol = await c.query<{ id: string }>(
        `insert into submissions (event_id, team_id, company_id, type, content, body_text, word_count, draft_version, saved_at)
         values ($1, $2, $3, 'SOLUTION', '{"diagnosis": "x"}', 'x', 1, 2, now()) returning id`,
        [ev.eventId, teamId(i), rescued],
      );
      await c.query(
        `insert into scores (event_id, company_id, team_id, type, submission_id, status, run_totals, median, final_score)
         values ($1, $2, $3, 'PRD', $4, 'SEALED', '{50,50,50}', 50, 50),
                ($1, $5, $3, 'SOLUTION', $6, 'SEALED', '{60,60,60}', 60, 60)`,
        [ev.eventId, company[i], teamId(i), prd.rows[0]!.id, rescued, sol.rows[0]!.id],
      );
      await c.query(
        `insert into judge_runs (event_id, submission_id, company_id, type, run_no, status, total)
         values ($1, $2, $3, 'PRD', 1, 'DONE', 50)`,
        [ev.eventId, prd.rows[0]!.id, company[i]],
      );
      await c.query(
        `insert into holdings (event_id, team_id, company_id, qty, cost_cents) values ($1, $2, $3, 100, 85000)`,
        [ev.eventId, teamId(i), company[(i + 2) % n]],
      );
      await c.query(
        `insert into orders (event_id, round_id, team_id, company_id, type, qty, entry_price, reserve_cents)
         values ($1, $2, $3, $4, 'BUY', 10, 850, 9350)`,
        [ev.eventId, round1, teamId(i), company[(i + 3) % n]],
      );
      await c.query(
        `insert into results (event_id, team_id, r1_points, r2_points, r3_points, portfolio_cents, return_bp, total, rank)
         values ($1, $2, 50, 60, 50, 10000000, 0, 160, $3)`,
        [ev.eventId, teamId(i), i + 1],
      );
    }
    await c.query(
      `insert into qa_questions (event_id, company_id, asker_team_id, body) values ($1, $2, $3, 'How many packs a month?')`,
      [ev.eventId, company[1], teamId(0)],
    );
    await c.query(
      `insert into bulletins (event_id, kind, title, body, published_at) values ($1, 'GENERAL', 'Welcome', 'Hello', now())`,
      [ev.eventId],
    );
    await c.query(`insert into event_secrets (event_id, seed) values ($1, 'secret-seed')`, [ev.eventId]);
    await c.query(
      `insert into flags (event_id, kind, company_id, team_ids) values ($1, 1, $2, array[$3, $4]::uuid[])`,
      [ev.eventId, company[0], teamId(1), teamId(2)],
    );
    await c.query(
      `insert into awards (event_id, code, place, team_id, company_id) values ($1, 'WINNER', 1, $2, null)`,
      [ev.eventId, teamId(0)],
    );
    await c.query(
      `insert into public_ledger (event_id, kind, label, team_code, ticker, side, shares, price_cents, round_number)
       values ($1, 'TRADE', 'Trade', $2, 'TKAA', 'BUY', 10, 850, 1)`,
      [ev.eventId, codes[0]],
    );
    await c.query("commit");
  } catch (err) {
    await c.query("rollback");
    throw err;
  } finally {
    c.release();
  }

  return {
    ...ev,
    codes,
    company,
    team: (code) => ev.teams.get(code)!,
    staffId: (email) => ev.staff.get(email)!,
    setPhase: (phase) => setPhase(pool, ev.eventId, phase),
    revealScores: async (type, revealed) => {
      const q = await pool.connect();
      try {
        await q.query("begin");
        await q.query("select set_config('app.score_writer', 'judge', true)");
        await q.query(
          `update scores set status = $3::score_status, revealed_at = case when $3::text = 'REVEALED' then now() end
            where event_id = $1 and type = $2`,
          [ev.eventId, type, revealed ? "REVEALED" : "SEALED"],
        );
        await q.query("commit");
      } catch (err) {
        await q.query("rollback");
        throw err;
      } finally {
        q.release();
      }
    },
  };
}
