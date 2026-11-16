---
name: primus-preflight
description: Check that a PRIMUS deployment is ready (database version, team logins, the site's settings, the sign-in rate limit) by running pnpm preflight and explaining each failure with its fix. Use when someone asks if everything is OK, why login fails, before the event, or after any change.
---

# Is PRIMUS ready?

## Run

```bash
pnpm preflight --slug <event slug>            # e.g. live-2026
pnpm preflight --slug <event slug> --rush 60  # also 60 quick sign-ins: the Auth rate limit
```
Ask for the slug if you do not know it (`out/*-login-cards.pdf` names it). `--rush` uses up 60 sign-ins from this
laptop's address: run it once, not in a loop. Prefer `pnpm auth-limits` (exact, uses no sign-ins). The script changes nothing.

Also run `curl -s "$APP_URL/api/health"` if the app section could not be reached.

## Read the result

Every line must be **PASS**. For each FAIL, the script prints the fix; explain it in plain words and offer to do the
laptop-side part. The common ones:

| FAIL | Meaning | Fix |
| --- | --- | --- |
| migrations not up to date | the database lacks a migration this code needs | `supabase db push` |
| a team's login is `…@x`, but TEAM_EMAIL_DOMAIN makes it `…@y` | laptop and seeded logins use different domains | set both `TEAM_EMAIL_DOMAIN` and Vercel's `NEXT_PUBLIC_TEAM_EMAIL_DOMAIN` to the seeded one; redeploy |
| cannot sign in with its card's password | `CARD_SECRET` differs from the one used for the cards | restore the original, or run `pnpm seed` with the same options (resets logins), then reprint |
| the app uses Supabase X, the laptop seeded Y | Vercel points at another project | fix Vercel's Supabase variables; redeploy |
| the app's team-login domain differs | Vercel's `NEXT_PUBLIC_TEAM_EMAIL_DOMAIN` is wrong | fix it in Vercel; **redeploy** (it is built into the app) |
| Auth limit "…" too low / quick sign-ins refused | Auth limit too low for 600 people | `pnpm auth-limits --set` (needs `SUPABASE_ACCESS_TOKEN` in `.env`), or Supabase → Authentication → Rate Limits: sign-ups and sign-ins ≥ 1000, token refreshes ≥ 1800, Save changes |
| Auth rate limits not checked | no personal access token | add `SUPABASE_ACCESS_TOKEN` (supabase.com/dashboard/account/tokens) to check them exactly without spending sign-ins |
| the deployed app is older than this code | Vercel is not on the latest commit | redeploy |

Then do the hand checks in `docs/DEPLOYMENT-GUIDE.md` Part 8.2 (QR sign-in on a phone, organiser, projector, heartbeat).

## Rules

Never print passwords or keys from `.env` or `out/`. Report results as PASS/FAIL lines and the fixes, not raw secrets.
