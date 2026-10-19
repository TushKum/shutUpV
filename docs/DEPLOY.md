<!-- Deployment instructions for organisers; keep credentials and printed passwords outside version control. -->
# Deploy and operate the competition

This guide prepares 150 teams (50 per track), roughly 600 participants with four people sharing one login per team, for a
20:00–06:00 IST event. Read [the brief](BRIEF.md), [judge contract](JUDGE.md) and [README](../README.md).
Phases 1–6 are built; real-model calibration is pending. Phase 7 is built and verified on the local stack: bot
rehearsals (`pnpm rehearse`), the load test (`pnpm load-test`) and the night's [RUNBOOK](../RUNBOOK.md). Run the load
test again on the hosted staging project before the event: deployment alone does not establish readiness. The required load acceptance is 500+ Realtime connections, 150 teams placing
orders in a round's final minute, clearing under five seconds and display updates under two seconds.

## 1. Accounts and a trusted organiser laptop

Create or obtain access to GitHub, Supabase, Vercel and the [Anthropic Console](https://console.anthropic.com/).
Use organisation-owned accounts, enable multifactor authentication and name a second organiser who can access
billing and recover service access. Buy Anthropic credits and request sufficient rate limits before event week.

On a trusted laptop install Git, Node 22+, pnpm 10.28.0 and the
[Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started). Docker is needed for the
local Supabase/browser-test stack. Clone `TushKum/shutUpV` and select `claude/market-simulation-platform-9rk357`:

```bash
git clone https://github.com/TushKum/shutUpV.git
cd shutUpV
git switch claude/market-simulation-platform-9rk357
pnpm install --frozen-lockfile
cp .env.example .env
```

Fill `.env` locally in a text editor; never paste credentials into chat or commit it. The server service-role key
bypasses RLS, and `CARD_SECRET` can derive all team passwords. Restrict laptop access and keep an encrypted backup.

## 2. Supabase database, Auth and Realtime

1. Create a production Supabase project in **Mumbai**, selecting the available Mumbai region in the dashboard.
   Save the project URL, public anon/publishable key, service-role key and database password securely.
2. In Database → Extensions, enable **pg_cron before applying migrations**. Link the correct project, verify the
   project reference and apply the committed migrations; do not edit a deployed migration:
   ```bash
   supabase login
   supabase link --project-ref <production-project-reference>
   supabase db push
   ```
   Review the CLI's proposed migration list before accepting. If a migration fails, diagnose it rather than marking
   it applied manually. Never run a local reset command against production.
   **Judge upgrade order:** stop/drain existing judge consoles and CLI workers, apply migrations through
   `20261017000022_judge_lifetime_claims.sql`, then deploy/start the updated app and CLI. Migration 22 adds lifetime
   `claim_token` ownership independently of resettable retry `attempts`; the report field `attempt` now carries
   `claim_token`. Existing rows are backfilled from attempts, but new workers require the added field and refuse
   missing/unsafe tokens. Never start the new worker against an older schema or roll back to a worker that reports
   retry counts after tokens diverge. Inspect queue progress and ignored reports after resuming.
3. In the SQL editor run:
   ```sql
   select jobname, schedule, active from cron.job where jobname = 'msim-tick';
   ```
   Require an active `msim-tick` job with a two-second schedule. If absent, read the cron block in
   `20261008000014_access_and_cron.sql` and resolve extension/permission errors before continuing. The Health page
   must show a current heartbeat with no repeating tick errors. An open organiser console also provides a backup
   tick, but is not a substitute for a working scheduler.
4. Auth → Providers → Email: disable new-user sign-ups. Accounts are created by the seed command, not by attendees.
   Set the Auth Site URL to the production HTTPS app URL and restrict allowed redirects to intended app URLs.
5. Auth → Rate Limits: account for approximately 600 phones signing in behind a few shared venue IPs, reconnects
   and retries. Check the current value at [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits),
   raise the applicable sign-in/token limits, and test check-in from the actual venue network. Shared accounts do
   not reduce connection or login demand to 150 when all four members open a browser.
6. Realtime → Settings: disable **Allow public access**. The app uses authenticated private channels with receive
   policies, and clients cannot publish game changes. Confirm team, staff and projector logins connect successfully.
7. Budget for **600–1,000 simultaneous connections** including phones, extra tabs, organisers and displays.
   Estimate delivered messages, not just broadcasts: a broadcast to 800 subscribed screens means approximately
   800 deliveries; page re-fetches and heartbeat traffic add database/HTTP work. Measure message frequency in the
   rehearsal; multiply subscribers × broadcasts/second and include headroom for bursts.
8. Choose the plan and compute using current limits at [Realtime quotas](https://supabase.com/docs/guides/realtime/quotas),
   [Realtime pricing](https://supabase.com/docs/guides/realtime/pricing),
   [compute sizes](https://supabase.com/docs/guides/platform/compute-and-disk) and
   [pricing](https://supabase.com/pricing). Connection capacity alone does not prove database capacity. Before the
   night, disable the [spend cap](https://supabase.com/docs/guides/platform/spend-cap) where applicable or contact
   support about required capacity. Agree a budget and monitor usage; disabling a cap permits overage charges.

## 3. Vercel app

Import the GitHub repository into Vercel, choose the requested branch, set Root Directory to `apps/web`, framework
Next.js, package manager pnpm, and enable access to workspace files outside that directory for `@msim/engine`
and `prompts/`. Use Node 22 and the repository lockfile. Set the function region to **`bom1` (Mumbai)** in the
project's function settings, and verify it on the deployed function. See
[Vercel regions](https://vercel.com/docs/functions/configuring-functions/region) for current controls and plan support.

Add environment variables using Vercel's encrypted settings. Apply production values to Production; keep Preview
isolated from the live database or restrict preview access. Redeploy after changing environment variables.
Every variable in `.env.example` is covered here:

| Variable | Location and value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel and local web; production project URL; public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel and local web; public anon key; RLS remains mandatory |
| `NEXT_PUBLIC_TEAM_EMAIL_DOMAIN` | Vercel and local web; same synthetic domain as `TEAM_EMAIL_DOMAIN`; public |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only**, Vercel and trusted operator laptop; never client code |
| `ANTHROPIC_API_KEY` | **Server only**, Vercel and laptop judge worker; funded Anthropic account |
| `JUDGE_MODEL` | **Server only**, `claude-opus-5-5`; verify actual model access |
| `JUDGE_BACKUP_MODEL` | **Server only**, `claude-sonnet-5-5`; verify access before the night |
| `JUDGE_TEMPERATURE` | **Server only**, leave empty/unset; defaults reject it |
| `JUDGE_EFFORT` | **Server only**, `low`; only low/medium/high accepted |
| `JUDGE_CONCURRENCY` | **Server only**, `8` per worker |
| `JUDGE_WORK_BUDGET_MS` | **Server only**, `50000`; claiming budget, not total request duration |
| `JUDGE_FAKE` | **Server only**, unset for production; `1` only on a separate rehearsal deployment |
| `JUDGE_FAKE_LATENCY_MS` | **Server only**, `300`; relevant only for fake judging |
| `JUDGE_PROMPTS_DIR` | **Server only**, normally unset; optional existing prompt-directory override |
| `SUPABASE_URL` | Laptop scripts only; same project as web |
| `CARD_SECRET` | **Laptop only. Never put on Vercel**; strong secret, keep for reprints |
| `TEAM_EMAIL_DOMAIN` | Laptop scripts only; exactly matches public team-email domain |
| `APP_URL` | Laptop scripts only; production HTTPS app URL printed on cards |

The judge route declares `maxDuration = 300` seconds and starts its 280-second abort deadline at POST entry, including authentication and model preflight. Check the current value at
[Vercel function duration](https://vercel.com/docs/functions/configuring-functions/duration): select a plan and
compute configuration permitting that duration. A 50-second claiming budget can still leave a 150-second run
in flight. If the selected plan cannot allow 300 seconds, a developer must lower `maxDuration`, the route's
abort deadline **and** `JUDGE_WORK_BUDGET_MS` consistently and verify lease recovery; lowering only the budget
is insufficient. The laptop worker is an existing alternative for processing the queue outside Vercel.

`apps/web/next.config.ts` uses `outputFileTracingRoot` and `outputFileTracingIncludes` to include root-level
`prompts/PITCH.md`, `PLAN.md`, `FLASH.md` and calibration samples. Inspect the build/deployment trace and open
`/team/judging` and `/admin/<slug>/judge/calibration` on the deployed app. Verify hashes against source and run
calibration there; a local build alone does not prove the deployed functions contain prompt files.

## 4. Anthropic capacity and cost

Verify both configured model IDs are available to your account; do not assume a model name in an example grants
access. Check current model IDs at [models overview](https://platform.claude.com/docs/en/about-claude/models/overview),
limits at [rate limits](https://platform.claude.com/docs/en/api/rate-limits) and prices at
[pricing](https://platform.claude.com/docs/en/about-claude/pricing). Set a funded credit balance, billing alerts
and a spend limit with room for calibration and retries. A spend limit reached mid-event stops scoring.

Two consoles × eight calls means up to **16 concurrent calls**, not 16 requests per minute. At an assumed
20 seconds per call this is about 48 requests/minute; at ten seconds it is about 96. Multiply measured input/output
tokens per call by that rate to size token limits as well. These are planning arithmetic, not vendor allowances.
Ask Anthropic for the tier needed for measured peak requests and tokens before the event.

There are 50 companies × three types × three initial runs = 450 base calls; spread-triggered runs can raise that
to 750 before retries. Budget **about 600 calls** initially, then revise from real calibration. An illustrative
assumption of 3,000 input and 1,000 output tokens/call gives 1.8 million input and 0.6 million output tokens for
600 calls. At current prices of `I` dollars/million input tokens and `O` dollars/million output tokens, the estimate
is `1.8 × I + 0.6 × O` dollars before caching, thinking/output variation and retries. These token assumptions are
not measurements. The configured maximum is 8,000 output tokens per call: a simple 600-call ceiling at that
maximum is 4.8 million output tokens, excluding additional retries. Record actual token usage in worker summaries,
include cache-read/cache-write pricing, budget calibration batches separately (30–50 calls each), and keep reserve.

## 5. Team accounts, login cards and lottery commitment

Copy `seed/teams.example.csv` to `seed/teams.csv` and `seed/staff.example.csv` to `seed/staff.csv`. Keep column
headers unchanged. Teams use `track,team_name` and four `memberN_name,memberN_roll` pairs; tracks are `product`,
`consulting`, `finance`. Supply 50 rows per track. Staff use `email,role,name,roll_number`; roles are `ORGANISER`,
`FAIRNESS`, `DISPLAY`. Check names, unique roll numbers and staff addresses before seeding. Protect these CSVs
as personal data; inspect Git status and never commit real rosters accidentally.

The day before, run `pnpm new-seed`. Store the secret seed privately with authorised staff and publish only its
SHA-256 commitment. The seed must stay hidden from participants until the crisis, since it predicts crisis cards.
Enter the commitment while the event is in SETUP; it locks when the event starts.

```bash
pnpm seed --slug live-2026 --name "Market Simulation 2026" --date 2026-11-14 \
  --teams seed/teams.csv --staff seed/staff.csv --commitment <published-sha256>
```

Replace the example date/slug with the real event. `--date` schedules 20:00 IST. Use `--dry-run` first to inspect
input and generated cards without modifying Supabase. Confirm 150 team cards in `out/<slug>-login-cards.pdf`
(eight per A4 page) and staff credentials in `out/<slug>-staff-logins.txt`. Print and count them, distribute one
card per team securely, and lock away spares. `out/` is gitignored and contains passwords: never publish or upload
it to the web app. Keep the same `CARD_SECRET` to reprint with `pnpm cards`; rotating it changes derived passwords
and must not be done casually during the event.

## 6. Rehearsal and calibration

Use a separate rehearsal event, preferably a separate Supabase project/deployment so practice cannot disturb the
live event. The existing seed supports fake X-prefixed teams and a 10× clock:

```bash
pnpm seed --slug rehearsal --rehearsal --starts-at 2026-11-13T15:00:00+05:30 --staff seed/staff.csv
```

Use a future rehearsal start time. `--replace` is destructive and only for an intentionally discarded rehearsal
or SETUP event. On the rehearsal deployment set `JUDGE_FAKE=1`, redeploy and confirm the FAKE JUDGE badge. Run
through login, lottery, submissions, order entry, score release, pause/resume and exports. Then let the bots play the night:
`JUDGE_FAKE=1 pnpm rehearse --slug rehearsal --autopilot`, and during a trading phase run
`pnpm load-test --slug rehearsal --connections 500` against the hosted staging project (README, "Rehearse with
bots and load-test"). A few manual browsers do not validate 600-phone capacity; the load test does.

Then unset `JUDGE_FAKE`, redeploy and run a real calibration batch under `/admin/<slug>/judge/calibration`.
Use two organiser consoles and check every median against the expected band; record model, prompt hashes, timing,
tokens, outliers and any 429/529 failures. Repeat if needed and investigate unexpected results before scoring
live submissions. Real calibration requires a working funded API key. Fake medians are not evidence of rubric
quality. Do not rewrite expected bands merely to make the batch pass.

## 7. Venue network

Ask the venue network team to test about 600 simultaneous phones, websocket connections to Supabase, HTTPS to
the app, shared-IP Auth throttling, DNS and captive-portal session expiry. Check AP capacity and congestion in the
actual hall. Measure bandwidth during broadcasts and page refresh bursts, not just an idle speed test. Complete
captive-portal login before check-in and ensure long-lived websocket connections are permitted.

Have mobile data/hotspots available as a tested fallback; they do not fix a cloud outage. Keep organiser judge
laptops powered and awake. Put projectors and organiser desks on wired Ethernet where possible, with backup power
and a spare signed-in display laptop. Test reconnecting a phone and projector without duplicate actions.

## 8. The night

This is an operational checklist; the night minute by minute is in [RUNBOOK.md](../RUNBOOK.md). Assign an event lead,
exchange operator, AI operator, fairness officer and network contact. Staff never share service keys with teams.

- **Before check-in:** verify production URL, current deployment, unset fake mode, Mumbai regions, billing headroom,
  cron heartbeat, backups, staff access, printed cards, decks, flash draft and published seed commitment.
- **Check-in (20:00 IST):** issue one team card per team, confirm the right track and connectivity. Monitor Auth
  errors and Health as phones join. All four members may share the login; private team data remains within that team.
- **Health:** watch heartbeat, tick errors, connected screens and Realtime status throughout the night. Keep at least
  one organiser console open for backup ticking, without treating this as a repair for broken cron.
- **Judge:** prepare two organiser laptops with `/admin/<slug>/judge`; after each type closes, start judging and turn
  on Run the judge here on both. Keep reserve laptop/CLI access ready. A third console or an additional
  `pnpm judge-worker --event <slug>` adds another worker and API demand: the choice to increase beyond two consoles
  needs the owner's approval and rate-limit headroom. At 30-second calls, two consoles' ten-minute target is at risk.
- **Failures:** inspect the error before retrying. Missing credentials or a failed model check claims no runs; correct
  server settings and redeploy. For 429/529/network failures, watch backoff and throughput instead of repeatedly
  clicking Start. If primary access is unusable, deliberately switch the event to BACKUP, record the reason, retry
  failed runs and resume workers; already-claimed runs retain their assigned model. Review all sealed results before
  Release. Handle technical re-runs/appeals with reasons, apply or dismiss them, and clear open appeals before AWARDS.
- **Pause/resume:** the lead pauses from Phase control with two clicks when fair participation is interrupted.
  Confirm PAUSED across screens; deadlines freeze and trading changes are refused. After recovery, Resume needs
  two clicks and shifts the schedule. Tell attendees the revised times. Do not edit prices or database deadlines.

| Failure | Immediate action and recovery |
|---|---|
| Realtime drops | Check Health and Supabase status. Screens re-read on reconnect; the display polls while disconnected. Check actual data freshness, pause if fair play is affected, and verify live updates before resuming. Polling is not a proven full-capacity substitute. |
| Vercel unavailable | Check [Vercel status](https://www.vercel-status.com/), deployment logs and rollback to a known compatible deployment if appropriate. If the UI is unavailable, staff need a previously tested secure database pause procedure; this guide does not invent an emergency SQL script. Keep attendees informed, restore the portal and inspect state before resuming. The trusted CLI judge can continue if Supabase/Anthropic remain healthy. |
| Supabase unavailable | Check [Supabase status](https://status.supabase.com/) and project health. Stop actions and communicate a halt; a pause cannot commit while the database is down. On recovery inspect tick errors, phase, rounds and elapsed deadlines before authorising play. Never promise automatic deadline freezing during an outage. |
| Anthropic unavailable | Stop/review failed workers, inspect [Anthropic status](https://status.claude.com/), rate/billing limits and backup access. Switch deliberately if usable, or pause/extend through supported controls while awaiting recovery. Do not fabricate scores or release incomplete scores. The planned human-score fallback tooling belongs to the pending RUNBOOK; do not assume it exists. |
| Venue Wi-Fi/power | Pause if possible, move staff/projectors to wired or backup power, test mobile fallback, and verify affected teams can rejoin before resuming. |

## 9. After the event

Download staff-only ledger, per-round prices, scores and final-results CSVs from Exports, plus the revealed lottery
record. Verify counts and keep an encrypted archive with restricted access and a retention policy for roster data.
Keep audit records and prompt hashes for technical questions. Do not publish private team balances or credentials.

Purge only discarded rehearsal events after exports and explicit verification of their slug: the existing
`public.purge_event(text)` is service-role-only and refuses a started live event. It is not a general live-event
reset tool. Review linked Auth accounts separately rather than blindly deleting users still needed by an event.
Rotate Anthropic and Supabase service credentials after operations finish, update authorised deployments/scripts,
and revoke old access. Retain `CARD_SECRET` securely only as long as reprints are needed. Scale compute/plans down
only after exports, appeals and retention needs are settled; check backup/restore implications first.

## 10. Preparation timeline (IST)

| When | Required preparation |
|---|---|
| T−14 days | Create accounts/projects, assign operators, request API tier, review budget and venue Wi-Fi capacity. |
| T−10 days | Deploy staging, apply migrations with cron enabled, verify private Realtime/Auth, seed practice accounts. |
| T−7 days | Run `pnpm rehearse --autopilot` and `pnpm load-test --connections 500` on the hosted staging project with the event's plans; resolve capacity failures; test venue reconnects. |
| T−3 days | Run full rehearsal with staff, real-model calibration and measured token/cost/latency checks; confirm plan headroom. |
| T−1 day | Publish seed commitment, protect seed, validate roster, seed live event, print 150 cards and verify decks/draft. |
| Event day, before 20:00 | Check Health, cron, deployments, billing, backup model, network, powered judge laptops and cards. |
| 20:00–06:00 | Follow brief schedule and operator controls; monitor health and judging; handle technical appeals before awards. |
| Day after | Export/archive, review incidents, purge confirmed rehearsals, rotate keys and scale down safely. |

Do not represent the event as load-ready until the load test passes on the hosted plans and the owner approves launch.
