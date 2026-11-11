-- One-case mode: every squad plays the same case.
-- A problem deck of exactly ONE card gives every squad that card at the draw, already chosen (nothing to pick), and
-- a crisis deck of exactly one card already hits every company with the same crisis (app.lottery_crises needs no
-- change). Decks of squads + 2 cards or more still deal 3 cards per squad as before. Squads and coverage use their
-- own random streams, so they do not change with the deck. Mirrors dealProblemCards in packages/engine.

create or replace function app.problem_deck_size_ok(p_cards integer, p_squads integer)
returns boolean
language sql immutable parallel safe
as $$
  select p_cards = 1 or p_cards >= p_squads + 2
$$;

alter table public.squads drop constraint if exists squads_dealt_card_ids_check;
alter table public.squads add constraint squads_dealt_card_ids_check check (cardinality(dealt_card_ids) in (0, 1, 3));

-- A squad dealt a single card has it chosen at once.
create or replace function app.squads_one_case()
returns trigger
language plpgsql
as $$
begin
  if cardinality(new.dealt_card_ids) = 1 and new.chosen_card_id is null then
    new.chosen_card_id := new.dealt_card_ids[1];
    new.chosen_at := now();
    new.chosen_by_default := false;
  end if;
  return new;
end
$$;
drop trigger if exists squads_one_case on public.squads;
create trigger squads_one_case before insert on public.squads for each row execute function app.squads_one_case();

create or replace function app.default_problem_cards(p_event uuid)
returns void
language sql
as $$
  update public.squads set chosen_card_id = dealt_card_ids[1], chosen_at = now(), chosen_by_default = true
   where event_id = p_event and chosen_card_id is null and cardinality(dealt_card_ids) in (1, 3)
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
  if coalesce(array_length(p_cards, 1), 0) <> 1 and coalesce(array_length(p_cards, 1), 0) < n + 2 then
    raise exception 'the deck needs exactly 1 card, or at least 2 more cards than there are squads';
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
  for s in 1..n loop
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
      'cards', case when array_length(p_cards, 1) = 1 then jsonb_build_array(hands[s][1])
                    else jsonb_build_array(hands[s][1], hands[s][2], hands[s][3]) end,
      'covers', jsonb_build_array(p[covers[s][1]], p[covers[s][2]]));
  end loop;
  return out;
end
$$;

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
  if not app.problem_deck_size_ok(v_n, v_squads) or v_n > 999 then
    return app.fail('BAD_DECK', format('The deck needs exactly 1 card (every squad plays the same case) or at least %s cards (squads + 2), and at most 999.', v_squads + 2));
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

create or replace function app.gate_blocker(p_event uuid)
returns text
language sql stable
as $$
  select case e.current_phase
    when 'SETUP' then case
      when e.seed_commitment is null then 'Publish the seed commitment before the event starts.'
      when not exists (select 1 from public.problem_cards p where p.event_id = e.id) then 'Upload the problem deck before the event starts.'
      when not app.problem_deck_size_ok((select count(*)::int from public.problem_cards p where p.event_id = e.id),
                                        (select count(*)::int from public.teams t where t.event_id = e.id and t.track = 'PRODUCT'))
        then format('The problem deck needs exactly 1 card (one case for every squad) or at least %s cards (squads + 2) before the event starts.',
                    (select count(*) from public.teams t where t.event_id = e.id and t.track = 'PRODUCT') + 2)
      when not exists (select 1 from public.crisis_cards c where c.event_id = e.id) then 'Upload the crisis deck before the event starts.'
    end
    when 'SQUAD_DRAW' then case when e.drawn_at is null then 'The lottery has not been drawn.' end
    when 'READING' then case when not app.score_released(e.id, 'PITCH') then 'Pitch scores have not been released.' end
    when 'VERDICTS' then case when not app.score_released(e.id, 'PLAN') then 'Plan scores have not been released.' end
    when 'ROUNDS_13_21' then case when not app.score_released(e.id, 'FLASH') then 'Flash scores have not been released.' end
    when 'APPEALS' then case
      when exists (select 1 from public.flags f where f.event_id = e.id and f.status = 'OPEN')
        then 'Collusion flags are still open for the fairness officer.'
      when exists (select 1 from public.appeals a where a.event_id = e.id and a.after_release and a.status in ('JUDGING', 'READY'))
        then 'A technical appeal is still open: apply or dismiss it on the Judge page.'
    end
    when 'AWARDS' then 'The event has ended.'
  end
  from public.events e where e.id = p_event
$$;

revoke all on function app.problem_deck_size_ok(integer, integer) from public, anon, authenticated;
revoke all on function app.squads_one_case() from public, anon, authenticated;
