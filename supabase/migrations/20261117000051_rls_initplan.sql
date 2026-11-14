-- Row level security that scales to 600 screens refreshing at once.
--
-- The policies call app.my_team_id(), app.is_staff(), auth.uid() and the like directly, and Postgres evaluated them
-- once for every row it looked at (each a lookup of the caller's account): reading 5 offers out of 271 took 10 ms. The
-- app-server load test (scripts/app-load-test.ts --burst) showed the database time per page dominated by this.
--
-- Wrapped as (select app.my_team_id()), a call is an init plan: evaluated once per query. These functions take no
-- arguments and are STABLE (one value for the whole query), so what each policy allows is unchanged; only the speed.
-- Calls that take a row's columns (app.phase_reached(event_id, …)) are left as they are. Already wrapped calls are
-- skipped.

do $$
declare
  p record;
  -- A zero-argument call of an app. or auth. function not already the subject of a SELECT. app.my_dealt_cards()
  -- returns an array used as "= ANY (…)", where a subquery would change the meaning: it stays as it is (it guards
  -- only the problem deck, a handful of rows).
  re constant text := '(?<!SELECT )\m((app|auth)\.(?!my_dealt_cards)[a-z_]+)\(\)';
  v_using text;
  v_check text;
  v_n int := 0;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (coalesce(qual, '') ~ re or coalesce(with_check, '') ~ re)
  loop
    v_using := regexp_replace(p.qual, re, '(select \1())', 'g');
    v_check := regexp_replace(p.with_check, re, '(select \1())', 'g');
    execute format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename)
         || case when v_using is null then '' else format(' using (%s)', v_using) end
         || case when v_check is null then '' else format(' with check (%s)', v_check) end;
    v_n := v_n + 1;
  end loop;
  raise notice 'rls_initplan: % policies rewritten', v_n;
end
$$;

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261117000051'::text $$;
