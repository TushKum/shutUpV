# Deploying PRIMUS on Vercel

The website (`apps/web`) on Vercel, connected to the Supabase project the event was seeded into. Live today at
`https://primus-delta.vercel.app`. Full setup of everything else: [DEPLOYMENT-GUIDE.md](DEPLOYMENT-GUIDE.md).

## 1. Before you start
- The database is up to date: on the laptop, `supabase db push` (migrations before the app, always).
- You have the Supabase project's **URL**, **anon key** and **service_role (secret) key**
  (Supabase → Project Settings → API).
- Plan: **Hobby (free)** is enough for a non-commercial college event of 150 laptops. Take **Pro** ($20/month) only if
  the event is commercial.

## 2. Create the project (once)
1. vercel.com → **Add New… → Project** → **Import** `TushKum/shutUpV`
   (not listed? "Adjust GitHub App Permissions" and give Vercel the repository).
2. **Project name:** e.g. `primus` (not containing product, consulting or finance).
3. **Root Directory:** **Edit** → `apps/web`. Keep "Include files outside the root directory" **on**
   (the app uses `packages/engine` and the judge prompts in `prompts/`).
4. **Framework:** Next.js (detected). Leave build and install commands as they are.
5. Add the environment variables below, then **Deploy**.

## 3. Environment variables (Settings → Environment Variables → **Production**)

| Name | Value | Required |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` | yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon key | yes |
| `NEXT_PUBLIC_TEAM_EMAIL_DOMAIN` | exactly the laptop's `TEAM_EMAIL_DOMAIN` (today `teams.primus.example`) | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | the service_role / secret key | yes |
| `ANTHROPIC_API_KEY` | the Anthropic key | for the AI judge |
| `JUDGE_BACKUP_MODEL` | `claude-sonnet-5-5` | optional (default: Haiku 5.5 again) |

The judge model needs nothing: the app defaults to **Claude Haiku 5.5**, medium effort.
**Never** set `CARD_SECRET` or `JUDGE_FAKE` on Vercel.

`NEXT_PUBLIC_…` values are built into the site: **after changing any of them, redeploy** (Deployments → ⋯ → Redeploy).

## 4. Project settings (once, then redeploy)
- **Settings → Functions → Function Region:** Mumbai (`bom1`), next to the database.
- **Settings → Build and Deployment → Node.js Version:** `22.x`.
- **Settings → Git → Production Branch:** `claude/market-simulation-platform-9rk357` (the branch with the code).

## 5. Check it
Open `https://<your-project>.vercel.app/api/health`:
```json
{"app":"ok","database":"ok","schema":"ok","supabaseHost":"<project-ref>.supabase.co","teamEmailDomain":"teams.primus.example", …}
```
| You see | Fix |
| --- | --- |
| `"database":"down"` | wrong `NEXT_PUBLIC_SUPABASE_URL` / anon key; fix, redeploy |
| `"schema":"behind"` | run `supabase db push` on the laptop |
| `"schema":"unknown"` | `SUPABASE_SERVICE_ROLE_KEY` missing; add, redeploy |
| another `supabaseHost` | Vercel points at a different project than the one seeded; fix the three Supabase variables, redeploy |
| another `teamEmailDomain` | must equal the laptop's `TEAM_EMAIL_DOMAIN`; fix, redeploy (otherwise no team can sign in) |

Then on the laptop: set `APP_URL=https://<your-project>.vercel.app` in `.env`, reprint the cards
(`pnpm cards --slug live-2026 --name "Market Simulation 2026" --date 2026-11-20`) and run
`pnpm preflight --slug live-2026`: every line PASS.

## 6. Your own domain (optional)
1. Settings → **Domains** → add e.g. `play.yourcollege.in`.
2. At the domain registrar, add exactly the record Vercel shows (usually a **CNAME** for a subdomain). Wait for the green
   tick; HTTPS is automatic.
3. Supabase → Authentication → URL Configuration → **Site URL** = the new address.
4. Laptop `.env`: `APP_URL=https://play.yourcollege.in`, reprint the cards, `pnpm preflight`.

## 7. Updating the site
- Every push to the production branch deploys by itself; watch **Deployments** until it says **Ready**.
- A change that needs a new migration: `supabase db push` **first**, then let the deploy run.
- **Code freeze** from the day before the event: no deploys unless rehearsed.

## 8. If something breaks
- **Roll back:** Deployments → the last good deployment → ⋯ → **Promote to Production** (instant).
- **See errors:** project → **Logs** (Runtime Logs); filter by Error.
- **Status:** vercel-status.com.

## 9. After the event
- Remove `ANTHROPIC_API_KEY` from the variables and redeploy (the judge stops).
- If you upgraded to Pro for the event, downgrade to Hobby before the next month starts.
