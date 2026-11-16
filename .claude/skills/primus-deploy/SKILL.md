---
name: primus-deploy
description: Walk an organiser through deploying PRIMUS from scratch (Supabase, Vercel, their own domain, the laptop .env, the event and its login cards) one step at a time, checking each step before the next. Use when someone asks to deploy, set up production, go live, or put PRIMUS on their domain.
---

# Deploy PRIMUS, step by step

The source of truth is `docs/DEPLOYMENT-GUIDE.md` (Parts 0–12). Read the part you are on before guiding it; never
improvise settings that are not in it.

## How to run this

1. Ask which part they are on (or start at Part 1). Go **one part at a time**: give the steps, then the part's check,
   and only move on when the check passes.
2. Steps in a dashboard (Supabase, Vercel, the registrar) are done by the person: say exactly where to click and what
   to set, then ask them to confirm or paste what they see.
3. Steps on the laptop you can run yourself in the repository, after saying what each command does:
   - `node -v` (needs 22+), `pnpm install`, `pnpm -s typecheck`
   - `supabase link --project-ref <ref>` and `supabase db push` (show the migration list; it must end with the newest
     file in `supabase/migrations/`; get their OK before applying)
   - `curl -s https://<site>/api/health` (expect `database: ok`, `schema: ok`)
   - `pnpm seed …`, `pnpm preflight …` (see below)
4. After Part 8, hand over to the `primus-preflight` skill.

## Values that must match (the usual cause of "no team can sign in")

| Laptop `.env` | Vercel (Production) |
| --- | --- |
| `SUPABASE_URL` | `NEXT_PUBLIC_SUPABASE_URL` (same project) |
| `TEAM_EMAIL_DOMAIN` | `NEXT_PUBLIC_TEAM_EMAIL_DOMAIN` (identical; never changed after seeding) |
| `APP_URL` | the site's https address |

`CARD_SECRET` lives **only** on the laptop (and a password manager). `JUDGE_FAKE` is never set on production.

## Rules

- Never print, paste or echo secrets (service key, `CARD_SECRET`, Anthropic key, passwords from `out/`). Refer to them
  by name. If the person pastes a secret in chat, tell them to rotate it.
- `pnpm seed` on an **existing** event only resets its logins to the cards' passwords and reprints; say so before
  running it. Never run `--replace` on a live event.
- Migrations go to the database **before** the app that needs them is deployed.
- The site address's first label must not contain `product`, `consulting` or `finance` (that makes a one-track portal).
- Supabase must have pg_cron enabled **before** `supabase db push`, sign-ups off, sign-ins ≥ 1,000 per 5 minutes,
  Realtime public access off, the spend cap off, ≥ 4 dedicated cores for the event.
