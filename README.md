# Market Simulation Competition platform

Live trading simulation for a one-night college competition: 150 teams (50 Product, 50 Consulting, 50 Finance), an AI judge, a crisis, rescues, and a stock exchange that clears in rounds.

- **Stack:** Next.js (App Router, TypeScript, Tailwind) on Vercel, and Supabase (Postgres, Auth, Realtime, RLS).
- **Plan:** see [`PLAN.md`](PLAN.md) for the architecture, the schema, the phases, the assumptions and the open questions.

> Status: **Phase 3 (control panel)** done, waiting for approval. Every game rule runs in the database and organisers run the night from `/admin`; the team portal, the big screen and the judge come next.

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
4. **Raise the sign-in rate limit.** In Auth → Rate Limits, set "sign-ups and sign-ins" to at least 300 per 5 minutes. The default (30 per 5 minutes per IP) would block check-in, because all teams sign in through a few IP addresses.
5. **Make Realtime private.** In Realtime → Settings, turn off "Allow public access". Event channels are private: a policy lets only the event's accounts (and staff and the display) receive, and nobody can send.
6. **Check the heartbeat.** Rounds close, clear and open on a `pg_cron` job that calls `tick()` every 2 seconds. Enable `pg_cron` in Database → Extensions *before* `supabase db push`, then check that `select jobname, schedule from cron.job;` lists `msim-tick`. If it is missing, enable the extension and run the last migration's `do $$ … $$` block again in the SQL editor. Failures of a tick are written to `error_log`.

## The control panel (/admin)

Each event has its own control panel at `/admin/<slug>`. Organisers act; the fairness officer reads everything and decides collusion flags. Anything that changes the night for good asks for a second click, and the second click only counts for what the first one showed.

| Section | What it does |
|---|---|
| Phase | Where the night is, what holds the next step, advance, pause and resume, extend, auto-advance, close the open round now, the schedule and the deadlines |
| Lottery | The seed commitment (Setup only), the 21:00 draw with the seed check, the squads, an independent re-run of the draw and the lottery record download |
| Rounds | The open round's pending orders, a preview of its clearing, the IPO book during the IPO, and every cleared round's prices |
| Judge | Every stored judge run per company, the spread, median and final score, "Seal missing as 0" and the release of each score type |
| Bulletins | Compose and publish bulletins, and publish the prepared flash bulletin at 04:00 |
| Content | Upload the problem deck, the crisis deck and the flash bulletin as CSV; both decks lock at the draw |
| Ledger | The full ledger with filters, a books check, and corrections that need a second person to approve |
| Fairness | Collusion flags with their evidence, decisions, the decision log and a drill-down per team (fairness officer only) |
| Exports | CSV of the ledger, prices per round, scores and final results (integer cents) |
| Health | The `pg_cron` heartbeat, tick errors, connected screens and their realtime status |

Before the event leaves Setup it needs the seed commitment and both decks (the seed command loads `seed/problem-cards.csv` and `seed/crisis-cards.csv`, or upload them under Content).

## The lottery seed

The day before the event, run `pnpm new-seed`. Keep the seed secret, publish the commitment, and enter the commitment (with `pnpm seed --commitment …` or in /admin) while the event is still in SETUP: it is fixed once the event starts. At 21:00 an organiser enters the seed and the dice roll; the display shows the commitment and the dice. The seed is revealed at the crisis (00:30), and anyone can then download the lottery record and run:

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
