#!/usr/bin/env bash
# A local Supabase (Postgres, Auth, PostgREST, Realtime and pg_cron) for development and the end-to-end tests.
# Needs Docker. Applies every migration in supabase/migrations and writes apps/web/.env.e2e for the browser tests.
#
#   scripts/local-supabase.sh          start (or restart) and write apps/web/.env.e2e
#   scripts/local-supabase.sh reset    re-apply all migrations to an empty database
#   scripts/local-supabase.sh stop
#
# Images come from Docker Hub (SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io) so the default registry is not needed.
set -euo pipefail
cd "$(dirname "$0")/.."
export SUPABASE_INTERNAL_IMAGE_REGISTRY="${SUPABASE_INTERNAL_IMAGE_REGISTRY:-docker.io}"
SUPABASE="${SUPABASE_CLI:-npx --yes supabase@2.120.0}"
EXCLUDE="studio,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta,mailpit"

case "${1:-start}" in
  stop) exec $SUPABASE stop ;;
  reset) $SUPABASE db reset ;;
  start) $SUPABASE start -x "$EXCLUDE" ;;
  *) echo "usage: $0 [start|reset|stop]" >&2; exit 2 ;;
esac

eval "$($SUPABASE status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY|DB_URL)=')"
cat > apps/web/.env.e2e <<ENV
# Written by scripts/local-supabase.sh for the local stack. Not secret: these are the CLI's fixed demo keys.
NEXT_PUBLIC_SUPABASE_URL=${API_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}
NEXT_PUBLIC_TEAM_EMAIL_DOMAIN=teams.e2e.test
SUPABASE_URL=${API_URL}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
DATABASE_URL=${DB_URL}
CARD_SECRET=e2e-card-secret-0123456789
TEAM_EMAIL_DOMAIN=teams.e2e.test
ENV
echo "Local Supabase is up at ${API_URL}; wrote apps/web/.env.e2e"
