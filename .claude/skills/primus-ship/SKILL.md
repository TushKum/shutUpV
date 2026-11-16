---
name: primus-ship
description: Ship a code or database change to the live PRIMUS deployment safely - tests, the migration first, then the app, then the checks - and refuse during the code freeze unless rehearsed. Use when someone wants to deploy an update, push a fix to production, or apply a new migration.
---

# Ship a change to PRIMUS safely

## 0. Is it allowed now?
From the day before the event until it ends there is a **code freeze** (`docs/FINAL-DAY.md`). Ask the date and the
event date. During the freeze, ship only a fix that was rehearsed on a rehearsal event first, and only with the event
lead's OK. Never ship while the event is running unless the night is otherwise lost.

## 1. Prove it locally
```bash
pnpm install
pnpm -s typecheck
pnpm test            # unit + engine + database tests (needs the local Supabase: scripts/local-supabase.sh)
```
For a UI change, also run the affected browser tests in `apps/web/e2e` (`cd apps/web && npx playwright test <spec>`).
Stop on any failure; fix it first.

## 2. A new migration?
- Every new migration must end by redefining `public.schema_version()` with its own version, and
  `apps/web/lib/schema.ts` `EXPECTED_SCHEMA` must name it (`apps/web/lib/schema.test.ts` enforces both).
- Apply it to production **before** deploying the app: `supabase db push` (show the list; get an explicit OK).
- Never edit a migration that is already applied; add a new one.

## 3. Deploy the app
Push to the production branch (Vercel builds it), or Vercel → Deployments → Redeploy. If any `NEXT_PUBLIC_…`
variable changed, a redeploy is required.

## 4. Check
```bash
curl -s "$APP_URL/api/health"          # database ok, schema ok
pnpm preflight --slug <event slug>     # all PASS
```
Then open the page the change touched on a phone.

## 5. If it broke
Vercel → Deployments → the previous good deployment → **Promote to Production**. Only roll back to a deployment built
for the same database version (migrations are not rolled back). Then run step 4 again.
