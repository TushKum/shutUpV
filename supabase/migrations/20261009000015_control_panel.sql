-- Phase 3 (control panel): content upload (problem deck, crisis deck, flash bulletin) and the Setup gate on it,
-- "close round N now", broadcasts that keep every console current, the server clock, client heartbeats for the
-- health view, and a health summary.

-- ───────────────────────────── Content ─────────────────────────────

-- Replaces the problem deck. Cards: [{number, sector?, title, body}]. Only before the draw, and the deck needs at
-- least two more cards than there are squads (3 distinct cards per squad, each card used at most 3 times).
create or replace function public.upload_problem_deck(p_event uuid, p_cards jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_squads int;
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
  select count(*) into v_squads from public.teams where event_id = p_event and track = 'PRODUCT';
  if v_n < v_squads + 2 or v_n > 999 then
    return app.fail('BAD_DECK', format('The deck needs at least %s cards (squads + 2) and at most 999.', v_squads + 2));
  end if;
  for c in select * from jsonb_array_elements(p_cards) loop
    if jsonb_typeof(c) <> 'object'
       or jsonb_typeof(c -> 'number') <> 'number' or (c ->> 'number')::numeric <> trunc((c ->> 'number')::numeric)
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
  perform app.broadcast_staff(p_event, 'content'); -- the consoles re-read the deck
  return app.ok(jsonb_build_object('cards', v_n));
end
$$;

-- Replaces the crisis deck. Cards: [{category, number, title, body}]. Only before the draw: organisers know the seed
-- from the draw on, and with it which category index each squad gets at the crisis, so a deck changed after the
-- draw could steer a chosen crisis to a chosen company and still verify.
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
    return app.fail('TOO_LATE', 'The crisis deck is fixed once the squads have been drawn.');
  end if;
  if jsonb_typeof(p_cards) is distinct from 'array' then
    return app.fail('BAD_DECK', 'The deck is a list of cards.');
  end if;
  v_n := jsonb_array_length(p_cards);
  if v_n < 1 or v_n > 500 then
    return app.fail('BAD_DECK', 'The crisis deck needs 1 to 500 cards.');
  end if;
  for c in select * from jsonb_array_elements(p_cards) loop
    if jsonb_typeof(c) <> 'object'
       or jsonb_typeof(c -> 'number') <> 'number' or (c ->> 'number')::numeric <> trunc((c ->> 'number')::numeric)
       or (c ->> 'number')::numeric not between 1 and 999
       or coalesce(btrim(c ->> 'category'), '') = '' or coalesce(btrim(c ->> 'title'), '') = '' or coalesce(btrim(c ->> 'body'), '') = ''
       or length(c ->> 'title') > 200 or length(c ->> 'body') > 4000 or length(c ->> 'category') > 100 then
      return app.fail('BAD_DECK', format('Card %s #%s needs a category, a number from 1 to 999, a title and a body.',
                                         coalesce(c ->> 'category', '?'), coalesce(c ->> 'number', '?')));
    end if;
  end loop;
  if (select count(distinct (btrim(x ->> 'category'), (x ->> 'number')::numeric::int)) from jsonb_array_elements(p_cards) x) <> v_n then
    return app.fail('BAD_DECK', 'Each category and number pair must be unique.');
  end if;
  delete from public.crisis_cards where event_id = p_event;
  insert into public.crisis_cards (event_id, category, number, title, body)
  select p_event, btrim(x ->> 'category'), (x ->> 'number')::numeric::int, btrim(x ->> 'title'), btrim(x ->> 'body')
    from jsonb_array_elements(p_cards) x;
  perform app.broadcast_staff(p_event, 'content');
  return app.ok(jsonb_build_object('cards', v_n,
    'categories', (select count(distinct category) from public.crisis_cards where event_id = p_event)));
end
$$;

-- The flash bulletin is prepared in advance (an unpublished FLASH bulletin, invisible to teams and the display) and
-- published by an organiser at 04:00. Preparing again replaces the draft; nothing changes once one is published.
create or replace function public.prepare_flash_bulletin(p_event uuid, p_title text, p_body text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.bulletins;
begin
  perform app.require_organiser();
  perform 1 from public.events where id = p_event for no key update;
  if not found then
    raise exception 'no such event';
  end if;
  if exists (select 1 from public.bulletins where event_id = p_event and kind = 'FLASH' and published_at is not null) then
    return app.fail('TOO_LATE', 'The flash bulletin has already been published.');
  end if;
  if length(btrim(coalesce(p_title, ''))) not between 1 and 140 or length(btrim(coalesce(p_body, ''))) not between 1 and 4000 then
    return app.fail('BAD_BULLETIN', 'The flash bulletin needs a title (up to 140 characters) and a body.');
  end if;
  delete from public.bulletins where event_id = p_event and kind = 'FLASH' and published_at is null;
  insert into public.bulletins (event_id, kind, title, body, published_at, created_by)
  values (p_event, 'FLASH', btrim(p_title), btrim(p_body), null, auth.uid())
  returning * into v_b;
  perform app.broadcast_staff(p_event, 'content'); -- the draft itself stays private
  return app.ok(jsonb_build_object('bulletin', to_jsonb(v_b)));
end
$$;

-- Publishes the prepared flash bulletin (once). This opens the flash answers. With p_bulletin, only that draft: a
-- draft replaced since the page showed it is never published by the confirming click.
drop function if exists public.publish_flash_bulletin(uuid);
create or replace function public.publish_flash_bulletin(p_event uuid, p_bulletin uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_b public.bulletins;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.id is null then
    raise exception 'no such event';
  end if;
  if exists (select 1 from public.bulletins where event_id = p_event and kind = 'FLASH' and published_at is not null) then
    return app.fail('ALREADY_PUBLISHED', 'The flash bulletin has already been published.');
  end if;
  if v_event.current_phase <> 'ROUNDS_13_21' then
    return app.fail('WRONG_PHASE', 'The flash bulletin is published during rounds 13–21 (04:00).');
  end if;
  update public.bulletins set published_at = now()
   where event_id = p_event and kind = 'FLASH' and published_at is null and (p_bulletin is null or id = p_bulletin)
  returning * into v_b;
  if v_b.id is null then
    if p_bulletin is not null and exists (select 1 from public.bulletins where event_id = p_event and kind = 'FLASH' and published_at is null) then
      -- The page named the draft it showed; another organiser has replaced it since.
      return app.fail('DRAFT_CHANGED', 'The flash draft was replaced since this page showed it; nothing was published. Read the new draft and publish again.');
    end if;
    return app.fail('NO_DRAFT', 'Prepare the flash bulletin first (Content).');
  end if;
  perform app.broadcast(p_event, 'bulletin', jsonb_build_object('id', v_b.id, 'bulletin_kind', v_b.kind, 'title', v_b.title, 'body', v_b.body));
  return app.ok(jsonb_build_object('bulletin', to_jsonb(v_b)));
end
$$;

-- A flash bulletin is published once: the composer can no longer publish a second FLASH bulletin.
create or replace function public.publish_bulletin(p_event uuid, p_kind public.bulletin_kind, p_title text, p_body text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.bulletins;
begin
  perform app.require_organiser();
  if p_kind = 'FLASH' then
    return app.fail('USE_FLASH', 'Prepare the flash bulletin under Content and publish it at 04:00.');
  end if;
  if length(btrim(coalesce(p_title, ''))) not between 1 and 140 or length(coalesce(p_body, '')) > 4000 then
    return app.fail('BAD_BULLETIN', 'A bulletin needs a title (up to 140 characters) and a body of up to 4,000 characters.');
  end if;
  insert into public.bulletins (event_id, kind, title, body, published_at, created_by)
  values (p_event, p_kind, btrim(p_title), coalesce(p_body, ''), now(), auth.uid())
  returning * into v_b;
  perform app.broadcast(p_event, 'bulletin', jsonb_build_object('id', v_b.id, 'bulletin_kind', v_b.kind, 'title', v_b.title, 'body', v_b.body));
  return app.ok(jsonb_build_object('bulletin', to_jsonb(v_b)));
end
$$;

-- ───────────────────────────── Clock and health ─────────────────────────────

-- The server clock, so every screen counts down against the clock that decides deadlines.
create or replace function public.server_time()
returns timestamptz
language sql stable security definer set search_path = ''
as $$
  select now()
$$;

-- Where the event is, for every screen's header: the phase and the next one, what holds the advance (the gate),
-- trading state, the open (or next) round, the phase's planned end and the server clock. Anyone who can see the
-- event may read it.
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
  v_open := app.open_round(p_event);
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

-- One row per open screen (a browser tab), refreshed by its heartbeat every 20 seconds: which account, which area,
-- and whether its realtime channel is connected. Staff read it in the health view; nobody writes it directly.
create table public.client_pings (
  client_id uuid primary key,
  event_id uuid references public.events (id) on delete cascade,
  user_id uuid not null,
  role public.account_role not null,
  team_id uuid references public.teams (id) on delete cascade,
  area text not null check (area in ('team', 'admin', 'display')),
  realtime text not null check (realtime in ('SUBSCRIBED', 'CONNECTING', 'CLOSED', 'CHANNEL_ERROR', 'TIMED_OUT')),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index client_pings_event_idx on public.client_pings (event_id, last_seen desc);
create index client_pings_user_idx on public.client_pings (user_id, last_seen desc);
alter table public.client_pings enable row level security;
grant select on public.client_pings to authenticated;
create policy client_pings_read on public.client_pings for select to authenticated using ((select app.is_staff()));

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
  -- One account's pings one after another: two tabs pinging at once would otherwise each delete the other's row
  -- (the cap below) while it is locked, and deadlock.
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
  -- An account keeps its 10 most recent screens, so made-up client ids cannot grow the table (or the health view).
  delete from public.client_pings
   where user_id = auth.uid()
     and client_id in (select client_id from public.client_pings where user_id = auth.uid() order by last_seen desc offset 10);
  return jsonb_build_object('ok', true, 'server_time', now());
end
$$;

-- Health of the backend for the control panel: the heartbeat's last runs (pg_cron), recent tick errors and the
-- connected screens. Staff only.
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
                        where j2.jobname = 'msim-tick' and d2.status = 'failed' order by d2.start_time desc limit 1))
        from cron.job_run_details d join cron.job j on j.jobid = d.jobid
       where j.jobname = 'msim-tick' and d.start_time > now() - interval '1 hour'$q$
      into v_cron;
  end if;
  return app.ok(jsonb_build_object(
    'server_time', now(),
    'cron', v_cron,
    'tick_errors_last_hour', (select count(*) from public.error_log where event_id = p_event and source = 'tick' and at > now() - interval '1 hour'),
    'screens', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
       select area, role, count(*) as connected,
              count(*) filter (where realtime = 'SUBSCRIBED') as realtime_ok
         from public.client_pings
        where event_id = p_event and last_seen > now() - interval '60 seconds'
        group by area, role order by area, role) x)));
end
$$;

-- ───────────────────────────── Setup gate ─────────────────────────────

-- Why the current phase cannot end yet (NULL when it can). The event starts only with both decks uploaded: they
-- lock at the draw, the draw needs squads + 2 problem cards, and the crisis at 00:30 needs the crisis deck.
create or replace function app.gate_blocker(p_event uuid)
returns text
language sql stable
as $$
  select case e.current_phase
    when 'SETUP' then case
      when e.seed_commitment is null then 'Publish the seed commitment before the event starts.'
      when not exists (select 1 from public.problem_cards p where p.event_id = e.id) then 'Upload the problem deck before the event starts.'
      when (select count(*) from public.problem_cards p where p.event_id = e.id)
           < (select count(*) from public.teams t where t.event_id = e.id and t.track = 'PRODUCT') + 2
        then format('The problem deck needs at least %s cards (squads + 2) before the event starts.',
                    (select count(*) from public.teams t where t.event_id = e.id and t.track = 'PRODUCT') + 2)
      when not exists (select 1 from public.crisis_cards c where c.event_id = e.id) then 'Upload the crisis deck before the event starts.'
    end
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

-- ───────────────────────────── Console refresh ─────────────────────────────

-- May the caller receive messages on this topic? 'event:<id>' of the caller's own event (staff and the display hear
-- every event); 'staff:<id>' for staff only: signals about drafts, requests and settings that teams must not learn
-- of, and that their screens need not re-fetch for.
create or replace function app.can_hear(p_topic text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (p_topic like 'event:%' and exists (
       select 1 from public.events e
        where 'event:' || e.id::text = p_topic and (app.sees_all_events() or e.id = app.my_event_id())))
    or (p_topic like 'staff:%' and app.is_staff() and exists (
       select 1 from public.events e where 'staff:' || e.id::text = p_topic)),
    false)
$$;

-- Tells the open control panels to re-read (the message carries no data; screens re-read through RLS).
create or replace function app.broadcast_staff(p_event uuid, p_kind text)
returns void
language plpgsql
as $$
begin
  perform realtime.send(jsonb_build_object('kind', p_kind, 'event_id', p_event, 'at', now()), p_kind, 'staff:' || p_event::text, true);
end
$$;

-- Changes that other open consoles must show at once, and that no game function broadcasts: auto-advance, the seed
-- commitment, and a correction requested or rejected (the second person must see a request to approve it; an
-- approval is published to everyone by decide_correction itself).
create or replace function app.broadcast_settings()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.broadcast_staff(new.id, 'settings');
  return null;
end
$$;

drop trigger if exists events_settings_broadcast on public.events;
create trigger events_settings_broadcast
  after update of auto_advance, seed_commitment on public.events
  for each row
  when (old.auto_advance is distinct from new.auto_advance or old.seed_commitment is distinct from new.seed_commitment)
  execute function app.broadcast_settings();

create or replace function app.broadcast_correction()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.broadcast_staff(new.event_id, 'correction');
  return null;
end
$$;

drop trigger if exists corrections_broadcast on public.corrections;
create trigger corrections_broadcast
  after insert or update of status on public.corrections
  for each row when (new.status <> 'APPROVED')
  execute function app.broadcast_correction();

-- A flag decided (or changed) by the fairness officer: the organisers' Phase page follows the APPEALS gate. The
-- message names nothing, so it goes to staff only like the rest.
create or replace function app.broadcast_flag()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.broadcast_staff(new.event_id, 'flag');
  return null;
end
$$;

drop trigger if exists flags_broadcast on public.flags;
create trigger flags_broadcast
  after update of status on public.flags
  for each row when (old.status is distinct from new.status)
  execute function app.broadcast_flag();

revoke all on function app.broadcast_staff(uuid, text) from public, anon, authenticated;
revoke all on function app.broadcast_flag() from public, anon, authenticated;
revoke all on function app.broadcast_settings() from public, anon, authenticated;
revoke all on function app.broadcast_correction() from public, anon, authenticated;

-- Turning auto-advance on when the current phase's planned end has passed advances the event on the next tick, so
-- it needs a second, explicit confirmation (p_advance_now). The database decides, not the page: a console rendered
-- before the planned end cannot advance the night with one click.
drop function if exists public.set_auto_advance(uuid, boolean);
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

-- ───────────────────────────── Rounds ─────────────────────────────

-- "Close round N now" names the round the organiser saw. With p_round, a round that cleared meanwhile is never
-- followed by closing the next one (a stale page or a double click). Without it (scripts, tests), the open round.
drop function if exists public.close_round_now(uuid);
create or replace function public.close_round_now(p_event uuid, p_round integer default null)
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

do $$
declare f text;
begin
  foreach f in array array[
    'public.upload_problem_deck(uuid, jsonb)', 'public.upload_crisis_deck(uuid, jsonb)',
    'public.prepare_flash_bulletin(uuid, text, text)', 'public.publish_flash_bulletin(uuid, uuid)',
    'public.publish_bulletin(uuid, public.bulletin_kind, text, text)',
    'public.server_time()', 'public.event_status(uuid)', 'public.ping(uuid, uuid, text, text)', 'public.admin_health(uuid)',
    'public.close_round_now(uuid, integer)', 'public.set_auto_advance(uuid, boolean, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  grant execute on function public.close_round_now(uuid, integer) to service_role;
  grant execute on function public.set_auto_advance(uuid, boolean, boolean) to service_role;
end $$;
