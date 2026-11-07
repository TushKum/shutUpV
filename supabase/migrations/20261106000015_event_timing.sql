-- Organiser-controlled timing. The night no longer runs on a fixed timetable: it starts when an organiser starts it
-- and ends when an organiser ends it. Each phase has a duration (or none: an untimed phase stays open until an
-- organiser ends it), each trading round has a duration, and the twist and the leaderboard freeze have an offset
-- from the start of their phase. Every time on the schedule is projected from what actually happened: when the
-- current phase started, how long it was paused and extended, and the durations after it (app.reproject). Pausing
-- freezes every countdown; resuming gives back exactly the time that was left.
--
-- What closes when:
--   PRD_LOCK = the end of BUILD; QA_CLOSE = the end of CRISIS_QA; SOLUTION_LOCK = the end of RESCUE;
--   MARKET_CLOSE = the end of MARKET; TWIST = BUILD start + offset; LEADERBOARD_FREEZE = MARKET start + offset.
--   A trading phase's rounds run back to back from its start, and the phase lasts as long as its rounds.
-- "Advance when timer expires" (events.auto_advance) moves to the next phase at the end of the current one;
-- "Manual advance" waits for an organiser. In both, a timer that runs out still closes its form or round.
--
-- Organiser changes carry the timing version the organiser saw (events.timing_version): a change made from a stale
-- page, or a second console, is refused instead of applied twice. A change that brings any deadline earlier, closes
-- a form or a round sooner, needs a second confirmation, and returns a preview of every affected time first. Every
-- change is in the audit log (the audit triggers on events, phases, rounds and deadlines, plus a "timing" entry
-- naming the action), and teams are told which deadlines moved.

-- ───────────────────────────── Columns ─────────────────────────────

alter table public.phases
  alter column starts_at drop not null,
  alter column ends_at drop not null,
  add column duration_seconds integer check (duration_seconds is null or duration_seconds between 30 and 43200),
  add column paused_seconds integer not null default 0 check (paused_seconds >= 0),
  add column extended_seconds integer not null default 0 check (extended_seconds >= 0);

alter table public.rounds
  alter column opens_at drop not null,
  alter column closes_at drop not null,
  add column duration_seconds integer not null default 900 check (duration_seconds between 30 and 7200),
  add column paused_seconds integer not null default 0 check (paused_seconds >= 0),
  add column extended_seconds integer not null default 0 check (extended_seconds >= 0);

alter table public.deadlines alter column at drop not null;

alter table public.events
  add column twist_offset_seconds integer not null default 3600 check (twist_offset_seconds >= 0),
  add column freeze_offset_seconds integer not null default 2700 check (freeze_offset_seconds >= 0),
  add column timing_version integer not null default 0,
  add column started_at timestamptz,
  add column ended_at timestamptz,
  add column timing_changed_at timestamptz,
  add column timing_change jsonb;

-- Events created before this migration: their planned times become durations.
update public.phases set duration_seconds = greatest(30, extract(epoch from ends_at - starts_at)::int)
 where duration_seconds is null and code not in ('SETUP', 'MARKET_BLIND', 'MARKET', 'AWARDS') and ends_at is not null;
update public.rounds set duration_seconds = greatest(30, least(7200, extract(epoch from closes_at - opens_at)::int))
 where closes_at is not null;

-- ───────────────────────────── The projection ─────────────────────────────

-- Has the step that a deadline triggers already happened? Such a deadline is history and is never moved.
create or replace function app.deadline_done(p_event public.events, p_code public.deadline_code)
returns boolean
language sql stable
as $$
  select case p_code
    when 'PROBLEM_DRAW' then p_event.drawn_at is not null
    when 'TWIST' then p_event.twist_published_at is not null
    when 'PRD_LOCK' then p_event.prds_locked_at is not null
    when 'QA_CLOSE' then p_event.current_phase > 'CRISIS_QA'
    when 'SOLUTION_LOCK' then p_event.solutions_locked_at is not null
    when 'LEADERBOARD_FREEZE' then p_event.leaderboard_frozen_at is not null
    when 'MARKET_CLOSE' then p_event.market_closed_at is not null
    else true
  end
$$;

-- The rounds of a trading phase, back to back from p_start; returns when the last one closes (null when unknown).
create or replace function app.reproject_rounds(p_event uuid, p_phase public.phase_code, p_start timestamptz)
returns timestamptz
language plpgsql
as $$
declare
  r public.rounds;
  v_cursor timestamptz := p_start;
begin
  for r in select * from public.rounds where event_id = p_event and phase = p_phase order by number loop
    if r.status = 'CLEARED' or r.status = 'CLOSED' then
      v_cursor := coalesce(r.closed_at, r.closes_at);
    elsif r.status = 'OPEN' then
      v_cursor := r.opened_at + make_interval(secs => r.duration_seconds + r.paused_seconds + r.extended_seconds);
      update public.rounds set closes_at = v_cursor where id = r.id and closes_at is distinct from v_cursor;
    else
      update public.rounds
         set opens_at = v_cursor,
             closes_at = v_cursor + make_interval(secs => r.duration_seconds)
       where id = r.id and (opens_at is distinct from v_cursor or closes_at is distinct from v_cursor + make_interval(secs => r.duration_seconds));
      v_cursor := v_cursor + make_interval(secs => r.duration_seconds);
    end if;
  end loop;
  return v_cursor;
end
$$;

-- Recomputes every time that is still ahead from what actually happened and the durations. Phases and rounds that
-- have ended keep their times. A deadline whose step has happened is history; with p_all false a deadline that is
-- already due is also left alone (the tick is about to act on it).
create or replace function app.reproject(p_event uuid, p_all boolean default true)
returns void
language plpgsql
as $$
declare
  e public.events;
  ph public.phases;
  v_cur_seq smallint;
  v_cursor timestamptz := null;
  v_start timestamptz;
  v_end timestamptz;
  v_build public.phases;
  v_market public.phases;
  v_new jsonb;
  d public.deadlines;
  v_at timestamptz;
begin
  select * into e from public.events where id = p_event;
  select seq into v_cur_seq from public.phases where event_id = p_event and code = e.current_phase;
  for ph in select * from public.phases where event_id = p_event and seq >= v_cur_seq order by seq loop
    if ph.code = 'SETUP' then
      v_start := null;
      v_end := null;
    elsif ph.code = e.current_phase then
      v_start := ph.started_at;
    else
      v_start := v_cursor;
    end if;
    if ph.code = 'SETUP' then
      null;
    elsif ph.code in ('MARKET_BLIND', 'MARKET') then
      v_end := case when v_start is null then null else app.reproject_rounds(p_event, ph.code, v_start) end;
      if v_start is null then
        update public.rounds set opens_at = null, closes_at = null where event_id = p_event and phase = ph.code and status = 'SCHEDULED';
      end if;
    elsif ph.duration_seconds is null or v_start is null then
      v_end := null;
    else
      v_end := v_start + make_interval(secs => ph.duration_seconds + ph.paused_seconds + ph.extended_seconds);
    end if;
    update public.phases set starts_at = v_start, ends_at = v_end
     where id = ph.id and (starts_at is distinct from v_start or ends_at is distinct from v_end);
    v_cursor := v_end;
  end loop;

  select * into v_build from public.phases where event_id = p_event and code = 'BUILD';
  select * into v_market from public.phases where event_id = p_event and code = 'MARKET';
  v_new := jsonb_build_object(
    'PROBLEM_DRAW', v_build.starts_at,
    'TWIST', case when v_build.starts_at is null then null
                  else least(v_build.starts_at + make_interval(secs => e.twist_offset_seconds), coalesce(v_build.ends_at, 'infinity')) end,
    'PRD_LOCK', v_build.ends_at,
    'QA_CLOSE', (select ends_at from public.phases where event_id = p_event and code = 'CRISIS_QA'),
    'SOLUTION_LOCK', (select ends_at from public.phases where event_id = p_event and code = 'RESCUE'),
    'LEADERBOARD_FREEZE', case when v_market.starts_at is null then null
                  else least(v_market.starts_at + make_interval(secs => e.freeze_offset_seconds), coalesce(v_market.ends_at, 'infinity')) end,
    'MARKET_CLOSE', v_market.ends_at);
  for d in select * from public.deadlines where event_id = p_event loop
    continue when app.deadline_done(e, d.code);
    continue when not p_all and d.at is not null and d.at <= now();
    v_at := (v_new ->> d.code::text)::timestamptz;
    if d.at is distinct from v_at then
      update public.deadlines set at = v_at where id = d.id;
    end if;
  end loop;
end
$$;

-- Every time an organiser or a team sees, keyed and labelled, for the before/after preview of a change.
create or replace function app.timing_snapshot(p_event uuid)
returns jsonb
language sql stable
as $$
  select coalesce(jsonb_agg(x order by x ->> 'sort', x ->> 'key'), '[]'::jsonb) from (
    select jsonb_build_object('key', 'phase:' || p.code, 'kind', 'phase', 'label', initcap(replace(p.code::text, '_', ' ')) || ' ends',
                              'at', p.ends_at, 'sort', lpad(p.seq::text, 3, '0') || 'z') as x
      from public.phases p where p.event_id = p_event and p.ended_at is null and p.code <> 'SETUP'
    union all
    select jsonb_build_object('key', 'round:' || r.number, 'kind', 'round', 'label', 'Round ' || r.number || ' closes',
                              'at', r.closes_at, 'sort', lpad(p.seq::text, 3, '0') || 'r' || lpad(r.number::text, 2, '0'))
      from public.rounds r join public.phases p on p.event_id = r.event_id and p.code = r.phase
     where r.event_id = p_event and r.status in ('SCHEDULED', 'OPEN')
    union all
    select jsonb_build_object('key', 'deadline:' || d.code, 'kind', 'deadline',
                              'label', case d.code when 'PROBLEM_DRAW' then 'Problem cards dealt' when 'TWIST' then 'The twist'
                                          when 'PRD_LOCK' then 'PRD form locks' when 'QA_CLOSE' then 'Q&A questions close'
                                          when 'SOLUTION_LOCK' then 'Crisis solution form locks' when 'LEADERBOARD_FREEZE' then 'Leaderboard freezes'
                                          when 'MARKET_CLOSE' then 'Closing bell' end,
                              'at', d.at, 'sort', '999' || d.code)
      from public.deadlines d join public.events e on e.id = d.event_id
     where d.event_id = p_event and not app.deadline_done(e, d.code)
  ) s
$$;

-- What moved between two snapshots: [{key, kind, label, from, to, earlier}] (earlier: a time still ahead that is now
-- sooner, or an untimed item that now has a time, which is what needs a second confirmation).
create or replace function app.timing_diff(p_before jsonb, p_after jsonb)
returns jsonb
language sql stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', a ->> 'key', 'kind', a ->> 'kind', 'label', a ->> 'label', 'from', b -> 'at', 'to', a -> 'at',
           'earlier', (a ->> 'at') is not null
                      and ((b ->> 'at') is null or (a ->> 'at')::timestamptz < (b ->> 'at')::timestamptz))
         order by a ->> 'sort'), '[]'::jsonb)
    from jsonb_array_elements(p_after) a
    left join jsonb_array_elements(p_before) b on b ->> 'key' = a ->> 'key'
   where (a -> 'at') is distinct from (b -> 'at')
$$;

-- Records a timing change: bumps the version, keeps the change for screens that reconnect, writes the audit entry
-- and tells every screen (teams get the deadlines that moved).
create or replace function app.timing_changed(p_event uuid, p_action text, p_diff jsonb, p_detail jsonb default '{}'::jsonb)
returns integer
language plpgsql
as $$
declare
  v_version integer;
  v_actor record;
begin
  update public.events
     set timing_version = timing_version + 1,
         timing_changed_at = case when jsonb_array_length(coalesce(p_diff, '[]')) > 0 then now() else timing_changed_at end,
         timing_change = case when jsonb_array_length(coalesce(p_diff, '[]')) > 0
                              then jsonb_build_object('action', p_action, 'at', now(), 'changes', p_diff) else timing_change end
   where id = p_event
  returning timing_version into v_version;
  select * into v_actor from app.audit_actor();
  insert into public.audit_log (event_id, actor_user_id, actor_role, actor_team_id, action, entity, entity_id, before, after)
  values (p_event, v_actor.user_id, v_actor.role, v_actor.team_id, 'timing:' || p_action, 'events', p_event, null,
          jsonb_build_object('changes', p_diff, 'detail', p_detail, 'version', v_version));
  if jsonb_array_length(coalesce(p_diff, '[]')) > 0 then
    perform app.broadcast(p_event, 'timing', jsonb_build_object('action', p_action,
      'changes', (select coalesce(jsonb_agg(c), '[]'::jsonb) from jsonb_array_elements(p_diff) c where c ->> 'kind' in ('deadline', 'round', 'phase'))));
  end if;
  perform app.broadcast(p_event, 'settings', jsonb_build_object('timing_version', v_version), true);
  return v_version;
end
$$;

-- A stale page or a second console: the version the organiser saw is not the current one.
create or replace function app.check_timing_version(p_event public.events, p_expected integer)
returns jsonb
language sql stable
as $$
  select case when p_expected is not null and p_expected <> p_event.timing_version
    then app.fail('STALE', 'The timing was changed on another console. Review the new times and try again.',
                  jsonb_build_object('timing_version', p_event.timing_version)) end
$$;

-- ───────────────────────────── Advancing ─────────────────────────────

-- Leaves the phase p_from (which must still be the current one, so a tick and an organiser advancing at the same
-- moment cannot skip a phase) and enters the next one, running each transition's steps. The next phase starts now:
-- every later time follows from its duration.
create or replace function app.do_advance(p_event uuid, p_from public.phase_code)
returns jsonb
language plpgsql
as $$
declare
  v_event public.events;
  v_next public.phase_code;
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

  -- Leaving: a trading phase closes and clears all of its rounds (the open round's pending orders fill at its
  -- clearing price; a round that never opened records unchanged prices).
  for r in select id from public.rounds where event_id = p_event and phase = v_event.current_phase and status <> 'CLEARED' order by number loop
    perform app.clear_round(r.id, true);
  end loop;

  update public.phases set ended_at = now() where event_id = p_event and code = v_event.current_phase;
  update public.phases set started_at = now() where event_id = p_event and code = v_next;
  update public.events
     set current_phase = v_next, phase_started_at = now(),
         started_at = case when p_from = 'SETUP' then now() else started_at end
   where id = p_event;
  perform app.reproject(p_event);

  -- Entering.
  case v_next
    when 'JUDGING_1' then perform app.lock_submissions(p_event, 'PRD');
    when 'REVEAL_1' then perform app.reveal_prd(p_event);
    when 'CRISIS_QA' then perform app.apply_crisis(p_event);
    when 'RESCUE' then
      update public.deadlines set at = least(at, now()) where event_id = p_event and code = 'QA_CLOSE';
    when 'JUDGING_2' then perform app.lock_submissions(p_event, 'SOLUTION');
    when 'MARKET_BLIND' then perform app.publish_solutions(p_event);
    when 'MARKET' then perform app.reveal_solutions(p_event);
    when 'SETTLEMENT' then
      perform app.freeze_leaderboard(p_event);
      update public.deadlines set at = least(at, now()) where event_id = p_event and code = 'MARKET_CLOSE';
      perform app.close_market(p_event);
      perform app.settle(p_event);
    else null;
  end case;

  perform app.broadcast(p_event, 'phase', jsonb_build_object('phase', v_next, 'from', v_event.current_phase));
  return app.ok(jsonb_build_object('phase', v_next));
end
$$;

-- Organiser: end the current phase now and enter the next (named by the phase they see, so a double click or a
-- second console cannot skip a phase).
create or replace function public.advance_phase(p_event uuid, p_from public.phase_code)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_current public.phase_code;
  v_paused boolean;
  v_res jsonb;
begin
  perform app.require_organiser();
  select current_phase, paused into v_current, v_paused from public.events where id = p_event for no key update;
  if v_current is distinct from p_from then
    return app.fail('STALE', format('The event is already in %s.', v_current));
  end if;
  if v_paused then
    return app.fail('PAUSED', 'Resume the event before advancing.');
  end if;
  v_res := app.do_advance(p_event, p_from);
  if (v_res ->> 'ok')::boolean then
    perform app.timing_changed(p_event, case when p_from = 'SETUP' then 'start' else 'end_phase' end, '[]'::jsonb,
                               jsonb_build_object('from', p_from, 'to', v_res ->> 'phase'));
  end if;
  return v_res;
end
$$;

-- Organiser: start the night (only from Setup, once its gate is clear).
create or replace function public.start_event(p_event uuid, p_expected_version integer default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.current_phase <> 'SETUP' then
    return app.fail('ALREADY_STARTED', 'The event has already started.');
  end if;
  return coalesce(app.check_timing_version(v_event, p_expected_version), public.advance_phase(p_event, 'SETUP'));
end
$$;

-- Organiser: end the night (only from the awards). Nothing changes afterwards.
create or replace function public.end_event(p_event uuid, p_expected_version integer default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.ended_at is not null then
    return app.fail('ALREADY_ENDED', 'The event has already ended.');
  end if;
  if v_event.current_phase <> 'AWARDS' then
    return app.fail('NOT_YET', 'The event ends from the awards: finish the phases before it first.');
  end if;
  if app.check_timing_version(v_event, p_expected_version) is not null then
    return app.check_timing_version(v_event, p_expected_version);
  end if;
  update public.events set ended_at = now(), paused = false, paused_at = null where id = p_event;
  update public.phases set ended_at = now() where event_id = p_event and code = 'AWARDS';
  perform app.timing_changed(p_event, 'end_event', '[]'::jsonb);
  perform app.broadcast(p_event, 'ended');
  return app.ok();
end
$$;

-- ───────────────────────────── Pause, resume, extend ─────────────────────────────

create or replace function public.pause_event(p_event uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.current_phase = 'SETUP' or v_event.ended_at is not null then
    return app.fail('NOT_RUNNING', 'The event is not running.');
  end if;
  if v_event.paused then
    return app.fail('ALREADY_PAUSED', 'The event is already paused.');
  end if;
  update public.events set paused = true, paused_at = now() where id = p_event;
  perform app.timing_changed(p_event, 'pause', '[]'::jsonb);
  perform app.broadcast(p_event, 'paused');
  return app.ok();
end
$$;

-- Resume: the current phase and the open round get back exactly the time the pause took; every later time follows.
create or replace function public.resume_event(p_event uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_secs integer;
  v_before jsonb;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event for no key update;
  if not v_event.paused then
    return app.fail('NOT_PAUSED', 'The event is not paused.');
  end if;
  v_before := app.timing_snapshot(p_event);
  v_secs := ceil(extract(epoch from now() - v_event.paused_at))::int;
  update public.phases set paused_seconds = paused_seconds + v_secs where event_id = p_event and code = v_event.current_phase;
  update public.rounds set paused_seconds = paused_seconds + v_secs where event_id = p_event and status = 'OPEN';
  update public.events set paused = false, paused_at = null where id = p_event;
  perform app.reproject(p_event);
  perform app.timing_changed(p_event, 'resume', app.timing_diff(v_before, app.timing_snapshot(p_event)), jsonb_build_object('paused_seconds', v_secs));
  perform app.broadcast(p_event, 'resumed', jsonb_build_object('paused_for_seconds', v_secs));
  return app.ok(jsonb_build_object('paused_seconds', v_secs));
end
$$;

-- The changes an organiser can make to the timing, applied in place (the caller previews or commits them).
--   {"phases": {"BUILD": 6300, "AWARDS": null}, "rounds": {"3": 600}, "twist_offset_seconds": 3600,
--    "freeze_offset_seconds": 2700, "extend_seconds": 300}
-- extend_seconds lengthens what is running now: the open round in a trading phase, otherwise the current phase.
create or replace function app.apply_timing(p_event uuid, p_changes jsonb)
returns jsonb
language plpgsql
as $$
declare
  e public.events;
  k text;
  v jsonb;
  ph public.phases;
  r public.rounds;
  v_ref timestamptz;
  v_secs integer;
  v_open public.rounds;
  v_warnings text[] := '{}';
begin
  select * into e from public.events where id = p_event;
  if e.ended_at is not null then
    raise exception using errcode = 'P0001', message = 'timing:ENDED:The event has ended.';
  end if;
  v_ref := case when e.paused then e.paused_at else now() end;

  for k, v in select * from jsonb_each(coalesce(p_changes -> 'phases', '{}'::jsonb)) loop
    select * into ph from public.phases where event_id = p_event and code = k::public.phase_code;
    if ph.code in ('SETUP') then
      raise exception using errcode = 'P0001', message = 'timing:BAD_PHASE:Setup has no duration: the event starts when an organiser starts it.';
    end if;
    if ph.code in ('MARKET_BLIND', 'MARKET') then
      raise exception using errcode = 'P0001', message = format('timing:TRADING_PHASE:%s lasts as long as its trading rounds: change the rounds.', ph.code);
    end if;
    if ph.ended_at is not null then
      raise exception using errcode = 'P0001', message = format('timing:ENDED_PHASE:%s has already ended.', ph.code);
    end if;
    v_secs := case when jsonb_typeof(v) = 'null' then null else (v #>> '{}')::int end;
    if v_secs is not null and (v_secs < 30 or v_secs > 43200) then
      raise exception using errcode = 'P0001', message = 'timing:BAD_DURATION:A phase lasts from 30 seconds to 12 hours (or is untimed).';
    end if;
    if ph.code = e.current_phase and v_secs is not null
       and ph.started_at + make_interval(secs => v_secs + ph.paused_seconds + ph.extended_seconds) <= v_ref + interval '30 seconds' then
      raise exception using errcode = 'P0001', message = format('timing:TOO_SHORT:%s has already run longer than that: use End phase to end it now.', ph.code);
    end if;
    update public.phases set duration_seconds = v_secs where id = ph.id;
  end loop;

  for k, v in select * from jsonb_each(coalesce(p_changes -> 'rounds', '{}'::jsonb)) loop
    select * into r from public.rounds where event_id = p_event and number = k::int;
    if r.id is null then
      raise exception using errcode = 'P0001', message = format('timing:BAD_ROUND:There is no round %s.', k);
    end if;
    if r.status in ('CLOSED', 'CLEARED') then
      raise exception using errcode = 'P0001', message = format('timing:ENDED_ROUND:Round %s has already closed.', r.number);
    end if;
    v_secs := (v #>> '{}')::int;
    if v_secs is null or v_secs < 30 or v_secs > 7200 then
      raise exception using errcode = 'P0001', message = 'timing:BAD_DURATION:A round lasts from 30 seconds to 2 hours.';
    end if;
    if r.status = 'OPEN' and r.opened_at + make_interval(secs => v_secs + r.paused_seconds + r.extended_seconds) <= v_ref + interval '30 seconds' then
      raise exception using errcode = 'P0001', message = format('timing:TOO_SHORT:Round %s has already run longer than that: use Close round now.', r.number);
    end if;
    update public.rounds set duration_seconds = v_secs where id = r.id;
  end loop;

  if p_changes ? 'twist_offset_seconds' then
    if e.twist_published_at is not null then
      raise exception using errcode = 'P0001', message = 'timing:DONE:The twist has already been published.';
    end if;
    update public.events set twist_offset_seconds = greatest(0, (p_changes ->> 'twist_offset_seconds')::int) where id = p_event;
  end if;
  if p_changes ? 'freeze_offset_seconds' then
    if e.leaderboard_frozen_at is not null then
      raise exception using errcode = 'P0001', message = 'timing:DONE:The leaderboard has already frozen.';
    end if;
    update public.events set freeze_offset_seconds = greatest(0, (p_changes ->> 'freeze_offset_seconds')::int) where id = p_event;
  end if;

  if p_changes ? 'extend_seconds' then
    v_secs := (p_changes ->> 'extend_seconds')::int;
    if v_secs is null or v_secs < 30 or v_secs > 7200 then
      raise exception using errcode = 'P0001', message = 'timing:BAD_DURATION:Extend by 30 seconds to 2 hours.';
    end if;
    if e.current_phase = 'SETUP' then
      raise exception using errcode = 'P0001', message = 'timing:NOT_RUNNING:The event has not started.';
    end if;
    select * into v_open from public.rounds where event_id = p_event and status = 'OPEN' order by number limit 1;
    if v_open.id is not null then
      update public.rounds set extended_seconds = extended_seconds + v_secs where id = v_open.id;
    elsif e.current_phase in ('MARKET_BLIND', 'MARKET') then
      raise exception using errcode = 'P0001', message = 'timing:NO_ROUND:No round is open: the phase waits for you to end it.';
    else
      select * into ph from public.phases where event_id = p_event and code = e.current_phase;
      if ph.duration_seconds is null then
        raise exception using errcode = 'P0001', message = 'timing:UNTIMED:This phase is untimed: it stays open until you end it.';
      end if;
      update public.phases set extended_seconds = extended_seconds + v_secs where id = ph.id;
    end if;
  end if;

  perform app.reproject(p_event);
  -- What a change cannot undo, said plainly in the preview.
  select * into e from public.events where id = p_event;
  if e.prds_locked_at is not null and e.current_phase = 'BUILD' then
    v_warnings := v_warnings || 'The PRD form has already locked: a longer Build only delays the next phase.'::text;
  end if;
  if e.solutions_locked_at is not null and e.current_phase = 'RESCUE' then
    v_warnings := v_warnings || 'The crisis solution form has already locked: a longer Rescue only delays the next phase.'::text;
  end if;
  return jsonb_build_object('warnings', to_jsonb(v_warnings));
end
$$;

-- Organiser: preview or apply a timing change. p_mode 'preview' always rolls back and returns what would move.
-- 'apply' commits it, unless it brings something earlier (a deadline, a round's close, a phase's end) and p_confirm
-- is false: then it rolls back and returns CONFIRM with the preview.
create or replace function app.timing_change(p_event uuid, p_expected_version integer, p_changes jsonb, p_mode text, p_confirm boolean, p_action text)
returns jsonb
language plpgsql
as $$
declare
  v_event public.events;
  v_before jsonb;
  v_diff jsonb;
  v_res jsonb;
  v_earlier boolean;
  v_stale jsonb;
  v_version integer;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.id is null then
    raise exception 'no such event';
  end if;
  v_stale := app.check_timing_version(v_event, p_expected_version);
  if v_stale is not null then
    return v_stale;
  end if;
  v_before := app.timing_snapshot(p_event);
  begin
    v_res := app.apply_timing(p_event, p_changes);
    v_diff := app.timing_diff(v_before, app.timing_snapshot(p_event));
    v_earlier := exists (select 1 from jsonb_array_elements(v_diff) c where (c ->> 'earlier')::boolean);
    if p_mode = 'preview' or (v_earlier and not p_confirm) then
      raise exception using errcode = 'P0001', message = 'timing:ROLLBACK:';
    end if;
  exception when sqlstate 'P0001' then
    if sqlerrm like 'timing:ROLLBACK:%' then
      return app.ok(jsonb_build_object('preview', true, 'changes', v_diff, 'shortens', v_earlier,
                                       'warnings', v_res -> 'warnings', 'timing_version', v_event.timing_version))
             || case when p_mode = 'apply' then jsonb_build_object('ok', false, 'code', 'CONFIRM',
                       'message', 'This brings a deadline earlier. Check the new times and confirm.') else '{}'::jsonb end;
    elsif sqlerrm like 'timing:%' then
      return app.fail(split_part(sqlerrm, ':', 2), substr(sqlerrm, length('timing:' || split_part(sqlerrm, ':', 2) || ':') + 1));
    else
      raise;
    end if;
  end;
  v_version := app.timing_changed(p_event, p_action, v_diff, p_changes);
  return app.ok(jsonb_build_object('changes', v_diff, 'shortens', v_earlier, 'warnings', v_res -> 'warnings', 'timing_version', v_version));
end
$$;

create or replace function public.preview_timing(p_event uuid, p_changes jsonb)
returns jsonb
language sql security definer set search_path = ''
as $$
  select app.timing_change(p_event, null, p_changes, 'preview', false, 'preview')
$$;

create or replace function public.set_timing(p_event uuid, p_expected_version integer, p_changes jsonb, p_confirm boolean default false)
returns jsonb
language sql security definer set search_path = ''
as $$
  select app.timing_change(p_event, p_expected_version, p_changes, 'apply', p_confirm, 'set_timing')
$$;

-- Extend what is running now (the open round, or the current phase) by N minutes. Never earlier, so no confirmation.
drop function public.extend_event(uuid, integer);
create or replace function public.extend_event(p_event uuid, p_minutes integer, p_expected_version integer default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_res jsonb;
begin
  if p_minutes is null or p_minutes < 1 or p_minutes > 120 then
    return app.fail('BAD_DURATION', 'Extend by 1 to 120 minutes.');
  end if;
  v_res := app.timing_change(p_event, p_expected_version, jsonb_build_object('extend_seconds', p_minutes * 60), 'apply', true, 'extend');
  if (v_res ->> 'ok')::boolean then
    perform app.broadcast(p_event, 'extended', jsonb_build_object('minutes', p_minutes));
  end if;
  return v_res;
end
$$;

-- What ending the current phase now would do, without doing it: the next phase, what holds it, and every time that
-- would move (computed by actually advancing and rolling back).
create or replace function public.preview_advance(p_event uuid, p_from public.phase_code)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_before jsonb;
  v_diff jsonb;
  v_res jsonb;
  v_pending integer;
  v_open integer;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event;
  if v_event.current_phase is distinct from p_from then
    return app.fail('STALE', format('The event is already in %s.', v_event.current_phase));
  end if;
  select r.number, (select count(*) from public.orders o where o.round_id = r.id and o.status = 'PENDING')
    into v_open, v_pending
    from public.rounds r where r.event_id = p_event and r.status = 'OPEN' and r.phase = p_from order by r.number limit 1;
  v_before := app.timing_snapshot(p_event);
  begin
    v_res := app.do_advance(p_event, p_from);
    v_diff := app.timing_diff(v_before, app.timing_snapshot(p_event));
    raise exception using errcode = 'P0001', message = 'timing:ROLLBACK:';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'timing:ROLLBACK:%' then
      raise;
    end if;
  end;
  return app.ok(jsonb_build_object(
    'from', p_from, 'next', app.phase_after(p_from), 'gate', app.gate_blocker(p_event), 'paused', v_event.paused,
    'can_advance', coalesce((v_res ->> 'ok')::boolean, false) and not v_event.paused,
    'refusal', case when (v_res ->> 'ok')::boolean then null else v_res ->> 'message' end,
    'open_round', v_open, 'pending_orders', coalesce(v_pending, 0),
    'changes', coalesce(v_diff, '[]'::jsonb)));
end
$$;

-- ───────────────────────────── Closing a round early ─────────────────────────────

-- "Close round N now" names the round the organiser saw (a stale page or a second console never closes the next one).
-- CLEAR (the default): the round clears now; every pending order fills at the clearing price, as at its planned close.
-- CANCEL: every pending order is cancelled (nothing is bought or sold) and the round clears as if none had been placed.
-- The rounds after it start from the actual close.
drop function public.close_round_now(uuid, integer);
create or replace function public.close_round_now(p_event uuid, p_round integer default null, p_mode text default 'CLEAR')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_round public.rounds;
  v_before jsonb;
  v_res jsonb;
  v_cancelled integer := 0;
begin
  perform app.require_organiser();
  if p_mode not in ('CLEAR', 'CANCEL') then
    return app.fail('BAD_MODE', 'Close and clear, or close and cancel.');
  end if;
  perform 1 from public.events where id = p_event for no key update;
  select * into v_round from public.rounds where event_id = p_event and status = 'OPEN' order by number limit 1;
  if v_round.id is null then
    return app.fail('NO_OPEN_ROUND', case when p_round is null then 'No round is open.'
      else format('Round %s is no longer open; nothing was closed.', p_round) end);
  end if;
  if p_round is not null and v_round.number <> p_round then
    return app.fail('ROUND_CHANGED', format(
      'Round %s is no longer open (round %s is); nothing was closed. Check the page and try again.', p_round, v_round.number));
  end if;
  v_before := app.timing_snapshot(p_event);
  if p_mode = 'CANCEL' then
    update public.orders set status = 'CANCELLED', cancelled_at = now(), updated_at = now() where round_id = v_round.id and status = 'PENDING';
    get diagnostics v_cancelled = row_count;
  end if;
  v_res := app.clear_round(v_round.id, true);
  perform app.reproject(p_event);
  perform app.timing_changed(p_event, 'close_round', app.timing_diff(v_before, app.timing_snapshot(p_event)),
                             jsonb_build_object('round', v_round.number, 'mode', p_mode, 'cancelled', v_cancelled));
  return v_res || jsonb_build_object('mode', p_mode, 'cancelled', v_cancelled);
end
$$;

-- ───────────────────────────── The heartbeat ─────────────────────────────

-- Every 2 seconds (pg_cron; an open control panel calls it too). Idempotent: clears a round whose time is up and opens
-- the next (back to back; a late opening starts its full duration from now), publishes the twist, locks the PRDs and
-- the solutions, freezes the leaderboard, and with "Advance when timer expires" moves to the next phase when the
-- current one's time is up. An untimed phase never ends by itself. Nothing happens while paused, in Setup, or after
-- the event has ended.
create or replace function public.tick(p_event uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_phase public.phases;
  r public.rounds;
  v_actions text[] := '{}';
  v_res jsonb;
begin
  perform app.require_organiser();
  if not pg_try_advisory_xact_lock(hashtext('tick:' || p_event::text)) then
    return app.ok(jsonb_build_object('skipped', true));
  end if;
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.id is null or v_event.paused or v_event.current_phase = 'SETUP' or v_event.ended_at is not null then
    return app.ok(jsonb_build_object('paused', coalesce(v_event.paused, false)));
  end if;

  for r in select * from public.rounds where event_id = p_event and phase = v_event.current_phase order by number loop
    if r.status = 'OPEN' and r.closes_at is not null and now() >= r.closes_at then
      perform app.clear_round(r.id);
      v_actions := v_actions || ('cleared ' || r.number);
    elsif r.status = 'SCHEDULED' and r.opens_at is not null and now() >= r.opens_at then
      exit when exists (select 1 from public.rounds p where p.event_id = p_event and p.number < r.number and p.status <> 'CLEARED');
      update public.rounds set status = 'OPEN', opened_at = now() where id = r.id and status = 'SCHEDULED';
      exit when not found;
      perform app.reproject(p_event, false);
      select * into r from public.rounds where id = r.id;
      perform app.broadcast(p_event, 'round_open', jsonb_build_object('round', r.number, 'closes_at', r.closes_at));
      v_actions := v_actions || ('opened ' || r.number);
      exit;
    end if;
  end loop;

  if v_event.drawn_at is not null and v_event.twist_published_at is null and app.deadline_passed(p_event, 'TWIST') then
    perform app.publish_twist(p_event);
    v_actions := v_actions || 'twist'::text;
  end if;
  if v_event.drawn_at is not null and v_event.prds_locked_at is null and app.deadline_passed(p_event, 'PRD_LOCK') then
    perform app.lock_submissions(p_event, 'PRD');
    v_actions := v_actions || 'PRDs locked'::text;
  end if;
  if v_event.crisis_applied_at is not null and v_event.solutions_locked_at is null and app.deadline_passed(p_event, 'SOLUTION_LOCK') then
    perform app.lock_submissions(p_event, 'SOLUTION');
    v_actions := v_actions || 'solutions locked'::text;
  end if;
  if v_event.leaderboard_frozen_at is null and v_event.current_phase >= 'MARKET_BLIND'
     and app.deadline_passed(p_event, 'LEADERBOARD_FREEZE') then
    perform app.freeze_leaderboard(p_event);
    v_actions := v_actions || 'leaderboard frozen'::text;
  end if;

  if v_event.auto_advance then
    select * into v_phase from public.phases where event_id = p_event and code = v_event.current_phase;
    if v_phase.ends_at is not null and now() >= v_phase.ends_at
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

-- "Advance when timer expires" or "Manual advance". Turning it on when the current phase's time is already up advances
-- at once, so it asks first.
create or replace function public.set_auto_advance(p_event uuid, p_on boolean, p_advance_now boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.id is null then
    raise exception 'no such event';
  end if;
  if p_on and not v_event.auto_advance and not p_advance_now
     and exists (select 1 from public.phases where event_id = p_event and code = v_event.current_phase and ends_at <= now())
     and app.phase_after(v_event.current_phase) is not null then
    return app.fail('OVERDUE', 'The time of this phase is already up: with "Advance when timer expires" on, the event advances at once. Confirm to go ahead.');
  end if;
  if v_event.auto_advance is distinct from p_on then
    update public.events set auto_advance = p_on where id = p_event;
    perform app.timing_changed(p_event, case when p_on then 'mode_auto' else 'mode_manual' end, '[]'::jsonb);
  end if;
  return app.ok(jsonb_build_object('auto_advance', p_on));
end
$$;

-- ───────────────────────────── Where the night is ─────────────────────────────

create or replace function public.event_status(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_phase public.phases;
  v_open public.rounds;
  v_next public.rounds;
  v_deadline public.deadlines;
  v_last public.phases;
  v_untimed public.phases;
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
  select * into v_deadline from public.deadlines
   where event_id = p_event and at > case when v_event.paused then v_event.paused_at else now() end and code <> 'PROBLEM_DRAW'
   order by at limit 1;
  -- The projected end of the night: the end of the awards, or of the last phase before the first untimed one.
  select * into v_untimed from public.phases
   where event_id = p_event and ended_at is null and code not in ('SETUP') and starts_at is not null and ends_at is null order by seq limit 1;
  select * into v_last from public.phases where event_id = p_event and code = 'AWARDS';
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
    'phase_untimed', v_phase.duration_seconds is null and v_event.current_phase not in ('MARKET_BLIND', 'MARKET', 'SETUP'),
    'phase_paused_seconds', coalesce(v_phase.paused_seconds, 0),
    'open_round', case when v_open.id is null then null else jsonb_build_object('number', v_open.number, 'closes_at', v_open.closes_at) end,
    'next_round', case when v_next.id is null then null else jsonb_build_object('number', v_next.number, 'opens_at', v_next.opens_at) end,
    'next_deadline', case when v_deadline.id is null then null else jsonb_build_object('code', v_deadline.code, 'at', v_deadline.at) end,
    'drawn', v_event.drawn_at is not null,
    'leaderboard_frozen', v_event.leaderboard_frozen_at is not null,
    'started_at', v_event.started_at,
    'ended_at', v_event.ended_at,
    'event_ends_at', case when v_last.ends_at is not null then v_last.ends_at end,
    'event_ends_after', case when v_last.ends_at is null then coalesce(v_untimed.code, v_last.code) end,
    'timing_version', v_event.timing_version,
    'timing_changed_at', v_event.timing_changed_at,
    'timing_change', v_event.timing_change,
    'server_time', now());
end
$$;

-- The heartbeat ticks running events only (an event starts when an organiser starts it and ends when one ends it).
create or replace function app.tick_all()
returns integer
language plpgsql
as $$
declare
  v_id uuid;
  n int := 0;
begin
  perform set_config('lock_timeout', '3s', true);
  for v_id in select id from public.events where current_phase between 'CHECKIN' and 'AWARDS' and ended_at is null and not paused order by id loop
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

drop function if exists app.shift_schedule(uuid, timestamptz, interval, boolean);

-- ───────────────────────────── Seeding: durations, not clock times ─────────────────────────────

create or replace function public.seed_event(p jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_e jsonb := p -> 'event';
  v_event uuid;
  v_rehearsal boolean := coalesce((v_e ->> 'is_rehearsal')::boolean, false);
  v_team jsonb;
  v_staff jsonb;
  v_team_id uuid;
  v_n int;
  v_start bigint := coalesce((p ->> 'starting_cash_cents')::bigint, 0);
  v_txn uuid;
begin
  perform set_config('app.actor', 'seed', true);

  v_n := jsonb_array_length(coalesce(p -> 'teams', '[]'));
  if v_n not between 3 and 150 then
    raise exception 'between 3 and 150 teams are needed (got %)', v_n;
  end if;
  if not v_rehearsal and v_n <> 150 then
    raise exception 'the live event needs exactly 150 teams (got %)', v_n;
  end if;
  if v_start < 0 then
    raise exception 'starting cash cannot be negative';
  end if;

  insert into public.events (slug, name, is_rehearsal, clock_speed, timezone, starts_at, seed_commitment)
  values (
    v_e ->> 'slug',
    v_e ->> 'name',
    v_rehearsal,
    coalesce((v_e ->> 'clock_speed')::int, 1),
    coalesce(v_e ->> 'timezone', 'Asia/Kolkata'),
    (v_e ->> 'starts_at')::timestamptz,
    nullif(v_e ->> 'seed_commitment', '')
  )
  returning id into v_event;

  -- The night's timing is organiser-controlled: durations (null = untimed), not clock times. Nothing has a time until
  -- an organiser starts the event; then every time is projected from the actual starts (app.reproject).
  update public.events
     set twist_offset_seconds = coalesce((p -> 'schedule' ->> 'twist_offset_seconds')::int, twist_offset_seconds),
         freeze_offset_seconds = coalesce((p -> 'schedule' ->> 'freeze_offset_seconds')::int, freeze_offset_seconds)
   where id = v_event;

  insert into public.phases (event_id, seq, code, duration_seconds)
  select v_event, (x ->> 'seq')::smallint, (x ->> 'code')::public.phase_code, (x ->> 'duration_seconds')::int
    from jsonb_array_elements(p -> 'schedule' -> 'phases') x;

  insert into public.rounds (event_id, number, phase, duration_seconds)
  select v_event, (x ->> 'number')::smallint, (x ->> 'phase')::public.phase_code, (x ->> 'duration_seconds')::int
    from jsonb_array_elements(p -> 'schedule' -> 'rounds') x;

  insert into public.deadlines (event_id, code)
  select v_event, c from unnest(enum_range(null::public.deadline_code)) c;

  for v_team in select * from jsonb_array_elements(p -> 'teams') loop
    insert into public.teams (event_id, code, name)
    values (v_event, v_team ->> 'code', v_team ->> 'name')
    returning id into v_team_id;

    insert into public.accounts (user_id, role, team_id, display_name)
    values ((v_team ->> 'user_id')::uuid, 'TEAM', v_team_id, v_team ->> 'code');

    insert into public.members (event_id, team_id, full_name, roll_number)
    select v_event, v_team_id, m ->> 'full_name', nullif(m ->> 'roll_number', '')
      from jsonb_array_elements(coalesce(v_team -> 'members', '[]')) m;

    -- Every team founds one company (Round 1).
    insert into public.companies (event_id, founder_team_id) values (v_event, v_team_id);

    -- Every team starts Round 3 with the same virtual cash, paid by the exchange.
    if v_start <> 0 then
      v_txn := gen_random_uuid();
      insert into public.ledger_entries (event_id, txn_id, kind, team_id, cash_delta_cents, memo)
      values (v_event, v_txn, 'START_CASH', v_team_id, v_start, 'Starting cash'),
             (v_event, v_txn, 'START_CASH', null, -v_start, 'Starting cash');
      update public.teams set cash_cents = cash_cents + v_start where id = v_team_id;
      update public.events set exchange_cash_cents = exchange_cash_cents - v_start where id = v_event;
    end if;
  end loop;

  -- Staff accounts are global (they also run the rehearsal event).
  for v_staff in select * from jsonb_array_elements(coalesce(p -> 'staff', '[]')) loop
    if (v_staff ->> 'role') not in ('ORGANISER', 'FAIRNESS', 'DISPLAY') then
      raise exception 'staff role must be ORGANISER, FAIRNESS or DISPLAY (got %)', v_staff ->> 'role';
    end if;
    if exists (select 1 from public.accounts a
               where a.user_id = (v_staff ->> 'user_id')::uuid and a.role = 'TEAM') then
      raise exception 'staff account % is already a team login', v_staff ->> 'display_name';
    end if;
    insert into public.accounts (user_id, role, display_name, roll_number)
    values ((v_staff ->> 'user_id')::uuid, (v_staff ->> 'role')::public.account_role,
            v_staff ->> 'display_name', nullif(v_staff ->> 'roll_number', ''))
    on conflict (user_id) do update
      set role = excluded.role, display_name = excluded.display_name, roll_number = excluded.roll_number;
  end loop;

  insert into public.problem_cards (event_id, number, sector, title, body)
  select v_event, (x ->> 'number')::smallint, x ->> 'sector', x ->> 'title', x ->> 'body'
    from jsonb_array_elements(coalesce(p -> 'problem_cards', '[]')) x;

  insert into public.crisis_cards (event_id, number, category, title, body)
  select v_event, (x ->> 'number')::smallint, x ->> 'category', x ->> 'title', x ->> 'body'
    from jsonb_array_elements(coalesce(p -> 'crisis_cards', '[]')) x;

  -- The twist is prepared before the night and published at 22:15 (a draft until then).
  if nullif(p -> 'twist' ->> 'title', '') is not null then
    insert into public.bulletins (event_id, kind, title, body)
    values (v_event, 'TWIST', p -> 'twist' ->> 'title', coalesce(p -> 'twist' ->> 'body', ''));
  end if;

  return v_event;
end
$$;
-- ───────────────────────────── Grants ─────────────────────────────

do $$
declare f text;
begin
  foreach f in array array[
    'public.start_event(uuid, integer)', 'public.end_event(uuid, integer)',
    'public.preview_timing(uuid, jsonb)', 'public.set_timing(uuid, integer, jsonb, boolean)',
    'public.extend_event(uuid, integer, integer)', 'public.preview_advance(uuid, public.phase_code)',
    'public.close_round_now(uuid, integer, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- Internal functions stay internal: only the RLS helpers are callable by signed-in users.
revoke all on all functions in schema app from public, anon, authenticated, service_role;
grant execute on function
  app.my_role(),
  app.my_team_id(),
  app.my_event_id(),
  app.my_company_id(),
  app.my_rescue_company_id(),
  app.is_staff(),
  app.is_organiser(),
  app.is_fairness(),
  app.sees_all_events(),
  app.in_my_event(uuid),
  app.phase_reached(uuid, public.phase_code),
  app.can_hear(text)
to authenticated;
