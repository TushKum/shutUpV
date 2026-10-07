-- Access that Phase 2 adds on top of Phase 1: who may hear the realtime channel, flags kept out of the organisers'
-- audit view, lighter audit rows for drafts, and the final grants. Internal app.* functions are callable only by
-- their owner (the SECURITY DEFINER game functions); signed-in users may execute only the helpers that Row Level
-- Security policies call.

-- ───────────────────────────── Realtime ─────────────────────────────

-- May the caller receive messages on this topic? 'event:<id>' of the caller's own event; staff and the display hear
-- every event.
create or replace function app.can_hear(p_topic text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(p_topic like 'event:%' and exists (
    select 1 from public.events e
     where 'event:' || e.id::text = p_topic and (app.sees_all_events() or e.id = app.my_event_id())), false)
$$;

-- Receive only (there is no INSERT policy, so no client can send on an event channel). Turn off "Allow public
-- access" in the project's Realtime settings so only private channels exist (README).
drop policy if exists event_broadcast_read on realtime.messages;
create policy event_broadcast_read on realtime.messages for select to authenticated
  using (realtime.messages.extension = 'broadcast' and (select app.can_hear((select realtime.topic()))));

-- ───────────────────────────── Audit log ─────────────────────────────

-- Collusion flags are for the fairness officer only, including their history in the audit log.
drop policy audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log for select to authenticated
  using ((select app.is_staff()) and (entity <> 'flags' or (select app.is_fairness())));

-- Drafts are saved often and can be long: their audit rows keep a digest of the content, not the content (every
-- submitted version is stored in full in submissions).
create or replace function app.audit_row()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid;
  v_role text;
  v_team uuid;
  v_before jsonb;
  v_after jsonb;
begin
  if current_setting('app.allow_purge', true) = 'on' then
    return null;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then v_before := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_after := to_jsonb(new); end if;
  if tg_op = 'UPDATE' and v_before = v_after then
    return null;
  end if;
  if tg_table_name = 'submission_drafts' then
    v_before := case when v_before is null then null else v_before || jsonb_build_object('content',
                  jsonb_build_object('md5', md5((v_before -> 'content')::text), 'chars', length((v_before -> 'content')::text))) end;
    v_after := case when v_after is null then null else v_after || jsonb_build_object('content',
                  jsonb_build_object('md5', md5((v_after -> 'content')::text), 'chars', length((v_after -> 'content')::text))) end;
  end if;
  select a.user_id, a.role, a.team_id into v_user, v_role, v_team from app.audit_actor() a;
  insert into public.audit_log (event_id, actor_user_id, actor_role, actor_team_id, action, entity, entity_id, before, after)
  values (
    coalesce(v_after ->> 'event_id', v_before ->> 'event_id',
             case when tg_table_name = 'events' then coalesce(v_after ->> 'id', v_before ->> 'id') end)::uuid,
    v_user, v_role, v_team,
    lower(tg_op), tg_table_name,
    coalesce(v_after ->> 'id', v_before ->> 'id', v_after ->> 'user_id', v_before ->> 'user_id',
             v_after ->> 'event_id', v_before ->> 'event_id'),
    v_before, v_after);
  return null;
end
$$;

-- ───────────────────────────── Grants ─────────────────────────────

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
  app.score_released(uuid, public.submission_type),
  app.can_hear(text)
to authenticated;

-- Ticks every running event, each in its own subtransaction: one event's failure (logged to error_log, shown in
-- the admin health view) never stops another event's rounds.
create or replace function app.tick_all()
returns integer
language plpgsql
as $$
declare
  v_id uuid;
  n int := 0;
begin
  for v_id in select id from public.events where current_phase between 'CHECKIN' and 'APPEALS' order by id loop
    begin
      perform public.tick(v_id);
      n := n + 1;
    exception when others then
      insert into public.error_log (event_id, source, message, context)
      values (v_id, 'tick', sqlerrm, jsonb_build_object('sqlstate', sqlstate));
    end;
  end loop;
  return n;
end
$$;
revoke all on function app.tick_all() from public, anon, authenticated, service_role;

-- The heartbeat: every 2 seconds the database ticks every running event (Supabase pg_cron ≥ 1.5 supports
-- second-level schedules). Skipped where pg_cron is not installed (local tests); the admin console also calls
-- tick() once a second while it is open.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    perform cron.unschedule(jobid) from cron.job where jobname = 'msim-tick';
    perform cron.schedule('msim-tick', '2 seconds', 'select app.tick_all()');
  end if;
exception when others then
  raise warning 'pg_cron heartbeat not scheduled: %', sqlerrm;
end $$;
