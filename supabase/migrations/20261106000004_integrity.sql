-- Integrity triggers: audit log, append-only tables, immutable submissions, the price guard, staff/team separation.

-- ───────────────────────────── Audit log ─────────────────────────────

create or replace function app.audit_actor(out user_id uuid, out role text, out team_id uuid)
language plpgsql stable security definer set search_path = ''
as $$
begin
  user_id := auth.uid();
  if user_id is not null then
    select a.role::text, a.team_id into role, team_id from public.accounts a where a.user_id = auth.uid();
  end if;
  role := coalesce(role, nullif(current_setting('app.actor', true), ''), 'system');
end
$$;

-- Drafts and submissions can be long: their audit rows keep a digest of the content, not the content (every locked
-- version is stored in full, once, in submissions).
create or replace function app.audit_digest(p_row jsonb, p_keys text[])
returns jsonb
language sql immutable
as $$
  select case when p_row is null then null else p_row || coalesce((
    select jsonb_object_agg(k, jsonb_build_object('md5', md5(p_row ->> k), 'chars', length(p_row ->> k)))
      from unnest(p_keys) k where p_row ? k), '{}'::jsonb) end
$$;

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
  if tg_table_name in ('drafts', 'submissions') then
    v_before := app.audit_digest(v_before, array['content', 'body_text']);
    v_after := app.audit_digest(v_after, array['content', 'body_text']);
  end if;
  select a.user_id, a.role, a.team_id into v_user, v_role, v_team from app.audit_actor() a;
  insert into public.audit_log (event_id, actor_user_id, actor_role, actor_team_id, action, entity, entity_id, before, after)
  values (
    coalesce(v_after ->> 'event_id', v_before ->> 'event_id',
             case when tg_table_name = 'events' then coalesce(v_after ->> 'id', v_before ->> 'id') end)::uuid,
    v_user, v_role, v_team,
    lower(tg_op), tg_table_name,
    coalesce(v_after ->> 'id', v_before ->> 'id', v_after ->> 'user_id', v_before ->> 'user_id',
             v_after ->> 'submission_id', v_before ->> 'submission_id', v_after ->> 'event_id', v_before ->> 'event_id'),
    v_before, v_after);
  return null;
end
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'events', 'event_secrets', 'phases', 'deadlines', 'rounds', 'teams', 'members', 'accounts',
    'problem_cards', 'crisis_cards', 'companies', 'holdings', 'orders', 'drafts', 'submissions', 'scores',
    'appeals', 'qa_questions', 'qa_answers', 'bulletins', 'corrections', 'flags', 'results', 'awards'
  ] loop
    execute format(
      'create trigger audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t);
  end loop;
end $$;

-- ───────────────────────────── Append-only tables ─────────────────────────────

create or replace function app.forbid_change()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.allow_purge', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end
$$;

do $$
declare t text;
begin
  -- Submissions are the drafts as they stood at the lock: never changed afterwards.
  foreach t in array array['audit_log', 'ledger_entries', 'public_ledger', 'round_prices', 'injection_logs', 'submissions'] loop
    execute format(
      'create trigger append_only before update or delete on public.%I for each row execute function app.forbid_change()', t);
    execute format(
      'create trigger append_only_truncate before truncate on public.%I for each statement execute function app.forbid_change()', t);
  end loop;
end $$;

-- ───────────────────────────── Price guard ─────────────────────────────
-- Prices change only through the starting-price reveal, the crisis, the score reveal, clearing, the close and an
-- applied appeal. Those functions set the transaction-local setting app.price_writer; anything else (including the
-- service role and the dashboard table editor) is rejected.

create or replace function app.companies_price_guard()
returns trigger
language plpgsql
as $$
declare
  v_writer text := coalesce(current_setting('app.price_writer', true), '');
begin
  if tg_op = 'INSERT' then
    if row(new.start_price, new.market_price, new.score_price, new.post_crisis_price,
           new.closing_market_price, new.closing_price)
       is distinct from row(null::int, null::int, null::int, null::int, null::int, null::int)
       and v_writer = '' then
      raise exception 'a company is created without prices; prices are set by the game engine' using errcode = '42501';
    end if;
  elsif row(new.start_price, new.market_price, new.score_price, new.post_crisis_price,
            new.closing_market_price, new.closing_price)
        is distinct from
        row(old.start_price, old.market_price, old.score_price, old.post_crisis_price,
            old.closing_market_price, old.closing_price)
        and v_writer not in ('START', 'CRISIS', 'REVEAL', 'CLEARING', 'CLOSE', 'APPEAL') then
    raise exception 'prices can only change through the game: the starting price, the crisis, the score reveal or clearing'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger price_guard before insert or update on public.companies
  for each row execute function app.companies_price_guard();

-- Scores change only through the judge pipeline (it sets app.score_writer); nobody edits a score by hand.
create or replace function app.scores_guard()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.allow_purge', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if coalesce(current_setting('app.score_writer', true), '') = '' then
    raise exception 'scores can only change through the judge pipeline' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger score_guard before insert or update or delete on public.scores
  for each row execute function app.scores_guard();

-- ───────────────────────────── Staff never belong to a team ─────────────────────────────
-- accounts.staff_never_in_team stops a staff login from being a team login. These triggers also stop a staff member
-- (identified by roll number) from being listed as a member of any team.

create or replace function app.members_roll_check()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.roll_number is not null and exists (
    select 1 from public.accounts a where a.role <> 'TEAM' and a.roll_number = new.roll_number
  ) then
    raise exception 'roll number % belongs to an organiser account; organisers cannot belong to a team', new.roll_number
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger staff_not_member before insert or update on public.members
  for each row execute function app.members_roll_check();

create or replace function app.accounts_roll_check()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.role <> 'TEAM' and new.roll_number is not null and exists (
    select 1 from public.members m where m.roll_number = new.roll_number
  ) then
    raise exception 'roll number % is a team member; organisers cannot belong to a team', new.roll_number
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger staff_not_member before insert or update on public.accounts
  for each row execute function app.accounts_roll_check();

-- A team has at most four members.
create or replace function app.members_max_four()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(*) from public.members m where m.team_id = new.team_id and m.id <> new.id) >= 4 then
    raise exception 'a team has at most four members' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger max_four before insert or update on public.members
  for each row execute function app.members_max_four();

-- Internal functions: callable only by their owner (the SECURITY DEFINER game functions) and triggers.
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
