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

## 7a. Decisions made while building (Phase 2)

1. **Penalty:** an "attempt" is one line removed from a team's submission. The team's second removed line (PRD lines
   counted before the solution's) costs 10 points, once, from the round whose submission contains it.
2. **Lottery:** the seed and dice entered at 21:15 deal the problem cards; the same seed and dice give the crisis
   cards and the rescue circle at 23:45, when the seed is published. Until then it is kept staff-only.
3. **Locks are exclusive:** a save at exactly 23:00:00 (or 01:45:00) is refused. The tick locks at the deadline, and
   an early phase advance pulls the deadline in.
4. **Empty PRD = no PRD:** a draft with no words counts as missing (0 points, $5.00). A company with no ticker at the
   lock gets a default one (Q + three letters) and the name "Company T001".
5. **Writing windows:** PRD from the draw until 23:00 (BRIEFING or BUILD); crisis solution from the crisis (23:45)
   until 01:45, so the 30 minutes of Q&A can be used to start writing.
6. **Q&A:** questions close at 00:15; the founding team may still answer until 01:45.
7. **Rumours** can be published from Round 2 (RESCUE) onwards.
8. **Live leaderboard:** Round 3 points count from 02:15 (at current market prices); before that only R1 (from
   23:30). The rankings endpoint returns 403 to teams and the projector from the 03:30 freeze until AWARDS.
9. **Sealed scores are organisers-only:** the fairness officer sees a score (and its judge readings) from its reveal.
10. **Ties for awards:** exact ties share an award (two rows). Flag 3 counts a team when it goes from under 5,000 to
    exactly 5,000 shares in one round's clearing.

## 7b. Decisions made while building (Phase 3)

1. **Sections:** Phase · Lottery · Rounds · Judge · Bulletins · Content · Ledger · Results · Fairness · Exports · Health. The
   squad-chat viewer is gone (no squad chat in PRIMUS).
2. **Content:** the twist is written in a form (or uploaded as a one-row CSV) under Content; the event cannot leave Setup
   without the commitment, both decks (problem deck ≥ ⌈teams ÷ 3⌉ cards) and the twist. A crisis deck that is not 10
   cards shows a warning.
3. **Bulletins:** general notices, rumours (from Round 2) and fairness notices; the twist's own panel (published at
   22:15 by the clock, or by hand); the Q&A board with Hide/Show for moderation.
4. **Judge (Phase 3 version):** each round's progress, every company's three readings, median, penalty and final
   score, and the backup-model switch. Organisers only (scores are secret until their reveal). Re-runs, appeals,
   calibration and the in-console worker come back in Phase 6.
5. **Results:** the leaderboard as staff see it (live, and still visible to staff after the 03:30 freeze), then the
   settled results and the awards.
6. **Lottery record download** is offered from 23:45, when the record is complete (and public).

## 7c. Decisions made while building (Phase 4)

- **One portal for every team.** Tracks and squads are gone: every team has the same sections (Home, Round 1: PRD,
  Round 2: Rescue, Q&A, Market, Round 3: Trade, Ledger, Leaderboard, News, How judging works). A section that is not in
  use yet is greyed in the menu and says when it opens.
- **No submit button.** The PRD and crisis-solution editors save as you type (2.5 s after the last keystroke, on
  leaving a field, and at once in the last 15 s). The last version saved before the lock is judged. Two laptops of
  one team editing at once are merged part by part; a real clash keeps both texts on screen.
- **"Do this now" and alerts** come from one plan (lib/team/home.ts): write the PRD, ask the founders, answer
  questions about your company, write the crisis solution, trade in the open round. Alerts fire 5 and 1 minutes before
  each open deadline and on the night's big moments (cards dealt, twist, PRD scores, crisis, solutions published,
  crisis scores, rounds, rumours, freeze, closing bell, pause/resume, extra time).
- **Public ledger** shows every filled trade (team code, company, side, quantity, price, value) once its round
  clears, each round's totals and published corrections; filters: kind, company, team, side.
- **Leaderboard:** live until 03:30 with the team's own row highlighted and which parts count so far; from 03:30
  until AWARDS a "frozen" notice and nothing else (the database refuses too); at AWARDS the final results and awards.
  `/api/rankings` follows the same rule (acceptance test 13).
- **Portfolio** shows the Round 3 points the current value would give ("if the market closed now"), and the room
  left under the 5,000-share limit per company.
- **How judging works** shows both rubrics, the score-to-price table and the judge's prompts with their SHA-256.
  The prompt files (prompts/PRD.md, prompts/SOLUTION.md) are written in Phase 6; until then the page says they are
  published before the round starts, and the tests that read them wait for the files.
- **Fixed on the way:** the sign-in lookup still asked for the old `teams.track` column, which would have broken
  every sign-in; the admin results page now shares the awards wording with the team leaderboard (lib/awards.ts).
- **Not yet:** the browser (e2e) tests still describe the old game and cannot run here (the full local Supabase
  stack cannot be downloaded). They are rewritten with the rehearsal in Phase 7.

## 7d. Decisions made while building (Phase 5)

- **Takeovers, in night order:** the twist (22:15, 3 min), PRD scores and starting prices with the top 5 PRDs
  (23:30, 3 min), the crisis with the rescue circle and the seed check (23:45, 3 min), the crisis-solution scores
  with the biggest risers and fallers (02:45, 2½ min), the closing bell with the biggest gainers and losers from the
  starting price (04:30, 2 min), and the awards (05:15, stays up). Each is worked out from a time the database
  stores, so a projector that reloads mid-takeover shows the rest of it. A rehearsal's faster clock shortens them
  (never below 30 s).
- **The rescue circle** is shown by ticker only ("AAA → CCC" = the team that built AAA rescues CCC), 10 to a line,
  pages turning every 20 s. No team code appears before the awards.
- **Before 23:30** the main screen is a large countdown to the next moment (briefing, cards dealt, twist, PRD lock,
  reveal), the evening's schedule, and the twist once it is out. The trading badge appears only from 02:15.
- **From 23:30** the price board (change since the starting price; 25 tiles a page, every 20 s). Until the 03:30
  freeze the leaderboard (top 30 by team code, with each round's points) takes a turn after the last page of
  tiles; after the freeze it is not shown at all.
- **Rumours** show in the banner and the ticker, marked as unconfirmed and as never moving a price.
- **The awards are revealed one by one by the clock:** best PRD, best crisis solution, best investor, best company,
  third, runner-up, then the winner, 45 s apart (shorter in a rehearsal). The newest fills the screen; earlier ones
  stay listed. *If you would rather have the MC press "next" for each award, that needs a small control-panel button
  and one more column; say so and I will add it.*
- **Database (migration 13):** the projector account may now read the leaderboard (refused after the freeze, like
  teams) and the lottery record; the public download `/api/lottery-record?event=<slug>` works again (it called a
  function that no longer existed) and is checked in the database tests, signed out, before and after the crisis.

## 7e. Decisions made while building (Phase 6)

- **Models:** PRDs are judged by `claude-opus-5-5` (backup `claude-sonnet-5-5`), crisis solutions by
  `claude-sonnet-5-5` (backup `claude-opus-5-5`), each set in its own environment variable
  (`JUDGE_PRD_MODEL`, `JUDGE_PRD_BACKUP_MODEL`, `JUDGE_SOLUTION_MODEL`, `JUDGE_SOLUTION_BACKUP_MODEL`). An organiser
  switches one round to its backup on the Judge page; readings claimed from then on use it.
- **Exactly three readings, no extra ones:** the median of three counts, as the brief says (the old game's runs 4
  and 5 are gone).
- **Judging starts by itself at the lock:** the lock queues the readings; an organiser only needs a worker running
  ("Run the judge here" on the Judge page, or `pnpm judge-worker` on a laptop).
- **The prompts** (`prompts/PRD.md`, `prompts/SOLUTION.md`) give the rubric with anchors for each line, how to judge,
  and the exact answer format. They are what teams read on "How judging works".
- **Calibration:** 8 samples (4 PRDs, 4 crisis solutions, very weak to excellent, each with its context and the
  range it should score in) in `prompts/calibration/samples.json`; uploaded and judged from the Judge page.
- **Re-runs (technical errors only):** before a reveal, one organiser re-runs with a written reason and the new
  median replaces the score. After a reveal, the new score waits for a **second** organiser to approve or dismiss.
- **What an approved appeal does to prices** *(the brief does not say; please confirm)*: it re-applies the score's own
  price effect. For a PRD the market price moves by new starting price ÷ old starting price; for a crisis solution by
  new reveal factor ÷ old reveal factor. The score-based price is recomputed from the scores; after the close the
  closing price follows, and after settlement the results and awards are recomputed. Earlier price history is not
  rewritten (an APPEAL price row records the change); the opening "starting price" stays as it was shown at 23:30.
- **Human-panel fallback:** three judges per submission (CSV rows judge 1–3), fed through the same queue
  (`pnpm human-scores`).
- **Fixed on the way:** `pnpm verify-lottery` (the command the crisis screen gives the hall) still expected the old
  record and crashed on a bad file; it now checks the PRIMUS record and explains a malformed one.
- **Tests:** the database queue (claims, leases, stale reports, retries, sealing, re-runs, appeals, calibration) and
  the real worker loop judging whole rounds against the real database with the fake judge. The real model has not
  been called from here (no API key in this environment): run calibration on the deployed app before the night.

## 7f. Decisions made while building (Phase 7)

- **Bots** (`scripts/lib/bots.ts`) play every team: a first PRD and a revision, a question to the founders of the
  company they rescue, answers to the questions about their own company, a crisis solution, and 1–3 orders in every
  trading round (never the built or rescued company, within cash and the 5,000-share limit). The quality of what they
  write varies by team, so the judge gives a spread of scores.
- **Practice night, verified here:** 150 bot teams played a whole night against the real database (`supabase/tests/
  practice-night.test.ts`): 450 PRD saves, 150 questions and answers, 2,840 orders, every score sealed, the awards.
  Each of the nine rounds (250–360 orders) cleared in **68–93 ms** (target: under 5 s) and matched the engine exactly.
- **Rehearsal on the real site** (`pnpm rehearse --autopilot`): the autopilot sets the commitment, starts the night,
  turns auto-advance on, runs the lottery, judges (fake judge with `JUDGE_FAKE=1`), publishes a rumour and clears the
  flags; the database's clock does the rest. Not run here (no hosted Supabase); this is the organisers' rehearsal.
- **Load test** (`pnpm load-test`): 1,000 connections by default and every team trading in the last minute; it
  reports the clearing time and how fast every screen heard it, against 5 s and 2 s. It needs the hosted project.
- **Certificates** (`pnpm certificates`): one A4 landscape page per participant, with the team, its final rank and
  points by round, and any award ("Certificate of Achievement"); a disqualified team's members get participation
  certificates without results.
- **Documents:** README, `docs/DEPLOY.md` (step by step, for a non-technical organiser, with a **new** Supabase
  project for PRIMUS) and `RUNBOOK.md` rewritten for PRIMUS. The old game's participant handbook, track cards, case
  studies and staff scripts are moved to `docs/archive/event-market-sim/` (they describe another game). *A PRIMUS
  participant handbook is not in the brief; I can write one if you want it.*
- **Browser tests:** the old specs (another game) are removed; `e2e/smoke.spec.ts` and a new `e2e/primus-night.spec.ts`
  (the PRD editor saving by itself, the reveal, the projector) are written but **not run here**: the local Supabase
  stack's images cannot be downloaded in this environment (registry limits). The rehearsal on the real site is the
  browser check.
- **Production build** checked: it succeeds, and the judge prompts and calibration samples are packed into the
  functions that read them.

## 7g. Organiser-controlled timing (migration 15)

The fixed timetable is replaced by durations that organisers control. The planned 20:00–06:00 night stays as the
default durations (`buildSchedule`), not as clock times.

- **Start and end.** The night starts only when an organiser starts it (Setup is never ticked) and ends only when an
  organiser ends it, from the awards (`start_event`, `end_event`). After the end nothing changes.
- **Durations, then projection.** Each phase has a duration, or none: untimed phases stay open until an organiser
  ends them (the awards are untimed by default; Setup has none; a trading phase lasts as long as its rounds). Rounds
  have durations (15 min default) and run back to back. The twist and the leaderboard freeze are offsets from the
  start of Build and Market. `app.reproject` recomputes every time still ahead from when the current phase actually
  started, plus its pauses and extensions; deadlines follow (PRD lock = end of Build, Q&A close = end of the crisis
  Q&A, solution lock = end of Rescue, closing bell = end of Market). A time after an untimed phase is unknown (null)
  and screens say "until the organisers end it".
- **Pause and resume.** A pause freezes every countdown; resume adds exactly the paused seconds to the current phase
  and the open round, so the time left is preserved.
- **Modes.** "Advance when timer expires" or "Manual advance". In both, a timer that runs out still locks its form or
  closes its round; manual only waits before starting the next phase.
- **Safeguards.** Every change is organiser-only, versioned (`timing_version`: a stale console gets STALE), logged
  (`audit_log` "timing:*" with what moved) and broadcast. A change that brings any time earlier needs a second
  confirmation; previews are computed by applying the change and rolling it back (`preview_timing`,
  `preview_advance`), so they are exactly what applying would do. Phase gates are unchanged. A duration shorter than
  what has already run is refused (end the phase instead).
- **Closing a round early.** CLEAR fills pending orders at the clearing price; CANCEL cancels them and the round
  clears as if none were placed. The rounds after it start from the actual close. Ending a trading phase clears its
  open round (CLEAR) and records unchanged prices for rounds that never opened.
- **Teams and projector** see deadline changes as a toast (earlier ones loud), a banner for 20 minutes (10 on the
  projector), and every page reads the times from the server, so a refresh shows the current ones. Texts that quoted
  the planned clock ("at 23:45") now name the moment ("at the crisis").
- **Panel.** `/admin/<slug>/timing`, dark Matrix-inspired style scoped to the panel (`.mx-*` in `globals.css`); the
  rest of the control panel keeps its light style.

## 7h. Backup teams and organiser access (migration 16)

- **Backups.** The live seed prints 150 team cards and 10 backup cards (B001–B010; up to 20; rehearsal backups are
  Y001…). A team is ACTIVE, BACKUP or WITHDRAWN. Until the lottery draw an organiser activates backups (walk-ins,
  replacements) and withdraws no-shows (**Teams** tab, logged). At the draw the companies of non-active teams are
  removed, so they get no card, crisis, rescue, price, points or award; the draw, the crisis, the rescue circle, the
  lottery record, the leaderboard, the results and the deck check all count active teams only. Up to 160 can play.
  A non-active team's screen says it is not playing (before the draw: wait at the desk; after: thank you).
- **Access.** Any organiser can make another person an organiser (**Access** tab): the website's server creates the
  login with the service key and shows a one-time password; the database checks the caller is an organiser and logs
  the grant. The same page resets a password or removes access (never one's own; the last organiser stays). Fairness
  and projector logins still come from the seed's staff list.

## 7i. 50 teams (migration 17)

The live night is 50 teams (T001–T050) and 3 backups (B001–B003), about 200 participants, instead of the brief's 150
and 10. The seed command and the database's seeding check require exactly 50 for a live event; a rehearsal can still
have 3 to 150 teams (the load test and the bots' practice night use 150). Every other rule scales with the number of
playing teams: the problem deck needs one card per three teams, the 10 crisis types go to 5 companies each, and the
rescue circle covers whoever plays.

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
