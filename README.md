# Market Simulation Competition platform

Live trading simulation for a one-night college competition: 150 teams (50 Product, 50 Consulting, 50 Finance), an AI judge, a crisis, rescues, and a stock exchange that clears in rounds.

- **Stack:** Next.js (App Router, TypeScript, Tailwind) on Vercel, and Supabase (Postgres, Auth, Realtime, RLS).
- **Plan:** see [`PLAN.md`](PLAN.md) for the architecture, the schema, the phases, the assumptions and the open questions.

> Status: **Phases 1–6 built; Phase 7 built and locally verified.** Bot rehearsals, a 500-connection load test and the night's [RUNBOOK](RUNBOOK.md) are in place. Still to do: a real-model calibration and the same load test on the hosted plans. See [`docs/DEPLOY.md`](docs/DEPLOY.md) for deployment and event preparation.

## Repository

| Path | What |
|---|---|
| `packages/engine` | Pure TypeScript rules (the reference for the SQL): money, prices, orders and clearing, IPO, lottery, fees and deals, calls, the judge's helpers, scoring, awards, collusion flags, the schedule |
| `supabase/migrations` | Schema, Row Level Security, integrity triggers, `seed_event()`, and every game action as a database function (`20261008…`) |
| `supabase/tests` | Database tests on a throwaway Postgres with a Supabase stub: access, TS/SQL parity, the scripted night (every acceptance test), organiser controls, and a full 150-team night |
| `apps/web` | Next.js app: `/login`, `/team`, `/admin`, `/display` |
| `scripts` | `seed.ts` (accounts and the event), `login-cards.ts` (printable PDF), `verify-lottery.ts` (anyone can recheck the draw) |
| `seed` | Sample problem deck (60), crisis deck (10), and example team and staff CSVs |

## Develop and test

You need Node 22, pnpm 10 and Postgres 15+ binaries (`initdb`, `pg_ctl`) on the PATH, or a disposable database in `TEST_DATABASE_URL`.

```bash
pnpm install
pnpm test        # engine + web unit tests + database tests (starts a private Postgres)
pnpm test:db supabase/tests/full-night.test.ts   # just the 150-team night (~20 s), prints clearing times
pnpm typecheck
```

## Local Supabase and browser tests

With Docker running, `scripts/local-supabase.sh` starts a local Supabase (Postgres with pg_cron, Auth, PostgREST and Realtime, from Docker Hub images), applies every migration and writes `apps/web/.env.e2e`. Then:

```bash
cd apps/web
pnpm e2e                                   # Playwright, against the local stack (starts `next dev` on port 3100 if needed)
pnpm e2e e2e/admin-phase.spec.ts           # one spec
```

Each spec seeds its own small rehearsal event with real logins and drives the game through the real database functions. `scripts/local-supabase.sh reset` re-applies the migrations to an empty database; `scripts/local-supabase.sh stop` stops it.

## Set up Supabase

1. **Create a project.** Create a Supabase project in a region close to the venue (Mumbai for an Indian venue).
2. **Apply the migrations:**
   ```bash
   supabase link --project-ref <ref>
   supabase db push
   ```
3. **Turn off sign-ups.** In Auth → Providers → Email, turn off "Allow new users to sign up". Organisers create every account; there is no self sign-up. `supabase/config.toml` sets the same for local development.
4. **Raise the sign-in rate limit.** In Auth → Rate Limits, check the current sign-in limits and raise them for roughly 600 phones behind a few venue IP addresses; rehearse a simultaneous check-in. See [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits).
5. **Make Realtime private.** In Realtime → Settings, turn off "Allow public access". Event channels are private: a policy lets only the event's accounts (and staff and the display) receive, and nobody can send.
6. **Check the heartbeat.** Rounds close, clear and open on a `pg_cron` job that calls `tick()` every 2 seconds. Enable `pg_cron` in Database → Extensions *before* `supabase db push`, then check that `select jobname, schedule from cron.job;` lists `msim-tick`. If it is missing, enable the extension and run the last migration's `do $$ … $$` block again in the SQL editor. Failures of a tick are written to `error_log`.

## The control panel (/admin)

Each event has its own control panel at `/admin/<slug>`. Organisers act; the fairness officer reads everything and decides collusion flags. Anything that changes the night for good asks for a second click, and the second click only counts for what the first one showed.

| Section | What it does |
|---|---|
| Phase | Where the night is, what holds the next step, advance, pause and resume, extend, auto-advance, close the open round now, the schedule and the deadlines |
| Lottery | The seed commitment (Setup only), the 21:00 draw with the seed check, the squads, an independent re-run of the draw and the lottery record download |
| Rounds | The open round's pending orders, a preview of its clearing, the IPO book during the IPO, and every cleared round's prices |
| Judge | Start scoring, run the worker, progress, every stored run, backup model, retry, technical re-runs and appeals, seal missing and release |
| Bulletins | Compose and publish bulletins, and publish the prepared flash bulletin at 04:00 |
| Content | Upload the problem deck, the crisis deck and the flash bulletin as CSV; both decks lock at the draw |
| Ledger | The full ledger with filters, a books check, and corrections that need a second person to approve |
| Fairness | Collusion flags with their evidence, decisions, the decision log and a drill-down per team (fairness officer only) |
| Exports | CSV of the ledger, prices per round, scores and final results (integer cents) |
| Health | The `pg_cron` heartbeat, tick errors, connected screens and their realtime status |

Before the event leaves Setup it needs the seed commitment and both decks (the seed command loads `seed/problem-cards.csv` and `seed/crisis-cards.csv`, or upload them under Content).

## The big screen (/display)

Sign the projector in with the display account; it lands on `/display`, which goes straight to the event when there is only one (otherwise pick it). Use a browser in full-screen mode (F11): the screen is laid out at 1920×1080 and scales to any window, letterboxed on black. It has no controls and needs none during the night:

- **Header:** the phase, the open round with its countdown to the close (or when the next round opens), the OPEN / HALTED / PAUSED badge and the event clock. During a pause the countdowns stand still.
- **Bulletin banner:** the latest bulletin.
- **Ticker board:** every listed company with its price, change since the IPO price and an arrow for the last round's move, 25 at a time; the page turns every 20 seconds (every projector shows the same page). Companies appear from the Reading phase.
- **Takeovers:** the squad draw (with the seed check), the crisis (each company's card, the −15% and the revealed seed), each score release (top movers), the flash news, the closing bell and the awards. Each comes up by itself when the moment happens and gives way to the board after a few minutes; the awards stay up. Team names appear only in the awards.

Every change reaches the screen within about a second over the event's realtime channel. If the connection drops, the screen re-reads itself every 10 seconds and once more when it is back; if a read fails it shows "Reconnecting…" and tries again by itself. A projector that is reloaded shows exactly what it showed before, including the rest of a takeover.

## The lottery seed

The day before the event, run `pnpm new-seed`. Keep the seed secret, publish the commitment, and enter the commitment (with `pnpm seed --commitment …` or in /admin) while the event is still in SETUP: it is fixed once the event starts. At 21:00 an organiser enters the seed and the dice roll; the big screen shows the commitment, the dice and the seed check. The seed is revealed at the crisis (00:30) and shown on the big screen; anyone can then download the lottery record, without signing in, from `https://<app>/api/lottery-record?event=<slug>` (before the reveal it answers 404) and run:

```bash
pnpm verify-lottery --file lottery-record.json --commitment <the commitment published the day before>
```

It checks the seed against the commitment and recomputes every squad, problem card, coverage pair and crisis card.

## Seed an event and print login cards

Passwords are never stored in plain text. Each one is derived from `CARD_SECRET` (HMAC-SHA256), so you can reprint the cards at any time with the same command. Run these on an organiser's laptop, never on Vercel. Copy `.env.example` to `.env` and fill in `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CARD_SECRET`, `TEAM_EMAIL_DOMAIN` and `APP_URL`.

```bash
# Live event: 150 teams, starting 20:00 IST on the given date
pnpm seed --slug live-2026 --name "Market Simulation 2026" --date 2026-11-14 \
  --teams seed/teams.csv --staff seed/staff.csv

# Rehearsal: X-prefixed codes, 10x clock (the night lasts one hour)
pnpm seed --slug rehearsal --rehearsal --starts-at 2026-11-13T15:00:00+05:30 --staff seed/staff.csv --replace

# Reprint every card, or only some
pnpm cards --slug live-2026 --date 2026-11-14 --teams seed/teams.csv [--only P07,F12]
```

The seed writes these files to `out/` (gitignored):
- `<slug>-login-cards.pdf`: 8 cards per A4 page
- `<slug>-staff-logins.txt`

Add `--dry-run` to build the plan and the PDF without touching Supabase.

## Rehearse with bots and load-test

Both work on rehearsal events only, with the same `.env` as the seed plus `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

```bash
# A rehearsal event, then the bots play every team; --autopilot also plays the organisers
pnpm seed --slug rehearsal --rehearsal --starts-at <in two minutes> --speed 10 --replace
JUDGE_FAKE=1 pnpm rehearse --slug rehearsal --autopilot

# While it is in a trading phase: 500 live screens, every fund trading in the last minute of a round
pnpm load-test --slug rehearsal --connections 500 --orders-per-fund 6 --window 60
```

The load test prints and saves (`out/load-test-*.json`) the sign-in time, connections joined, order latency, the clearing time and how fast every screen heard it, and exits 1 when a target is missed (clearing under 5 s, screens updated within 2 s). On the local stack run `scripts/local-load-limits.sh` first: its default Realtime and gateway caps are far below a hosted plan's.

## Helpers for teams and the room

- Every team page has a sticky **"Do this now"** bar (the next task and its countdown) and **alerts** 5 and 1 minutes
  before each deadline and on big moments, with an optional beep and buzz (the header's sound switch).
- **Charts**: each company's price per round (with its AI price), trend lines on the market list, and a fund's own
  value per round on its positions page.
- A simpler **order ticket**: quick amounts, a colour per order type and a one-line summary.
- The projector shows a **news ticker** under the price board (movers by ticker, bulletins, deals signed, the next
  deadline; never team names or rankings).
- **Squad chat** (`/team/chat`, migration 23): a private live chat for each squad, readable by that squad and the
  staff only. A hosted project needs `supabase db push --linked` to get it.

## Event materials

[`docs/event/`](docs/event/README.md) holds everything for the people in the room: the participant handbook, one-page
cards per track, three worked case studies (AquaSense, CampusCart, SnapStudy, built on the acceptance numbers), strong
and weak sample submissions, the FAQ, and for staff the 20:30 briefing, the minute-by-minute announcements, the
registration desk and the preparation checklist. Six ready flash bulletins are in
[`seed/flash-bulletins/`](seed/flash-bulletins/README.md).

If both models fail on the night, a human panel scores on paper and the scores go through the same queue:

```
pnpm human-scores --event <slug> --type PITCH --file pitch.csv --check   # list missing rows
pnpm human-scores --event <slug> --type PITCH --file pitch.csv           # record them; then release as usual
```

See [`docs/event/staff/HUMAN-JUDGING.md`](docs/event/staff/HUMAN-JUDGING.md).

## Run the web app

```bash
cp .env.example apps/web/.env.local   # then fill in the NEXT_PUBLIC_* values
pnpm --filter @msim/web dev
```

Each team signs in with its team code (for example `P07`) and the password from its card. Staff sign in with their email. After sign-in each account goes to its own area:

| Account | Lands on |
|---|---|
| Team | `/team` |
| Organiser or fairness officer | `/admin` |
| Projector account | `/display` |

## Run the AI judge

Set the server-only judge variables from `.env.example` on Vercel (or `apps/web/.env.local` locally), including
`ANTHROPIC_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. Leave temperature empty for the default models and keep
effort `low`. Keep the service key out of browser code and `CARD_SECRET` off Vercel.

After a submission deadline, open `/admin/<slug>/judge`, choose the type, confirm Start judging, and turn on
**Run the judge here**. Two organiser consoles share the SQL queue with eight calls each by default. Keep them
awake and monitor progress against ten minutes. Review scores before releasing them; running a worker never
releases results. The model switch affects subsequently claimed runs, and failed runs have a separate retry control.

For a laptop worker, put `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` and applicable `JUDGE_*`
settings in the repository-root `.env`, then run:

```bash
pnpm judge-worker --event <slug>
pnpm judge-worker --event <slug> --once  # one bounded claiming turn
```

It drains both judging and calibration queues, waiting for leases/backoff as needed. Ctrl-C once stops claiming
and finishes in-flight work; twice aborts it. It does not start batches or release scores.

Before the night, open `/admin/<slug>/judge/calibration`, start a ten-sample batch, and run a worker. Check every
median against its expected band, inspect discrepancies and compare another batch. The fairness officer has
read-only access. `JUDGE_FAKE=1` is only for rehearsal events and cannot establish real-model calibration.
All tracks can read the rendered rubrics and source SHA-256 hashes at `/team/judging`.
See [`docs/JUDGE.md`](docs/JUDGE.md) for leases, retries, timeouts and security boundaries.
