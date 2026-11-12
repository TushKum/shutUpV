-- Running a PRIMUS event with 50 companies and about 600 screens: four fixes found by reading the night end to end.
--
-- 1. Round 3 could lock itself. Entering SATURATION without problem statements created a draft that could never
--    move, and the statements could then no longer be uploaded (DRAFT_STARTED). Now the draft starts only once there
--    are statements with room for every company: at the start of Round 3 if they are there, otherwise the moment the
--    organisers upload them. Statements can be replaced until the first pick is made, and an upload with too little
--    room for the companies is refused with the numbers.
-- 2. The draft gives each company 20 seconds, so 50 companies need 16 min 40 s, but the draft's deadline (DRAFT) is
--    15 minutes after Round 3 starts: the last companies would lose their pick. When the draft starts, DRAFT moves
--    later if needed so that every company gets its 20 seconds (HIRE_5 keeps at least 10 minutes after it).
-- 3. Screens were not told when a sub-round's hiring closed, its escrow was settled or its ratings closed (they only
--    re-read on their own clock, sometimes before the heartbeat had done the work). The heartbeat now broadcasts each.
-- 4. Every offer, counter and answer was broadcast to the whole event without saying whom it concerned, so every
--    screen re-read itself (hundreds of page loads per offer during hiring). The message now names the company's
--    Product team and the firm; the team portal ignores offers that are not its own.

-- ───────────────────────────── 1 and 2. The draft ─────────────────────────────

-- Starts the Round 3 draft if it can start: SATURATION, no draft yet, and statements with room for every company.
create or replace function app.start_draft(p_event uuid)
returns boolean
language plpgsql
as $$
declare
  v_event public.events;
  v_n int;
  v_room int;
  v_end timestamptz;
begin
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.format <> 'PRIMUS' or v_event.current_phase <> 'SATURATION'
     or exists (select 1 from public.draft_picks where event_id = p_event) then
    return false;
  end if;
  select count(*) into v_n from public.companies c where c.event_id = p_event and c.squad_id is not null;
  select coalesce(sum(cap), 0) into v_room from public.problem_statements where event_id = p_event;
  if v_n = 0 or v_room < v_n then
    return false;
  end if;
  -- Lowest score so far first (ties: the lower ticker, then the company id), 20 s per pick.
  insert into public.draft_picks (event_id, company_id, pick_no, score_avg, opens_at, closes_at)
  select p_event, c.id, n, a, now() + make_interval(secs => 20 * (n - 1)), now() + make_interval(secs => 20 * n)
    from (select c.id, app.score_so_far(c.id) as a,
                 row_number() over (order by app.score_so_far(c.id), c.ticker collate "C", c.id) as n
            from public.companies c where c.event_id = p_event and c.squad_id is not null) c;
  -- Every company gets its 20 seconds: the draft's deadline moves later if the schedule left too little time, and
  -- hiring for Round 3 keeps at least 10 minutes after it.
  v_end := now() + make_interval(secs => 20 * v_n + 20);
  update public.deadlines set at = v_end where event_id = p_event and code = 'DRAFT' and at < v_end;
  update public.deadlines set at = v_end + interval '10 minutes'
   where event_id = p_event and code = 'HIRE_5' and at < v_end + interval '10 minutes';
  perform app.broadcast(p_event, 'draft', jsonb_build_object('step', 'start'));
  return true;
end
$$;
revoke all on function app.start_draft(uuid) from public, anon, authenticated;

create or replace function app.enter_saturation(p_event uuid)
returns void
language plpgsql
as $$
declare
  v_event public.events;
  v_txn uuid := gen_random_uuid();
  v_total bigint;
  v_started boolean;
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
  insert into public.subrounds (event_id, k) values (p_event, 5) on conflict do nothing;
  v_started := app.start_draft(p_event);
  insert into public.bulletins (event_id, kind, title, body, published_at)
  values (p_event, 'GENERAL', 'Round 3: market saturation',
          case when v_started
               then 'The problem statements are out. Product teams pick in the draft (lowest score first, 20 seconds each). '
               else 'The problem statements are coming: the draft starts as soon as the organisers publish them. ' end
          || 'Every fund has received 50% of its starting capital.', now());
  if not v_started then
    perform app.broadcast(p_event, 'draft', jsonb_build_object('step', 'waiting'));
  end if;
end
$$;

-- Replaces the statements (rows: [{number, title, body, cap?}]) until the first pick is made. They must have room
-- for every company. Uploaded during Round 3 (late, or to correct them before anyone picked), the draft (re)starts.
create or replace function public.set_problem_statements(p_event uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
  v_companies int;
  v_room int;
begin
  perform app.require_organiser();
  perform 1 from public.events where id = p_event for no key update;
  if exists (select 1 from public.draft_picks where event_id = p_event and statement_id is not null) then
    return app.fail('DRAFT_STARTED', 'A company has already picked; the statements can no longer change.');
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return app.fail('BAD_CONTENT', 'Upload at least one problem statement.');
  end if;
  select count(*) into v_companies from public.companies c
   where c.event_id = p_event and (c.squad_id is not null or not exists (select 1 from public.squads s where s.event_id = p_event));
  select coalesce(sum(coalesce(nullif(x ->> 'cap', '')::int, 5)), 0) into v_room from jsonb_array_elements(p_rows) x;
  if v_room < v_companies then
    return app.fail('NOT_ENOUGH_ROOM',
      format('These statements have room for %s companies, but there are %s. Add statements or raise their caps.', v_room, v_companies));
  end if;
  delete from public.draft_picks where event_id = p_event;
  delete from public.problem_statements where event_id = p_event;
  insert into public.problem_statements (event_id, number, title, body, cap)
  select p_event, coalesce((x ->> 'number')::smallint, o::smallint), btrim(x ->> 'title'), btrim(x ->> 'body'),
         coalesce(nullif(x ->> 'cap', '')::smallint, 5)
    from jsonb_array_elements(p_rows) with ordinality t(x, o);
  get diagnostics n = row_count;
  return app.ok(jsonb_build_object('statements', n, 'draft_started', app.start_draft(p_event)));
end
$$;

-- ───────────────────────────── 3. The heartbeat tells the screens ─────────────────────────────

select app.patch_functions(
  '      v_actions := v_actions || (''hiring closed '' || v_k);',
  '      v_actions := v_actions || (''hiring closed '' || v_k);
      perform app.broadcast(p_event, ''subround'', jsonb_build_object(''k'', v_k, ''step'', ''hiring_closed''));');
select app.patch_functions(
  '      v_actions := v_actions || (''escrow settled '' || v_k || '': '' || n);',
  '      v_actions := v_actions || (''escrow settled '' || v_k || '': '' || n);
      perform app.broadcast(p_event, ''subround'', jsonb_build_object(''k'', v_k, ''step'', ''due''));');
select app.patch_functions(
  '      v_actions := v_actions || (''ratings closed '' || v_k);',
  '      v_actions := v_actions || (''ratings closed '' || v_k);
      perform app.broadcast(p_event, ''subround'', jsonb_build_object(''k'', v_k, ''step'', ''rated''));');

-- ───────────────────────────── 4. Offers say whom they concern ─────────────────────────────

select app.patch_functions(
  'perform app.broadcast(v_team.event_id, ''offers'', jsonb_build_object(''firm'', p_firm, ''company'', v_company.id));',
  'perform app.broadcast(v_team.event_id, ''offers'', jsonb_build_object(''firm'', p_firm, ''product'', v_company.product_team_id));');
select app.patch_functions(
  'perform app.broadcast(v_team.event_id, ''offers'', jsonb_build_object(''offer'', p_offer));',
  'perform app.broadcast(v_team.event_id, ''offers'', jsonb_build_object(''offer'', p_offer, ''firm'', v_offer.firm_team_id, ''product'', v_company.product_team_id));');
select app.patch_functions(
  'perform app.broadcast(v_team.event_id, ''offers'', jsonb_build_object(''offer'', p_offer, ''accepted'', true));',
  'perform app.broadcast(v_team.event_id, ''offers'', jsonb_build_object(''offer'', p_offer, ''accepted'', true, ''firm'', v_offer.firm_team_id, ''product'', v_company.product_team_id));');
