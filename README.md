# PRIMUS platform

The live web platform for PRIMUS, a one-night college business case competition (Friday 20 November 2026,
20:00–06:00 IST, 150 teams of 3–4). Every team plays three rounds:

1. **Build** (21:15–23:00): the lottery deals each team a problem card; it writes a PRD and names its company.
2. **Rescue** (23:45–01:45): a crisis hits every company; each team rescues another team's company and writes a crisis
   solution, after a public Q&A with its founders.
3. **Invest** (02:15–04:30): nine trading rounds with $100,000 each; prices move with demand and with the judges'
   scores.

AI judges score the written work (PRDs by Claude Opus 5.5, crisis solutions by Claude Sonnet 5.5), and the scores
move the share prices. The brief is [`docs/BRIEF.md`](docs/BRIEF.md); the plan and every decision made while
building are in [`PLAN.md`](PLAN.md).

| If you want to… | Read |
|---|---|
| Put the site online and prepare the event (no technical background needed) | [`docs/DEPLOY.md`](docs/DEPLOY.md) |
| Run the night, and what to do when something fails | [`RUNBOOK.md`](RUNBOOK.md) |
| Hand out the guides (illustrated PDFs) | [`docs/guides/PRIMUS-organiser-guide.pdf`](docs/guides/PRIMUS-organiser-guide.pdf), [`docs/guides/PRIMUS-team-guide.pdf`](docs/guides/PRIMUS-team-guide.pdf) |
| Understand the AI judge | [`docs/JUDGE.md`](docs/JUDGE.md) and the prompts in [`prompts/`](prompts/README.md) |

## The four areas of the site

| Who | Where | What |
|---|---|---|
| Teams (one login per team, from its printed card) | `/team` | "Do this now" bar and alerts; Round 1 (problem card, twist, PRD editor that saves by itself, score and reason); Round 2 (crisis card, Q&A, solution editor); the market and every published solution; orders, portfolio and history; the public ledger; the leaderboard until 03:30; news; how judging works |
| Organisers and the fairness officer | `/admin/<event>` | Phase control and **Event timing** (start and end the night, durations with a before/after preview, untimed phases, pause, resume, extend, manual or timed advance, early round close, timing log), lottery, rounds, judge (worker, backup model, re-runs, appeals, calibration), bulletins, content, ledger and corrections, results, fairness flags, exports, health |
| The projector (display account) | `/display/<event>` | Countdown, the twist, starting prices and top 5 PRDs, the crisis and rescue circle, rumours, the price board and leaderboard, the 02:45 reveal, the closing bell, the awards one by one |
| Anyone | `/api/lottery-record?event=<event>` | The public lottery record after 23:45, checked with `pnpm verify-lottery` |

## Commands (organiser laptop)

| Command | Does |
|---|---|
| `pnpm new-seed` | A secret lottery seed and the commitment to publish the day before |
| `pnpm seed --slug … --date … --teams … --staff … --commitment …` | Creates the event, every login, the decks and the twist; prints the login cards to `out/` |
| `pnpm cards … --only T007` | Reprints login cards |
| `pnpm staff-sheet --slug …` | The staff logins as a printable PDF (the seed also writes it) |
| `pnpm judge-worker --event <slug>` | Runs the AI judge from a laptop (the control panel can run it too) |
| `pnpm human-scores --event <slug> --type PRD --file prd.csv` | The AI-outage fallback: three human judges' marks through the same queue |
| `pnpm rehearse --slug rehearsal --autopilot` | 150 bot teams play a rehearsal night (with the organisers' part) |
| `pnpm load-test --slug rehearsal --connections 1000` | 1,000 live screens and a last-minute order burst, against the 5 s / 2 s targets |
| `pnpm certificates --event <slug>` | One certificate per participant after the awards |
| `pnpm verify-lottery --file record.json --commitment …` | Anyone can re-run the draw |

Commands read `.env` (copy `.env.example`). `out/` is never committed: it holds passwords and the seed.

## For developers

| Path | What |
|---|---|
| `packages/engine` | Pure TypeScript rules, the reference for the SQL: money in integer cents, prices, orders and clearing, the lottery, the judge's helpers, scoring, awards, collusion flags |
| `supabase/migrations` | 15 migrations: schema, Row Level Security, integrity triggers, seeding, every game action as a database function, the 2-second clock (`pg_cron`), the judge queue, organiser-controlled timing |
| `supabase/tests` | Database tests on a throwaway Postgres: access rules, engine/SQL parity, the scripted night with every acceptance test, organiser controls, the judge queue and worker, and a 150-team practice night played by the bots |
| `apps/web` | Next.js (App Router, TypeScript, Tailwind) |
| `scripts` | The commands above, with their tests in `scripts/test` |
| `prompts` | The judge's instructions and the calibration samples |
| `seed` | Problem deck, crisis deck, twist, and example team and staff CSVs |
| `docs/archive` | The brief, plan and event materials of the earlier market-simulation game this platform was adapted from |

You need Node 22, pnpm 10 and Postgres 15+ binaries (`initdb`, `pg_ctl`) on the PATH, or a disposable database in
`TEST_DATABASE_URL`.

```bash
pnpm install
pnpm test           # engine, web and script tests, then the database tests (starts a private Postgres)
pnpm typecheck
pnpm --filter @msim/web dev    # the site, with apps/web/.env.local (copy .env.example)
```

Browser tests (`apps/web/e2e`, Playwright) run against a local Supabase: with Docker, `scripts/local-supabase.sh`
starts it and writes `apps/web/.env.e2e`; then `cd apps/web && pnpm e2e`.
