-- Squad chat: a private chat for the three teams of a squad (the product, consulting and finance team), so they can
-- agree the fee and the rescue deal on the site instead of across the hall. Only the squad's teams and the staff
-- (organisers and the fairness officer) read it; a team writes through post_squad_message only. Each new message is
-- announced on the squad's own private channel 'squad:<id>'. The announcement says only who posted, never the text:
-- screens re-read through RLS.

create table public.squad_messages (
  id bigserial primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  squad_id uuid not null references public.squads (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  body text not null check (length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index squad_messages_squad_idx on public.squad_messages (squad_id, id);

alter table public.squad_messages enable row level security;

create policy squad_messages_read on public.squad_messages for select to authenticated
  using ((select app.is_staff()) or squad_id = (select app.my_squad_id()));

grant select on public.squad_messages to authenticated;

create trigger audit after insert or update or delete on public.squad_messages for each row execute function app.audit_row();

create or replace function public.post_squad_message(p_body text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_phase public.phase_code;
  v_squad uuid;
  v_m public.squad_messages;
begin
  -- Throttle first (it touches only the team's rate-limit row), then lock the team (PLAN §46).
  if app.my_team_id() is null then
    raise exception 'only a team can post in a squad chat' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  v_team := app.lock_caller_team();
  v_squad := app.my_squad_id();
  if v_squad is null then
    return app.reject(v_team.event_id, 'post_squad_message', 'NO_SQUAD', 'The chat opens when the squads are drawn.');
  end if;
  select current_phase into v_phase from public.events where id = v_team.event_id;
  if v_phase >= 'AWARDS' then
    return app.reject(v_team.event_id, 'post_squad_message', 'CHAT_CLOSED', 'The squad chat has closed.');
  end if;
  if length(btrim(coalesce(p_body, ''))) = 0 or length(btrim(p_body)) > 500 then
    return app.reject(v_team.event_id, 'post_squad_message', 'BAD_LENGTH', 'Messages are 1 to 500 characters.');
  end if;
  if not app.rate_limit(v_team.id, 'chat', 20, interval '1 minute') then
    return app.fail('RATE_LIMITED', 'Too many messages in a minute.');
  end if;
  insert into public.squad_messages (event_id, squad_id, team_id, body)
  values (v_team.event_id, v_squad, v_team.id, btrim(p_body))
  returning * into v_m;
  perform realtime.send(
    jsonb_build_object('kind', 'squad_message', 'squad_id', v_squad, 'team_id', v_team.id, 'at', now()),
    'squad_message', 'squad:' || v_squad::text, true);
  return app.ok(jsonb_build_object('message_id', v_m.id));
end
$$;

revoke all on function public.post_squad_message(text) from public, anon;
grant execute on function public.post_squad_message(text) to authenticated;

-- May the caller receive messages on this topic? As before ('event:<id>' of the caller's own event, or any event for
-- staff and the display; 'staff:<id>' for staff), plus 'squad:<id>' for that squad's three teams and the staff.
create or replace function app.can_hear(p_topic text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (p_topic like 'event:%' and exists (
       select 1 from public.events e
        where 'event:' || e.id::text = p_topic and (app.sees_all_events() or e.id = app.my_event_id())))
    or (p_topic like 'staff:%' and app.is_staff() and exists (
       select 1 from public.events e where 'staff:' || e.id::text = p_topic))
    or (p_topic like 'squad:%' and (
       (app.is_staff() and exists (select 1 from public.squads s where 'squad:' || s.id::text = p_topic))
       or 'squad:' || app.my_squad_id()::text = p_topic)),
    false)
$$;
