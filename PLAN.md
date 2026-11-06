# PRIMUS platform: plan

> Built against [docs/BRIEF.md](docs/BRIEF.md). PRIMUS replaces the earlier Market Simulation game on this platform;
> that version is kept in git history (commit `d4d5a4d`) with its brief and plan in [docs/archive/](docs/archive/).
> Event: Friday 20 November 2026, 20:00–06:00 IST. Today: 6 November. **14 days.**

## 1. In plain words

PRIMUS keeps the platform's skeleton and replaces its game:

- **Kept as it is (already built and tested):** logins and printed cards, the server clock and phase machine with
  Pause / Resume / Extend, the verifiable lottery, the trading engine (orders, the 15-minute clearing, the 1%-per-1,000
  rule, the 10% cap), the AI judge pipeline (queue, three readings, median, anonymising, injection removal,
  calibration, appeals, the human-panel fallback), the audit log, rate limits, ledger corrections with two-person
  approval, the projector framework, the "Do this now" bar, alerts, charts, the news ticker, exports, health,
  rehearsal bots and the load test.
- **Replaced:** the game itself. No squads, tracks, IPO, fees, deals, consultant calls, flash news or shorting.
  Instead: every team builds one company (150 companies), rescues one other company in a lottery circle, and every
  team trades with $100,000.
- **Removed:** squad chat (not in the brief).

## 2. Architecture (unchanged)

```
Phones & laptops ──► Website (Next.js on Vercel) ──► Database (Supabase Postgres)
                                                       │  all rules, money, prices, deadlines
                                                       │  2-second clock (pg_cron) clears rounds, advances phases
                                                       ▼
                      Live updates (Supabase Realtime, private channels) ──► every screen refreshes
Judge workers (control panel or laptop) ──► Anthropic API (Opus 5.5: PRDs · Sonnet 5.5: crisis solutions)
```

- Every game action is one database function, run in one transaction, as the signed-in user. Row Level Security
  on every table. Money in integer cents, rounded half-up after each multiplication.
- The game engine is a pure TypeScript package (`packages/engine`) with unit tests; the database functions port the
  same rules, and shared test cases ("parity tests") prove they agree.

## 3. Database: a fresh migration set

The old migrations are built around squads, fees and deals. PRIMUS starts from a **fresh, squashed set of
migrations** that reuses the old SQL wherever the logic is the same (clock, lottery RNG, trading, judge queue, audit,
access helpers, control panel, display). Consequence: the hosted Supabase project must be **reset** (or a new
project created). It holds only practice data, so nothing is lost; the deploy guide will give the exact steps.

### Types
`account_role` (TEAM, ORGANISER, FAIRNESS, DISPLAY) · `phase_code` (SETUP, CHECKIN, BRIEFING, BUILD, JUDGING_1,
REVEAL_1, CRISIS_QA, RESCUE, JUDGING_2, MARKET_BLIND, MARKET, SETTLEMENT, AWARDS) · `submission_type` (PRD, SOLUTION)
· `order_type` (BUY, SELL) · `price_kind` (START, CRISIS, REVEAL, CLEARING, CLOSE) · `bulletin_kind` (GENERAL, TWIST,
CRISIS, RUMOUR, FAIRNESS, SYSTEM) · `ledger_kind` (START_CASH, TRADE_BUY, TRADE_SELL, CORRECTION) · `deadline_code`
(PROBLEM_DRAW, TWIST, PRD_LOCK, QA_CLOSE, SOLUTION_LOCK, LEADERBOARD_FREEZE, CLOSE) · plus the kept status enums
(round, order, judge run, score, flag, correction).

### Tables
| Area | Tables |
|---|---|
| Event and clock | `events` (adds `prd_model_slot`, `solution_model_slot`), `event_secrets`, `phases`, `deadlines`, `rounds` (1–9) |
| People | `teams` (code `T001`–`T150`; rehearsal `X001`…; cash, disqualified), `members`, `accounts` |
| Content | `problem_cards` (deck ≥ 50), `crisis_cards` (10 types), `bulletins` (the twist, rumours, general) |
| Companies | `companies`: one per team. `founder_team_id` (unique), `rescuer_team_id` (unique, from the circle), `problem_card_id`, `crisis_card_id`, `name`, `ticker` (exactly 4 letters, unique), `start_price`, `market_price`, `score_price`, `post_crisis_price`, `closing_market_price`, `closing_price` |
| Writing | `drafts` (one per team per type, autosaved, version-locked so teammates can type at once), `submissions` (the draft frozen at the lock), `injection_logs` |
| Judging | `judge_runs` (exactly 3 per submission per generation), `scores` (one per company per type: PRD scored for the founder, SOLUTION for the rescuer), `appeals`, `calibration_samples`, `calibration_runs`, `judge_injection_checks` |
| Q&A | `qa_questions` (rescuer → founder of the company it rescues), `qa_answers` — public |
| Market | `holdings` (one row per team per company), `orders`, `round_prices`, `ledger_entries`, `public_ledger` (every filled trade with team code), `corrections` |
| Results | `results` (per team: R1, R2, R3 points, return, penalty, total, rank), `leaderboard_frozen` (the 03:30 snapshot), `awards`, `flags` |
| Operations | `audit_log`, `rate_limits`, `error_log`, `client_pings` |

Removed: `squads`, `coverage`, `ipo_bids`, `fees`, `deals`, `calls`, `squad_messages`, `submission_drafts` (replaced
by `drafts`).

### Access (RLS)
- A team reads: its own team row, cash, holdings, orders, drafts; every company's public fields; its own PRD and
  solution scores once revealed; everyone's submissions once published (PRDs after 23:30, solutions after 02:15);
  public bulletins, Q&A, public ledger, rounds and prices; the leaderboard until 03:30.
- Round 2 scores: readable by staff only until the 02:45 reveal.
- Staff (organiser, fairness officer) read everything; the display account reads public data only.

## 4. Engine (`packages/engine`)

| Module | PRIMUS change |
|---|---|
| `money.ts` | Kept |
| `rules.ts` | Rewritten: $100,000 start cash; 5,000-share limit; reserve 110%; clearing 1% per 1,000, cap 10%; crisis 85%; start price $10 + $0.10 × (score − 50); reveal 0.5% per point; word limits 800 / 500; Round 3 points 50 + 2.5 × return |
| `schedule.ts` | Rewritten: the 13 phases, 9 rounds and the deadlines from the brief |
| `prices.ts` | `startPrice`, `crisisShock`, `revealFactor`, `clearingPrice` (kept), `closingPrice` (kept: ½ market + ½ score-based) |
| `trading.ts` | Simplified: BUY/SELL only; refuses own and rescued companies, selling more than owned, more than 5,000, cash short of qty × price × 1.10; `clearRound` kept |
| `lottery.ts` | `dealProblemCards` (≤ 3 teams per card), `assignCrises` (10 × 15), `rescueCircle` (no self, exactly one rescuer each); same seeded RNG and record |
| `judge.ts` | New rubrics (PRD, SOLUTION); exactly 3 readings, median; injection removal and anonymising kept |
| `submissions.ts` | Templates: PRD (9 parts, 800 words), SOLUTION (6 parts, 500 words); ticker exactly 4 letters |
| `scoring.ts` | Round 3 points, totals, ranking with tie-breaks (R2, then R1, then exact return), the live leaderboard |
| `awards.ts`, `flags.ts` | The six awards; the three collusion flags from the brief |
| Removed | `ipo.ts`, `rescue.ts` (fees and deals), `calls.ts` |

## 5. Screens

- **/team:** Home with the "Do this now" bar and alerts · Build (problem card, PRD editor, the twist, the score with
  its breakdown and reason) · Rescue (the crisis card, the company to rescue with its PRD, the Q&A board, the
  solution editor) · Market (all companies, published solutions, company page with chart, the order ticket, orders,
  portfolio and chart, public ledger) · News (twist, rumours, bulletins) · Leaderboard (until 03:30) · Results.
- **/admin:** Phase control · Content (problem cards, twist, crisis cards, rumours) · Lottery · Judging (per round,
  model switch, calibration, appeals) · Rounds · Ledger and corrections · Fairness (flags, decisions, a team's
  history) · Exports · Health.
- **/display:** countdowns · twist takeover · 23:30 start-price reveal + top 5 PRDs · 23:45 crisis takeover + rescue
  circle · rumours · price board with the news ticker · 02:45 score-reveal takeover · leaderboard until 03:30 ·
  closing bell · awards.

## 6. Tasks by phase (each phase ends with all tests, a summary, and your approval)

| Phase | Work | Target date |
|---|---|---|
| **1. Schema and access** | Fresh migrations (types, tables, RLS, audit, helpers); seed script for 150 teams and staff; login-card PDF; database tests for access | 8 Nov |
| **2. Game engine** | Engine rewrite with unit tests and all 14 acceptance tests; SQL game functions (phase machine, lottery, drafts and lock, crisis, reveal, trading, close, settlement, awards, flags); parity tests | 10 Nov |
| **3. Control panel** | Adapt every /admin page to PRIMUS | 12 Nov |
| **4. Team portal** | Rebuild /team for the three rounds | 13 Nov |
| **5. Projector** | Adapt /display: reveals, crisis, leaderboard, awards | 14 Nov |
| **6. AI judge** | Two models (one per round), PRD and solution prompts, context, 3 readings, calibration samples | 14 Nov |
| **7. Rehearsal and launch** | Bots for PRIMUS, 150-team practice night, load test at 1,000 connections, certificate PDF, RUNBOOK, README, deploy guide; you deploy and rehearse on the real site | 16–17 Nov |
| Buffer | Fixes from your rehearsal | 18–19 Nov |

## 7. Assumptions

1. The Market Simulation game is no longer needed: PRIMUS is the 20 November event.
2. The hosted Supabase project can be reset (it holds only practice data).
3. Teams of 3–4 share one login; all members can edit at once (the editor merges or asks when two people change the
   same part).
4. Problem-card and crisis-card decks are written by the organisers and uploaded under Content; I ship sample decks
   for rehearsals.
5. The twist is written by the organisers before the event and published at 22:15 by the phase machine (or by
   hand).
6. Starting prices can't go below $5.00 (score 0) or above $15.00 (score 100), so prices always stay positive.
7. Round 3 return uses closing prices for every share held; cash reserved for unfilled orders returns to cash at the
   close.
8. The leaderboard shows team codes and names (it is public until 03:30, per the guide).

## 8. Open questions

All 13 in the brief were answered "defaults are fine" on 6 November. None open.

## 9. Risks

- **Time.** 14 days is tight for a game this different. Mitigation: the plan reuses every tested building block, and
  each phase is small enough to check quickly. Fast approvals between phases matter.
- **Judging speed.** 450 readings per round in a 30-minute window. Mitigation: the existing parallel queue (two
  consoles × 8 calls) plus a laptop worker; measured in Phase 6 and the rehearsal.
- **Venue Wi-Fi for ~600 people.** Not software: the organisers arrange it with college IT (RUNBOOK).

## 10. Later (ideas not in the brief, not being built)

- Squad or team chat
- A printed rules sheet generated from the brief
- Downloadable portfolio history after the event
