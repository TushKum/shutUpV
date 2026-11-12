-- Sectors: an event can be split across 2 to 6 sectors (for example Luxury, FMCG and Energy).
--
-- The draw. A problem deck of 2 to 6 cards (fewer than squads + 2) is a set of sectors, one card each: the lottery
-- shuffles the squads and deals them round the cards, so each sector gets an equal share (counts differ by at most
-- one), and each squad's card is chosen at once. Seeded like the rest of the draw (stream 'problems'), so the public
-- lottery record proves every squad's sector. Mirrors dealProblemCards in packages/engine.
--
-- The crises. A crisis card may name a sector. When it does, every company of that sector gets its sector's card in
-- each crisis: the card whose number is k in crisis k (else the sector's cards in turn). Every company of a sector
-- faces the same card. Cards without a sector are dealt by the lottery as before.
--
-- Round 3. A problem statement may name a sector. A company may draft only its own sector's statements, a pick that
-- runs out gives the least-crowded statement of its own sector, and each sector's statements must have room for
-- that sector's companies before the draft starts.

create or replace function app.norm_sector(p text)
returns text
language sql immutable parallel safe
as $$ select nullif(lower(btrim(coalesce(p, ''))), '') $$;

-- A company's sector: the sector on its squad's chosen problem card.
create or replace function app.company_sector(p_company uuid)
returns text
language sql stable
as $$
  select app.norm_sector(pc.sector)
    from public.companies c join public.squads s on s.id = c.squad_id join public.problem_cards pc on pc.id = s.chosen_card_id
   where c.id = p_company
$$;

-- ───────────────────────────── The draw ─────────────────────────────

create or replace function app.problem_deck_size_ok(p_cards integer, p_squads integer)
returns boolean
language sql immutable parallel safe
as $$
  select p_cards = 1 or p_cards between 2 and 6 or p_cards >= p_squads + 2
$$;

create or replace function app.lottery_draw(p_root text, p_product text[], p_consulting text[], p_finance text[], p_cards text[])
returns jsonb
language plpgsql immutable parallel safe
as $$
declare
  n int := coalesce(array_length(p_product, 1), 0);
  st app.rng_state;
  p text[];
  c text[];
  f text[];
  hands text[][];
  left_count int[];
  candidates text[];
  hand text[];
  pick bigint;
  cycle text[];
  covers int[][];
  out jsonb := '[]'::jsonb;
  s int;
  k int;
  idx int;
  pos int;
  squad int;
  rec record;
  v_few boolean;
  v_order text[];
begin
  if coalesce(array_length(p_consulting, 1), 0) <> n or coalesce(array_length(p_finance, 1), 0) <> n then
    raise exception 'tracks must be the same size';
  end if;
  if n < 3 then
    raise exception 'coverage needs at least 3 squads';
  end if;
  if (select count(distinct x) from unnest(p_cards) x) <> coalesce(array_length(p_cards, 1), 0) then
    raise exception 'duplicate card ids';
  end if;
  if coalesce(array_length(p_cards, 1), 0) <> 1 and coalesce(array_length(p_cards, 1), 0) < n + 2
     and coalesce(array_length(p_cards, 1), 0) not between 2 and 6 then
    raise exception 'the deck needs 1 card, 2 to 6 sector cards, or at least 2 more cards than there are squads';
  end if;

  -- Squads.
  st := app.rng_new(p_root, 'squads');
  select * into rec from app.rng_shuffle(st, array(select x from unnest(p_product) x order by x collate "C"));
    st := rec.st; p := rec.result;
  select * into rec from app.rng_shuffle(st, array(select x from unnest(p_consulting) x order by x collate "C"));
    st := rec.st; c := rec.result;
  select * into rec from app.rng_shuffle(st, array(select x from unnest(p_finance) x order by x collate "C"));
    st := rec.st; f := rec.result;

  -- Problem cards. One-case mode: a one-card deck gives every squad that card and draws nothing.
  st := app.rng_new(p_root, 'problems');
  left_count := array_fill(3, array[array_length(p_cards, 1)]);
  hands := array_fill(null::text, array[n, 3]);
  -- Sector mode: 2 to 6 cards (fewer than squads + 2) are sectors. Squads are shuffled and dealt round the cards, so
  -- every card gets an equal share (the counts differ by at most one); each squad gets one card, already chosen.
  v_few := array_length(p_cards, 1) between 2 and 6 and array_length(p_cards, 1) < n + 2;
  if v_few then
    select * into rec from app.rng_shuffle(st, array(select g::text from generate_series(0, n - 1) g));
      st := rec.st; v_order := rec.result;
    for pos in 1..n loop
      hands[v_order[pos]::int + 1][1] := p_cards[((pos - 1) % array_length(p_cards, 1)) + 1];
    end loop;
  end if;
  for s in 1..n loop
    if v_few then
      continue;
    end if;
    if array_length(p_cards, 1) = 1 then
      hands[s][1] := p_cards[1];
      continue;
    end if;
    hand := '{}';
    for k in 1..3 loop
      candidates := '{}';
      for idx in 1..array_length(p_cards, 1) loop
        if left_count[idx] > 0 and not (p_cards[idx] = any (hand)) then
          candidates := candidates || p_cards[idx];
        end if;
      end loop;
      if coalesce(array_length(candidates, 1), 0) = 0 then
        raise exception 'the deck cannot deal 3 distinct cards to every squad';
      end if;
      select * into rec from app.rng_int(st, array_length(candidates, 1));
    st := rec.st; pick := rec.val;
      hand := hand || candidates[pick + 1];
      idx := array_position(p_cards, candidates[pick + 1]);
      left_count[idx] := left_count[idx] - 1;
    end loop;
    hands[s][1] := hand[1];
    hands[s][2] := hand[2];
    hands[s][3] := hand[3];
  end loop;

  -- Coverage: squads in a random cycle; each consultant covers the next two squads' companies.
  st := app.rng_new(p_root, 'coverage');
  select * into rec from app.rng_shuffle(st, array(select g::text from generate_series(0, n - 1) g));
    st := rec.st; cycle := rec.result;
  covers := array_fill(0, array[n, 2]);
  for pos in 1..n loop
    squad := cycle[pos]::int + 1;
    covers[squad][1] := cycle[(pos % n) + 1]::int + 1;
    covers[squad][2] := cycle[((pos + 1) % n) + 1]::int + 1;
  end loop;

  for s in 1..n loop
    out := out || jsonb_build_object(
      'number', s,
      'product', p[s],
      'consulting', c[s],
      'finance', f[s],
      'cards', case when array_length(p_cards, 1) = 1 or v_few then jsonb_build_array(hands[s][1])
                    else jsonb_build_array(hands[s][1], hands[s][2], hands[s][3]) end,
      'covers', jsonb_build_array(p[covers[s][1]], p[covers[s][2]]));
  end loop;
  return out;
end
$$;


-- ───────────────────────────── The crises ─────────────────────────────

alter table public.crisis_cards add column if not exists sector text check (length(sector) <= 100);
alter table public.crisis_cards drop constraint if exists crisis_cards_event_id_category_number_key;
create unique index if not exists crisis_cards_unique_uq on public.crisis_cards (event_id, coalesce(app.norm_sector(sector), ''), category, number);

-- The card this company gets in crisis k from its own sector's cards, or null (no sector, or no card for it).
create or replace function app.sector_crisis_card(p_company uuid, p_k int)
returns uuid
language sql stable
as $$
  with mine as (
    select k.id, k.number, row_number() over (order by k.number, k.category collate "C", k.id) as i, count(*) over () as n
      from public.crisis_cards k join public.companies c on c.event_id = k.event_id
     where c.id = p_company and app.norm_sector(k.sector) is not null and app.norm_sector(k.sector) = app.company_sector(p_company))
  select coalesce((select id from mine where number = p_k order by i limit 1),
                  (select id from mine where i = ((p_k - 1) % n) + 1 limit 1))
$$;
revoke all on function app.sector_crisis_card(uuid, int) from public, anon, authenticated;

select app.patch_functions(
  '  select p_event, c.id, p_k, v_cards[s.number]::uuid',
  '  select p_event, c.id, p_k, coalesce(app.sector_crisis_card(c.id, p_k), v_cards[s.number]::uuid)');

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
       or length(c ->> 'title') > 200 or length(c ->> 'body') > 4000 or length(c ->> 'category') > 100
       or length(coalesce(c ->> 'sector', '')) > 100 then
      return app.fail('BAD_DECK', format('Card %s #%s needs a category, a number from 1 to 999, a title and a body.',
                                         coalesce(c ->> 'category', '?'), coalesce(c ->> 'number', '?')));
    end if;
  end loop;
  if (select count(distinct (coalesce(app.norm_sector(x ->> 'sector'), ''), btrim(x ->> 'category'), (x ->> 'number')::numeric::int))
        from jsonb_array_elements(p_cards) x) <> v_n then
    return app.fail('BAD_DECK', 'Each sector, category and number must be unique.');
  end if;
  delete from public.crisis_cards where event_id = p_event;
  insert into public.crisis_cards (event_id, category, number, title, body, sector)
  select p_event, btrim(x ->> 'category'), (x ->> 'number')::numeric::int, btrim(x ->> 'title'), btrim(x ->> 'body'),
         nullif(btrim(coalesce(x ->> 'sector', '')), '')
    from jsonb_array_elements(p_cards) x;
  perform app.broadcast_staff(p_event, 'content');
  return app.ok(jsonb_build_object('cards', v_n, 'categories', (select count(distinct category) from public.crisis_cards where event_id = p_event)));
end
$$;

-- ───────────────────────────── Round 3 ─────────────────────────────

alter table public.problem_statements add column if not exists sector text check (length(sector) <= 100);

-- A sector whose statements have too little room for its companies, as "sector: room/companies" (null: all fit).
-- Only once the squads are drawn (before, a company has no sector), and only for statements that name a sector.
create or replace function app.sector_room_short(p_event uuid)
returns text
language sql stable
as $$
  select string_agg(format('%s has room for %s but %s companies', d.sec, d.room, d.n), '; ' order by d.sec)
    from (select x.sec, count(*) as n,
                 (select coalesce(sum(st.cap), 0) from public.problem_statements st
                   where st.event_id = p_event and app.norm_sector(st.sector) = x.sec) as room
            from (select app.company_sector(c.id) as sec from public.companies c
                   where c.event_id = p_event and c.squad_id is not null) x
           where x.sec is not null
           group by x.sec) d
   where exists (select 1 from public.problem_statements st where st.event_id = p_event and st.sector is not null)
     and d.room < d.n
$$;
revoke all on function app.sector_room_short(uuid) from public, anon, authenticated;

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
  if v_n = 0 or v_room < v_n or app.sector_room_short(p_event) is not null then
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

create or replace function public.set_problem_statements(p_event uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
  v_companies int;
  v_room int;
  v_short text;
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
  -- With sectors, each sector's statements must have room for that sector's companies (known once drawn).
  if exists (select 1 from jsonb_array_elements(p_rows) x where app.norm_sector(x ->> 'sector') is not null) then
    select string_agg(format('%s: room for %s, %s companies', d.sec, d.room, d.n), '; ' order by d.sec) into v_short
      from (select y.sec, count(*) as n,
                   (select coalesce(sum(coalesce(nullif(x ->> 'cap', '')::int, 5)), 0) from jsonb_array_elements(p_rows) x
                     where app.norm_sector(x ->> 'sector') = y.sec) as room
              from (select app.company_sector(c.id) as sec from public.companies c
                     where c.event_id = p_event and c.squad_id is not null) y
             where y.sec is not null
             group by y.sec) d
     where d.room < d.n;
    if v_short is not null then
      return app.fail('NOT_ENOUGH_ROOM', 'Each sector needs room for its companies. ' || v_short || '. Add statements or raise their caps.');
    end if;
  end if;
  delete from public.draft_picks where event_id = p_event;
  delete from public.problem_statements where event_id = p_event;
  insert into public.problem_statements (event_id, number, title, body, cap, sector)
  select p_event, coalesce((x ->> 'number')::smallint, o::smallint), btrim(x ->> 'title'), btrim(x ->> 'body'),
         coalesce(nullif(x ->> 'cap', '')::smallint, 5), nullif(btrim(coalesce(x ->> 'sector', '')), '')
    from jsonb_array_elements(p_rows) with ordinality t(x, o);
  get diagnostics n = row_count;
  return app.ok(jsonb_build_object('statements', n, 'draft_started', app.start_draft(p_event)));
end
$$;


-- The least-crowded statement with room in this company's sector (when the statements have sectors), else any.
create or replace function app.open_statement(p_event uuid, p_company uuid)
returns uuid
language sql stable
as $$
  select s.id from public.problem_statements s
   where s.event_id = p_event
     and (select count(*) from public.draft_picks d where d.statement_id = s.id) < s.cap
   order by (app.norm_sector(s.sector) is not distinct from app.company_sector(p_company)) desc,
            (select count(*) from public.draft_picks d where d.statement_id = s.id), s.number
   limit 1
$$;
revoke all on function app.open_statement(uuid, uuid) from public, anon, authenticated;

select app.patch_functions(
  'set statement_id = app.open_statement(p_event), picked_at = now(), by_default = true',
  'set statement_id = app.open_statement(p_event, v_pick.company_id), picked_at = now(), by_default = true');

select app.patch_functions(
  '  if v_st.id is null then
    return app.fail(''NO_SUCH_STATEMENT'', ''No such problem statement.'');
  end if;',
  '  if v_st.id is null then
    return app.fail(''NO_SUCH_STATEMENT'', ''No such problem statement.'');
  end if;
  if app.norm_sector(v_st.sector) is not null and app.norm_sector(v_st.sector) is distinct from app.company_sector(v_pick.company_id) then
    return app.fail(''WRONG_SECTOR'', format(''Statement %s belongs to the %s sector; pick one of your own sector.'', v_st.number, v_st.sector));
  end if;');

revoke all on function app.norm_sector(text), app.company_sector(uuid) from public, anon, authenticated;

select app.patch_functions(
  'The problem deck needs exactly 1 card (one case for every squad) or at least %s cards (squads + 2) before the event starts.',
  'The problem deck needs 1 card (one case for every squad), 2 to 6 cards (one per sector) or at least %s cards (squads + 2) before the event starts.');

select app.patch_functions(
  'The deck needs exactly 1 card (every squad plays the same case) or at least %s cards (squads + 2), and at most 999.',
  'The deck needs 1 card (every squad plays the same case), 2 to 6 cards (one per sector) or at least %s cards (squads + 2), and at most 999.');
