-- The phase state machine: advance (with gates), pause, resume, extend, auto-advance and the tick that opens and
-- clears rounds and applies time-based defaults. Times shift so that every team loses the same amount of time.

create or replace function app.phase_after(p_phase public.phase_code)
returns public.phase_code
language sql immutable
as $$
  select x from unnest(enum_range(null::public.phase_code)) x where x > p_phase order by x limit 1
$$;

-- Moves every scheduled time at or after p_from by p_delta (phases, rounds and deadlines).
create or replace function app.shift_schedule(p_event uuid, p_from timestamptz, p_delta interval)
returns void
language plpgsql
as $$
begin
  if p_delta <= interval '0' then
    return;
  end if;
  -- Only what has not happened yet moves: a phase that has started keeps its start, a round that has
  -- opened keeps its opening time, and a cleared round never moves.
  update public.phases set ends_at = ends_at + p_delta where event_id = p_event and ends_at >= p_from and ended_at is null;
  update public.phases set starts_at = starts_at + p_delta where event_id = p_event and starts_at >= p_from and started_at is null;
  update public.rounds set closes_at = closes_at + p_delta where event_id = p_event and closes_at >= p_from and status in ('SCHEDULED', 'OPEN');
  update public.rounds set opens_at = opens_at + p_delta where event_id = p_event and opens_at >= p_from and status = 'SCHEDULED';
  update public.deadlines set at = at + p_delta where event_id = p_event and at >= p_from;
end
$$;

-- Why the current phase cannot end yet (NULL when it can).
create or replace function app.gate_blocker(p_event uuid)
returns text
language sql stable
as $$
  select case e.current_phase
    when 'SQUAD_DRAW' then case when e.drawn_at is null then 'The lottery has not been drawn.' end
    when 'READING' then case when not app.score_released(e.id, 'PITCH') then 'Pitch scores have not been released.' end
    when 'VERDICTS' then case when not app.score_released(e.id, 'PLAN') then 'Plan scores have not been released.' end
    when 'ROUNDS_13_21' then case when not app.score_released(e.id, 'FLASH') then 'Flash scores have not been released.' end
    when 'APPEALS' then case when exists (select 1 from public.flags f where f.event_id = e.id and f.status = 'OPEN')
                             then 'Collusion flags are still open for the fairness officer.' end
    when 'AWARDS' then 'The event has ended.'
  end
  from public.events e where e.id = p_event
$$;

-- Leaves the phase p_from (which must still be the current one, so that a tick and an organiser advancing at the
-- same moment cannot skip a phase) and enters the next one, running each transition's actions.
create or replace function app.do_advance(p_event uuid, p_from public.phase_code)
returns jsonb
language plpgsql
as $$
declare
  v_event public.events;
  v_next public.phase_code;
  v_phase public.phases;
  v_blocker text;
  r record;
begin
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.current_phase is distinct from p_from then
    return app.fail('STALE', format('The event is already in %s.', v_event.current_phase));
  end if;
  v_blocker := app.gate_blocker(p_event);
  if v_blocker is not null then
    return app.fail('GATE', v_blocker);
  end if;
  v_next := app.phase_after(v_event.current_phase);

  -- Leaving: a trading phase closes and clears all of its rounds (a round that never opened records unchanged prices).
  for r in select id from public.rounds where event_id = p_event and phase = v_event.current_phase and status <> 'CLEARED' order by number loop
    perform app.clear_round(r.id, true);
  end loop;
  if v_event.current_phase = 'IPO' then
    perform app.allocate_ipo(p_event);
  end if;

  -- Late start: if the next phase should already have begun, everything from its planned start moves by the delay.
  select * into v_phase from public.phases where event_id = p_event and code = v_next;
  if v_phase.starts_at < now() - interval '5 seconds' then
    perform app.shift_schedule(p_event, v_phase.starts_at, now() - v_phase.starts_at);
  end if;
  -- Early: a phase that publishes work closes the windows for that work, whatever the clock says.
  update public.deadlines set at = least(at, now())
   where event_id = p_event
     and code = any (case v_next when 'READING' then array['PITCH']::public.deadline_code[]
                                 when 'PLANS_PUBLISHED' then array['PLAN', 'DEAL']::public.deadline_code[]
                                 else '{}'::public.deadline_code[] end);
  update public.phases set ended_at = now() where event_id = p_event and code = v_event.current_phase;
  update public.phases set started_at = now() where event_id = p_event and code = v_next;
  update public.events set current_phase = v_next, phase_started_at = now() where id = p_event;

  -- Entering.
  case v_next
    when 'BUILD' then
      -- The pick may still be open after an early advance; the tick applies the defaults at its deadline.
      if app.deadline_passed(p_event, 'PROBLEM_PICK') then
        perform app.default_problem_cards(p_event);
      end if;
    when 'READING' then perform app.default_tickers(p_event);
    when 'CRISIS' then perform app.apply_crisis(p_event);
    when 'CLOSE' then perform app.close_market(p_event);
    when 'SETTLEMENT' then perform app.settle(p_event);
    else null;
  end case;

  perform app.broadcast(p_event, 'phase', jsonb_build_object('phase', v_next, 'from', v_event.current_phase));
  return app.ok(jsonb_build_object('phase', v_next));
end
$$;

-- Organiser: advance from the phase they see (so a double click cannot skip a phase).
create or replace function public.advance_phase(p_event uuid, p_from public.phase_code)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_current public.phase_code;
begin
  perform app.require_organiser();
  select current_phase into v_current from public.events where id = p_event for no key update;
  if v_current is distinct from p_from then
    return app.fail('STALE', format('The event is already in %s.', v_current));
  end if;
  return app.do_advance(p_event, p_from);
end
$$;

create or replace function public.pause_event(p_event uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.require_organiser();
  update public.events set paused = true, paused_at = now() where id = p_event and not paused;
  if not found then
    return app.fail('ALREADY_PAUSED', 'The event is already paused.');
  end if;
  perform app.broadcast(p_event, 'paused');
  return app.ok();
end
$$;

-- Resume: everything that was still ahead when the pause began moves later by the length of the pause.
create or replace function public.resume_event(p_event uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event for no key update;
  if not v_event.paused then
    return app.fail('NOT_PAUSED', 'The event is not paused.');
  end if;
  perform app.shift_schedule(p_event, v_event.paused_at, now() - v_event.paused_at);
  -- Items that were already due when the pause began but had not started (a phase waiting at a gate, a round
  -- waiting for the tick) also move, or the pause would be counted again as lateness when they start.
  update public.phases
     set starts_at = starts_at + (now() - v_event.paused_at),
         ends_at = case when ends_at < v_event.paused_at then ends_at + (now() - v_event.paused_at) else ends_at end
   where event_id = p_event and started_at is null and starts_at < v_event.paused_at;
  update public.rounds
     set opens_at = opens_at + (now() - v_event.paused_at),
         closes_at = case when closes_at < v_event.paused_at then closes_at + (now() - v_event.paused_at) else closes_at end
   where event_id = p_event and status = 'SCHEDULED' and opens_at < v_event.paused_at;
  update public.events set paused = false, paused_at = null where id = p_event;
  perform app.broadcast(p_event, 'resumed', jsonb_build_object('paused_for_seconds', extract(epoch from now() - v_event.paused_at)::int));
  return app.ok();
end
$$;

-- Extend: the current round (or phase) and everything after it move later by N minutes.
create or replace function public.extend_event(p_event uuid, p_minutes integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
begin
  perform app.require_organiser();
  if p_minutes < 1 or p_minutes > 120 then
    raise exception 'extend by 1 to 120 minutes';
  end if;
  select * into v_event from public.events where id = p_event for no key update;
  -- While paused, time stands still at the start of the pause: what was ahead then is what is extended.
  perform app.shift_schedule(p_event, case when v_event.paused then v_event.paused_at else now() end, make_interval(mins => p_minutes));
  perform app.broadcast(p_event, 'extended', jsonb_build_object('minutes', p_minutes));
  return app.ok();
end
$$;

create or replace function public.set_auto_advance(p_event uuid, p_on boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.require_organiser();
  update public.events set auto_advance = p_on where id = p_event;
  return app.ok(jsonb_build_object('auto_advance', p_on));
end
$$;

-- Organiser: close and clear the open round now.
create or replace function public.close_round_now(p_event uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_round public.rounds;
begin
  perform app.require_organiser();
  -- Like the tick, hold the event first: a clearing never interleaves with another clearing or a correction.
  perform 1 from public.events where id = p_event for no key update;
  select * into v_round from public.rounds
   where event_id = p_event and status = 'OPEN' order by number limit 1;
  if v_round.id is null then
    return app.fail('NO_OPEN_ROUND', 'No round is open.');
  end if;
  return app.clear_round(v_round.id, true);
end
$$;

-- The heartbeat (pg_cron every 2 s; the admin console calls it too). Idempotent and safe to call any time:
-- clears rounds whose time is up, opens the next round, applies the problem-card and fee defaults at their
-- deadlines, and advances the phase on schedule when auto-advance is on.
create or replace function public.tick(p_event uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_phase public.phases;
  r public.rounds;
  v_actions text[] := '{}';
  v_late interval;
  v_res jsonb;
begin
  perform app.require_organiser();
  if not pg_try_advisory_xact_lock(hashtext('tick:' || p_event::text)) then
    return app.ok(jsonb_build_object('skipped', true));
  end if;
  -- Serialise with organiser actions (advance, pause, extend), which lock the event row. NO KEY UPDATE still lets
  -- team actions take their KEY SHARE locks on it.
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.id is null or v_event.paused then
    return app.ok(jsonb_build_object('paused', coalesce(v_event.paused, false)));
  end if;

  -- Rounds of the current phase, in order.
  for r in select * from public.rounds where event_id = p_event and phase = v_event.current_phase order by number loop
    if r.status = 'OPEN' and now() >= r.closes_at then
      perform app.clear_round(r.id);
      v_actions := v_actions || ('cleared ' || r.number);
    elsif r.status = 'SCHEDULED' and now() >= r.opens_at then
      exit when exists (select 1 from public.rounds p where p.event_id = p_event and p.number < r.number and p.status <> 'CLEARED');
      -- Round 18 waits for the flash tier (applied after round 17 clears).
      exit when r.number = 18 and not app.score_released(p_event, 'FLASH');
      v_late := now() - r.opens_at;
      if v_late > interval '5 seconds' then
        perform app.shift_schedule(p_event, r.opens_at, v_late);
        select * into r from public.rounds where id = r.id;
      end if;
      update public.rounds set status = 'OPEN', opened_at = now() where id = r.id and status = 'SCHEDULED';
      exit when not found;
      perform app.broadcast(p_event, 'round_open', jsonb_build_object('round', r.number, 'closes_at', r.closes_at));
      v_actions := v_actions || ('opened ' || r.number);
      exit;
    end if;
  end loop;

  if v_event.drawn_at is not null and app.deadline_passed(p_event, 'PROBLEM_PICK') then
    perform app.default_problem_cards(p_event);
  end if;
  if v_event.crisis_applied_at is not null and app.deadline_passed(p_event, 'FEE')
     and exists (select 1 from public.fees where event_id = p_event and executed_at is null) then
    v_actions := v_actions || ('default fees ' || app.apply_default_fees(p_event));
  end if;

  if v_event.auto_advance then
    select * into v_phase from public.phases where event_id = p_event and code = v_event.current_phase;
    if now() >= v_phase.ends_at
       and not exists (select 1 from public.rounds where event_id = p_event and phase = v_event.current_phase
                          and status <> 'CLEARED' and closes_at > now()) then
      v_res := app.do_advance(p_event, v_event.current_phase);
      if (v_res ->> 'ok')::boolean then
        v_actions := v_actions || ('advanced to ' || (v_res ->> 'phase'));
      end if;
    end if;
  end if;
  return app.ok(jsonb_build_object('actions', to_jsonb(v_actions)));
end
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.advance_phase(uuid, public.phase_code)', 'public.pause_event(uuid)', 'public.resume_event(uuid)',
    'public.extend_event(uuid, integer)', 'public.set_auto_advance(uuid, boolean)', 'public.close_round_now(uuid)',
    'public.tick(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
