-- Which migration the database is at, so the app can tell a database that is behind it (a migration not yet run in
-- production) before the night starts: /api/health reports it and the control panel warns. Clients cannot call it
-- (anon and authenticated run only the game functions); the app reads it with the server-only service role.
--
-- Every new migration must end by redefining this function with its own version (apps/web/lib/schema.test.ts checks
-- that the newest migration does, and that the app expects that version).

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261117000050'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
