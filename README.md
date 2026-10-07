# Market Simulation Competition platform

Live trading simulation for a one-night college competition: 150 teams (50 Product, 50 Consulting, 50 Finance), an AI judge, a crisis, rescues, and a stock exchange that clears in rounds.

- **Stack:** Next.js (App Router, TypeScript, Tailwind) on Vercel, and Supabase (Postgres, Auth, Realtime, RLS).
- **Plan:** see [`PLAN.md`](PLAN.md) for the architecture, the schema, the phases, the assumptions and the open questions.

> Status: **Phase 2 (game engine)**. Every game rule runs in the database; the screens and the judge come in later phases.

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

## Set up Supabase

1. **Create a project.** Create a Supabase project in a region close to the venue (Mumbai for an Indian venue).
2. **Apply the migrations:**
   ```bash
   supabase link --project-ref <ref>
   supabase db push
   ```
3. **Turn off sign-ups.** In Auth → Providers → Email, turn off "Allow new users to sign up". Organisers create every account; there is no self sign-up. `supabase/config.toml` sets the same for local development.
4. **Raise the sign-in rate limit.** In Auth → Rate Limits, set "sign-ups and sign-ins" to at least 300 per 5 minutes. The default (30 per 5 minutes per IP) would block check-in, because all teams sign in through a few IP addresses.
5. **Check the heartbeat.** Rounds close, clear and open on a `pg_cron` job that calls `tick()` every 2 seconds. Enable `pg_cron` in Database → Extensions *before* `supabase db push`, then check that `select jobname, schedule from cron.job;` lists `msim-tick`. If it is missing, enable the extension and run the last migration's `do $$ … $$` block again in the SQL editor.

## Verify the lottery

At 21:00 the display shows the seed commitment and the dice; the seed itself is revealed at the crisis (00:30). Anyone can then download the lottery record and run:

```bash
pnpm verify-lottery --file lottery-record.json
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
