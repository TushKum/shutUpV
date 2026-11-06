-- Phase 3 (control panel): content upload (problem deck, crisis deck) and the Setup gate on it, the server clock and
-- every screen's status line, client heartbeats for the health view and a health summary, broadcasts that keep every
-- console current, auto-advance with a confirmation when the phase is overdue, and "close round N now".

-- ───────────────────────────── Content ─────────────────────────────

-- Replaces the problem deck. Cards: [{number, sector?, title, body}]. Only before the draw, and with at least
-- ⌈teams ÷ 3⌉ cards (each card goes to at most 3 teams).
create or replace function public.upload_problem_deck(p_event uuid, p_cards jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_need int;
  v_n int;
  c jsonb;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.id is null then
    raise exception 'no such event';
  end if;
  if v_event.drawn_at is not null then
    return app.fail('TOO_LATE', 'The problem deck is fixed once the lottery has been drawn.');
  end if;
  if jsonb_typeof(p_cards) is distinct from 'array' then
    return app.fail('BAD_DECK', 'The deck is a list of cards.');
  end if;
  v_n := jsonb_array_length(p_cards);
  select (count(*) + 2) / 3 into v_need from public.teams where event_id = p_event;
  if v_n < v_need or v_n > 999 then
    return app.fail('BAD_DECK', format('The deck needs at least %s cards (each card goes to at most 3 teams) and at most 999.', v_need));
  end if;
  for c in select * from jsonb_array_elements(p_cards) loop
    if jsonb_typeof(c) <> 'object'
       or jsonb_typeof(c -> 'number') is distinct from 'number' or (c ->> 'number')::numeric <> trunc((c ->> 'number')::numeric)
       or (c ->> 'number')::numeric not between 1 and 999
       or coalesce(btrim(c ->> 'title'), '') = '' or coalesce(btrim(c ->> 'body'), '') = ''
       or length(c ->> 'title') > 200 or length(c ->> 'body') > 4000 or length(coalesce(c ->> 'sector', '')) > 100 then
      return app.fail('BAD_DECK', format('Card %s needs a number from 1 to 999, a title and a body.', coalesce(c ->> 'number', '?')));
    end if;
  end loop;
  if (select count(distinct (x ->> 'number')::numeric::int) from jsonb_array_elements(p_cards) x) <> v_n then
    return app.fail('BAD_DECK', 'Card numbers must be unique.');
  end if;
  delete from public.problem_cards where event_id = p_event;
  insert into public.problem_cards (event_id, number, sector, title, body)
  select p_event, (x ->> 'number')::numeric::int, btrim(coalesce(x ->> 'sector', '')), btrim(x ->> 'title'), btrim(x ->> 'body')
    from jsonb_array_elements(p_cards) x;
  perform app.broadcast(p_event, 'content', '{}'::jsonb, true);
  return app.ok(jsonb_build_object('cards', v_n));
end
$$;

-- Replaces the crisis deck. Cards: [{number, category, title, body}], one card per crisis type (the guide has 10).
-- Only before the draw: organisers know the seed from the draw on, and with it which card each company gets, so a deck
-- changed after the draw could steer a chosen crisis to a chosen company and still verify.
create or replace function public.upload_crisis_deck(p_event uuid, p_cards jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_n int;
  c jsonb;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.id is null then
    raise exception 'no such event';
  end if;
  if v_event.drawn_at is not null then
    return app.fail('TOO_LATE', 'The crisis deck is fixed once the lottery has been drawn.');
  end if;
  if jsonb_typeof(p_cards) is distinct from 'array' then
    return app.fail('BAD_DECK', 'The deck is a list of cards.');
  end if;
  v_n := jsonb_array_length(p_cards);
  if v_n < 1 or v_n > 99 then
    return app.fail('BAD_DECK', 'The crisis deck needs 1 to 99 cards (one per crisis type).');
  end if;
  for c in select * from jsonb_array_elements(p_cards) loop
    if jsonb_typeof(c) <> 'object'
       or jsonb_typeof(c -> 'number') is distinct from 'number' or (c ->> 'number')::numeric <> trunc((c ->> 'number')::numeric)
       or (c ->> 'number')::numeric not between 1 and 99
       or coalesce(btrim(c ->> 'category'), '') = '' or coalesce(btrim(c ->> 'title'), '') = '' or coalesce(btrim(c ->> 'body'), '') = ''
       or length(c ->> 'title') > 200 or length(c ->> 'body') > 4000 or length(c ->> 'category') > 100 then
      return app.fail('BAD_DECK', format('Card %s needs a number from 1 to 99, a type, a title and a body.', coalesce(c ->> 'number', '?')));
    end if;
  end loop;
  if (select count(distinct (x ->> 'number')::numeric::int) from jsonb_array_elements(p_cards) x) <> v_n then
    return app.fail('BAD_DECK', 'Card numbers must be unique.');
  end if;
  delete from public.crisis_cards where event_id = p_event;
  insert into public.crisis_cards (event_id, number, category, title, body)
  select p_event, (x ->> 'number')::numeric::int, btrim(x ->> 'category'), btrim(x ->> 'title'), btrim(x ->> 'body')
    from jsonb_array_elements(p_cards) x;
  perform app.broadcast(p_event, 'content', '{}'::jsonb, true);
  return app.ok(jsonb_build_object('cards', v_n));
end
$$;

-- ───────────────────────────── The Setup gate ─────────────────────────────

-- Why the current phase cannot end yet (NULL when it can). The event starts only with the commitment published, both
-- decks uploaded and the twist written: the decks lock at the draw and the twist goes out at 22:15.
create or replace function app.gate_blocker(p_event uuid)
returns text
language sql stable
as $$
  select case e.current_phase
    when 'SETUP' then case
      when e.seed_commitment is null then 'Publish the seed commitment before the event starts.'
      when (select count(*) from public.problem_cards p where p.event_id = e.id)
           < (select (count(*) + 2) / 3 from public.teams t where t.event_id = e.id)
        then format('Upload a problem deck of at least %s cards before the event starts.',
                    (select (count(*) + 2) / 3 from public.teams t where t.event_id = e.id))
      when not exists (select 1 from public.crisis_cards c where c.event_id = e.id) then 'Upload the crisis deck before the event starts.'
      when not exists (select 1 from public.bulletins b where b.event_id = e.id and b.kind = 'TWIST')
        then 'Write the twist (Bulletins) before the event starts.'
    end
    when 'BRIEFING' then case when e.drawn_at is null then 'Run the lottery (seed and dice) to deal the problem cards.' end
    when 'JUDGING_1' then case when not app.all_sealed(e.id, 'PRD') then 'Some PRD scores are not sealed yet.' end
    when 'MARKET_BLIND' then case when not app.all_sealed(e.id, 'SOLUTION')
                                  then 'Some crisis-solution scores are not sealed yet (needed for the 02:45 reveal).' end
    when 'SETTLEMENT' then case when exists (select 1 from public.flags f where f.event_id = e.id and f.status = 'OPEN')
                                then 'Collusion flags are still open for the fairness officer.' end
    when 'AWARDS' then 'The event has ended.'
  end
  from public.events e where e.id = p_event
$$;

-- ───────────────────────────── Clock and status ─────────────────────────────

-- The server clock, so every screen counts down against the clock that decides deadlines.
create or replace function public.server_time()
returns timestamptz
language sql stable security definer set search_path = ''
as $$
  select now()
$$;

-- Where the event is, for every screen's header: the phase and the next one, what holds the advance (the gate),
-- trading state, the open (or next) round, the phase's planned end, the next deadline and the server clock. While
-- paused, the round that was open when the pause began is still reported (its close moves later on resume). Anyone who
-- can see the event may read it.
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
    'next_deadline', case when v_deadline.id is null then null else jsonb_build_object('code', v_deadline.code, 'at', v_deadline.at) end,
    'drawn', v_event.drawn_at is not null,
    'leaderboard_frozen', v_event.leaderboard_frozen_at is not null,
    'server_time', now());
end
$$;

-- ───────────────────────────── Health ─────────────────────────────

-- A screen's heartbeat (every 20 seconds): which account, which area, whether its realtime channel is connected.
create or replace function public.ping(p_client uuid, p_event uuid, p_area text, p_realtime text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_account public.accounts;
  v_event uuid;
begin
  select * into v_account from public.accounts where user_id = auth.uid();
  if v_account.user_id is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  -- One account's pings one after another: two tabs pinging at once would otherwise each delete the other's row.
  perform pg_advisory_xact_lock(hashtext('ping:' || auth.uid()::text));
  -- A team pings for its own event; staff and the display for the event they are looking at.
  v_event := case when v_account.team_id is not null then (select event_id from public.teams where id = v_account.team_id)
                  else (select id from public.events where id = p_event) end;
  if p_area not in ('team', 'admin', 'display')
     or p_realtime not in ('SUBSCRIBED', 'CONNECTING', 'CLOSED', 'CHANNEL_ERROR', 'TIMED_OUT') then
    raise exception 'bad ping';
  end if;
  insert into public.client_pings (client_id, event_id, user_id, role, team_id, area, realtime)
  values (p_client, v_event, auth.uid(), v_account.role, v_account.team_id, p_area, p_realtime)
  on conflict (client_id) do update
    set event_id = excluded.event_id, area = excluded.area, realtime = excluded.realtime, last_seen = now()
  where public.client_pings.user_id = auth.uid();
  -- An account keeps its 10 most recent screens, so made-up client ids cannot grow the table.
  delete from public.client_pings
   where user_id = auth.uid()
     and client_id in (select client_id from public.client_pings where user_id = auth.uid() order by last_seen desc offset 10);
  return jsonb_build_object('ok', true, 'server_time', now());
end
$$;

-- Health of the backend for the control panel: the heartbeat's last runs (pg_cron), recent tick errors, the judge
-- queue and the connected screens. Staff only.
create or replace function public.admin_health(p_event uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_cron jsonb := null;
begin
  if not app.is_staff() then
    raise exception 'only staff can read the health view' using errcode = '42501';
  end if;
  if to_regclass('cron.job_run_details') is not null then
    execute $q$
      select jsonb_build_object(
        'last_start', max(d.start_time), 'last_end', max(d.end_time),
        'failed_last_10min', count(*) filter (where d.status = 'failed' and d.start_time > now() - interval '10 minutes'),
        'runs_last_10min', count(*) filter (where d.start_time > now() - interval '10 minutes'),
        'last_error', (select d2.return_message from cron.job_run_details d2 join cron.job j2 on j2.jobid = d2.jobid
                        where j2.jobname = 'primus-tick' and d2.status = 'failed' order by d2.start_time desc limit 1))
        from cron.job_run_details d join cron.job j on j.jobid = d.jobid
       where j.jobname = 'primus-tick' and d.start_time > now() - interval '1 hour'$q$
      into v_cron;
  end if;
  return app.ok(jsonb_build_object(
    'server_time', now(),
    'cron', v_cron,
    'tick_errors_last_hour', (select count(*) from public.error_log where event_id = p_event and source = 'tick' and at > now() - interval '1 hour'),
    'judge_queue', (select jsonb_build_object(
                       'queued', count(*) filter (where status = 'QUEUED'), 'running', count(*) filter (where status = 'RUNNING'),
                       'done', count(*) filter (where status = 'DONE'), 'failed', count(*) filter (where status = 'FAILED'))
                      from public.judge_runs where event_id = p_event),
    'screens', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
       select area, role, count(*) as connected,
              count(*) filter (where realtime = 'SUBSCRIBED') as realtime_ok
         from public.client_pings
        where event_id = p_event and last_seen > now() - interval '60 seconds'
        group by area, role order by area, role) x)));
end
$$;

-- ───────────────────────────── Console refresh ─────────────────────────────

-- Changes other open consoles must show at once and that no game function broadcasts: auto-advance, the seed
-- commitment, a correction requested or rejected, a flag decided. Staff only, and the message names nothing.
create or replace function app.broadcast_settings()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.broadcast(new.id, 'settings', '{}'::jsonb, true);
  return null;
end
$$;

create trigger events_settings_broadcast
  after update of auto_advance, seed_commitment on public.events
  for each row
  when (old.auto_advance is distinct from new.auto_advance or old.seed_commitment is distinct from new.seed_commitment)
  execute function app.broadcast_settings();

create or replace function app.broadcast_staff_row()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.broadcast(new.event_id, tg_argv[0], '{}'::jsonb, true);
  return null;
end
$$;

create trigger corrections_broadcast
  after insert or update of status on public.corrections
  for each row when (new.status <> 'APPROVED')
  execute function app.broadcast_staff_row('correction');

create trigger flags_broadcast
  after update of status on public.flags
  for each row when (old.status is distinct from new.status)
  execute function app.broadcast_staff_row('flag');

-- ───────────────────────────── Auto-advance and rounds ─────────────────────────────

-- Turning auto-advance on when the current phase's planned end has passed advances the event on the next tick, so
-- it needs a second, explicit confirmation (p_advance_now). The database decides, not the page.
drop function public.set_auto_advance(uuid, boolean);
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
    return app.fail('OVERDUE', 'The planned end of this phase has passed: with auto-advance on, the event advances at once. Confirm to go ahead.');
  end if;
  update public.events set auto_advance = p_on where id = p_event;
  return app.ok(jsonb_build_object('auto_advance', p_on));
end
$$;

-- "Close round N now" names the round the organiser saw, so a stale page or a double click never closes the next one.
-- Without p_round (scripts, tests): the open round.
drop function public.close_round_now(uuid);
create or replace function public.close_round_now(p_event uuid, p_round integer default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_round public.rounds;
begin
  perform app.require_organiser();
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
  return app.clear_round(v_round.id, true);
end
$$;

-- Organiser: switch a round's judge between its primary and backup model (the worker reads the slot per claim).
create or replace function public.set_model_slot(p_event uuid, p_type public.submission_type, p_slot text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.require_organiser();
  if p_slot not in ('PRIMARY', 'BACKUP') then
    raise exception 'the slot is PRIMARY or BACKUP';
  end if;
  if p_type = 'PRD' then
    update public.events set prd_model_slot = p_slot where id = p_event;
  else
    update public.events set solution_model_slot = p_slot where id = p_event;
  end if;
  perform app.broadcast(p_event, 'settings', '{}'::jsonb, true);
  return app.ok(jsonb_build_object('type', p_type, 'slot', p_slot));
end
$$;

-- ───────────────────────────── Grants ─────────────────────────────

revoke all on function app.broadcast_settings() from public, anon, authenticated, service_role;
revoke all on function app.broadcast_staff_row() from public, anon, authenticated, service_role;
do $$
declare f text;
begin
  foreach f in array array[
    'public.upload_problem_deck(uuid, jsonb)', 'public.upload_crisis_deck(uuid, jsonb)',
    'public.server_time()', 'public.event_status(uuid)', 'public.ping(uuid, uuid, text, text)', 'public.admin_health(uuid)',
    'public.close_round_now(uuid, integer)', 'public.set_auto_advance(uuid, boolean, boolean)',
    'public.set_model_slot(uuid, public.submission_type, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
