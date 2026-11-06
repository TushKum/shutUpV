-- Event seeding (service role only). The seed script creates the auth users first through the
-- Supabase Admin API, then calls seed_event() once: everything below runs in one transaction.

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
  v_n_product int;
  v_n_consulting int;
  v_n_finance int;
  v_start bigint;
  v_txn uuid;
begin
  perform set_config('app.actor', 'seed', true);

  select count(*) filter (where x ->> 'track' = 'PRODUCT'),
         count(*) filter (where x ->> 'track' = 'CONSULTING'),
         count(*) filter (where x ->> 'track' = 'FINANCE')
    into v_n_product, v_n_consulting, v_n_finance
    from jsonb_array_elements(coalesce(p -> 'teams', '[]')) x;

  if not (v_n_product = v_n_consulting and v_n_consulting = v_n_finance) then
    raise exception 'each track needs the same number of teams (got % product, % consulting, % finance)',
      v_n_product, v_n_consulting, v_n_finance;
  end if;
  if v_n_product not between 3 and 50 then
    raise exception 'between 3 and 50 teams per track are needed (got %)', v_n_product;
  end if;
  if not v_rehearsal and v_n_product <> 50 then
    raise exception 'the live event needs exactly 50 teams per track (got %)', v_n_product;
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

  insert into public.phases (event_id, seq, code, starts_at, ends_at)
  select v_event, (x ->> 'seq')::smallint, (x ->> 'code')::public.phase_code,
         (x ->> 'starts_at')::timestamptz, (x ->> 'ends_at')::timestamptz
    from jsonb_array_elements(p -> 'schedule' -> 'phases') x;

  insert into public.rounds (event_id, number, phase, opens_at, closes_at)
  select v_event, (x ->> 'number')::smallint, (x ->> 'phase')::public.phase_code,
         (x ->> 'opens_at')::timestamptz, (x ->> 'closes_at')::timestamptz
    from jsonb_array_elements(p -> 'schedule' -> 'rounds') x;

  insert into public.deadlines (event_id, code, at)
  select v_event, (x ->> 'code')::public.deadline_code, (x ->> 'at')::timestamptz
    from jsonb_array_elements(p -> 'schedule' -> 'deadlines') x;

  for v_team in select * from jsonb_array_elements(p -> 'teams') loop
    insert into public.teams (event_id, code, track, name)
    values (v_event, v_team ->> 'code', (v_team ->> 'track')::public.track, v_team ->> 'name')
    returning id into v_team_id;

    insert into public.accounts (user_id, role, team_id, display_name)
    values ((v_team ->> 'user_id')::uuid, 'TEAM', v_team_id, v_team ->> 'code');

    insert into public.members (event_id, team_id, full_name, roll_number)
    select v_event, v_team_id, m ->> 'full_name', nullif(m ->> 'roll_number', '')
      from jsonb_array_elements(coalesce(v_team -> 'members', '[]')) m;

    if v_team ->> 'track' = 'PRODUCT' then
      insert into public.companies (event_id, product_team_id) values (v_event, v_team_id);
    end if;

    v_start := coalesce((p -> 'starting_cash_cents' ->> (v_team ->> 'track'))::bigint, 0);
    if v_start <> 0 then
      v_txn := gen_random_uuid();
      insert into public.ledger_entries (event_id, txn_id, kind, team_id, cash_delta_cents, memo)
      values (v_event, v_txn, 'STARTING_CASH', v_team_id, v_start, 'Starting cash'),
             (v_event, v_txn, 'STARTING_CASH', null, -v_start, 'Starting cash');
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

  insert into public.crisis_cards (event_id, category, number, title, body)
  select v_event, x ->> 'category', coalesce((x ->> 'number')::smallint, 1), x ->> 'title', x ->> 'body'
    from jsonb_array_elements(coalesce(p -> 'crisis_cards', '[]')) x;

  return v_event;
end
$$;

-- Deletes a rehearsal event, or a live event that has not started, with everything in it.
-- Auth users are kept so the seed script can reuse them.
create or replace function public.purge_event(p_slug text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_rehearsal boolean;
  v_phase public.phase_code;
begin
  select id, is_rehearsal, current_phase into v_id, v_rehearsal, v_phase
    from public.events where slug = p_slug;
  if v_id is null then
    return;
  end if;
  if not (v_rehearsal or v_phase = 'SETUP') then
    raise exception 'only a rehearsal event or an event still in SETUP can be purged';
  end if;
  insert into public.audit_log (event_id, actor_role, action, entity, entity_id, before)
  values (v_id, coalesce(nullif(current_setting('app.actor', true), ''), 'system'), 'purge', 'events', v_id::text,
          jsonb_build_object('slug', p_slug, 'phase', v_phase));
  perform set_config('app.allow_purge', 'on', true);
  delete from public.accounts a using public.teams t where a.team_id = t.id and t.event_id = v_id;
  delete from public.events where id = v_id;
  perform set_config('app.allow_purge', 'off', true);
end
$$;

revoke all on function public.seed_event(jsonb) from public, anon, authenticated;
revoke all on function public.purge_event(text) from public, anon, authenticated;
grant execute on function public.seed_event(jsonb) to service_role;
grant execute on function public.purge_event(text) to service_role;
