# PLAN — Market Simulation Competition platform

Status: **Phases 1–5 approved; Phase 6 implementation and local verification complete, real-model calibration pending. Phase 7 built and locally verified (bot rehearsal, 500-connection load test, RUNBOOK); a hosted-plan load test remains.** Each phase ends with tests, a summary, and a list of assumptions, then waits for approval.

Source documents: the build brief (the authority) and `Market_Simulation_Event_Guide.docx` v1.0. Section 7 lists where they differ.

---

## 1. Architecture

```
┌──────────────────────────── Vercel (Next.js App Router, TS, Tailwind) ───────────────────────────┐
│  /login    /team (laptop+phone)    /admin (organiser, fairness)    /display (projector 1920×1080) │
│  Server actions + route handlers ──► supabase.rpc(...)  (user's JWT, so auth.uid() is the caller) │
│  /api/judge/*  (AI judge worker, Anthropic SDK, service role)   consoles call tick() as a backup  │
└───────────────────────────────────────────────┬──────────────────────────────────────────────────┘
                                                │ PostgREST / Realtime
┌───────────────────────────────────────── Supabase ───────────────────────────────────────────────┐
│ Postgres: tables (RLS on all, SELECT-only grants) + SECURITY DEFINER game functions               │
│   • every game-changing action = one function = one transaction, row locks, clock = now()          │
│   • triggers: audit_log on every change, append-only ledger/audit, price-write guard                │
│ Auth: one account per team (code → synthetic email), staff accounts, display account              │
│ Realtime: DB-side broadcast (realtime.send) on commit → market/phase/bulletin channels            │
│ pg_cron (every 2 s) → tick(): close rounds, clear, apply deadlines, auto-advance                   │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
packages/engine  — pure TypeScript rules (reference implementation, no I/O)
```

### Key decisions

1. **The engine is the specification, and the database executes it.** `packages/engine` is a pure TypeScript package that implements every rule. The game-changing actions are PL/pgSQL functions, so that each runs in one transaction on the database server, using the database clock and row locks. Each SQL rule is a direct port of the matching engine function. This is how "database functions must use the same logic" is enforced, three ways:
   - **Parity tests** (`supabase/tests/parity.test.ts`) run the TypeScript and the SQL implementation of each rule on thousands of generated inputs (order validation: 5,000 random fund states covering all 14 outcomes) and on the acceptance-test numbers. A mismatch fails the build.
   - **The scripted night** (`night.test.ts`) plays the brief's case studies through the real functions and reproduces every acceptance-test number; every clearing is compared with the engine's `clearRound`.
   - **The full night** (`full-night.test.ts`) plays 150 bot teams through every phase; every clearing is compared with the engine, and the final values and ranks are recomputed with the engine.
   - The heavy, non-concurrent work (lottery, settlement, rankings, awards, collusion flags) also runs in SQL, inside the transaction that changes the phase, so it never depends on a server process being up. The engine is its reference.
2. **Clients never write tables.** `anon` and `authenticated` have SELECT-only grants, filtered by RLS. Every write goes through a SECURITY DEFINER function. Each function checks the caller (`auth.uid()` → `accounts`), the phase, and the deadline (`now()` against the schedule). The browser can call these functions only with its own JWT, so they protect themselves.
3. **Deadlines depend on time, not on state transitions.** An order is accepted only if `now() < round.closes_at` and the event is not paused. A submission is accepted only if `now() <= deadline`. The tick that closes and clears rounds can run a few seconds late without letting a late action through. A late tick only delays a price update.
4. **Money is integer cents in `bigint`, prices are `integer` cents, and tiers are basis points.** One helper rounds half-up: `round_half_up(numerator, denominator)`, with ties going away from zero, which matches Postgres `round(numeric)`. Every multiplication by a rate goes through `mul_rate(cents, num, den)`, and the result is rounded at once. No floating point is used anywhere.
5. **Prices change only inside three functions: clearing, the crisis shock and tier release.** Each sets a transaction-local flag `app.price_writer`. A trigger on `companies` rejects any price change made without that flag, even from the service role. Every change writes a `round_prices` row.
6. **Realtime.** One private broadcast channel per event, `event:{id}` (prices, phase, round, bulletin, takeovers). Database functions send to it with `realtime.send()` inside the transaction, so a message goes out only on commit. A policy on `realtime.messages` lets only the event's accounts (and staff and the display) receive, and no client may send, so nobody can inject fake prices or takeovers. Clients then re-fetch their own private data through RLS. This avoids 500 `postgres_changes` subscriptions, each running an RLS check.
7. **Auto-advance.** `pg_cron` calls `tick()` every 2 seconds, using Supabase's sub-minute cron. Every open organiser console also calls `tick()` once a second (directly, with the organiser's session) as a backup. `tick()` is idempotent and takes an advisory lock.
8. **Rehearsal** is a separate `events` row with `is_rehearsal = true`, `clock_speed = 10`, its own fake teams (codes prefixed `X`), and the same functions.

### Repository layout

```
PLAN.md  README.md  RUNBOOK.md (phase 7)
package.json  pnpm-workspace.yaml  tsconfig.base.json
packages/engine/           @msim/engine — rules, types, default schedule, fixtures, tests
apps/web/                  Next.js app
  app/login  app/team  app/admin  app/display  app/api
  lib/supabase/*  lib/auth/*
supabase/migrations/       schema, RLS, functions (SQL)
supabase/tests/            DB test harness (throwaway local Postgres + Supabase stubs) and RLS/parity tests
scripts/                   seed, login-cards, verify-lottery
seed/                      example CSVs (teams, staff, problem deck, crisis deck, flash bulletin)
prompts/                   judge prompts (published to teams)
```

Phases 3–6 work in separate folders: `apps/web/app/admin`, `app/team`, `app/display`, `apps/web/lib/judge` + `app/admin/judge`. They share `@msim/engine` and `apps/web/lib/db-types.ts`, which is generated from the schema.

---

## 2. Database schema

Every table has `event_id`, so the rehearsal event lives alongside the real one. The time type is `timestamptz`, displayed in Asia/Kolkata. Each type below is a Postgres enum.

**Enums**
- `track`: PRODUCT, CONSULTING, FINANCE
- `account_role`: TEAM, ORGANISER, FAIRNESS, DISPLAY
- `phase_code` (ordered): SETUP, CHECKIN, BRIEFING, SQUAD_DRAW, BUILD, READING, IPO, ROUNDS_1_4, CRISIS, RESCUE_1, BREAK, RESCUE_2, PLANS_PUBLISHED, VERDICTS, ROUNDS_13_21, CLOSE, SETTLEMENT, APPEALS, AWARDS
- `order_type`: BUY, SELL, SHORT, COVER
- `order_status`: PENDING, FILLED, CANCELLED
- `lot_type`: RETAINED (Product's locked 60k), SQUAD (fund's seed and rescue lot), EXCHANGE (fund's long from the IPO and trading), SHORT (fund's short quantity, stored as a positive number), FEE (consultant's fee shares)
- `submission_type`: PITCH, PLAN, FLASH
- `score_status`: PENDING, SCORING, SEALED, RELEASED
- `call_dir`: BUY, SELL
- `flag_status`: OPEN, CLEARED, DISQUALIFIED
- `price_kind`: IPO, CLEARING, CRISIS, PLAN_TIER, FLASH_TIER, CLOSE

| Table | Purpose and key columns |
|---|---|
| `events` | slug, name, is_rehearsal, clock_speed, timezone, starts_at (real time of 20:00), seed_commitment (SHA-256 hex), seed_revealed, dice, drawn_at, current_phase, phase_started_at, paused, paused_at, auto_advance, judge_model_slot (PRIMARY/BACKUP), exchange_cash_cents |
| `event_secrets` | event_id, seed. Holds the secret seed from 21:00 until it is revealed. Staff only. |
| `phases` | Schedule rows: seq, code, starts_at, ends_at, started_at, ended_at |
| `deadlines` | code (PROBLEM_PICK, PITCH, CALL_1, IPO_BIDS, FEE, DEAL_BONUS, DEAL, PLAN, CALL_2, FLASH, FLASH_TIER, CALL_3), at |
| `rounds` | number (1–21), phase, opens_at, closes_at, status (SCHEDULED/OPEN/CLOSED/CLEARED), cleared_at |
| `teams` | code (unique), track, name, cash_cents, collateral_cents (recalculated every round), disqualified |
| `members` | team_id, full_name, roll_number. Organisers cannot share a roll number with a member. |
| `accounts` | user_id (→ auth.users), role, team_id, display_name, roll_number. CHECK `(role='TEAM') = (team_id IS NOT NULL)` means a staff account can never belong to a team. |
| `squads` | number (1–50), product/consulting/finance_team_id (each unique, track-checked by a composite FK), dealt_card_ids[3], chosen_card_id, chosen_at |
| `companies` | product_team_id, squad_id, name, ticker (unique per event), ipo_price, market_price, ai_price, post_crisis_price, closing_market_price, closing_price, crisis_card_id, exchange_inventory |
| `coverage` | consultant_team_id, company_id. 2 rows per consultant and 2 per company. Never the consultant's own squad. |
| `holdings` | team_id, company_id, lot, qty, cost_cents. Unique on (team, company, lot). |
| `orders` | round_id, team_id, company_id, type, qty, status, entry_price, reserve_cents, fill_price, filled_at, client_ref |
| `ipo_bids` | team_id, company_id, qty_requested, qty_allocated, price |
| `round_prices` | One row for every price change: kind, round_id, market_before/after, ai_before/after, buy/sell/short/cover qty, net_qty, capped_net. Unique on (round, company) for CLEARING, which makes clearing idempotent. |
| `fees` | squad, cash_cents, shares, value_cents, product_confirmed_at, consulting_confirmed_at, version, executed_at, is_default |
| `deals` | squad, amount_cents, price_cents, shares, cash_moved_cents, signed_{product,consulting,finance}_at, version, executed_at |
| `submission_drafts` | squad, type, content (jsonb template fields), version (optimistic lock), updated_by. Private to the squad. |
| `submissions` | Immutable submitted versions: squad, company, type, content, text, word_count, submitted_at, submitted_by. The last version submitted on time is the one judged. |
| `judge_runs` | submission_id, run_no, model, prompt_sha, status, attempts, claim_token, request_text, raw_response, breakdown, total, rationale, error, latency_ms |
| `scores` | company, type, runs, median, capped, late, penalty, final_score, tier_bp, breakdown, rationale, status, released_at/by |
| `injection_logs` | submission_id, squad_id, line, pattern |
| `calls` | consultant_team_id, company_id, window (1–3), direction, made_at, baseline_price, judged_price, correct, earnings_cents |
| `qa_questions` | company_id, asker_team_id (hidden from teams by a column grant), body |
| `qa_answers` | question_id, company_id, body (≤100 words) |
| `bulletins` | kind (GENERAL/CRISIS/FLASH/FAIRNESS), title, body, published_at |
| `ledger_entries` | Append-only, one row per party per leg: txn_id, kind, team_id (NULL = exchange), company_id, lot, cash_delta_cents, share_delta, price_cents, round_id, ref. Invariant: each team's cash and holdings equal the sum of its ledger rows. |
| `public_ledger` | Published view of transfers, labelled by squad and role (never team names), plus round aggregates and published corrections |
| `corrections` | requested_by, reason, entries (jsonb), status, approved_by (≠ requester), applied_txn_id, published_at |
| `flags` | kind (1/2/3), company_id, team_ids[], details, status, decided_by, reason, decided_at |
| `results` | Settlement output per team: final_value, return_bp, tiebreak, rank, eligible |
| `awards` | Award code, place, team or company, metric |
| `problem_cards` | number, sector, title, body (60 per event) |
| `crisis_cards` | category, title, body (10 categories) |
| `audit_log` | Append-only: at, actor_user_id, actor_role, actor_team_id, action, entity, entity_id, before, after |
| `rate_limits` | team_id, window_start, count (order-entry throttle) |
| `error_log` | source, message, context. Shown in the admin health view. |

**Row Level Security** (SELECT policies only; there are no write policies):
- **Public to every signed-in account:** events, phases, deadlines, rounds, round_prices, public_ledger, bulletins already published, qa_questions (without the asker), qa_answers.
- **Own team:** teams, members, holdings, orders, ipo_bids, ledger_entries, calls, coverage, accounts.
- **Own squad:** squads, fees, deals, submission_drafts, the problem cards dealt to the squad, and the squad's own submissions.
- **Unlocked by phase:**
  - companies from READING, or earlier for the own squad
  - PITCH submissions from READING
  - PLAN submissions from PLANS_PUBLISHED
  - FLASH submissions once flash scores are released
  - crisis_cards from CRISIS
  - scores once RELEASED
  - results and awards from AWARDS
- **Staff (organiser and fairness officer)** can read everything except `flags`, which only the fairness officer can read.
- **The display account** sees exactly the public set.
- Helpers live in schema `app`, which PostgREST does not expose: `app.my_team_id()`, `app.my_squad_id()`, `app.is_staff()`, `app.phase_reached(event, phase)`, and so on.

**Triggers**
- An audit trigger on every game table.
- `ledger_entries` and `audit_log` are append-only.
- A price guard on `companies`.
- A roll-number cross-check stops a staff account from matching a team member.

---

## 3. Game engine (packages/engine), function by function

| Module | Functions |
|---|---|
| money | `roundHalfUp`, `mulRate`, `avgHalfUp`, `formatCents`. All take `bigint` or `number` integers and never floats. |
| lottery | `rootSeed(seed, dice) = sha256(seed + dice)`. Counter-mode SHA-256 stream per purpose (`squads`, `problems`, `coverage`, `crisis`). Uniform integers by rejection sampling. `formSquads`, `dealProblemCards` (3 distinct cards per squad, each card used at most 3 times), `assignCoverage` (shuffled cycle, offsets +1 and +2: exactly 2 per company, never the consultant's own squad), `assignCrises` (10 categories × 5 companies), `verifyCommitment`. A published script `scripts/verify-lottery.ts` reproduces all of this. |
| ipo | `ipoPrice(tier)`, `validateIpoBids` (0–4,000 shares per company, not the own squad, total cost ≤ cash), `allocateIpo` (pro rata, rounded down to 10 shares) |
| orders | `validateOrder` (halt and pause, insider rules, SELL ≤ shares owned, long limit 4,000 and short limit 2,000 including pending orders, $250k short exposure, buy reserve q×P×1.10, short collateral q×P×1.5×1.10, collateral deficit blocks BUY and SHORT), `maxQuantity` helper |
| clearing | `clearRound(prices, orders)`: net, `clamp(net, ±10,000)`, `new = roundHalfUp(old × (100,000 + net) / 100,000)`, fills, a price row for every company, collateral recalculation |
| tiers | `pitchTier`, `planTier`, `flashTier`, `applyTier` |
| crisis | `crisisShock(price) = roundHalfUp(price × 85/100)` |
| rescue | `validateFee` ($10k–$35k, ≤3,000 shares valued at the IPO price), `defaultFee`, `validateDeal` ($40k–$80k, 50%–100% of the post-crisis price, `shares = floor(amount/price)`, `cash = shares × price`), `dealBonusEarned` |
| prices | `aiPrice` (running field), `marketClose = avgHalfUp(r20, r21)`, `closingPrice` |
| calls | `judgeCall(dir, baseline, judged)` (an equal or missing price is wrong), earnings |
| judge | `sanitize` (strip and log injection lines), `anonymise`, `validateJudgeOutput`, `median`, `needsExtraRuns` (spread > 10), `finalScore` (late → 0, cap 50 without a signed deal, −10 on the second offence, clamp 0–100) |
| scoring | `planBonus` (clamped to −$10k…+$25k), per-track final values, ranking with tie-breaks, `canViewRankings(role, phase)` |
| awards | Top 3 per track, best turnaround, best rescue plan, best-judging fund (portfolio at AI prices) |
| flags | Flag 1 (plan < 50 and ≥3 funds at the 4,000 cap), flag 2 (order vectors with cosine ≥ 0.9, at least 5 orders each), flag 3 (fee ≥ $33k or deal price ≤ 55% of the post-crisis price, with plan < 50) |
| schedule | Default night timetable as event-minute offsets, `buildSchedule(startsAt, clockSpeed)`, pause, resume, extend and shift |

---

## 4. Task list by phase

### Phase 1 — Schema and access
- [x] PLAN.md
- [x] pnpm monorepo (`packages/engine`, `apps/web`, `scripts`, `supabase`), TS config, lint, CI workflow
- [x] Migrations: extensions, enums, all tables and constraints, indexes (`20261007000001`–`000005`)
- [x] RLS policies, `app.*` helpers, grants (SELECT only), column grant hiding the Q&A asker
- [x] Triggers: audit log, append-only tables, price guard, staff/team separation (constraint and roll-number cross-check)
- [x] DB test harness: throwaway local Postgres (or `TEST_DATABASE_URL`), Supabase stub, template database
- [x] RLS and integrity tests (a deliberately loosened policy is caught by the tests)
- [x] Seed: team codes, HMAC-derived passwords, CSV inputs, staff accounts, default schedule, `seed_event()` (one transaction), `purge_event()`, Supabase Admin API logins
- [x] Login-card PDF (pdf-lib, 8 per A4 page, cut lines), from the same derivation, so it can be reprinted
- [x] Auth in Next.js 16: `/login` (team code or staff email), `@supabase/ssr` cookies, `proxy.ts` session refresh, server-side role gates, placeholder area pages
- [x] Tests green, summary, stop

### Phase 2 — Game engine
- [x] All engine modules above, with unit tests, including acceptance tests 1–10 with the exact numbers (`packages/engine/test/acceptance.test.ts`)
- [x] SQL ports of the rules (`20261008000006`, `000007`), parity tests running both implementations on generated inputs
- [x] Game functions in SQL (`20261008000008`–`000014`), each one transaction, caller from `auth.uid()`, clock `now()`:
  - teams: `place_order`, `edit_order`, `cancel_order`, `place_ipo_bid`, `pick_problem_card`, `save_draft`, `submit_submission`, `propose_fee`, `confirm_fee`, `edit_deal`, `sign_deal`, `make_call`, `post_question`, `answer_question`
  - organisers: `advance_phase`, `pause_event`, `resume_event`, `extend_event`, `set_auto_advance`, `close_round_now`, `set_seed_commitment`, `run_lottery`, `seal_score`, `seal_missing_scores`, `release_scores`, `publish_bulletin`, `request_correction`, `decide_correction`
  - fairness officer: `decide_flag` (and `decide_correction`)
  - heartbeat: `tick` (pg_cron every 2 s; clears rounds, opens rounds, applies default problem cards and fees, auto-advances)
  - internal (run by phase transitions): `clear_round`, `allocate_ipo`, `apply_crisis`, `close_market`, `settle` (bonuses, results, flags, rankings, awards), `judge_calls`, `default_tickers`, `apply_default_fees`
- [x] Rankings endpoint `GET /api/rankings`: 401 signed out, 403 to teams and the display before AWARDS (staff from SETTLEMENT); RLS enforces the same
- [x] Invariant checks after every phase: cash and shares equal the ledger sums, 100,000 shares conserved per company, money zero-sum, every transaction balances
- [x] Simulated full night in tests: 150 teams, every phase, ~5,400 accepted actions, settlement and awards; every clearing timed
- [x] `scripts/verify-lottery.ts`: anyone can recheck the draw from the revealed seed; `scripts/new-seed.ts` makes the seed and commitment
- [x] Two adversarial review rounds of the SQL: 24 findings, then 18 in the fixes (one, presence policies, moved to Phase 3), all fixed, each replayed by a regression test (`supabase/tests/review-*.test.ts`), most of them shown to fail on the code before the fix

### Phase 3 — Control panel (/admin)
- [x] Local Supabase (Docker Hub images, `scripts/local-supabase.sh`) and Playwright browser tests against it (`apps/web/e2e`)
- [x] Migration 15: deck upload, flash bulletin prepared then published, "close round N now", `server_time`, `event_status`, screen heartbeats (`ping`), `admin_health`
- [x] Foundation: `/admin` event list, per-event layout (phase, trading state, server clock, realtime status), private realtime channel refresh, heartbeat, organiser consoles as backup tick, UI kit, formatting
- [x] Phase control: advance (two-click, gate explained), pause/resume, extend, auto-advance, close round now, schedule, deadlines, rounds
- [x] Lottery (commitment, draw, verification), bulletins, content upload
- [x] Rounds (pending orders, clearing preview, IPO book, history), health
- [x] Judge (runs, spread, seal missing, release; running the judge comes in Phase 6), exports (CSV)
- [x] Ledger with two-person corrections, fairness (flags, decisions, team drill-down)
- [x] Review (two rounds: 14 findings, then 24 in the fixes; all fixed and covered by tests), all tests, summary

### Phase 4 — Team portal (/team)
- [x] Foundation: team layout (team, phase and countdown, trading and the round, cash and collateral, the latest bulletin, pause and disqualification notices), sections per track, team context loader, shared helpers moved out of the control panel
- [x] Common: home, bulletins, market (pitch book, prices, plans and verdicts, crisis cards), Q&A board, public ledger
- [x] Squad (Product and Consulting): problem card pick, pitch editor, shared plan editor, flash answer
- [x] Rescue: fee (propose and confirm), deal (broker proposes, all three sign)
- [x] Finance: IPO bids, order ticket with live validation and a max-quantity helper, open orders, positions, profit and loss, collateral
- [x] Consulting: calls on the 2 covered companies, earnings breakdown
- [x] Review (two reviewers: 12 findings, all fixed and covered by tests), all tests, summary

- **Common to all tracks:** header with phase and countdown, bulletins, own cash and holdings, pitch book, Q&A board, public ledger, and crisis cards, plans and verdicts once public.
- **Product:**
  - problem card pick
  - pitch form (template fields and a word counter)
  - Q&A answers
  - fee confirmation
  - deal signing
  - plan editor
  - flash answer
- **Consulting:**
  - squad workspace
  - fee confirmation
  - deal broker
  - plan editor
  - calls form
  - earnings breakdown
- **Finance:**
  - IPO bids
  - order ticket with live validation and a max-quantity helper
  - open orders, positions, profit and loss, and collateral
  - deal signing
  - question posting
- Mobile-first layout.

### Phase 5 — Big screen (/display)
1920×1080, high contrast. Header with clock, phase, round, countdown and an OPEN/HALTED/PAUSED badge. Bulletin banner. A 50-ticker grid paged 25 at a time every 20 s. Takeovers for the squad draw (with the seed check), crisis, verdicts, flash news, closing bell and awards. Realtime updates. No team names before AWARDS. After the seed is revealed, a public `GET /api/lottery-record` serves the JSON that `pnpm verify-lottery` checks (decision 86).
- [x] Migration 17: `rankings` (team names at AWARDS), `lottery_record_rows` (public after the seed reveal), `draw_summary`; `/api/rankings` reads `rankings`; public `GET /api/lottery-record?event=<slug>`
- [x] Foundation: event picker, `/display/<slug>` on a 1920×1080 stage scaled to the window, header, bulletin banner, pause strip, takeover selection from stored moments, realtime refresh with a 10 s fallback, heartbeat
- [x] Ticker board (50 tickers, 25 per page every 20 s, price, change since IPO, last round's arrow, moved tiles light up after a clearing)
- [x] Takeovers: squad draw (seed check), crisis (cards, −15%, seed reveal), verdicts (top movers), flash news, closing bell, awards
- [x] Review (two reviewers: 15 findings, then a screenshot check of the fixes: 4 more; all fixed and covered by tests), all tests, summary

### Phase 6 — AI judge pipeline

Implementation and local verification complete. Engine (246), web (631) and database (237) tests pass, as do typecheck, lint and the production build. All 155 browser tests passed in 10.9 minutes; all 13 judge/calibration tests were rechecked against migration 22 and passed. Cloud browser checks used the installed Chromium 154 through an external runner configuration. The final production traces include every required prompt/sample and exclude unrelated app source files.

- [x] Queue, leases, lifetime claim tokens, backoff, median sealing and deliberate release
- [x] Console, CLI, model switch, technical appeals, calibration and published prompts
- [x] Browser coverage for calibration batches, injection stripping, fairness access and all tracks at 390 px
- [x] Correctness, security, brief and failure-mode review; confirmed fixes covered by regressions
- [x] Deployment guide and measured local speed results
- [ ] Real-model calibration with a funded API key and confirmed model access
- [x] Owner approval before Phase 7

The implementation is done; live calibration remains an external prerequisite for full Phase 6 sign-off. No real API key was available in this environment. Both optional additions (calibration retry control and extra-worker guidance) remain pending by the owner's choice.

Prompts stored in `prompts/`. Sanitise and anonymise each submission, wrap it in XML, return structured JSON output, validate it with up to 2 retries. Run 3 times, plus 2 more if the spread is over 10, and take the median. Store every run. Work runs through a database queue with parallel workers and rate-limit backoff, with a progress view. A backup-model switch, release that applies tiers atomically, a re-run for appeals, and a calibration page with 10 sample pitches.

### Phase 7 — Rehearsal and launch
A rehearsal event (fake teams, bot traders, 10× clock). A load test: 500 realtime connections and 150 teams placing orders in the last minute of a round. Clearing must take under 5 s and the display must update in under 2 s. RUNBOOK.md and README.md.
- [x] Bot traders (`scripts/lib/bots.ts`, unit-tested) that play every team through the public game functions, and `pnpm rehearse` with an organiser autopilot (start, draw, auto-advance, judging, releases, flash bulletin, flags)
- [x] A full 150-team night played by the bots on the local stack at 10×: 50 pitches and plans, 50 fees agreed, 50 deals executed, 300 consultant calls, 2,184 orders filled over 21 rounds, every score released, 150 results, 12 awards, no tick errors. It exposed one bot bug (flash answers tried before the bulletin and abandoned), fixed and unit-tested; a second full run is still to do
- [x] `pnpm load-test`: 500 of 500 realtime connections joined, 300 orders in the last minute (all accepted, p95 118 ms), clearing transaction 0.64 s, every screen heard the clearing and re-read its page within 0.4 s
- [x] `scripts/local-load-limits.sh`: the local stack's own caps (Realtime 200 users / 100 events per second, Kong 512 connections) raised so the test measures the app
- [x] RUNBOOK.md (the night minute by minute, roles, incidents), README and DEPLOY updates
- [ ] The same load test against the hosted staging project on the event's plans (the local stack is one machine)
- [ ] Real-model calibration (Phase 6)

---

## 5. Default night schedule (event-minute offsets from 20:00 IST)

| Phase | Start → end | Rounds or deadlines |
|---|---|---|
| CHECKIN | 0 → 30 | |
| BRIEFING | 30 → 60 | |
| SQUAD_DRAW | 60 → 70 | Problem pick due 21:10 |
| BUILD | 70 → 150 | Pitch due 22:30 |
| READING | 150 → 195 | Call 1 due 23:15 |
| IPO | 195 → 210 | IPO bids due 23:30 |
| ROUNDS_1_4 | 210 → 270 | R1–R4 at 15 min each |
| CRISIS | 270 → 285 | |
| RESCUE_1 | 285 → 345 | R5–R8. Fee due 01:05 |
| BREAK | 345 → 360 | |
| RESCUE_2 | 360 → 420 | R9–R12. Deal bonus cutoff 02:45. Deal and plan due 03:00 |
| PLANS_PUBLISHED | 420 → 450 | |
| VERDICTS | 450 (gate) | Plan release |
| ROUNDS_13_21 | 450 → 540 | R13–R21 at 10 min each. Call 2 due 03:40. Flash bulletin 04:00. Flash answers due 04:15. Flash tier applied after R17 at 04:20. Call 3 due 04:30 |
| CLOSE | 540 (instant) | |
| SETTLEMENT | 540 → 570 | |
| APPEALS | 570 → 580 | |
| AWARDS | 580 → 600 | |

Real time = `starts_at + offset ÷ clock_speed`.

- **Pause** freezes the event: trading is refused and a deadline that falls after the pause began has not passed. On resume, everything that has not happened yet (phases not yet started or ended, rounds not yet opened or cleared, deadlines) moves by the length of the pause. A cleared round never moves. Items already overdue when the pause began (a phase waiting at a gate, a round waiting for the tick), and the deadlines whose windows they open, move too, so the pause is not counted again as lateness.
- **Extend** adds N minutes to the current phase or round and moves everything after it.
- **Gates.** Auto-advance (and a manual advance) waits at these points:
  - SQUAD_DRAW until the lottery is drawn
  - READING until pitch scores are released (so the IPO opens with IPO prices)
  - VERDICTS until plan scores are released
  - ROUNDS_13_21 until flash scores are released, and round 18 does not open before then
  - APPEALS until the fairness officer has decided every flag

  If a gate opens late, the rest of the schedule moves by the delay. Rounds therefore keep their full length.

---

## 6. Decisions and assumptions (correct me if any is wrong)

1. **Long limit.** The 4,000 limit applies to the shares currently held in the EXCHANGE lot, including IPO shares and counting pending BUY orders. Selling frees room. The SQUAD lot is excluded.
2. **Shorts.** Short proceeds go into cash. Collateral, 150% × short quantity × current price, is a lock on cash and is recalculated at each clearing. Available cash = cash − collateral − reserves for pending orders. When cash is less than collateral (a deficit), BUY and SHORT orders are blocked, while SELL and COVER orders are always allowed. COVER needs no extra reserve, because covering releases more collateral than it costs.
3. **Short exposure** of $250k is measured as (existing + pending + new short quantity) × current price, with no 1.10 buffer. The 1.10 buffer applies only to cash reserves and collateral.
4. **Rounding.** Every multiplication is rounded at once. For example, a short reserve is `mulRate(mulRate(q×P, 150, 100), 110, 100)`.
5. **Fee and deal execution.**
   - A fee executes when both teams have confirmed it.
   - A deal executes on the third signature. A deal that has executed cannot be changed.
   - Before execution, any edit resets all signatures or confirmations.
   - Consulting sets the deal price. Finance sets the deal amount. Product signs.
   - A deal needs available fund cash ≥ cash moved, and retained shares ≥ the fee shares plus the deal shares.
6. **Submissions** use explicit Submit and can be resubmitted until the deadline. The last version submitted on time is judged. A submission after the deadline is rejected by the server and logged. If there is no submission made on time, the score is 0. This covers acceptance test 8: a plan submitted at 03:00:01 scores 0. An unsubmitted draft is not judged.
7. **Plan score composition.** A late or missing plan scores 0. Otherwise the score is `clamp(min(median, cap) − penalty, 0, 100)`, where cap = 50 if the deal was not fully signed by 03:00 and penalty = 10 on a second offence. So the penalty applies after the cap.
8. **Injection offences** are counted per squad. One offence is one judged submission that contains at least one stripped line. Submissions are ordered PITCH → PLAN → FLASH, and only the judged version counts.
9. **Plan bonus** = `clamp($500 × (score − 50), −$10,000, +$25,000)`. Any score below 30 hits the floor.
10. **Published breakdown and rationale** come from the first run whose total equals the median.
11. **Problem card.** If no card is picked by 21:10, the first dealt card is assigned. The Product team picks; the squad partners can see the three cards. The pick always gets 10 event minutes after the draw: a late draw moves the pick deadline (and the rest of the schedule) later.
12. **Ticker.** If no ticker is claimed by 22:30, one is assigned automatically when Reading starts: `Z` + a three-letter code that is not already used (shown on the Judge and Lottery pages). No organiser action is needed. A company with no pitch scores 0, which gives −10% and an IPO price of $9.00.
13. **Flag 1** counts funds whose EXCHANGE lot equals 4,000 at settlement. **Flag 3** and "plan below 50" use the final plan score.
14. **Finance tie-break**, "smaller largest single position": the largest absolute value of quantity × closing price, across all lots (squad lot included).
15. **Best-judging fund** = cash before short covering + Σ long × AI price − Σ short × AI price, divided by $500k. This includes the squad lot. **Best turnaround** ties are broken by the higher final plan score.
16. **Disqualified teams** are excluded from awards and ranks, and are listed separately.
17. **Rankings.** Organisers and the fairness officer can see results from SETTLEMENT, because they review flags. Teams and the display see them only from AWARDS.
18. **Ledger corrections** are approved by a different organiser or by the fairness officer, never by the requester.
19. **Technical appeal after verdicts.** A re-run updates the score, the AI price, the closing price, the plan bonus and settlement. The market price history that has already happened is not rewritten.
20. **Q&A.** Questions are shown without the asker's team. Answers are attributed to the company's ticker.
21. **Flash answers** become public when flash scores are released.
22. **Team login.** Codes are `P01`–`P50`, `C01`–`C50` and `F01`–`F50`, and rehearsal codes are prefixed `X`. The synthetic email is `{code}@{TEAM_EMAIL_DOMAIN}`. Passwords take the form `XXXX-XXXX-XXXX` and are derived as HMAC-SHA256(`CARD_SECRET`, `event:code`). The script that prints the cards can reprint them at any time, so plaintext passwords are never stored. `CARD_SECRET` never goes to Vercel.
23. **Rate limits.** Orders: 20 order actions per 10 seconds per team. Every other team action shares a bucket of 60 per 10 seconds; submissions also have their own 10 per minute. A throttled call is refused with RATE_LIMITED and writes nothing (not even an audit row). Drafts keep only the template's fields (a pitch also its company name and ticker), and submitting the same text again stores nothing.
24. **Squad workspace** means the three dealt problem cards, the shared pitch, plan and flash drafts, the fee, the deal, and the partner teams' codes and names.
25. **Team codes are logins, so they are unique across all events.** Only one rehearsal event can exist alongside the live one at a time; re-seed it with `--replace`. `--rehearsal` uses the prefix `X`.
26. **Event size.** The live event must have exactly 50 teams per track (enforced in SQL). A rehearsal may use 3–50 per track, with the same number in every track.
27. **Next.js 16 `cacheComponents` is off.** Every screen is per-user and realtime, so the request-time rendering model is simpler and safer.
28. **Login errors.** A sign-in that fails because Supabase cannot be reached says so, rather than "wrong password".
29. **Supabase Auth's sign-in rate limit must be raised** (README step 4). Otherwise 150 check-ins through a few IP addresses would be throttled.
30. **Passwords** are 12 characters from a 31-letter alphabet, about 59 bits. Organisers' and the display account's passwords are derived the same way and written to `out/<slug>-staff-logins.txt`.

31. **Problem deck size.** The deck needs at least (squads + 2) cards; otherwise dealing 3 distinct cards per squad with each card used at most 3 times can run out for the last squad. The live deck has 60 cards for 50 squads. Checked in both the engine and SQL.
32. **Ledger share sign.** `share_delta` is shares received (+) or delivered (−). A short sale is −qty on the fund's SHORT lot (+qty to the exchange); covering and the close are +qty. So a SHORT lot's quantity is −Σ share_delta and every other lot's is +Σ. Every transaction balances in cash and in shares per company (except the issue of new shares at the draw).
33. **Injection stripping.** A line is stripped when, after Unicode normalisation (NFKC, invisible format characters removed, curly quotes made straight), it matches a pattern that addresses the judge in a judging context (ignore the instructions, give/deserves a score, "you are"/"you must", addressing the judge, fake judge output, breaking out of the XML wrapper). Known limit: look-alike letters from other scripts (for example a Cyrillic "о") are not caught; the judge prompt still tells the model to ignore instructions inside the submission.
34. **Word count** (pitch 400, plan 500, flash 100, Q&A answer 100; the template sections only, not the company name or ticker): text is split on whitespace (invisible format characters count as spaces), and a token counts if it has at least one character that is not punctuation. The same definition is in the engine and in SQL.
35. **Q&A rate limits:** 10 questions per minute per fund, and 10 answers per minute per company (each answer is broadcast to every screen).
36. **Realtime messages** go to the private topic `event:{id}` on commit and carry only public data (no team ids, cash or holdings): squad_draw, phase, round_open, round_cleared, ipo_allocated, crisis, verdicts, bulletin, qa, paused, resumed, extended, closing_bell, settled, correction. Clients re-fetch their own private data through RLS.
37. **Heartbeat.** `pg_cron` runs `app.tick_all()` every 2 seconds, which ticks each running event in its own subtransaction: a failure is written to `error_log` (the admin health view) and never stops another event. A tick takes a per-event advisory lock (a second tick at the same moment does nothing), locks the event row (so it serialises with organiser actions), does nothing while paused, and is idempotent. A phase or round that starts more than 5 s late moves the rest of the schedule by the delay.
38. **Consultant calls** are judged when their window's price is known: call 1 at the round 4 clearing price, call 2 when flash scores are released (the flash tier is applied), call 3 at the closing price. Each correct call earns $2,500.
39. **The seed is revealed at the crisis** (Q1), in the same transaction that applies the crisis cards.
40. **Settlement runs in SQL** in the transaction that enters SETTLEMENT: consultant bonuses, final values, collusion flags, then ranks and awards. A disqualification re-ranks at once.
41. **Rankings endpoint.** A team reads its own event; staff and the display pass `?event=<id>`. Responses are `no-store`.
42. **Nobody types in a score.** `seal_score` can be called only by the judge worker (service role), and it seals from the stored judge runs of the company's current submission: 3 runs within 10 points or 5 runs, each checked against the rubric. Organisers seal the 0 for companies with no submission and release. If the AI service fails completely on the night, the fallback (RUNBOOK, Phase 7) records human judges' totals as judge runs through a service-role script, under the same checks.
43. **Scores are sealed after the deadline** (plans: after the plan and deal deadlines, which decide the cap), so a resubmission or a late signature can never leave a stale score. Release also refuses if a sealed score's submission is no longer the current one. Pitch scores (and so IPO prices) are released only after consultant call 1 closes at 23:15, because call 1 is judged against the IPO price.
44. **An early advance closes what the next phase publishes.** Entering READING closes pitch submission; entering PLANS_PUBLISHED closes plans and deal signing. Calls close before the price they are judged at is known (call 1 at the pitch release, call 2 at the flash release, call 3 at the close). Submission, deal and call windows also check the phase, as a second lock.
45. **The seed commitment is fixed once the event leaves SETUP** (the brief: published the day before), and the event cannot leave SETUP without one. The seed must be 32 random bytes in hex (`pnpm new-seed` prints a seed and its commitment), because a guessable seed could be found from its hash and reveal the crisis draw early. `pnpm verify-lottery --commitment …` checks against the value published the day before, not the record's own copy.
46. **Locking.** A team action throttles first (touching only its own rate-limit row), then locks only its own team row, and checks the round or window after that. A clearing or the IPO allocation locks every fund of the event, in id order, before it reads the order book or the bids, so an order or bid in flight either commits first or finds the round closed; no share lock is ever taken that a flood of requests could use to starve the clearing. Squad actions lock the squad's fee or deal row first, then the teams they move money between, in id order. An advance that publishes work locks the companies and deals before anything else. Every row lock is `FOR NO KEY UPDATE`, which never conflicts with the foreign-key checks of inserts. Clearings, corrections, flag decisions and phase changes hold the event row, so they never interleave; the heartbeat bounds its wait for it (3 s) and logs a busy event to `error_log`.
47. **Ledger corrections.** An entry is `{team_id, company_id?, lot?, cash_delta_cents?, share_delta?}`, where `share_delta` is the change in the lot's quantity (for a SHORT lot: more shares short). Entries are validated when requested and again when approved: known keys only, whole numbers within ±$1,000,000 and ±100,000 shares, a company of the event, a lot that fits the team (RETAINED: the company's Product team; FEE: a consultant; SQUAD, EXCHANGE, SHORT: a fund), and no short correction after the close. Collateral is recalculated. A correction that would leave a pending sell or cover larger than the position is refused (the team cancels or edits first), so a round can always clear.
48. **Flag decisions can be changed until AWARDS.** A team is disqualified while any flag naming it is DISQUALIFIED, so reversing a mis-click restores it. Decisions are serialised per event, and rankings are recomputed only when someone's eligibility changed.
49. **Audit log.** Organisers see the full audit log except flags, which only the fairness officer sees. Drafts and submissions are audited with a digest of the content (every submitted version is stored in full, once, in `submissions`).
50. **Late starts never reopen a window.** When a phase or round starts late, the rest of the schedule moves by the delay, except deadlines that have already passed while their window was open (teams could act until then): the plan and deal deadline stays at 03:00 even if round 12 opens late. A deadline whose window had not opened yet (the IPO bids before the IPO, call 2 before the plan scores) moves with its phase.
51. **No advance while paused.** The organiser resumes first, so a pause is never counted twice and a deadline pulled in by an early advance is not frozen.
52. **The flash bulletin is prepared in advance** (Content: a CSV with `title, body`), invisible to teams and the display, and published once by an organiser at 04:00 (two clicks, only during rounds 13–21). The general composer cannot publish a FLASH bulletin, so there is exactly one.
53. **Connected users come from heartbeats**, not Realtime presence: every open screen pings every 20 seconds with its realtime status, and "connected" means seen in the last 60 seconds. This is simpler to secure and test, and it also shows which screens have lost realtime.
54. **Content locks:** both decks can be replaced until the draw, and the flash bulletin until it is published. The crisis deck locks at the draw, not at the crisis: from the draw on, organisers know the seed, and with it which category each squad gets at 00:30, so a deck changed later could steer a chosen crisis to a chosen company and still verify. The event cannot leave Setup without the seed commitment and both decks.
55. **Each event's control panel lives under `/admin/<slug>`**; `/admin` lists the live event and any rehearsal.
56. **Realtime bulletin messages** carry `bulletin_kind` (the message's own `kind` is `bulletin`).
57. **The lottery record** (the JSON that `pnpm verify-lottery` checks) is built from the stored rows: team codes sorted per track, problem cards in number order, squads in number order with their cards in dealt order, and the crisis deck and crises once the crisis is applied. It contains the secret seed, so before the reveal only staff can download it (`/admin/<slug>/lottery/record`). The page re-runs the draw with the engine and shows "Draw verified" or every difference. The covered companies are compared as a set, since their order is not stored.
58. **The secret seed is typed into a password field** and shown on the control panel only once it is revealed, because staff screens can be visible in the hall.
59. **Content is uploaded as CSV** (up to 512 KB). It is parsed on the server with the engine's parsers, errors are named by row and column, and the database checks it again.
60. **"Close round N now" names the round.** The database refuses with ROUND_CHANGED when another round is open, so a stale page or a double click never closes the next round.
61. **Pages that change without a broadcast poll.** Orders and IPO bids send no realtime message, so the Rounds page re-fetches every 5 s while a round is open or during the IPO (only while the tab is visible). Health re-fetches every 10 s.
62. **Every team screen refreshes on each broadcast.** At a clearing, all 150 teams' screens re-fetch at once; Phase 7's load test measures it.
63. **A screen pings at once when its realtime channel connects or drops**, as well as every 20 s, so the health view is never 20 s behind.
64. **Two clicks for anything that changes the night for good, and the second click counts only for what the first one showed.** If a refresh changes the target between the clicks (another organiser advanced, the round cleared, Pause became Resume, the flash draft was replaced), the click asks again for the new target. A confirmation names what will be sent ("Click again to draw with dice 4", "Click again to disqualify XF01, XF02", "Click again to publish “Rates rise”"). The confirming button is disabled for half a second, so a double-click is one click. Resume and a typed extension also ask twice. Forms keep what was typed when the database refuses, and an action that never reaches the server (connection dropped) is shown as a refusal, not a crashed page.
65. **Consoles stay current.** Auto-advance, the seed commitment, deck uploads, the flash draft, a correction requested or rejected, and a flag decided send a message with no data on the event's staff channel (`staff:<id>`, which only organisers and the fairness officer can hear), so team screens neither learn of them nor re-fetch for them. An approved correction is published to everyone. Pages whose data changes without a message poll while it matters: Rounds every 5 s while a round is open or during the IPO, Judge every 3 s while runs are in flight and every 15 s until every score is released, Health every 10 s. Phase and Rounds also re-read when a planned end or a round's time passes.
66. **An account keeps its 10 most recent screen pings**, so made-up client ids cannot grow the heartbeat table.
67. **Judge page.** It follows every stored run, seals the 0 of companies with no on-time submission and releases scores. Phase 6 adds start/run controls, progress against ten minutes, backup-model switch, retries and technical appeals. It polls every 3 s while runs are in flight, then every 15 s until scores are released. The default tab follows the night (Pitch, then Plan, then Flash).
68. **Exports** are staff-only CSV files: the ledger, prices per round, scores and final results. Money is in integer cents, exactly as stored; times are IST; a text cell starting with = + - @, a tab or a carriage return gets a leading quote; tables are read 1,000 rows at a time. A signed-out download is sent to the login page and returns to the file afterwards.
69. **Ledger and corrections.** The ledger is newest first, 50 rows a page, filterable by team, kind and ticker. A books check confirms that every transaction balances and that each team's cash equals the sum of its rows. Dollars typed into a correction are converted to cents from the text (never through floating point; more than 2 decimals is refused). The requester sees why they cannot decide; a second organiser or the fairness officer approves or rejects, with two clicks.
70. **Fairness.** Flags, decisions, the decision log (from the audit log, so a changed decision keeps its history) and the team drill-down are for the fairness officer only; organisers see a notice. Decisions can be changed until AWARDS (decision 48).
71. **Turning auto-advance on after the phase's planned end needs an explicit confirmation from the database's point of view** (`set_auto_advance(…, p_advance_now)`), not only from the page: the next tick would advance the event at once.
72. **The flash bulletin is published by the draft the page showed** (`publish_flash_bulletin(event, draft id)`); a draft replaced since is refused (DRAFT_CHANGED).
73. **The Setup gate checks the problem deck's size** (squads + 2), the same rule as the upload and the draw, so a short deck from a seed file is caught before the event starts, not at 21:00.
74. **The organiser console's backup tick really runs** (every second, as key decision 7 in section 1 says): a supabase-js call is sent only once awaited, which the first version missed.
75. **Control panel pages** have their own titles ("Ledger · Control panel"), the event name as the page heading, tables that scroll sideways can be reached by keyboard, and organiser text (a link in a bulletin) wraps instead of widening the page.
76. **The team portal shows what is public to everyone, the same for every team.** The market (prices, the pitch book from Reading, the crisis cards from the crisis, the rescue plans from Plans published, the flash answers once their scores are released) never shows a squad's own unreleased plan or flash answer early, although RLS lets the squad read it in its workspace. Released verdicts show the score, the tier, the reasons (capped, late, missing, penalty) and the published judge run's points per rubric line and rationale. Nothing is ranked anywhere before AWARDS.
77. **Teams are named by role, never by code.** A team cannot read another team's row, so partners are "the Product team", "the fund (Finance)"; Q&A shows "A fund asked" and "<TICKER> answered"; the public ledger uses squad-and-role labels.
78. **Home says what to do now**, per track and phase, from the deadlines and the same windows the game functions use (pause-aware), with a countdown and a link straight to the form (the problem cards, the pitch card, the IPO bids…), then what is coming up, the team's cash and holdings, its squad and the latest bulletins.
79. **One click or two in the portal.** Two clicks: picking the problem card, submitting a pitch, plan or flash answer, confirming the fee and signing the deal (the confirmation names what is sent: "Click again to sign 8,571 shares at $7.00 ($59,997.00)"). One click: saving a draft, proposing a fee or deal terms, a call, a question or an answer, placing, editing or cancelling an order, an IPO bid: each can be changed until its deadline or the round's close, and a second click would slow the last minute of a round.
80. **Live validation agrees with the database.** The order ticket checks every order as it is typed with the engine's validateOrder and maxQuantity on the fund's own view (built as app.order_context builds it), shows the engine's refusal text and the reserve or collateral it locks, and a "Max" button. An order the screen cannot check is still sent: the database decides. Orders carry a client reference, so a double click or a retry after a lost answer places one order; if that order has since been cancelled or changed, the screen says so instead of "Already placed".
81. **The shared plan editor merges per section** (pitch and flash answer too). Every save names the version it started from. When the partner saved meanwhile, sections changed on one side only merge at once, with a notice naming them; only a section both teams changed differently asks which text to keep, showing both, and Save and Submit wait for that choice. Unsaved text is never lost: a section replaced by their text is set aside and can be put back, and the typed text and open choices are also kept per tab across a reload. A screen with nothing typed always takes the newer version, also when its submit is refused for it.
82. **Pages that change without a realtime message re-read while it matters:** squad editors every 10 s while their window is open, Rescue every 10 s during the fee and deal windows, Orders and IPO bids every 10 s while they accept input, Home every 15 s while a squad window is open; every page also re-reads when its next deadline passes. With 150 teams this is at most about 15 page reads a second, well inside what the server takes.
83. **A result is never lost.** When the control that ran an action disappears right after it (the round closed, the row moved, the item left a list), its result moves to a bar at the top of the page: an order refused at the close still says why. This applies to the control panel too.
84. **A pause freezes the order book.** Placing, editing and cancelling an order are all refused while the event is paused (migration 16 adds the pause check to cancel_order), so the book that resumes is the book that was frozen.
85. **The header says what a phase is waiting for** once its planned end has passed ("waiting for the pitch scores", "waiting for the fairness officer"), instead of "ends in now".

86. **The public lottery record** comes from `public.lottery_record_rows(slug)`, a database function anyone may call (signed in or not) that returns the stored draw only once `seed_revealed` is set (00:30), and null before. It reads the seed from `events.seed_revealed`, so the web server needs no service key and never reads `event_secrets`. Problem cards appear by number only. `GET /api/lottery-record?event=<slug>` builds the record with the control panel's `buildLotteryRecord` (404 before the reveal; cached for a minute after it, since the draw can no longer change).
87. **Team names at the awards come from `public.rankings(event)`.** A team may read only its own row of `teams`, so the rankings endpoint's embedded team names were empty for teams and the display. The function applies the endpoint's rule again (staff from SETTLEMENT; the event's teams and the display from AWARDS; otherwise null) and returns every team's code and name with the results and awards.
88. **Takeovers come from moments the database stores, not from messages.** The draw (`drawn_at`), the crisis (`crisis_applied_at`), each score release (the first `released_at` of that type, so a re-release after an appeal does not repeat it), the flash bulletin (`published_at`), the close (`market_closed_at`) and the awards (the AWARDS phase). The newest moment is shown while its time lasts: draw 3 min, crisis 2 min, verdicts 2 min, flash news 90 s, closing bell 90 s; a rehearsal divides these by its clock speed, but never below 30 s, so takeovers do not hide the board for most of its one-minute rounds. Once the newest has run out the board comes back (an older takeover with time left never returns); the awards stay up. A projector that reloads or reconnects mid-takeover shows the rest of it; a broadcast only makes the screen re-read itself.
89. **The draw takeover shows the seed check without the seed:** the commitment, the dice, the number of squads and "SHA-256 of the seed matches the commitment ✓" (`run_lottery` refuses a seed that does not match, so a stored draw is a verified one). The seed is shown at the crisis takeover, with the address of the public record (Q1).
90. **The display has no controls.** It picks its event (straight to it when there is only one), re-reads itself on every broadcast and every 10 s while realtime is down, and every projector shows the same board page (the page follows the server clock).
91. **A pause freezes every countdown.** While the event is paused, `event_status` keeps reporting the round that was open when the pause began (even after its planned close passes; migration 18), and every screen counts deadlines against the moment the pause began, as the database already does: each countdown stands still at the time that was left, and moves on after the resume, when the schedule has moved later by the pause. The big screen says "Round N is paused with 3:12" and shows the pause strip over a takeover too.
92. **Screens recover by themselves.** A failed read on the big screen shows "Reconnecting…" and tries again every 5 s (an error boundary, not a dead error page). Each time a realtime channel is joined (first, and again after a drop) the page re-reads itself once, because broadcasts sent before the join or while it was down are not replayed (team and admin screens too); the screen shows "Live" only once that read is done, so Live means joined and up to date.

93. **Queue claims use leases and lifetime tokens.** Service-role workers claim with `FOR UPDATE SKIP LOCKED`, a three-minute lease, retry `attempts` and a separately incrementing lifetime `claim_token`. Reports send `attempt: claim_token`; the token never resets when retry attempts reset. Reports for old tokens or no-longer-running rows are ignored, not allowed to overwrite scores. Retryable failures back off; five retry attempts fail a run.
94. **Sealing is automatic, release is deliberate.** Three runs seal if their spread is at most ten; otherwise runs four and five are queued and the five-run median seals. The plan cap and injection penalty apply through the shared scoring rule. No worker releases a score.
95. **Technical appeals use a new generation.** Before release a re-run returns the score to SCORING. After release, PLAN/FLASH appeals wait for the replacement score; an organiser applies or dismisses them. Applying corrects tiers, AI/closing prices, short covering, bonuses and settlement results without rewriting market history (decision 19). Open appeals block AWARDS.
96. **Calibration is a separate queue.** Batches contain the ten repository sample pitches, show expected bands, medians and verdicts, and retain previous batches. The same workers drain both queues; fairness can read only. A calibration retry-failed function remains an optional proposal, not an implemented feature.
97. **The console and CLI share work.** Each console claims for 50 seconds per turn with eight parallel calls by default; `pnpm judge-worker --event <slug>` drains the same queues. The selected model is checked before claiming (successful checks cached 60 s). Three consecutive 400s stop a worker. A run is bounded to 150 s, with a 60 s SDK timeout per attempt. Fake judging is refused for live events.
98. **Prompts are public and versioned by content.** `/team/judging` renders all three rubrics for every track and shows source SHA-256 hashes. Every stored run records its prompt hash and sanitised request. Name-part matching and its common-word stoplist are documented in `docs/JUDGE.md`.
99. **Speed evidence has a defined scope.** The measured SQL-queue test uses 50 submissions and two workers × eight concurrent one-second fake calls: 156 runs (including six extra runs) sealed all 50 companies in 10.3 s. A 429 storm affected 45 of 201 calls and still sealed all 50 in 11.4 s, respecting backoff. For 170 runs, projected expected/conservative times are 4.1/6.1 minutes at 20 s per call and 6.2/10.4 minutes at 30 s; 250 runs at 30 s project 8.8/14.5 minutes. These projections assume 100 ms per remote RPC and one-second console setup; they are not production measurements. Real-key calibration and Phase 7's 500+ connection, last-minute order and display-latency checks remain pending.
100. **Review hardening preserves the claim contract.** Migration 21 requires RUNNING status and a numeric claim token for both judge and calibration reports. Migration `20261017000022_judge_lifetime_claims.sql` separates lifetime `claim_token` from resettable retry `attempts`, backfilling existing tokens from attempts and comparing reports against the lifetime token. Queued, missing-token, malformed-token and superseded reports cannot finish work, including after organiser retry resets. Apply migration 22 before starting the new worker; workers refuse missing or unsafe tokens instead of using the retry count. The route creates its 280-second abort signal at POST entry, so authentication and model preflight consume the same deadline as worker execution.

101. **Bots play through the front door.** Each bot signs in with its card's password and calls the same public functions as a team, reading only what RLS shows it; a refusal is the game's answer and the bot tries later or moves on. The organiser autopilot uses the service role (organiser functions accept the system caller). Rehearsal events only.
102. **Load-test measurements.** The clearing's own time is from its transaction start (the broadcast's `at`) to the commit (the round seen CLEARED); a screen's update is the delivery after the commit plus a typical re-read of its page. The test refuses live events and writes a JSON report to `out/`.
103. **Local limits are not the app's limits.** Out of the box the local Realtime tenant allows 200 users and 100 events a second and Kong 512 connections; at those caps the load test fails for reasons the hosted plans decide. The hosted plan must cover about 800 connections and bursts of a few thousand messages a second (docs/DEPLOY.md).
104. **Page reads under the full load.** With 150 bots playing and 650 extra clients, plain page reads reached a p95 of about 5 s on the local stack (PostgREST's pool there is 10 connections), while orders stayed fast. On the hosted plan, size the compute and pool for the night and re-run the test.

## 7. Where the brief and the guide differ (the brief is followed)

| Topic | Guide | Brief (implemented) |
|---|---|---|
| Consultant call times | 23:15, 03:30, 04:20 | Due 23:15, 03:40, 04:30, judged as in the brief's table |
| Who may post Q&A questions | Investors or advisors | Only Finance has "question posting" |
| Ticker | "four-letter code, e.g. AquaSense (AQS)" | "unique 4-letter ticker", but acceptance test 7 uses AQS. See open question Q2. |
| Product starting cash | $50,000 | $0 before seed, then +$50,000 seed. Same result. |
| Ledger | "full ledger of every transaction is public" | No team sees another team's private data. See Q4. |
| Calls | Advisors "publish" calls | Visibility not specified. Kept private (Q5). |
| Judge sampling | Same settings for everyone | Temperature 0, but current Claude models reject temperature (Q3). |

## 8. Open questions (my default is in brackets)

- **Q1 — When to reveal the seed.** The same generator assigns crises at 00:30. If the seed is published at 21:00, anyone can compute every company's crisis category 3½ hours early. [Default: at 21:00 the display shows the dice, the commitment and "seed matches commitment ✓". The seed itself is revealed at 00:30, right after the crisis draw. Anyone can then verify all four draws.]
- **Q2 — Ticker length.** [Default: 3–4 uppercase letters, so AQS is valid.]
- **Q3 — Judge model and temperature.** Current models (`claude-opus-5-5`, `claude-sonnet-5-5`) return HTTP 400 when temperature is set. Options:
  - (a) Primary `claude-opus-5-5` and backup `claude-sonnet-5-5`, no temperature, low effort, with the 3/5-run median absorbing variance.
  - (b) An older model that still accepts `temperature: 0`, such as `claude-sonnet-4-6`.

  [Default: (a). Temperature is sent only when `JUDGE_TEMPERATURE` is set. The model names live in `JUDGE_MODEL` and `JUDGE_BACKUP_MODEL`. Automatic server-side refusal fallback stays off, because the guide promises the same model for every submission. Switching to the backup model is a deliberate organiser action and applies to everyone.]
- **Q4 — Public ledger contents.** [Default:
  - All transfers that are not trades, labelled by squad and role (for example "Squad 07 · Finance → AQS"): seed, IPO allocation totals, fees, deals, default fees, bonuses at settlement, and corrections.
  - Per-round, per-company totals for buys, sells, shorts and covers, plus the net and the price.
  - Trades by individual funds stay private.]
- **Q5 — Should consultant calls become public after each due time?** [Default: private.]
- **Q6 — Best rescue plan.** Is it decided by the final plan score (after the cap and penalty) or by the raw judge median? [Default: final score; ties go to the higher raw median, then the ticker.]

## 9. Later (ideas not in the brief, not being built)

- An admin button to reset one team's password and reprint its card
- A QR code on login cards
- Consultants posting Q&A questions
- Publishing consultant calls
- Squad chat
- Per-team notification sounds
- Downloadable portfolio history for teams after the event
