# Final deployment on your own domain

The short path from code to a live site at your address (every click and check: [DEPLOYMENT-GUIDE.md](DEPLOYMENT-GUIDE.md)). The detail behind each step is in [DEPLOY.md](DEPLOY.md);
the checklist for the night is in [GO-LIVE.md](GO-LIVE.md). Below, `play.example.com` stands for your address.

## 0. Pick the address

- One address for everyone, e.g. `play.example.com` or `primus.example.com`. **Its first part must not contain
  "product", "consulting" or "finance"**: the app reads that part to decide which track's teams a portal admits
  (`apps/web/lib/portal/portal.ts`).
- Optional, one address per track on the same deployment: `product.example.com`, `consulting.example.com`,
  `finance.example.com`. Each admits only its track's teams; organisers can sign in on every one.

## 1. Supabase (once)

1. Plan **Pro with the spend cap off, or Team**; compute **with at least 4 dedicated cores** for the night.
2. Database → Extensions: enable **pg_cron** (the heartbeat that clears rounds runs on it).
3. Apply every migration from the laptop:
   ```bash
   supabase login
   supabase link --project-ref <your project ref>
   supabase db push
   ```
4. Authentication → Sign In / Providers: **turn off "Allow new users to sign up"**. Team and staff logins are created
   by `pnpm seed` with the service key; nobody should be able to make their own account.
5. Authentication → URL Configuration: **Site URL** = `https://play.example.com` (add the track addresses to the
   redirect URLs if you use them).
6. Authentication → Rate Limits: raise **sign-ins to at least 1,000 per 5 minutes**. All 600 phones (150 team
   logins, each used by its 4 members at once) reach Auth from a few addresses (the app's servers and the venue
   Wi-Fi), so the default limit would refuse most of the room. Realtime settings: concurrent clients above
   600 × 3 channels.

## 2. Vercel (once)

1. Import the GitHub repository. **Root Directory: `apps/web`**, framework Next.js.
2. Settings → Environment Variables, for **Production**:

   | Variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<project ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the project's anon (public) key |
   | `NEXT_PUBLIC_TEAM_EMAIL_DOMAIN` | **exactly** the laptop's `TEAM_EMAIL_DOMAIN` (the one the event was seeded with) |
   | `SUPABASE_SERVICE_ROLE_KEY` | the service (secret) key, rotated if it was ever shared |
   | `ANTHROPIC_API_KEY` | a funded key |
   | `JUDGE_MODEL` / `JUDGE_BACKUP_MODEL` | `claude-opus-5-5` / `claude-sonnet-5-5` |
   | `JUDGE_EFFORT` | `low` |

   Never set `CARD_SECRET` or `JUDGE_FAKE` on the production project.
3. Deploy. `NEXT_PUBLIC_…` values are built into the app: **after changing one, redeploy**.

## 3. Your domain

1. Vercel → your project → Settings → **Domains** → add `play.example.com` (and the track addresses if you use them).
2. At your domain registrar, create exactly the DNS record Vercel shows for each address: usually a **CNAME** to
   Vercel for a subdomain, or an **A record** for the bare domain. Vercel shows a green tick and issues the HTTPS
   certificate itself once the record is visible (minutes, sometimes up to an hour).
3. Open `https://play.example.com/api/health`: it must show `"database":"ok","schema":"ok"`.

## 4. Laptop .env, cards and the check

1. In the laptop's `.env`: `APP_URL=https://play.example.com` (the cards' QR codes and "log in at" line use it).
   Keep `CARD_SECRET` and `TEAM_EMAIL_DOMAIN` exactly as they were when the event was seeded.
2. Print the cards for the new address. For an event that already exists, `pnpm seed` with the same options now only
   resets the logins to the cards' passwords and reprints; it changes nothing else:
   ```bash
   pnpm seed --slug live-2026 --name "Market Simulation 2026" --date 2026-11-20 --staff seed/staff.csv
   ```
   (or `pnpm cards --slug live-2026 --name "Market Simulation 2026" --date 2026-11-20` to reprint without touching logins)
3. Run the check, which signs in with real card passwords and compares the site's settings with your `.env`:
   ```bash
   pnpm preflight --slug live-2026
   ```
   Add `--rush 60` once to also check the sign-in rate limit with 60 quick sign-ins (then wait 5 minutes before
   signing in from the laptop again if it fails). **Every line must say PASS.** Each FAIL says what to change. The usual cause of "That team code and password do
   not match" is a different `NEXT_PUBLIC_TEAM_EMAIL_DOMAIN` on Vercel, or Vercel pointing at another Supabase project.
4. Sign in yourself on a phone: scan a card's QR code, type the password.

## 5. Before the night

1. Content page: upload the sector decks (`seed/sectors/` or `pnpm sectors --pick …`) before the squad draw.
2. A real calibration batch (Judge → Calibration), then a full rehearsal on a separate **rehearsal** event
   (`pnpm seed --slug reh-1 --rehearsal --starts-at …`, `pnpm rehearse --slug reh-1 --autopilot`).
3. Load tests against that rehearsal on your address:
   - check-in, 600 phones signing in: `pnpm app-load-test --base https://play.example.com --slug reh-1 --rush 60`
   - a round clearing on 600 screens: `pnpm app-load-test --base https://play.example.com --slug reh-1 --burst 1.2`
   - realtime and trading: `pnpm load-test --slug reh-1`
4. **Check-in on the night:** let teams sign in as they arrive, or call them table by table over a few minutes,
   rather than "everyone sign in now". In tests, 600 phones within 60 s signed in in 0.2 s each; within 30 s all 600
   still got in (the app retries quietly when Auth is busy) but some waited several seconds.
5. `pnpm preflight --slug live-2026` once more on the day.
