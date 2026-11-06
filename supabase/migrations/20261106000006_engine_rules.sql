-- The game engine's rules in SQL. Each function is a direct port of a function in packages/engine/src and is checked
-- against it by supabase/tests/parity.test.ts on generated cases. All arithmetic is in integers / exact numeric;
-- rounding is half-up (ties away from zero) after every multiplication.

-- ───────────────────────────── money.ts ─────────────────────────────

-- round(num ÷ den), ties away from zero.
create or replace function app.div_round_half_up(num numeric, den numeric)
returns bigint
language sql immutable strict parallel safe
as $$
  select (sign(num) * sign(den) * div(2 * abs(num) + abs(den), 2 * abs(den)))::bigint
$$;

create or replace function app.mul_rate(amount numeric, num numeric, den numeric)
returns bigint
language sql immutable strict parallel safe
as $$
  select app.div_round_half_up(amount * num, den)
$$;

create or replace function app.avg_half_up(a numeric, b numeric)
returns bigint
language sql immutable strict parallel safe
as $$
  select app.div_round_half_up(a + b, 2)
$$;

-- ───────────────────────────── prices.ts ─────────────────────────────

create or replace function app.assert_score(p_score integer)
returns integer
language plpgsql immutable strict parallel safe
as $$
begin
  if p_score < 0 or p_score > 100 then
    raise exception 'score must be 0–100, got %', p_score;
  end if;
  return p_score;
end
$$;

-- $10.00 + $0.10 × (PRD score − 50).
create or replace function app.start_price(p_score integer)
returns integer
language sql immutable strict parallel safe
as $$
  select 1000 + 10 * (app.assert_score(p_score) - 50)
$$;

-- × 0.85, rounded half-up.
create or replace function app.crisis_shock(p_price bigint)
returns bigint
language sql immutable strict parallel safe
as $$
  select app.mul_rate(p_price, 85, 100)
$$;

-- 10,000 + 50 × (crisis score − 50) basis points.
create or replace function app.reveal_factor_bp(p_score integer)
returns integer
language sql immutable strict parallel safe
as $$
  select 10000 + 50 * (app.assert_score(p_score) - 50)
$$;

create or replace function app.apply_reveal(p_price bigint, p_score integer)
returns bigint
language sql immutable strict parallel safe
as $$
  select app.mul_rate(p_price, app.reveal_factor_bp(p_score), 10000)
$$;

-- Score-based price = start × 0.85 × reveal factor (before the reveal, p_score null: start × 0.85).
create or replace function app.score_price(p_start bigint, p_score integer)
returns bigint
language sql immutable parallel safe
as $$
  select case when p_score is null then app.crisis_shock(p_start)
              else app.apply_reveal(app.crisis_shock(p_start), p_score) end
$$;

create or replace function app.capped_net(p_net bigint)
returns bigint
language sql immutable strict parallel safe
as $$
  select greatest(-10000, least(10000, p_net))
$$;

-- new = old × (100,000 + clamp(net, −10,000, 10,000)) ÷ 100,000, rounded half-up.
create or replace function app.clearing_price(p_old bigint, p_net bigint)
returns bigint
language sql immutable strict parallel safe
as $$
  select app.mul_rate(p_old, 100000 + app.capped_net(p_net), 100000)
$$;

create or replace function app.closing_price(p_market bigint, p_score_based bigint)
returns bigint
language sql immutable strict parallel safe
as $$
  select app.avg_half_up(p_market, p_score_based)
$$;

-- ───────────────────────────── trading.ts ─────────────────────────────

create or replace function app.buy_reserve(p_qty bigint, p_price bigint)
returns bigint
language sql immutable strict parallel safe
as $$
  select app.mul_rate(p_qty::numeric * p_price, 110, 100)
$$;

-- validateOrder(ctx, order) with the engine's JSON shapes (OrderContext, OrderRequest):
--   ctx = {"trading", "prices": {id: cents}, "replacingOrderId"?, "trader": {"cash", "builtCompanyId",
--          "rescuedCompanyId", "positions": {id: {"qty", "cost"}}, "pending": [{"id","companyId","type","qty","reserve"}]}}
-- Returns {"ok":true,"reserve","entryPrice"} or {"ok":false,"code"}. The order of the checks is part of the contract.
create or replace function app.check_order(ctx jsonb, ord jsonb)
returns jsonb
language plpgsql immutable parallel safe
as $$
declare
  tr jsonb := ctx -> 'trader';
  repl text := ctx ->> 'replacingOrderId';
  company text := ord ->> 'companyId';
  typ text := ord ->> 'type';
  qty numeric;
  price bigint;
  owned numeric;
  pend_same numeric;
  reserved numeric;
  reserve bigint;
begin
  if typ not in ('BUY', 'SELL') then
    raise exception 'unknown order type %', typ;
  end if;
  if ctx ->> 'trading' = 'PAUSED' then return jsonb_build_object('ok', false, 'code', 'TRADING_PAUSED'); end if;
  if ctx ->> 'trading' is distinct from 'OPEN' then return jsonb_build_object('ok', false, 'code', 'TRADING_HALTED'); end if;
  if jsonb_typeof(ord -> 'qty') is distinct from 'number' then return jsonb_build_object('ok', false, 'code', 'BAD_QUANTITY'); end if;
  qty := (ord ->> 'qty')::numeric;
  if qty <> trunc(qty) or qty < 1 or qty > 5000 then return jsonb_build_object('ok', false, 'code', 'BAD_QUANTITY'); end if;
  if company = tr ->> 'builtCompanyId' then return jsonb_build_object('ok', false, 'code', 'OWN_COMPANY'); end if;
  if company = tr ->> 'rescuedCompanyId' then return jsonb_build_object('ok', false, 'code', 'RESCUED_COMPANY'); end if;
  price := (ctx -> 'prices' ->> company)::bigint;
  if price is null then return jsonb_build_object('ok', false, 'code', 'NOT_LISTED'); end if;

  owned := coalesce((tr -> 'positions' -> company ->> 'qty')::numeric, 0);
  select coalesce(sum((p ->> 'qty')::numeric), 0) into pend_same
    from jsonb_array_elements(coalesce(tr -> 'pending', '[]'::jsonb)) p
   where p ->> 'companyId' = company and p ->> 'type' = typ and (repl is null or p ->> 'id' <> repl);

  if typ = 'BUY' then
    if owned + pend_same + qty > 5000 then return jsonb_build_object('ok', false, 'code', 'HOLD_LIMIT'); end if;
    select coalesce(sum((p ->> 'reserve')::numeric), 0) into reserved
      from jsonb_array_elements(coalesce(tr -> 'pending', '[]'::jsonb)) p
     where repl is null or p ->> 'id' <> repl;
    reserve := app.buy_reserve(qty::bigint, price);
    if reserve > (tr ->> 'cash')::numeric - reserved then return jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_CASH'); end if;
    return jsonb_build_object('ok', true, 'reserve', reserve, 'entryPrice', price);
  end if;
  if qty > owned - pend_same then return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_SHARES'); end if;
  return jsonb_build_object('ok', true, 'reserve', 0, 'entryPrice', price);
end
$$;

create or replace function app.order_message(p_code text)
returns text
language sql immutable
as $$
  select case p_code
    when 'TRADING_PAUSED' then 'Trading is paused.'
    when 'TRADING_HALTED' then 'Trading is closed right now.'
    when 'BAD_QUANTITY' then 'Enter a whole number of shares (1 to 5,000).'
    when 'OWN_COMPANY' then 'You cannot trade the company you built.'
    when 'RESCUED_COMPANY' then 'You cannot trade the company you rescued.'
    when 'NOT_LISTED' then 'That company is not trading.'
    when 'HOLD_LIMIT' then 'That would take you over 5,000 shares of this company (including pending buys).'
    when 'NOT_ENOUGH_SHARES' then 'You can only sell shares you own (minus pending sells).'
    when 'INSUFFICIENT_CASH' then 'Not enough available cash for this order (a buy holds back its value plus 10%).'
    else p_code
  end
$$;

-- ───────────────────────────── judge.ts ─────────────────────────────

create or replace function app.median_score(p_totals integer[])
returns integer
language plpgsql immutable strict parallel safe
as $$
declare
  n int := coalesce(array_length(p_totals, 1), 0);
begin
  if n = 0 or n % 2 = 0 then
    raise exception 'median needs an odd number of readings';
  end if;
  return (select t from unnest(p_totals) t order by t offset (n - 1) / 2 limit 1);
end
$$;

-- The judge's rubric (RUBRICS): line → maximum points. Each rubric totals 100.
create or replace function app.rubric(p_type public.submission_type)
returns jsonb
language sql immutable strict parallel safe
as $$
  select case p_type
    when 'PRD' then '{"problem_user": 20, "solution_requirements": 25, "business_model": 20, "go_to_market": 15,
                      "success_metrics": 10, "risks": 10}'::jsonb
    else '{"diagnosis": 20, "options": 20, "recommendation": 25, "feasibility": 15, "timeline": 10, "risks": 10}'::jsonb
  end
$$;

-- validateJudgeOutput for a stored reading: exactly the rubric's lines, each a whole number from 0 to its maximum,
-- a total equal to their sum, and a reason.
create or replace function app.judge_run_valid(p_type public.submission_type, p_breakdown jsonb, p_total integer, p_rationale text)
returns boolean
language plpgsql immutable parallel safe
as $$
declare
  r record;
  v numeric;
  v_sum numeric := 0;
begin
  if p_type is null or p_breakdown is null or jsonb_typeof(p_breakdown) <> 'object' or p_total is null
     or p_rationale is null or p_rationale !~ '[^[:space:]]' then
    return false;
  end if;
  if exists (select 1 from jsonb_object_keys(p_breakdown) k where not app.rubric(p_type) ? k) then
    return false;
  end if;
  for r in select key, value::text::int as max from jsonb_each(app.rubric(p_type)) loop
    if jsonb_typeof(p_breakdown -> r.key) is distinct from 'number' then
      return false;
    end if;
    v := (p_breakdown ->> r.key)::numeric;
    if v <> trunc(v) or v < 0 or v > r.max then
      return false;
    end if;
    v_sum := v_sum + v;
  end loop;
  return v_sum = p_total;
end
$$;

-- injectionPenalty: the team's second removed line (PRD lines counted before the solution's) costs 10 points, once,
-- in the round whose submission contains it.
create or replace function app.injection_penalty(p_type public.submission_type, p_prd integer, p_solution integer)
returns integer
language sql immutable parallel safe
as $$
  select case
    when p_type = 'PRD' then case when coalesce(p_prd, 0) >= 2 then 10 else 0 end
    else case when coalesce(p_prd, 0) < 2 and coalesce(p_prd, 0) + coalesce(p_solution, 0) >= 2 then 10 else 0 end
  end
$$;

-- finalScore: {"final","missing","penalty"}. No submission → 0; else clamp(median − penalty, 0, 100).
create or replace function app.final_score(p_median integer, p_penalty integer)
returns jsonb
language sql immutable parallel safe
as $$
  select case
    when p_median is null then jsonb_build_object('final', 0, 'missing', true, 'penalty', 0)
    else jsonb_build_object('final', greatest(0, least(100, p_median - coalesce(p_penalty, 0))), 'missing', false,
                            'penalty', coalesce(p_penalty, 0))
  end
$$;

-- ───────────────────────────── scoring.ts ─────────────────────────────

create or replace function app.return_bp(p_value numeric, p_start numeric)
returns bigint
language sql immutable strict parallel safe
as $$
  select app.div_round_half_up((p_value - p_start) * 10000, p_start)
$$;

-- 50 + 250 × (value − start) ÷ start, rounded half-up, clamped to 0–100.
create or replace function app.round3_points(p_value numeric, p_start numeric)
returns integer
language sql immutable strict parallel safe
as $$
  select greatest(0, least(100, app.div_round_half_up(50 * p_start + 250 * (p_value - p_start), p_start)))::int
$$;

-- awards.ts riseBp: (closing − post-crisis) ÷ post-crisis in basis points.
create or replace function app.rise_bp(p_post_crisis numeric, p_closing numeric)
returns bigint
language sql immutable strict parallel safe
as $$
  select app.div_round_half_up((p_closing - p_post_crisis) * 10000, p_post_crisis)
$$;

-- ───────────────────────────── submissions.ts ─────────────────────────────

create or replace function app.template_fields(p_type public.submission_type)
returns table (ord int, key text, label text)
language sql immutable
as $$
  select t.ord, t.key, t.label from (values
    ('PRD'::public.submission_type, 1, 'problem', 'Problem'),
    ('PRD', 2, 'target_user', 'Target user'),
    ('PRD', 3, 'must_have', 'Must have'),
    ('PRD', 4, 'should_have', 'Should have'),
    ('PRD', 5, 'not_in_v1', 'Not in version 1'),
    ('PRD', 6, 'per_pack_maths', 'Per-pack maths'),
    ('PRD', 7, 'go_to_market', 'Go to market'),
    ('PRD', 8, 'success_metrics', 'Success metrics'),
    ('PRD', 9, 'risks', 'Risks'),
    ('SOLUTION', 1, 'diagnosis', 'Diagnosis'),
    ('SOLUTION', 2, 'three_options', 'Three options'),
    ('SOLUTION', 3, 'recommendation', 'Recommendation'),
    ('SOLUTION', 4, 'per_pack_maths', 'Per-pack maths'),
    ('SOLUTION', 5, 'timeline', 'Timeline'),
    ('SOLUTION', 6, 'risks', 'Risks')
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
    case when p_type = 'PRD' then
      app.content_field(p_content, 'company_name') || ' (' || upper(app.content_field(p_content, 'ticker')) || ')' end,
    (select string_agg(f.label || E':\n' || app.content_field(p_content, f.key), E'\n\n' order by f.ord)
       from app.template_fields(p_type) f where app.content_field(p_content, f.key) <> ''))
$$;

-- validateDraft: null when the draft may be saved, else TOO_LONG, BAD_NAME or BAD_TICKER.
create or replace function app.check_draft(p_type public.submission_type, p_content jsonb)
returns text
language sql immutable
as $$
  select case
    when app.submission_words(p_type, p_content) > case p_type when 'PRD' then 800 else 500 end then 'TOO_LONG'
    when p_type = 'PRD' and length(app.content_field(p_content, 'company_name')) > 60 then 'BAD_NAME'
    when p_type = 'PRD' and app.content_field(p_content, 'ticker') <> ''
         and upper(app.content_field(p_content, 'ticker')) !~ '^[A-Z]{4}$' then 'BAD_TICKER'
  end
$$;

-- ───────────────────────────── lottery.ts ─────────────────────────────
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

-- dealProblemCards: the teams (sorted by code) shuffled, then the deck (given in card-number order) shuffled; the
-- k-th team gets card k mod deck size. Every card goes to at most 3 teams.
create or replace function app.lottery_problems(p_root text, p_teams text[], p_cards text[])
returns table (team text, card text)
language plpgsql immutable parallel safe
as $$
declare
  n int := coalesce(array_length(p_teams, 1), 0);
  d int := coalesce(array_length(p_cards, 1), 0);
  st app.rng_state;
  t text[];
  c text[];
  rec record;
  k int;
begin
  if (select count(distinct x) from unnest(p_teams) x) <> n then raise exception 'duplicate team codes'; end if;
  if (select count(distinct x) from unnest(p_cards) x) <> d then raise exception 'duplicate card ids'; end if;
  if d = 0 then raise exception 'the problem deck is empty'; end if;
  if (n + d - 1) / d > 3 then raise exception 'the problem deck needs at least % cards', (n + 2) / 3; end if;
  st := app.rng_new(p_root, 'problems');
  select * into rec from app.rng_shuffle(st, array(select x from unnest(p_teams) x order by x collate "C"));
  st := rec.st; t := rec.result;
  select * into rec from app.rng_shuffle(st, p_cards);
  st := rec.st; c := rec.result;
  for k in 1..n loop
    team := t[k];
    card := c[((k - 1) % d) + 1];
    return next;
  end loop;
end
$$;

-- assignCrises: the founders (sorted by code) shuffled and dealt round the deck in card-number order.
-- p_deck: [{"id","number"}].
create or replace function app.lottery_crises(p_root text, p_founders text[], p_deck jsonb)
returns table (team text, card text)
language plpgsql immutable parallel safe
as $$
declare
  n int := coalesce(array_length(p_founders, 1), 0);
  cards text[] := array(select x ->> 'id' from jsonb_array_elements(p_deck) x order by (x ->> 'number')::int);
  d int;
  st app.rng_state;
  t text[];
  rec record;
  k int;
begin
  d := coalesce(array_length(cards, 1), 0);
  if (select count(distinct x) from unnest(p_founders) x) <> n then raise exception 'duplicate team codes'; end if;
  if d = 0 then raise exception 'the crisis deck is empty'; end if;
  st := app.rng_new(p_root, 'crisis');
  select * into rec from app.rng_shuffle(st, array(select x from unnest(p_founders) x order by x collate "C"));
  t := rec.result;
  for k in 1..n loop
    team := t[k];
    card := cards[((k - 1) % d) + 1];
    return next;
  end loop;
end
$$;

-- rescueCircle: the teams (sorted by code) shuffled into a circle; each rescues the next team's company.
create or replace function app.lottery_circle(p_root text, p_teams text[])
returns table (rescuer text, founder text)
language plpgsql immutable parallel safe
as $$
declare
  n int := coalesce(array_length(p_teams, 1), 0);
  st app.rng_state;
  t text[];
  rec record;
  k int;
begin
  if (select count(distinct x) from unnest(p_teams) x) <> n then raise exception 'duplicate team codes'; end if;
  if n < 2 then raise exception 'the rescue circle needs at least 2 teams'; end if;
  st := app.rng_new(p_root, 'circle');
  select * into rec from app.rng_shuffle(st, array(select x from unnest(p_teams) x order by x collate "C"));
  t := rec.result;
  for k in 1..n loop
    rescuer := t[k];
    founder := t[(k % n) + 1];
    return next;
  end loop;
end
$$;
