-- Backup teams, and organisers giving other people access.
--
-- Backups: an event can be seeded with up to 20 backup teams besides its playing teams (the live event: 150 + 10,
-- codes B001…). Until the lottery draw an organiser can activate a backup (a walk-in team, a replacement) and withdraw
-- a team that did not come. At the draw only the ACTIVE teams play: the companies of the others are removed, so they
-- get no problem card, crisis, rescue, price, points or award. A team's status is fixed once the cards are dealt.
--
-- Access: an organiser can make another person an organiser from the control panel. The login itself is created by the
-- website's server (Supabase Auth, with the service key); these functions record the account and check, in the
-- database, that the person asking is an organiser. Every grant and removal is in the audit log.

alter table public.teams add column status text not null default 'ACTIVE' check (status in ('ACTIVE', 'BACKUP', 'WITHDRAWN'));

-- ───────────────────────────── Backup teams ─────────────────────────────

-- Organiser: activate a backup, put a team back as a backup, or withdraw a team that did not come. Before the draw only.
create or replace function public.set_team_status(p_event uuid, p_team_code text, p_status text, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_team public.teams;
  v_actor record;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.id is null then
    raise exception 'no such event';
  end if;
  if v_event.drawn_at is not null then
    return app.fail('TOO_LATE', 'The problem cards have been dealt: the teams playing tonight are fixed.');
  end if;
  if p_status not in ('ACTIVE', 'BACKUP', 'WITHDRAWN') then
    return app.fail('BAD_STATUS', 'A team is active, a backup or withdrawn.');
  end if;
  select * into v_team from public.teams where event_id = p_event and code = upper(btrim(p_team_code)) for no key update;
  if v_team.id is null then
    return app.fail('NO_TEAM', format('There is no team %s in this event.', p_team_code));
  end if;
  if v_team.status = p_status then
    return app.ok(jsonb_build_object('code', v_team.code, 'status', p_status, 'unchanged', true));
  end if;
  update public.teams set status = p_status where id = v_team.id;
  select * into v_actor from app.audit_actor();
  insert into public.audit_log (event_id, actor_user_id, actor_role, actor_team_id, action, entity, entity_id, before, after)
  values (p_event, v_actor.user_id, v_actor.role, v_actor.team_id, 'team_status', 'teams', v_team.id,
          jsonb_build_object('status', v_team.status), jsonb_build_object('status', p_status, 'reason', nullif(btrim(coalesce(p_reason, '')), '')));
  perform app.broadcast(p_event, 'team_status', jsonb_build_object('code', v_team.code));
  perform app.broadcast(p_event, 'settings', '{}'::jsonb, true);
  return app.ok(jsonb_build_object('code', v_team.code, 'status', p_status,
    'active', (select count(*) from public.teams where event_id = p_event and status = 'ACTIVE')));
end
$$;

-- ───────────────────────────── Access for other organisers ─────────────────────────────

-- The staff accounts with their sign-in email. Organisers only.
create or replace function public.staff_list()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not app.is_organiser() then
    raise exception 'only an organiser can see who has access' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'role', a.role, 'name', a.display_name,
                                                      'email', u.email, 'created_at', a.created_at, 'me', a.user_id = auth.uid())
                                    order by a.role, a.display_name)
                     from public.accounts a join auth.users u on u.id = a.user_id
                    where a.role <> 'TEAM'), '[]'::jsonb);
end
$$;

-- The website's server, after creating the login: records the new organiser. p_by is the organiser who asked; the
-- database checks that they are one.
create or replace function public.add_organiser(p_user uuid, p_name text, p_by uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.accounts where user_id = p_by and role = 'ORGANISER') then
    raise exception 'only an organiser can give access' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    return app.fail('BAD_NAME', 'Give the person''s name (1 to 80 characters).');
  end if;
  if exists (select 1 from public.accounts where user_id = p_user) then
    return app.fail('EXISTS', 'That login already has access.');
  end if;
  insert into public.accounts (user_id, role, display_name) values (p_user, 'ORGANISER', btrim(p_name));
  insert into public.audit_log (event_id, actor_user_id, actor_role, action, entity, entity_id, after)
  values (null, p_by, 'ORGANISER', 'access_granted', 'accounts', p_user, jsonb_build_object('role', 'ORGANISER', 'name', btrim(p_name)));
  return app.ok();
end
$$;

-- The website's server: removes a staff member's access (the login itself is then deleted). Nobody removes their own
-- access, and the last organiser stays.
create or replace function public.remove_staff(p_user uuid, p_by uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_target public.accounts;
begin
  if not exists (select 1 from public.accounts where user_id = p_by and role = 'ORGANISER') then
    raise exception 'only an organiser can remove access' using errcode = '42501';
  end if;
  select * into v_target from public.accounts where user_id = p_user for update;
  if v_target.user_id is null or v_target.role = 'TEAM' then
    return app.fail('NO_STAFF', 'That person is not on the staff list.');
  end if;
  if p_user = p_by then
    return app.fail('SELF', 'You cannot remove your own access: ask another organiser.');
  end if;
  if v_target.role = 'ORGANISER' and (select count(*) from public.accounts where role = 'ORGANISER') <= 1 then
    return app.fail('LAST', 'The last organiser cannot be removed.');
  end if;
  delete from public.accounts where user_id = p_user;
  insert into public.audit_log (event_id, actor_user_id, actor_role, action, entity, entity_id, before)
  values (null, p_by, 'ORGANISER', 'access_removed', 'accounts', p_user,
          jsonb_build_object('role', v_target.role, 'name', v_target.display_name));
  return app.ok(jsonb_build_object('role', v_target.role));
end
$$;

-- An organiser's own record that a password was reset (the reset itself is done by the server).
create or replace function public.log_password_reset(p_user uuid, p_by uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.accounts where user_id = p_by and role = 'ORGANISER') then
    raise exception 'only an organiser can reset a password' using errcode = '42501';
  end if;
  if not exists (select 1 from public.accounts where user_id = p_user and role <> 'TEAM') then
    return app.fail('NO_STAFF', 'That person is not on the staff list.');
  end if;
  insert into public.audit_log (event_id, actor_user_id, actor_role, action, entity, entity_id)
  values (null, p_by, 'ORGANISER', 'password_reset', 'accounts', p_user);
  return app.ok();
end
$$;

-- ───────────────────────────── Only the active teams play ─────────────────────────────

create or replace function public.run_lottery(p_event uuid, p_seed text, p_dice text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_root text;
  n int;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.current_phase not in ('BRIEFING', 'BUILD') then
    raise exception 'the lottery is drawn at the start of Round 1 (BRIEFING or BUILD)';
  end if;
  if v_event.drawn_at is not null then
    raise exception 'the lottery has already been drawn';
  end if;
  if v_event.seed_commitment is null then
    raise exception 'no seed commitment was published';
  end if;
  if btrim(coalesce(p_dice, '')) !~ '^[0-9]{1,6}$' then
    raise exception 'the dice roll must be a number';
  end if;
  -- A short or guessable seed could be found from its published hash, revealing the crisis draw early.
  if coalesce(p_seed, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'the seed must be 64 lower-case hex characters (32 random bytes: pnpm new-seed)';
  end if;
  if app.sha256_hex(p_seed) <> v_event.seed_commitment then
    return app.fail('COMMITMENT_MISMATCH', 'SHA-256 of that seed does not match the published commitment.');
  end if;
  if not exists (select 1 from public.crisis_cards where event_id = p_event) then
    raise exception 'the crisis deck is empty: add the crisis cards before the draw';
  end if;

  -- Only the active teams play: a backup that was not activated, and a withdrawn team, are left out from here on (their
  -- company goes, so no card, no crisis, no rescue, no price, no ranking).
  if (select count(*) from public.teams where event_id = p_event and status = 'ACTIVE') < 3 then
    raise exception 'at least 3 active teams are needed for the draw';
  end if;
  delete from public.companies c using public.teams t
   where c.event_id = p_event and t.id = c.founder_team_id and t.status <> 'ACTIVE';

  v_root := app.sha256_hex(p_seed || btrim(p_dice));
  -- Cards are identified by their number (as text), in number order: the published record uses the same keys.
  update public.companies c set problem_card_id = pc.id
    from app.lottery_problems(v_root,
                              array(select code from public.teams where event_id = p_event and status = 'ACTIVE'),
                              array(select number::text from public.problem_cards where event_id = p_event order by number)) d
    join public.teams t on t.event_id = p_event and t.code = d.team
    join public.problem_cards pc on pc.event_id = p_event and pc.number = d.card::int
   where c.founder_team_id = t.id;
  get diagnostics n = row_count;

  insert into public.event_secrets (event_id, seed, entered_by) values (p_event, p_seed, auth.uid())
  on conflict (event_id) do update set seed = excluded.seed, entered_at = now(), entered_by = excluded.entered_by;
  update public.events set dice = btrim(p_dice), drawn_at = now() where id = p_event;

  perform app.broadcast(p_event, 'problem_draw', jsonb_build_object(
    'commitment', v_event.seed_commitment, 'dice', btrim(p_dice), 'verified', true, 'teams', n));
  return app.ok(jsonb_build_object('teams', n));
end
$$;

create or replace function app.apply_crisis(p_event uuid)
returns void
language plpgsql
as $$
declare
  v_event public.events;
  v_seed text;
  v_root text;
  v_teams text[];
begin
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.crisis_applied_at is not null then
    return;
  end if;
  if v_event.prices_started_at is null then
    raise exception 'the crisis comes after the starting prices';
  end if;
  select seed into v_seed from public.event_secrets where event_id = p_event;
  if v_seed is null or v_event.dice is null then
    raise exception 'the crisis draw needs the lottery seed and dice';
  end if;
  v_root := app.sha256_hex(v_seed || v_event.dice);
  v_teams := array(select code from public.teams where event_id = p_event and status = 'ACTIVE');

  update public.companies c set crisis_card_id = cc.id
    from app.lottery_crises(v_root, v_teams,
           (select jsonb_agg(jsonb_build_object('id', number::text, 'number', number)) from public.crisis_cards where event_id = p_event)) d
    join public.teams t on t.event_id = p_event and t.code = d.team
    join public.crisis_cards cc on cc.event_id = p_event and cc.number = d.card::int
   where c.founder_team_id = t.id;
  update public.companies c set rescuer_team_id = r.id
    from app.lottery_circle(v_root, v_teams) d
    join public.teams r on r.event_id = p_event and r.code = d.rescuer
    join public.teams f on f.event_id = p_event and f.code = d.founder
   where c.founder_team_id = f.id;

  perform set_config('app.price_writer', 'CRISIS', true);
  insert into public.round_prices (event_id, company_id, kind, market_before, market_after, score_before, score_after)
  select p_event, c.id, 'CRISIS', c.market_price, app.crisis_shock(c.market_price), c.score_price, app.crisis_shock(c.score_price)
    from public.companies c where c.event_id = p_event;
  update public.companies c set market_price = rp.market_after, score_price = rp.score_after, post_crisis_price = rp.market_after
    from public.round_prices rp
   where c.event_id = p_event and rp.event_id = p_event and rp.company_id = c.id and rp.kind = 'CRISIS';
  perform set_config('app.price_writer', '', true);

  update public.events set crisis_applied_at = now(), seed_revealed = v_seed where id = p_event;
  delete from public.event_secrets where event_id = p_event;
  insert into public.bulletins (event_id, kind, title, body, published_at)
  values (p_event, 'CRISIS', 'Crisis: every company is hit',
          'Each company has received its crisis card and every share price fell 15%. Each team now rescues another '
          || 'team''s company: see your rescue card. The Q&A board is open until 00:15.', now());
  perform app.broadcast(p_event, 'crisis', jsonb_build_object('seed', v_seed, 'dice', v_event.dice));
end
$$;

create or replace function app.lottery_record_json(p_event uuid)
returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'seed', e.seed_revealed,
    'dice', e.dice,
    'commitment', e.seed_commitment,
    'teams', (select jsonb_agg(code order by code) from public.teams where event_id = p_event and status = 'ACTIVE'),
    'problemCards', (select jsonb_agg(number::text order by number) from public.problem_cards where event_id = p_event),
    'crisisCards', (select jsonb_agg(number::text order by number) from public.crisis_cards where event_id = p_event),
    'draws', (select jsonb_agg(jsonb_build_object('team', t.code, 'problem', pc.number::text, 'crisis', cc.number::text,
                                                  'rescues', ft.code) order by t.code)
                from public.teams t
                join public.companies own on own.founder_team_id = t.id
                left join public.problem_cards pc on pc.id = own.problem_card_id
                left join public.crisis_cards cc on cc.id = own.crisis_card_id
                left join public.companies res on res.rescuer_team_id = t.id
                left join public.teams ft on ft.id = res.founder_team_id
               where t.event_id = p_event and t.status = 'ACTIVE'))
    from public.events e where e.id = p_event
$$;

create or replace function app.live_leaderboard(p_event uuid)
returns table (team_id uuid, code text, r1 int, r2 int, r3 int, total int, portfolio bigint, rank int)
language sql stable
as $$
  with e as (select * from public.events where id = p_event),
  t as (
    select t.id, t.code, t.disqualified,
           coalesce((select s.final_score from public.scores s join public.companies c on c.id = s.company_id
                      where c.founder_team_id = t.id and s.type = 'PRD' and s.status = 'REVEALED'), 0)::int as r1,
           coalesce((select s.final_score from public.scores s
                      where s.team_id = t.id and s.type = 'SOLUTION' and s.status = 'REVEALED'), 0)::int as r2,
           t.cash_cents + coalesce((select sum(h.qty::bigint * c.market_price) from public.holdings h
                                     join public.companies c on c.id = h.company_id
                                    where h.team_id = t.id and h.qty > 0), 0) as portfolio
      from public.teams t where t.event_id = p_event and t.status = 'ACTIVE'
  ),
  s as (
    select t.*, case when (select current_phase from e) >= 'MARKET_BLIND'
                     then app.round3_points(t.portfolio, (select 10000000)) else 0 end as r3
      from t
  )
  select s.id, s.code, s.r1, s.r2, s.r3, s.r1 + s.r2 + s.r3, s.portfolio,
         case when s.disqualified then null
              else (rank() over (partition by s.disqualified
                                 order by s.r1 + s.r2 + s.r3 desc, s.r2 desc, s.r1 desc, s.portfolio desc))::int end
    from s
$$;

create or replace function app.compute_results(p_event uuid)
returns void
language sql
as $$
  insert into public.results (event_id, team_id, r1_points, r2_points, r3_points, portfolio_cents, return_bp, total, eligible, details, computed_at)
  select p_event, x.id, x.r1, x.r2, app.round3_points(x.portfolio, 10000000), x.portfolio, app.return_bp(x.portfolio, 10000000),
         x.r1 + x.r2 + app.round3_points(x.portfolio, 10000000), not x.disqualified,
         jsonb_build_object('cash', x.cash_cents), now()
    from (select t.id, t.disqualified, t.cash_cents,
                 coalesce((select s.final_score from public.scores s join public.companies c on c.id = s.company_id
                            where c.founder_team_id = t.id and s.type = 'PRD'), 0)::int as r1,
                 coalesce((select s.final_score from public.scores s where s.team_id = t.id and s.type = 'SOLUTION'), 0)::int as r2,
                 t.cash_cents + coalesce((select sum(h.qty::bigint * c.closing_price) from public.holdings h
                                           join public.companies c on c.id = h.company_id
                                          where h.team_id = t.id and h.qty > 0), 0) as portfolio
            from public.teams t where t.event_id = p_event and t.status = 'ACTIVE') x
  on conflict (team_id) do update
    set r1_points = excluded.r1_points, r2_points = excluded.r2_points, r3_points = excluded.r3_points,
        portfolio_cents = excluded.portfolio_cents, return_bp = excluded.return_bp, total = excluded.total,
        eligible = excluded.eligible, details = excluded.details, computed_at = now()
$$;

create or replace function app.gate_blocker(p_event uuid)
returns text
language sql stable
as $$
  select case e.current_phase
    when 'SETUP' then case
      when e.seed_commitment is null then 'Publish the seed commitment before the event starts.'
      when (select count(*) from public.problem_cards p where p.event_id = e.id)
           < (select (count(*) + 2) / 3 from public.teams t where t.event_id = e.id and t.status = 'ACTIVE')
        then format('Upload a problem deck of at least %s cards before the event starts.',
                    (select (count(*) + 2) / 3 from public.teams t where t.event_id = e.id and t.status = 'ACTIVE'))
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
  select (count(*) + 2) / 3 into v_need from public.teams where event_id = p_event and status = 'ACTIVE';
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

  -- Playing teams, and the backups (status BACKUP) an organiser can activate before the draw.
  v_n := (select count(*) from jsonb_array_elements(coalesce(p -> 'teams', '[]')) x where coalesce(x ->> 'status', 'ACTIVE') = 'ACTIVE');
  if (select count(*) from jsonb_array_elements(coalesce(p -> 'teams', '[]')) x where coalesce(x ->> 'status', 'ACTIVE') not in ('ACTIVE', 'BACKUP')) > 0 then
    raise exception 'a team starts ACTIVE or BACKUP';
  end if;
  if jsonb_array_length(coalesce(p -> 'teams', '[]')) - v_n > 20 then
    raise exception 'at most 20 backup teams';
  end if;
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
    insert into public.teams (event_id, code, name, status)
    values (v_event, v_team ->> 'code', v_team ->> 'name', coalesce(v_team ->> 'status', 'ACTIVE'))
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

revoke all on function public.set_team_status(uuid, text, text, text) from public, anon;
grant execute on function public.set_team_status(uuid, text, text, text) to authenticated, service_role;
revoke all on function public.staff_list() from public, anon;
grant execute on function public.staff_list() to authenticated, service_role;
do $$
declare f text;
begin
  foreach f in array array['public.add_organiser(uuid, text, uuid)', 'public.remove_staff(uuid, uuid)', 'public.log_password_reset(uuid, uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
revoke all on all functions in schema app from public, anon, authenticated, service_role;
grant execute on function
  app.my_role(), app.my_team_id(), app.my_event_id(), app.my_company_id(), app.my_rescue_company_id(), app.is_staff(),
  app.is_organiser(), app.is_fairness(), app.sees_all_events(), app.in_my_event(uuid),
  app.phase_reached(uuid, public.phase_code), app.can_hear(text)
to authenticated;
