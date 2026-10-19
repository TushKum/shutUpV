#!/usr/bin/env bash
# Raises the local Supabase stack's limits to roughly a paid hosted plan, so `pnpm load-test` measures the app and not
# the local defaults: Realtime allows 200 concurrent users and 100 events a second per tenant, and the local Kong
# gateway 512 connections. Run after `scripts/local-supabase.sh` (and again after any restart of the stack).
set -euo pipefail
DB=${DB_URL:-postgres://supabase_admin:postgres@127.0.0.1:54322/postgres}
psql "$DB" -q -c "update _realtime.tenants set max_concurrent_users = 2000, max_events_per_second = 10000, max_joins_per_second = 1000"
docker exec supabase_realtime_market-sim /app/bin/realtime rpc 'Realtime.Tenants.Cache.distributed_invalidate_tenant_cache("realtime-dev")' >/dev/null
docker exec supabase_kong_market-sim sh -c 'KONG_NGINX_EVENTS_WORKER_CONNECTIONS=8192 KONG_NGINX_WORKER_RLIMIT_NOFILE=20000 kong reload' >/dev/null
echo "Local limits raised: Realtime 2,000 users and 10,000 events/s; Kong 8,192 connections."
