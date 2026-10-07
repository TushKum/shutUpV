-- The verifiable lottery's generator and draws in SQL: a port of packages/engine/src/lottery.ts, checked
-- against it draw for draw by supabase/tests/parity.test.ts.
--   root  = hex(SHA-256(seed || dice))
--   block i of a stream = SHA-256(root || ':' || stream || ':' || i), read as 8 big-endian uint32 words
--   int(n) = rejection sampling below 2^32 − (2^32 mod n); shuffle = Fisher–Yates from the end

create or replace function app.sha256_hex(p_text text)
returns text
language sql immutable strict parallel safe
as $$
  select encode(extensions.digest(convert_to(p_text, 'UTF8'), 'sha256'), 'hex')
$$;

create type app.rng_state as (root text, stream text, block integer, words bigint[]);

create or replace function app.rng_new(p_root text, p_stream text)
returns app.rng_state
language sql immutable strict parallel safe
as $$
  select row(p_root, p_stream, 0, '{}'::bigint[])::app.rng_state
$$;

create or replace function app.rng_uint32(inout st app.rng_state, out val bigint)
language plpgsql immutable parallel safe
as $$
declare
  h bytea;
  i int;
begin
  if coalesce(array_length(st.words, 1), 0) = 0 then
    h := extensions.digest(convert_to(st.root || ':' || st.stream || ':' || st.block, 'UTF8'), 'sha256');
    st.block := st.block + 1;
    st.words := '{}'::bigint[];
    for i in 0..7 loop
      st.words := st.words || ((get_byte(h, 4 * i)::bigint << 24) | (get_byte(h, 4 * i + 1)::bigint << 16)
                               | (get_byte(h, 4 * i + 2)::bigint << 8) | get_byte(h, 4 * i + 3)::bigint);
    end loop;
  end if;
  val := st.words[1];
  st.words := st.words[2:];
end
$$;

-- Uniform integer in [0, n).
create or replace function app.rng_int(inout st app.rng_state, n bigint, out val bigint)
language plpgsql immutable parallel safe
as $$
declare
  lim bigint;
  u bigint;
  rec record;
begin
  if n < 1 or n > 4294967296 then
    raise exception 'bad range %', n;
  end if;
  lim := 4294967296 - (4294967296 % n);
  loop
    select * into rec from app.rng_uint32(st);
    st := rec.st; u := rec.val;
    if u < lim then
      val := u % n;
      return;
    end if;
  end loop;
end
$$;

create or replace function app.rng_shuffle(inout st app.rng_state, items text[], out result text[])
language plpgsql immutable parallel safe
as $$
declare
  i int;
  j bigint;
  tmp text;
  rec record;
begin
  result := items;
  for i in reverse coalesce(array_length(items, 1), 0)..2 loop
    select * into rec from app.rng_int(st, i);
    st := rec.st; j := rec.val;
    tmp := result[i];
    result[i] := result[j + 1];
    result[j + 1] := tmp;
  end loop;
end
$$;

-- drawLottery minus the root: squads (sorted inputs, shuffled per track), 3 distinct problem cards per squad
-- with each card used at most 3 times, and coverage (random cycle, next two squads). Card keys must be given in
-- deck order. Output matches the engine's LotteryResult.squads.
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
  if coalesce(array_length(p_cards, 1), 0) < n + 2 then
    raise exception 'the deck needs at least 2 more cards than there are squads';
  end if;

  -- Squads.
  st := app.rng_new(p_root, 'squads');
  select * into rec from app.rng_shuffle(st, array(select x from unnest(p_product) x order by x collate "C"));
    st := rec.st; p := rec.result;
  select * into rec from app.rng_shuffle(st, array(select x from unnest(p_consulting) x order by x collate "C"));
    st := rec.st; c := rec.result;
  select * into rec from app.rng_shuffle(st, array(select x from unnest(p_finance) x order by x collate "C"));
    st := rec.st; f := rec.result;

  -- Problem cards.
  st := app.rng_new(p_root, 'problems');
  left_count := array_fill(3, array[array_length(p_cards, 1)]);
  hands := array_fill(null::text, array[n, 3]);
  for s in 1..n loop
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
      'cards', jsonb_build_array(hands[s][1], hands[s][2], hands[s][3]),
      'covers', jsonb_build_array(p[covers[s][1]], p[covers[s][2]]));
  end loop;
  return out;
end
$$;

-- assignCrises: for squad index i (1-based here), the crisis card. Deck: [{"id","category","number"}].
create or replace function app.lottery_crises(p_root text, p_squads integer, p_deck jsonb)
returns text[]
language plpgsql immutable parallel safe
as $$
declare
  categories text[];
  st app.rng_state;
  ord text[];
  result text[] := array_fill(null::text, array[p_squads]);
  k int;
  squad int;
  cards text[];
  pick bigint;
  rec record;
begin
  categories := array(select d.cat from (select distinct x ->> 'category' as cat from jsonb_array_elements(p_deck) x) d
                        order by d.cat collate "C");
  if coalesce(array_length(categories, 1), 0) = 0 then
    raise exception 'the crisis deck is empty';
  end if;
  st := app.rng_new(p_root, 'crisis');
  select * into rec from app.rng_shuffle(st, array(select g::text from generate_series(0, p_squads - 1) g));
    st := rec.st; ord := rec.result;
  for k in 1..p_squads loop
    squad := ord[k]::int + 1;
    cards := array(select x ->> 'id' from jsonb_array_elements(p_deck) x
                    where x ->> 'category' = categories[((k - 1) % array_length(categories, 1)) + 1]
                    order by (x ->> 'number')::int);
    if array_length(cards, 1) = 1 then
      result[squad] := cards[1];
    else
      select * into rec from app.rng_int(st, array_length(cards, 1));
    st := rec.st; pick := rec.val;
      result[squad] := cards[pick + 1];
    end if;
  end loop;
  return result;
end
$$;
