-- Game core: caller identity, results, deadlines, trading state, broadcasting, submission text, and a few
-- event columns the engine functions need.
--
-- Conventions for game functions (public schema, SECURITY DEFINER, search_path = ''):
--   • A team action returns jsonb: {"ok":true,…} or {"ok":false,"code":…,"message":…}. A rejected attempt is
--     written to audit_log (action "rejected") so every attempt is on record, including late submissions.
--   • Organiser/system actions raise on permission errors and on misuse; they also return jsonb.
--   • The clock is now() (the database server's clock) everywhere.

alter table public.events
  add column ipo_allocated_at timestamptz,
  add column crisis_applied_at timestamptz,
  add column market_closed_at timestamptz,
  add column settled_at timestamptz;

comment on column public.ledger_entries.share_delta is
  'Shares received (+) or delivered (−) by the party. A short sale delivers shares, so a SHORT lot''s quantity is −Σ share_delta of that lot; every other lot''s quantity is +Σ share_delta.';

alter table public.ledger_entries drop constraint ledger_entries_check;
alter table public.ledger_entries add constraint ledger_entries_shares_need_company
  check (share_delta = 0 or company_id is not null);
alter table public.ledger_entries add constraint ledger_entries_team_shares_need_lot
  check (share_delta = 0 or team_id is null or lot is not null);

-- ───────────────────────────── Results ─────────────────────────────

create or replace function app.ok(p_data jsonb default '{}'::jsonb)
returns jsonb
language sql immutable
as $$
  select jsonb_build_object('ok', true) || coalesce(p_data, '{}'::jsonb)
$$;

create or replace function app.fail(p_code text, p_message text, p_data jsonb default '{}'::jsonb)
returns jsonb
language sql immutable
as $$
  select jsonb_build_object('ok', false, 'code', p_code, 'message', p_message) || coalesce(p_data, '{}'::jsonb)
$$;

-- Records a rejected attempt and returns the failure.
create or replace function app.reject(p_event uuid, p_action text, p_code text, p_message text, p_details jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid;
  v_role text;
  v_team uuid;
begin
  select a.user_id, a.role, a.team_id into v_user, v_role, v_team from app.audit_actor() a;
  insert into public.audit_log (event_id, actor_user_id, actor_role, actor_team_id, action, entity, entity_id, after)
  values (p_event, v_user, v_role, v_team, 'rejected', p_action, null,
          jsonb_build_object('code', p_code, 'message', p_message, 'at', clock_timestamp()) || coalesce(p_details, '{}'::jsonb));
  return app.fail(p_code, p_message);
end
$$;

-- ───────────────────────────── Who is calling ─────────────────────────────

-- The calling team (locked FOR UPDATE: a team's actions are serialised). NULL if the caller is not a team.
create or replace function app.lock_caller_team()
returns public.teams
language sql
as $$
  select t.* from public.accounts a join public.teams t on t.id = a.team_id
   where a.user_id = auth.uid()
   for update of t
$$;

-- System = no signed-in user and not the anon role: the service role (judge worker, seed) or the database
-- itself (pg_cron).
create or replace function app.is_system()
returns boolean
language sql stable
as $$
  select auth.uid() is null and coalesce(auth.role(), 'service_role') = 'service_role'
$$;

create or replace function app.require_organiser()
returns void
language plpgsql stable
as $$
begin
  if not (app.is_organiser() or app.is_system()) then
    raise exception 'only an organiser can do this' using errcode = '42501';
  end if;
end
$$;

create or replace function app.require_fairness()
returns void
language plpgsql stable
as $$
begin
  if not (app.is_fairness() or app.is_system()) then
    raise exception 'only the fairness officer can do this' using errcode = '42501';
  end if;
end
$$;

create or replace function app.squad_of_team(p_team uuid)
returns public.squads
language sql stable
as $$
  select s.* from public.squads s where p_team in (s.product_team_id, s.consulting_team_id, s.finance_team_id)
$$;

-- ───────────────────────────── Time ─────────────────────────────

create or replace function app.deadline(p_event uuid, p_code public.deadline_code)
returns timestamptz
language sql stable
as $$
  select at from public.deadlines where event_id = p_event and code = p_code
$$;

-- Passed, by the server clock. While the event is paused, deadlines after the pause began are frozen.
create or replace function app.deadline_passed(p_event uuid, p_code public.deadline_code)
returns boolean
language sql stable
as $$
  select case
    when d.at is null then false
    when e.paused and d.at > e.paused_at then false
    else now() > d.at
  end
  from public.events e left join public.deadlines d on d.event_id = e.id and d.code = p_code
  where e.id = p_event
$$;

create or replace function app.event_label(p_squad_number int, p_role text)
returns text
language sql immutable
as $$
  select 'Squad ' || lpad(p_squad_number::text, 2, '0') || ' · ' || p_role
$$;

-- The round currently accepting orders (status OPEN and before its close), if any.
create or replace function app.open_round(p_event uuid)
returns public.rounds
language sql stable
as $$
  select r.* from public.rounds r join public.events e on e.id = r.event_id
   where r.event_id = p_event and r.status = 'OPEN' and now() < r.closes_at and r.phase = e.current_phase
   order by r.number limit 1
$$;

-- OPEN, PAUSED or HALTED, exactly as the display badge shows it.
create or replace function app.trading_state(p_event uuid)
returns text
language sql stable
as $$
  select case
    when e.paused or e.current_phase = 'BREAK' then 'PAUSED'
    when (app.open_round(p_event)).id is not null then 'OPEN'
    else 'HALTED'
  end
  from public.events e where e.id = p_event
$$;

-- ───────────────────────────── Realtime ─────────────────────────────

-- Public broadcast on topic event:<id>. Sent through realtime.send inside the transaction, so it goes out on
-- commit only. Clients refetch their own private rows through RLS when they receive it.
create or replace function app.broadcast(p_event uuid, p_kind text, p_payload jsonb default '{}'::jsonb)
returns void
language plpgsql
as $$
begin
  perform realtime.send(
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('kind', p_kind, 'event_id', p_event, 'at', now()),
    p_kind,
    'event:' || p_event::text,
    false);
end
$$;

-- ───────────────────────────── Submissions text (engine submissions.ts) ─────────────────────────────

create or replace function app.template_fields(p_type public.submission_type)
returns table (ord int, key text, label text)
language sql immutable
as $$
  select t.ord, t.key, t.label from (values
    ('PITCH'::public.submission_type, 1, 'problem', 'The problem'),
    ('PITCH', 2, 'solution', 'The solution'),
    ('PITCH', 3, 'customers', 'Customers'),
    ('PITCH', 4, 'business_model', 'How we make money'),
    ('PITCH', 5, 'advantage', 'Our advantage'),
    ('PITCH', 6, 'use_of_seed', 'Use of seed money'),
    ('PLAN', 1, 'crisis', 'The crisis'),
    ('PLAN', 2, 'new_plan', 'The new plan'),
    ('PLAN', 3, 'money', 'The money'),
    ('PLAN', 4, 'deal', 'The rescue deal'),
    ('PLAN', 5, 'time_to_recovery', 'Time to recovery'),
    ('PLAN', 6, 'risks', 'Risks'),
    ('PLAN', 7, 'next_steps', 'Next three steps'),
    ('FLASH', 1, 'answer', 'Our answer')
  ) t(type, ord, key, label)
  where t.type = p_type
$$;

-- Same definition as the engine (submissions.ts wordCount): invisible format characters count as spaces; a word is
-- a token between ASCII whitespace with at least one character that is not punctuation.
create or replace function app.word_count(p_text text)
returns integer
language sql immutable strict
as $$
  select count(*)::int
    from regexp_split_to_table(
           btrim(regexp_replace(p_text, E'[\u00AD\u200B-\u200F\u2028-\u202E\u2060-\u2064\uFEFF]', ' ', 'g'), E' \t\n\r\f\x0B'),
           E'[ \t\n\r\f\x0B]+') w
   where w <> '' and w ~ E'[^ \t\n\r\f\x0B!-/:-@[-`{-~\u00A0-\u00BF\u00D7\u00F7\u2010-\u2027]'
$$;

create or replace function app.content_field(p_content jsonb, p_key text)
returns text
language sql immutable
as $$
  select case when jsonb_typeof(p_content -> p_key) = 'string' then btrim(p_content ->> p_key, E' \t\n\r\f\x0B') else '' end
$$;

create or replace function app.submission_words(p_type public.submission_type, p_content jsonb)
returns integer
language sql immutable
as $$
  select coalesce(sum(app.word_count(app.content_field(p_content, f.key))), 0)::int from app.template_fields(p_type) f
$$;

create or replace function app.submission_text(p_type public.submission_type, p_content jsonb)
returns text
language sql immutable
as $$
  select concat_ws(E'\n\n',
    case when p_type = 'PITCH' then
      app.content_field(p_content, 'company_name') || ' (' || upper(app.content_field(p_content, 'ticker')) || ')' end,
    (select string_agg(f.label || E':\n' || app.content_field(p_content, f.key), E'\n\n' order by f.ord)
       from app.template_fields(p_type) f where app.content_field(p_content, f.key) <> ''))
$$;
