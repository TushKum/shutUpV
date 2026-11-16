# PRIMUS deployment guide (step by step)

From nothing to a live site on your own domain that 600 people can use, with a check after every step. Written for
the organiser laptop (a Mac; Windows/Linux commands are the same apart from installing tools). Follow the parts in
order: each one needs the previous. Time needed: about 2 hours, plus waiting for DNS.

Related: [FINAL-DAY.md](FINAL-DAY.md) (the week and the night), [DEPLOY.md](DEPLOY.md) (background and failure
handling), [GO-LIVE.md](GO-LIVE.md) (what was tested).

---

## Part 0 · What you are deploying

```
 600 phones ──https──▶  Vercel (Next.js app, apps/web)  ──▶  Supabase (Postgres, Auth, Realtime, pg_cron)
 projector  ──https──▶        │  judge route /api/judge/work ──▶ Anthropic API (Claude)
                              │
 organiser laptop ── pnpm seed / cards / preflight ──▶ Supabase (service key)
```

- **Supabase** holds everything: the game, the accounts, live updates (Realtime) and the 2-second heartbeat that opens
  and clears rounds (a pg_cron job created by the migrations).
- **Vercel** serves the website and runs the AI judge when an organiser presses "Run the judge here".
- **The organiser laptop** creates the event and its logins, prints the cards, and checks the deployment. It is the
  only place that holds `CARD_SECRET` (from which every team password is derived).

---

## Part 1 · Accounts and tools

### 1.1 Accounts
| Service | Plan for the night | Why |
| --- | --- | --- |
| GitHub | any | the code (`TushKum/shutUpV`) |
| Supabase | **Pro with the spend cap off, or Team** | 600 phones × 3 live channels; free and capped plans refuse connections above their limit |
| Vercel | **Pro** | commercial use, Mumbai region, the judge's 300-second function |
| Anthropic Console | funded, **$10–20** credit | the AI judge on Claude Haiku 5.5 (about $5 for the night) |
| Domain registrar | your domain | the address on the cards |

### 1.2 Tools on the laptop
```bash
# Node 22 or newer, and pnpm (the repo pins pnpm 10.28)
node -v                      # must print v22.x or later
corepack enable              # gives you pnpm at the pinned version
pnpm -v

# Supabase CLI (macOS)
brew install supabase/tap/supabase
supabase --version

# The code
git clone https://github.com/TushKum/shutUpV.git primus   # or: cd primus && git pull
cd primus
git checkout claude/market-simulation-platform-9rk357
pnpm install
```
**Check:** `pnpm install` ends without errors; `pnpm -s typecheck` prints nothing.

---

## Part 2 · Decide your values (write them down once)

| Value | Example | Rules |
| --- | --- | --- |
| Site address | `play.example.com` | Its **first part must not contain** `product`, `consulting` or `finance` (those make a one-track portal). |
| `CARD_SECRET` | output of `openssl rand -hex 32` | Long and random. **Laptop only.** Lose it and you cannot reprint cards; leak it and every password is known. Store it in a password manager. |
| `TEAM_EMAIL_DOMAIN` | `teams.example.com` | A made-up domain for team logins (no mail is ever sent). **Never change it after seeding**: every team login is `<code>@<this domain>`. |
| Event slug | `live-2026` | Short id of the night; the same in every command. |
| Event date | `2026-11-20` | The event starts at 20:00 IST that day. |

Generate the secret:
```bash
openssl rand -hex 32
```

---

## Part 3 · Supabase

### 3.1 Create the project
1. supabase.com → **New project**. Organisation on the Pro (or Team) plan.
2. Name `primus-live`, a strong database password (save it), **Region: Mumbai (ap-south-1)**.
3. Wait until the project is ready.

### 3.2 Collect the keys
Project Settings → **API** (or API Keys):
- **Project URL**: `https://<ref>.supabase.co` (the `<ref>` is the project reference).
- **anon / publishable key**: public; goes to Vercel and the laptop.
- **service_role / secret key**: secret; goes to Vercel (server) and the laptop only. If it was ever pasted in a chat
  or a document, **roll it now** (same page) before going further.

### 3.3 Turn on pg_cron (before the migrations)
Database → **Extensions** → search `pg_cron` → enable.

### 3.4 Apply the database (migrations)
```bash
supabase login                                   # opens the browser once
supabase link --project-ref <ref>                # asks for the database password
supabase db push                                 # lists the migrations, then applies them
```
Read the list before you confirm: it should end with `20261117000051_rls_initplan.sql`.
**Check:** SQL Editor → run
```sql
select public.schema_version();                                           -- 20261117000051
select jobname, schedule, active from cron.job where jobname = 'msim-tick'; -- one row, active = true
```
If the cron row is missing, pg_cron was not enabled before the push: enable it and run `supabase db push` again.

### 3.5 Authentication settings
| Where | Setting | Value |
| --- | --- | --- |
| Authentication → Sign In / Providers → Email | **Allow new users to sign up** | **Off** (accounts come only from `pnpm seed`) |
| Authentication → Sign In / Providers → Email | Confirm email | Off (team emails are made up) |
| Authentication → URL Configuration | **Site URL** | `https://play.example.com` |
| Authentication → URL Configuration | Redirect URLs | your site address (and track addresses if you use them) |
| Authentication → Rate Limits | **Sign-ins / sign-ups** | **at least 1,000 per 5 minutes** |
| Authentication → Rate Limits | **Token refreshes** | **1800 per 5 minutes**: password sign-ins count against this limit too, as well as the 600 phones refreshing their sessions |

**Check them exactly from the laptop** (no sign-ins used): create a personal access token at
supabase.com/dashboard/account/tokens, put it in `.env` as `SUPABASE_ACCESS_TOKEN=…`, then
```bash
pnpm auth-limits         # shows every Auth rate limit as the project has it
pnpm auth-limits --set   # raises sign-ups and sign-ins to 1000 and token refreshes to 1800, then reads back
```
`pnpm preflight` then checks them too. The token can manage your whole Supabase account: keep it in `.env`
only and delete it after the event.

Why the rate limit matters: the 600 phones reach Supabase through a few addresses (the venue Wi-Fi and Vercel's
servers). At the default limit most of the room would be refused at check-in.

### 3.6 Realtime settings
Realtime → **Settings**:
- **Allow public access: off** (the app uses private, signed-in channels).
- Concurrent clients / messages per second: above **1,800 connections** (600 screens × 3 channels: the event, the team,
  the squad chat) and **≥ 2,500 messages per second**. Pro with the spend cap off or Team gives 10,000 / 2,500.

### 3.7 Plan, compute and spend cap
- Billing → **Spend cap: off** (otherwise the plan's included limits become hard limits on the night).
- Project Settings → Compute: **at least 4 dedicated cores** for the event week (lower it again afterwards).

**Check for Part 3:** Database → Tables shows `events`, `teams`, `companies`…; the two SQL checks above pass.

---

## Part 4 · Vercel

### 4.1 Import
1. vercel.com → **Add New → Project** → import `TushKum/shutUpV`.
2. **Root Directory: `apps/web`**. Framework: Next.js (detected). Install command: default (pnpm, from the lockfile).
3. Open **"Include source files outside of the Root Directory"** (or the equivalent setting) and keep it on: the app
   uses `packages/engine` and the judge prompts in `prompts/`.
4. Production branch: `claude/market-simulation-platform-9rk357` (or the branch you merge it into).

### 4.2 Environment variables (Settings → Environment Variables → **Production**)
| Name | Value | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon / publishable key | |
| `NEXT_PUBLIC_TEAM_EMAIL_DOMAIN` | your `TEAM_EMAIL_DOMAIN` | **must equal the laptop's**, or no team can sign in |
| `SUPABASE_SERVICE_ROLE_KEY` | the service / secret key | server only |
| `ANTHROPIC_API_KEY` | your Anthropic key | server only |
| `JUDGE_MODEL` | `claude-haiku-5-5` | the default; the night costs a few dollars |
| `JUDGE_BACKUP_MODEL` | `claude-haiku-5-5` | the same model, so nothing dearer can start spending |
| `JUDGE_EFFORT` | `medium` | |
| `JUDGE_CONCURRENCY` | `8` | |
| `JUDGE_WORK_BUDGET_MS` | `50000` | |

**Never set** on production: `CARD_SECRET`, `JUDGE_FAKE`, `JUDGE_TEMPERATURE`, `TEAM_PORTAL` (unless you want a
one-track site). Keep Preview deployments away from the live database (do not give Preview these values).

### 4.3 Region and functions
Settings → **Functions**: region **Mumbai (`bom1`)**, next to the database. The judge route asks for up to 300 seconds
(`maxDuration = 300`): your plan must allow it (Pro does).

### 4.4 Deploy
Deployments → **Deploy** (or push to the production branch). `NEXT_PUBLIC_…` values are built into the app: **after
changing any of them, redeploy**.

**Check:** open `https://<project>.vercel.app/api/health`:
```json
{"app":"ok","database":"ok","schema":"ok","supabaseHost":"<ref>.supabase.co","teamEmailDomain":"teams.example.com", …}
```
`schema: "behind"` → run `supabase db push`. `database: "down"` → wrong Supabase URL or key; fix and redeploy.

---

## Part 5 · Your domain

### 5.1 Add it in Vercel
Settings → **Domains** → add `play.example.com`. Vercel shows the DNS record it needs.

### 5.2 Create the record at your registrar
| Address type | Record | Name | Value |
| --- | --- | --- | --- |
| Subdomain (`play.example.com`) | **CNAME** | `play` | the target Vercel shows |
| Bare domain (`example.com`) | **A** | `@` | the IP Vercel shows |

Use the exact values Vercel displays. Remove any older record with the same name. Wait for the green tick in
Vercel (minutes, up to an hour); Vercel then issues the HTTPS certificate itself.

### 5.3 Optional: one address per track
Add `product.example.com`, `consulting.example.com`, `finance.example.com` to the **same** project. Each admits only its
own track's teams (organisers can use all). Add the three to Supabase's redirect URLs. Teams then get their own
track's address; a team at the wrong one is told where to go.

**Check:** `https://play.example.com/api/health` shows the same as in 4.4, over HTTPS without a warning.

---

## Part 6 · The organiser laptop's `.env`

In the repository root, create `.env` (never commit it; it is already ignored):
```bash
# Supabase (same project as Vercel)
SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service key>

# Logins and cards
CARD_SECRET=<your openssl rand -hex 32>
TEAM_EMAIL_DOMAIN=teams.example.com
APP_URL=https://play.example.com

# Optional: the laptop judge worker (pnpm judge-worker)
ANTHROPIC_API_KEY=<key>
JUDGE_MODEL=claude-haiku-5-5
JUDGE_BACKUP_MODEL=claude-haiku-5-5
```
Back up `CARD_SECRET` in a password manager now.

---

## Part 7 · The event, its logins and the cards

### 7.1 Staff list
Copy `seed/staff.example.csv` to `seed/staff.csv` and fill in real emails (the file is ignored by git):
```
email,role,name,roll_number
lead@college.edu,ORGANISER,Event lead,S0001
exchange@college.edu,ORGANISER,Exchange desk,S0002
ai@college.edu,ORGANISER,AI desk,S0003
fairness@college.edu,FAIRNESS,Fairness officer,
display@college.edu,DISPLAY,Projector,
```
Roles: `ORGANISER` (control panel, judge), `FAIRNESS` (lottery and appeals), `DISPLAY` (the projector screen).
Optional: team names and members in `seed/teams.csv` (see `seed/teams.example.csv`); without it teams are named by code.

### 7.2 Create the event and logins
```bash
pnpm seed --slug live-2026 --name "Market Simulation 2026" --date 2026-11-20 --staff seed/staff.csv
```
It creates 150 teams (`P01–P50` Product, `C01–C50` Consulting, `F01–F50` Finance), one login per team, the staff logins,
and writes:
- `out/live-2026-login-cards.pdf`: 8 cards per A4 page, each with code, password and a QR code to `APP_URL`;
- `out/live-2026-staff-logins.txt`: the staff passwords.

Already seeded? Run the same command again: for an existing event it **only resets the logins to the cards' passwords
and reprints**. It never touches the game. Reprint one lost card: `pnpm cards --slug live-2026 --name "Market
Simulation 2026" --date 2026-11-20 --only P07`.

### 7.3 The lottery commitment (the day before)
```bash
pnpm new-seed
```
Keep the printed seed secret (password manager); enter the **commitment** on the control panel while the event is in
Setup. At the squad draw you enter the seed and a dice roll; anyone can verify the draw afterwards.

### 7.4 The decks
Sign in as an organiser → `/admin/live-2026/content` → upload from `seed/sectors/`:
`problem-cards.csv` (problem deck), `crisis-cards.csv` (crisis deck): **before the squad draw** (both lock then), and
`statements.csv` (Round 3 statements). Other sector mixes: `pnpm sectors --pick Luxury,FMCG,Aviation`.

**Check:** the control panel's **To do now** list shows no "Upload" item.

---

## Part 8 · Verify everything

### 8.1 The automatic check
```bash
pnpm preflight --slug live-2026 --rush 60
```
Every line must say **PASS**. It checks the `.env`, the database version, that teams have logins, signs in with real
card passwords, makes 60 quick sign-ins (rate limit), and compares your site's Supabase project and login domain with
the laptop's. Each FAIL says what to change.

### 8.2 By hand
- [ ] A phone scans a card's QR code → the code is filled in → the password signs in → the team home page.
- [ ] An organiser signs in (Organiser tab, email + password from `out/live-2026-staff-logins.txt`) → control panel.
- [ ] The projector account opens `/display/live-2026` full screen.
- [ ] `/admin/live-2026/health`: heartbeat ticking every 2 s, no tick errors; screens show Realtime green.
- [ ] `/team/judging` shows the published judge prompts (the prompt files are in the deployed app).

---

## Part 9 · Rehearse and load-test (on a separate rehearsal event)

```bash
# A rehearsal event (X-coded teams, 10× clock) on the same project
pnpm seed --slug reh-1 --rehearsal --starts-at 2026-11-16T10:00:00Z --speed 10
# upload the decks to /admin/reh-1/content, then let bots play the whole night
pnpm rehearse --slug reh-1 --autopilot

# Load tests against your domain
pnpm app-load-test --base https://play.example.com --slug reh-1 --rush 10    # check-in: 600 sign-ins
pnpm app-load-test --base https://play.example.com --slug reh-1 --burst 1.2  # a round clearing on 600 screens
pnpm load-test --slug reh-1                                                  # realtime and trading
```
All must PASS. If one does not: raise Supabase compute one size (or the limit the report names) and run it again.
Rehearsal events use the fake judge only if you set `JUDGE_FAKE=1` on a **separate** Vercel project; on production,
run one **real calibration** instead (`/admin/live-2026/judge/calibration`) and check the medians fall in their bands.

---

## Part 10 · Changing things later

- **Code change:** merge, let Vercel build, then `pnpm preflight --slug live-2026`.
- **New migration:** apply it first (`supabase db push`), **then** deploy the app (the app checks the version; the
  control panel warns in red if the database is behind).
- **Env change:** edit in Vercel → **Redeploy** (needed for every `NEXT_PUBLIC_…`).
- **Roll back:** Vercel → Deployments → a previous deployment → **Promote to Production**. Migrations are not rolled
  back; only roll back to a deployment built for the same database version.
- **Code freeze** from the day before the event: no deploys unless rehearsed.

---

## Part 11 · Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| "That team code and password do not match" for every team | `NEXT_PUBLIC_TEAM_EMAIL_DOMAIN` ≠ `TEAM_EMAIL_DOMAIN`, or Vercel points at another project | `pnpm preflight` names it; fix in Vercel, redeploy |
| Same, for one team | wrong card, or `CARD_SECRET` changed after printing | reprint with `pnpm cards … --only P07`; or run `pnpm seed` again (resets logins to the cards) |
| "The sign-in service is very busy" | Auth rate limit | Authentication → Rate Limits; `pnpm preflight --rush 60` |
| `/api/health` → `"schema":"behind"` | migrations not applied | `supabase db push` |
| Rounds never open or clear | pg_cron job missing or failing | SQL check in 3.4; Health page tick errors; enable pg_cron and push again |
| Screens say "Connecting" | Realtime limits, or public access settings | Realtime settings (3.6); Supabase status page |
| Judge errors | key, credit or model access | Judge page error text; Anthropic console; switch to the backup model |
| Domain shows a certificate warning | DNS not finished | wait for Vercel's green tick; check the record matches |
| Site loads but data is missing | the event slug differs | use the slug you seeded in every URL and command |

---

## Part 12 · Security checklist
- [ ] Supabase secret key rolled if it was ever shared; only in Vercel (server) and the laptop `.env`.
- [ ] `CARD_SECRET` only on the laptop and in the password manager.
- [ ] Sign-ups off; Realtime public access off.
- [ ] `out/` (passwords) kept off shared drives; printed cards shredded after the event.
- [ ] Preview deployments do not use production keys.
- [ ] After the event: remove the Anthropic key from Vercel, lower Supabase compute, keep the exports.
