<!-- Deployment instructions for organisers; keep credentials and printed passwords outside version control. -->
# Deploy PRIMUS: step by step

This guide takes you from nothing to a live site for PRIMUS (Friday 20 November 2026, 20:00–06:00 IST, 150 teams,
about 600 participants). It is written for an organiser without a technical background: follow the steps in order,
and do not skip the checks. The night itself is in [RUNBOOK.md](../RUNBOOK.md); how the AI judge works is in
[JUDGE.md](JUDGE.md).

**Three rules that protect the event**

1. Never paste a key, a password or the `.env` file into a chat, an email or GitHub.
2. Never put `CARD_SECRET` on Vercel: it can recreate every team's password. It lives only on the organiser laptop.
3. The `out/` folder holds printed passwords and the lottery seed. It is never committed or uploaded.

## What you need (once, about two weeks before)

| Service | What for | Account |
|---|---|---|
| [GitHub](https://github.com) | The code | Access to `TushKum/shutUpV` |
| [Supabase](https://supabase.com) | The database, logins and live updates | An organisation account, Pro plan or above |
| [Vercel](https://vercel.com) | The website | Pro plan (the judge needs functions that run up to 5 minutes) |
| [Anthropic Console](https://console.anthropic.com) | The AI judge | Funded credits, enough rate limit (section 4) |

Turn on two-factor sign-in for every account and give a second organiser access to each, so one person's phone
dying does not lock you out.

**The organiser laptop.** One trusted laptop runs the setup commands. Install [Node.js 22](https://nodejs.org) and
then, in a terminal:

```bash
npm install -g pnpm@10.28.0
git clone https://github.com/TushKum/shutUpV.git
cd shutUpV
git switch claude/market-simulation-platform-9rk357
pnpm install --frozen-lockfile
cp .env.example .env
```

Open `.env` in a text editor; you fill it in as you go through the steps below.

## 1. The database (Supabase)

PRIMUS uses a fresh database design. **Create a new Supabase project** for it; do not reuse a project from an older
version of this platform.

1. In Supabase, click **New project**. Name it `primus-2026`, choose region **Mumbai (ap-south-1)**, set a strong
   database password and save it in your password manager.
2. **Database → Extensions:** search for `pg_cron` and switch it on. (The game clock runs on it: it locks the forms,
   reveals scores, opens and clears trading rounds.) Do this *before* step 3.
3. Apply the database migrations from the laptop. Install the
   [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), then:
   ```bash
   supabase login
   supabase link --project-ref <your project reference, from Project Settings → General>
   supabase db push
   ```
   It lists 14 migrations (`20261106000001` to `20261106000014`) and asks you to confirm. If anything fails, stop
   and ask for help; never mark a migration as applied by hand.
4. **Check the clock.** In **SQL Editor**, run:
   ```sql
   select jobname, schedule, active from cron.job where jobname = 'primus-tick';
   ```
   You should see one row: `primus-tick`, `2 seconds`, `true`.
5. **Authentication → Sign In / Providers → Email:** turn **off** "Allow new users to sign up". Every account is
   created by the seed command.
6. **Authentication → Rate Limits:** about 600 phones will sign in from a few shared venue IP addresses. Raise the
   sign-in limits well above the defaults ([current limits](https://supabase.com/docs/guides/auth/rate-limits)).
7. **Realtime → Settings:** turn **off** "Allow public access". Every screen uses private, signed-in channels.
8. **Project Settings → API:** copy the **Project URL**, the **anon public** key and the **service_role** key into
   `.env` (`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`).
9. **Capacity.** Plan for 1,000 live connections (phones, laptops, staff, projectors). Check the
   [Realtime quotas](https://supabase.com/docs/guides/realtime/quotas) of your plan and choose a compute size of
   Small or larger. Before the night, turn off the spend cap (Organisation → Billing) so a burst cannot cut the site
   off, and agree a budget.

## 2. The website (Vercel)

1. In Vercel, **Add New → Project**, import `TushKum/shutUpV`.
2. **Root Directory:** `apps/web`. Tick "Include files outside the root directory" (the site reads the game engine
   and the judge prompts from the repository root). Framework: Next.js. Node.js version: 22.
3. **Settings → Functions → Region:** **Mumbai (bom1)**, next to the database.
4. **Settings → Git → Production Branch:** `claude/market-simulation-platform-9rk357` (or `main` once merged).
5. **Settings → Environment Variables**, for Production:

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | The Supabase Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The anon public key |
   | `NEXT_PUBLIC_TEAM_EMAIL_DOMAIN` | A made-up domain, e.g. `teams.primus.example` (no mail is sent); must equal `TEAM_EMAIL_DOMAIN` in `.env` |
   | `SUPABASE_SERVICE_ROLE_KEY` | The service_role key (server only: the judge uses it) |
   | `ANTHROPIC_API_KEY` | From the Anthropic Console (section 4) |
   | `JUDGE_PRD_MODEL` / `JUDGE_PRD_BACKUP_MODEL` | `claude-opus-5-5` / `claude-sonnet-5-5` |
   | `JUDGE_SOLUTION_MODEL` / `JUDGE_SOLUTION_BACKUP_MODEL` | `claude-sonnet-5-5` / `claude-opus-5-5` |
   | `JUDGE_EFFORT` | `low` |
   | `JUDGE_CONCURRENCY` | `8` |

   Leave `JUDGE_TEMPERATURE`, `JUDGE_FAKE` and `JUDGE_PROMPTS_DIR` unset on the live site. **Never** add
   `CARD_SECRET` here.
6. Click **Deploy**. When it finishes, open the address Vercel gives you (for example `https://primus.vercel.app`)
   and check the sign-in page appears. Put that address in `.env` as `APP_URL`, and in Supabase under
   **Authentication → URL Configuration → Site URL**.
7. After changing any variable, redeploy (**Deployments → … → Redeploy**).

## 3. Teams, staff, decks and login cards

1. In `.env`, set `CARD_SECRET` to a long random secret (run `openssl rand -hex 32` and paste the result) and
   `TEAM_EMAIL_DOMAIN` to the same domain as on Vercel. **Back up `.env` securely**: the same `CARD_SECRET` is needed
   to reprint a lost card.
2. Copy `seed/teams.example.csv` to `seed/teams.csv` and fill in 150 teams: the team name and up to four members
   (name and roll number). Copy `seed/staff.example.csv` to `seed/staff.csv` with each staff member's email, role
   (`ORGANISER`, `FAIRNESS` for the faculty fairness officer, `DISPLAY` for each projector) and roll number. These
   files hold personal data: they stay on the laptop.
3. Check the content: `seed/problem-cards.csv` (at least 50 cards), `seed/crisis-cards.csv` (10 cards) and
   `seed/twist.csv` (the 22:15 twist). Edit them in a spreadsheet and save as CSV. The twist can still be edited on
   the control panel until it is published.
4. **The lottery seed (the day before).** Run `pnpm new-seed`. It prints a secret seed and its SHA-256
   "commitment". Give the seed to the event lead only (sealed envelope or password manager): it decides every draw.
   Publish the commitment (email it to all teams, put it on a notice board) *before* the event, so anyone can later
   check that the draws were not changed.
5. Try the seed without writing anything:
   ```bash
   pnpm seed --slug primus-2026 --date 2026-11-20 --teams seed/teams.csv --staff seed/staff.csv --commitment <the commitment> --dry-run
   ```
   Then run it again without `--dry-run`. It creates every login, the 150 teams and companies, the night's schedule
   (from 20:00 IST) and the decks, and writes:
   - `out/primus-2026-login-cards.pdf`: 150 team cards, eight per A4 page;
   - `out/primus-2026-staff-logins.txt`: the staff passwords.
6. Print the cards, cut them, and keep them locked away until check-in. To reprint some:
   `pnpm cards --slug primus-2026 --date 2026-11-20 --teams seed/teams.csv --only T007,T112`.

## 4. The AI judge (Anthropic)

1. In the Anthropic Console, add credits and set a billing alert. Create an API key and put it on Vercel (step 2.5).
2. **How much it will be asked:** 150 PRDs and 150 crisis solutions, each read 3 times: about 900 calls, plus
   calibration (24 calls a batch) and a few retries. With two consoles judging at 8 calls each, up to 16 calls run at
   once. Check your account's [rate limits](https://platform.claude.com/docs/en/api/rate-limits) for both models and
   ask Anthropic for a higher tier if needed, at least a week before.
3. **Cost** is usage-based: see [pricing](https://platform.claude.com/docs/en/about-claude/pricing). Measure it in
   the rehearsal (the worker reports tokens) and keep a generous reserve: a spending limit reached at 23:05 stops the
   judging.
4. **Calibration (required, at least three days before):** sign in to `/admin`, open your event's **Judge** page,
   click **Upload the samples** and then **Judge them**, and switch **Run the judge here** on. Eight sample
   submissions, weak to excellent, are scored by each round's model; the page shows whether each lands in its
   expected range. If several are out of range, tell the developer before the night. Never change the expected
   ranges to make it pass.

## 5. Rehearse (the week before)

Use a separate rehearsal: best a second Supabase project and a second Vercel deployment with `JUDGE_FAKE=1` (a
pretend judge, so no API costs). Then, from the laptop with that project's keys in `.env`:

```bash
# A rehearsal event: X-prefixed teams, a clock 10 times faster (the night lasts about an hour)
pnpm seed --slug rehearsal --rehearsal --starts-at 2026-11-17T18:00:00+05:30 --staff seed/staff.csv
# 150 bot teams play the night; --autopilot also does the organisers' part (lottery, judging, a rumour, flags)
JUDGE_FAKE=1 pnpm rehearse --slug rehearsal --autopilot
# In a second terminal, during trading: 1,000 live screens and every team trading in a round's last minute
pnpm load-test --slug rehearsal --connections 1000
```

The load test must report each clearing under 5 seconds and every screen updated within 2 seconds. Keep a few teams
for people (`--except X001,X002`) and play them on phones while the bots run, with the projector open. Practise
pausing, resuming, a re-run, the backup-model switch and the awards.

## 6. The venue

Ask the venue's network team to test about 600 phones at once, long-lived connections (websockets) to
`*.supabase.co`, and the captive portal (sign everyone in to Wi-Fi before check-in). Put the projector and the
organiser desk on wired network and backup power; keep a mobile hotspot ready and one spare signed-in projector
laptop.

## 7. The night and after

Follow [RUNBOOK.md](../RUNBOOK.md). After the awards:

1. Print the certificates: `pnpm certificates --event primus-2026` writes `out/primus-2026-certificates.pdf` (one
   page per participant).
2. Download everything from **Exports** on the control panel, and the public lottery record; store them encrypted.
3. Rotate the Anthropic key and the Supabase service_role key, and scale the Supabase plan back down.

## Preparation timeline

| When | What |
|---|---|
| By 8 Nov | Accounts, two-factor, a second organiser on each; ask Anthropic for rate limits |
| By 10 Nov | Supabase project, migrations, Vercel deployment; a test sign-in works |
| By 13 Nov | Rosters and staff list final; real-model calibration on the live deployment |
| By 17 Nov | Full rehearsal with bots, load test at 1,000 connections, staff practise the RUNBOOK |
| 19 Nov | `pnpm new-seed`; publish the commitment; seed the live event; print the cards |
| 20 Nov, 18:00 | RUNBOOK "Before 19:30" checklist |
| 21 Nov | Certificates, exports, key rotation |
