-- Final grants: internal app.* functions are callable only by their owner (the SECURITY DEFINER game functions);
-- signed-in users may execute only the helpers that Row Level Security policies call.

revoke all on all functions in schema app from public, anon, authenticated, service_role;
grant execute on function
  app.my_role(),
  app.my_team_id(),
  app.my_event_id(),
  app.my_squad_id(),
  app.my_dealt_cards(),
  app.is_staff(),
  app.is_organiser(),
  app.is_fairness(),
  app.sees_all_events(),
  app.phase_reached(uuid, public.phase_code),
  app.score_released(uuid, public.submission_type)
to authenticated;

-- The heartbeat: every 2 seconds the database calls tick() for every running event (Supabase pg_cron ≥ 1.5
-- supports second-level schedules). Skipped where pg_cron is not installed (local tests); the admin console
-- also calls tick() once a second while it is open.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    perform cron.unschedule(jobid) from cron.job where jobname = 'msim-tick';
    perform cron.schedule('msim-tick', '2 seconds',
      $cron$select public.tick(e.id) from public.events e where e.current_phase between 'CHECKIN' and 'APPEALS'$cron$);
  end if;
exception when others then
  raise warning 'pg_cron heartbeat not scheduled: %', sqlerrm;
end $$;
