-- Phase 5 review: while the event is paused, event_status keeps reporting the round that was open when the pause
-- began. app.open_round needs now() < closes_at, so a round whose planned close passed during the pause used to
-- vanish from every header ("Round 2 opens at …" while round 1 was still open and frozen). Its close moves later by
-- the length of the pause when the event resumes (shift_schedule), so screens show the time it had left, frozen.

create or replace function public.event_status(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_phase public.phases;
  v_open public.rounds;
  v_next public.rounds;
begin
  if not (app.sees_all_events() or app.my_event_id() = p_event) then
    raise exception 'no such event' using errcode = '42501';
  end if;
  select * into v_event from public.events where id = p_event;
  if v_event.id is null then
    raise exception 'no such event' using errcode = '42501';
  end if;
  select * into v_phase from public.phases where event_id = p_event and code = v_event.current_phase;
  if v_event.paused then
    select r.* into v_open from public.rounds r
     where r.event_id = p_event and r.status = 'OPEN' and r.phase = v_event.current_phase order by r.number limit 1;
  else
    v_open := app.open_round(p_event);
  end if;
  select * into v_next from public.rounds
   where event_id = p_event and status = 'SCHEDULED' and phase = v_event.current_phase order by number limit 1;
  return jsonb_build_object(
    'phase', v_event.current_phase,
    'next_phase', app.phase_after(v_event.current_phase),
    'gate', app.gate_blocker(p_event),
    'paused', v_event.paused,
    'paused_at', v_event.paused_at,
    'auto_advance', v_event.auto_advance,
    'trading', app.trading_state(p_event),
    'phase_started_at', v_event.phase_started_at,
    'phase_ends_at', v_phase.ends_at,
    'open_round', case when v_open.id is null then null else jsonb_build_object('number', v_open.number, 'closes_at', v_open.closes_at) end,
    'next_round', case when v_next.id is null then null else jsonb_build_object('number', v_next.number, 'opens_at', v_next.opens_at) end,
    'drawn', v_event.drawn_at is not null,
    'server_time', now());
end
$$;
