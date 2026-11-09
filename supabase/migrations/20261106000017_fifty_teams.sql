-- The live night has 50 teams (and 3 backups, from the seed command) instead of 150. A rehearsal can still have
-- from 3 to 150 teams, for load tests. Only the seeding check changes.

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
  if not v_rehearsal and v_n <> 50 then
    raise exception 'the live event needs exactly 50 teams (got %)', v_n;
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
