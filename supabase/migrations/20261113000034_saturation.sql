-- PRIMUS Round 3, "Saturation" (docs/PRIMUS.md): organisers upload problem statements (each takes at most 5
-- companies). At the start of SATURATION every fund receives 50% of its starting capital, and the draft begins:
-- Product teams pick a statement one at a time, lowest score so far first (average of the PRD and the four crisis
-- plans), 20 seconds each; a team that does not pick gets the least-crowded open statement. Firms are then hired
-- for Round 3 (sub-round 5: fee worth 5–20% of the company's cash, at most 3 counters each) and the solution
-- (SOLUTION) is written. Released solutions move the price by their tier, scaled by rank within the statement:
-- 1st ×1, 2nd ×0.75, 3rd ×0.5, 4th–5th ×0.25 on a positive tier; a negative tier applies in full; a statement with
-- one company gives it its full tier. Final scores follow the guide (Product tie-break: average AI score;
-- Consultancy: firm value, tie-break average client rating; Finance: return on all capital received).

create table public.problem_statements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  number smallint not null check (number between 1 and 99),
  title text not null check (length(title) between 1 and 140),
  body text not null check (length(body) between 1 and 4000),
  cap smallint not null default 5 check (cap between 1 and 50),
  unique (event_id, number)
);
alter table public.problem_statements enable row level security;
-- Shown to teams from Round 3.
create policy problem_statements_read on public.problem_statements for select to authenticated
  using (app.is_staff() or (event_id = app.my_event_id()
         and (select current_phase from public.events e where e.id = event_id) >= 'SATURATION'));

create table public.draft_picks (
  event_id uuid not null references public.events (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  pick_no smallint not null,
  -- The average score that set the order (lowest first).
  score_avg numeric(6, 2) not null,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  statement_id uuid references public.problem_statements (id),
  picked_at timestamptz,
  by_default boolean not null default false,
  primary key (company_id),
  unique (event_id, pick_no)
);
alter table public.draft_picks enable row level security;
create policy draft_picks_read on public.draft_picks for select to authenticated
  using (event_id = app.my_event_id() or app.is_staff());

-- ───────────────────────────── Organisers: the statements ─────────────────────────────

-- Replaces the statements (rows: [{number, title, body, cap?}]) while the draft has not started.
create or replace function public.set_problem_statements(p_event uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  perform app.require_organiser();
  if exists (select 1 from public.draft_picks where event_id = p_event) then
    return app.fail('DRAFT_STARTED', 'The draft has started; the statements can no longer change.');
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return app.fail('BAD_CONTENT', 'Upload at least one problem statement.');
  end if;
  delete from public.problem_statements where event_id = p_event;
  insert into public.problem_statements (event_id, number, title, body, cap)
  select p_event, coalesce((x ->> 'number')::smallint, o::smallint), btrim(x ->> 'title'), btrim(x ->> 'body'),
         coalesce(nullif(x ->> 'cap', '')::smallint, 5)
    from jsonb_array_elements(p_rows) with ordinality t(x, o);
  get diagnostics n = row_count;
  return app.ok(jsonb_build_object('statements', n));
end
$$;

-- ───────────────────────────── Entering Round 3 ─────────────────────────────

-- A company's average AI score so far (PRD and the four crisis plans; a missing score counts as 0).
create or replace function app.score_so_far(p_company uuid)
returns numeric
language sql stable
as $$
  select round(coalesce(avg(coalesce(s.final_score, 0)), 0), 2)
    from unnest(array['PITCH', 'CRISIS_1', 'CRISIS_2', 'CRISIS_3', 'CRISIS_4']::public.submission_type[]) t
    left join public.scores s on s.company_id = p_company and s.type = t
$$;

create or replace function app.enter_saturation(p_event uuid)
returns void
language plpgsql
as $$
declare
  v_event public.events;
  v_txn uuid := gen_random_uuid();
  v_total bigint;
begin
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.format <> 'PRIMUS' then
    return;
  end if;
  -- The Finance injection: 50% of each fund's starting capital, once.
  if not exists (select 1 from public.ledger_entries where event_id = p_event and kind = 'INJECTION') then
    create temporary table if not exists _inj (team_id uuid, amount bigint) on commit drop;
    truncate _inj;
    insert into _inj
    select t.id, coalesce((select sum(l.cash_delta_cents) from public.ledger_entries l
                            where l.team_id = t.id and l.kind = 'STARTING_CASH'), 0) / 2
      from public.teams t where t.event_id = p_event and t.track = 'FINANCE';
    delete from _inj where amount <= 0;
    insert into public.ledger_entries (event_id, txn_id, kind, team_id, cash_delta_cents, memo)
    select p_event, v_txn, 'INJECTION', team_id, amount, 'Round 3 injection: 50% of starting capital' from _inj;
    select coalesce(sum(amount), 0) into v_total from _inj;
    if v_total > 0 then
      insert into public.ledger_entries (event_id, txn_id, kind, team_id, cash_delta_cents, memo)
      values (p_event, v_txn, 'INJECTION', null, -v_total, 'Paid by the exchange');
      update public.teams t set cash_cents = t.cash_cents + i.amount from _inj i where t.id = i.team_id;
      update public.events set exchange_cash_cents = exchange_cash_cents - v_total where id = p_event;
      insert into public.public_ledger (event_id, txn_id, kind, label, cash_cents)
      values (p_event, v_txn, 'INJECTION', 'Round 3: every fund received 50% of its starting capital', v_total);
    end if;
  end if;
  -- The draft order: lowest score so far first (ties: the lower ticker, then the company id), 20 s per pick.
  if not exists (select 1 from public.draft_picks where event_id = p_event) then
    insert into public.draft_picks (event_id, company_id, pick_no, score_avg, opens_at, closes_at)
    select p_event, c.id, n, a, now() + make_interval(secs => 20 * (n - 1)), now() + make_interval(secs => 20 * n)
      from (select c.id, app.score_so_far(c.id) as a,
                   row_number() over (order by app.score_so_far(c.id), c.ticker collate "C", c.id) as n
              from public.companies c where c.event_id = p_event and c.squad_id is not null) c;
  end if;
  insert into public.subrounds (event_id, k) values (p_event, 5) on conflict do nothing;
  insert into public.bulletins (event_id, kind, title, body, published_at)
  values (p_event, 'GENERAL', 'Round 3: market saturation',
          'The problem statements are out. Product teams pick in the draft (lowest score first, 20 seconds each). '
          || 'Every fund has received 50% of its starting capital.', now());
  perform app.broadcast(p_event, 'draft', jsonb_build_object('step', 'start'));
end
$$;

-- ───────────────────────────── The draft ─────────────────────────────

-- The least-crowded statement with room (ties: the lower number).
create or replace function app.open_statement(p_event uuid)
returns uuid
language sql stable
as $$
  select s.id from public.problem_statements s
   where s.event_id = p_event
     and (select count(*) from public.draft_picks d where d.statement_id = s.id) < s.cap
   order by (select count(*) from public.draft_picks d where d.statement_id = s.id), s.number
   limit 1
$$;

-- The pick whose turn it is (the first one without a statement), or null when the draft is over.
create or replace function app.current_pick(p_event uuid)
returns public.draft_picks
language sql stable
as $$
  select d.* from public.draft_picks d where d.event_id = p_event and d.statement_id is null order by d.pick_no limit 1
$$;

create or replace function public.pick_statement(p_statement uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_pick public.draft_picks;
  v_st public.problem_statements;
begin
  if app.my_team_id() is null then
    raise exception 'only a team can pick a statement' using errcode = '42501';
  end if;
  v_team := app.lock_caller_team();
  if v_team.track <> 'PRODUCT' then
    return app.fail('NOT_ALLOWED', 'The Product team picks the statement.');
  end if;
  perform 1 from public.events where id = v_team.event_id for no key update;
  if app.deadline_passed(v_team.event_id, 'DRAFT') then
    return app.fail('DRAFT_CLOSED', 'The draft has ended.');
  end if;
  v_pick := app.current_pick(v_team.event_id);
  if v_pick.company_id is null or v_pick.company_id <> (select id from public.companies where product_team_id = v_team.id) then
    return app.fail('NOT_YOUR_TURN', 'Wait for your turn in the draft.');
  end if;
  select * into v_st from public.problem_statements where id = p_statement and event_id = v_team.event_id;
  if v_st.id is null then
    return app.fail('NO_SUCH_STATEMENT', 'No such problem statement.');
  end if;
  if (select count(*) from public.draft_picks where statement_id = v_st.id) >= v_st.cap then
    return app.fail('STATEMENT_FULL', format('Statement %s already has %s companies.', v_st.number, v_st.cap));
  end if;
  update public.draft_picks set statement_id = v_st.id, picked_at = now() where company_id = v_pick.company_id;
  perform app.advance_draft(v_team.event_id);
  perform app.broadcast(v_team.event_id, 'draft', jsonb_build_object('step', 'pick', 'pick_no', v_pick.pick_no));
  return app.ok(jsonb_build_object('statement', v_st.number));
end
$$;

-- After a pick: the next team's 20 seconds start now (so the draft never waits on a clock that already passed).
create or replace function app.advance_draft(p_event uuid)
returns void
language sql
as $$
  update public.draft_picks d set opens_at = now(), closes_at = now() + interval '20 seconds'
   where d.event_id = p_event and d.pick_no = (app.current_pick(p_event)).pick_no
$$;

-- The heartbeat's draft step: a pick whose time ran out (or every pick, once DRAFT has passed) gets the
-- least-crowded open statement.
create or replace function app.draft_tick(p_event uuid)
returns int
language plpgsql
as $$
declare
  v_pick public.draft_picks;
  n int := 0;
begin
  loop
    v_pick := app.current_pick(p_event);
    exit when v_pick.company_id is null;
    exit when v_pick.closes_at > now() and not app.deadline_passed(p_event, 'DRAFT');
    update public.draft_picks set statement_id = app.open_statement(p_event), picked_at = now(), by_default = true
     where company_id = v_pick.company_id;
    exit when (select statement_id from public.draft_picks where company_id = v_pick.company_id) is null; -- no room left
    perform app.advance_draft(p_event);
    n := n + 1;
  end loop;
  return n;
end
$$;

create or replace function app.company_statement(p_company uuid)
returns jsonb
language sql stable
as $$
  select jsonb_build_object('number', s.number, 'title', s.title, 'body', s.body)
    from public.draft_picks d join public.problem_statements s on s.id = d.statement_id where d.company_id = p_company
$$;

-- Round 3 work opens once the company has its statement (and the draft is over).
create or replace function app.subround_open(p_event uuid, p_k int)
returns boolean
language sql stable
as $$
  select e.format = 'PRIMUS'
     and not app.deadline_passed(e.id, ('DUE_' || p_k)::public.deadline_code)
     and case when p_k = 5 then e.current_phase = 'SATURATION'
                                and (app.deadline_passed(e.id, 'DRAFT') or (app.current_pick(e.id)).company_id is null)
                                and exists (select 1 from public.draft_picks d where d.event_id = e.id)
              else e.current_phase = 'PRESSURE'
                   and exists (select 1 from public.subrounds s where s.event_id = e.id and s.k = p_k and s.revealed_at is not null) end
    from public.events e where e.id = p_event
$$;

create or replace function app.hiring_subround(p_event uuid)
returns smallint
language sql stable
as $$
  select case
    when e.format <> 'PRIMUS' then null
    when e.current_phase = 'PRESSURE' then (
      select max(s.k) from public.subrounds s
       where s.event_id = e.id and s.k between 1 and 4 and s.revealed_at is not null
         and not app.deadline_passed(e.id, ('HIRE_' || s.k)::public.deadline_code))
    when e.current_phase = 'SATURATION' and app.subround_open(e.id, 5) and not app.deadline_passed(e.id, 'HIRE_5') then 5::smallint
  end
    from public.events e where e.id = p_event
$$;

select app.patch_functions(
  '  for v_k in 1..5 loop
    insert into public.subrounds (event_id, k) values (p_event, v_k) on conflict do nothing;',
  '  if v_event.current_phase = ''SATURATION'' and app.draft_tick(p_event) > 0 then
    v_actions := v_actions || ''draft defaults''::text;
  end if;
  for v_k in 1..5 loop
    insert into public.subrounds (event_id, k) values (p_event, v_k) on conflict do nothing;');

-- ───────────────────────────── Saturation ─────────────────────────────

-- A released solution's price move: its tier, scaled by its rank among the companies on the same statement.
create or replace function app.release_tier_bp(p_company uuid, p_type public.submission_type)
returns integer
language plpgsql stable
as $$
declare
  v_bp int;
  v_rank int;
  v_n int;
begin
  select coalesce(s.tier_bp, 0) into v_bp from public.scores s where s.company_id = p_company and s.type = p_type;
  v_bp := coalesce(v_bp, 0);
  if p_type <> 'SOLUTION' or v_bp <= 0 then
    return v_bp;
  end if;
  select r.rnk, r.n into v_rank, v_n from (
    select d.company_id, count(*) over () as n,
           row_number() over (order by coalesce(s.final_score, 0) desc, c.ticker collate "C", d.company_id) as rnk
      from public.draft_picks d join public.companies c on c.id = d.company_id
      left join public.scores s on s.company_id = d.company_id and s.type = 'SOLUTION'
     where d.statement_id = (select statement_id from public.draft_picks where company_id = p_company)) r
   where r.company_id = p_company;
  if v_n is null or v_n <= 1 then
    return v_bp;
  end if;
  return (v_bp * case v_rank when 1 then 100 when 2 then 75 when 3 then 50 else 25 end) / 100;
end
$$;

-- ───────────────────────────── Final scores ─────────────────────────────

create or replace function app.primus_results(p_event uuid)
returns void
language plpgsql
as $$
begin
  if (select format from public.events where id = p_event) <> 'PRIMUS' then
    return;
  end if;
  -- Product: tie-break by the average AI score (PRD, crisis plans and the solution).
  update public.results r set tiebreak = jsonb_build_object('plan_score', (
      select round(coalesce(avg(coalesce(s.final_score, 0)), 0), 2)
        from unnest(array['PITCH', 'CRISIS_1', 'CRISIS_2', 'CRISIS_3', 'CRISIS_4', 'SOLUTION']::public.submission_type[]) t
        left join public.scores s on s.company_id = (r.details ->> 'company_id')::uuid and s.type = t))
   where r.event_id = p_event and r.track = 'PRODUCT';
  -- Consultancy: firm value (cash + every fee share × its closing price); tie-break by the average client rating.
  update public.results r set
      final_value_cents = t.cash_cents + coalesce(f.v, 0),
      tiebreak = jsonb_build_object('plan_score', coalesce((select avg(e.rating) from public.engagements e where e.firm_team_id = t.id), 0)),
      details = r.details || jsonb_build_object('fee_share_value', coalesce(f.v, 0))
    from public.teams t
    left join (select h.team_id, sum(h.qty::bigint * coalesce(c.closing_price, 0)) as v
                 from public.holdings h join public.companies c on c.id = h.company_id where h.lot = 'FEE' group by h.team_id) f
           on f.team_id = t.id
   where r.event_id = p_event and r.track = 'CONSULTING' and t.id = r.team_id;
  -- Finance: return on all capital received (starting capital and the injection).
  update public.results r set start_value_cents = x.capital, return_bp = app.return_bp(r.final_value_cents, x.capital)
    from (select l.team_id, sum(l.cash_delta_cents) as capital from public.ledger_entries l
           where l.event_id = p_event and l.kind in ('STARTING_CASH', 'INJECTION') and l.team_id is not null group by l.team_id) x
   where r.event_id = p_event and r.track = 'FINANCE' and x.team_id = r.team_id;
end
$$;

select app.patch_functions(
  '   where t.event_id = p_event and t.track = ''FINANCE'';
end',
  '   where t.event_id = p_event and t.track = ''FINANCE'';
  perform app.primus_results(p_event);
end');

do $$
declare f text;
begin
  foreach f in array array['public.set_problem_statements(uuid, jsonb)', 'public.pick_statement(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

revoke all on function app.score_so_far(uuid), app.enter_saturation(uuid), app.open_statement(uuid), app.current_pick(uuid),
  app.advance_draft(uuid), app.draft_tick(uuid), app.company_statement(uuid), app.subround_open(uuid, int),
  app.hiring_subround(uuid), app.release_tier_bp(uuid, public.submission_type), app.primus_results(uuid)
  from public, anon, authenticated;
