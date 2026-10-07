-- The game engine's rules in SQL. Each function is a direct port of a function in packages/engine/src and is
-- checked against it by supabase/tests/parity.test.ts on thousands of generated cases. All arithmetic is in
-- integers / exact numeric; rounding is half-up (ties away from zero) after every multiplication.

-- ───────────────────────────── money.ts ─────────────────────────────

-- round(num ÷ den), ties away from zero.
create or replace function app.div_round_half_up(num numeric, den numeric)
returns bigint
language sql immutable strict parallel safe
as $$
  select (sign(num) * sign(den) * div(2 * abs(num) + abs(den), 2 * abs(den)))::bigint
$$;

create or replace function app.floor_div(num numeric, den numeric)
returns bigint
language sql immutable strict parallel safe
as $$
  select div(num, den)::bigint
$$;

-- amount × num ÷ den, rounded half-up at once.
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

create or replace function app.tier_bp(p_type public.submission_type, p_score integer)
returns integer
language plpgsql immutable strict parallel safe
as $$
begin
  if p_score < 0 or p_score > 100 then
    raise exception 'score must be 0–100, got %', p_score;
  end if;
  return case p_type
    when 'PITCH' then case when p_score >= 80 then 1000 when p_score >= 60 then 500 when p_score >= 50 then 0
                           when p_score >= 40 then -500 else -1000 end
    when 'PLAN' then case when p_score >= 90 then 2500 when p_score >= 80 then 2000 when p_score >= 70 then 1000
                          when p_score >= 60 then 500 when p_score >= 50 then 0 when p_score >= 40 then -1000 else -2000 end
    else case when p_score >= 70 then 500 when p_score >= 50 then 0 else -500 end
  end;
end
$$;

create or replace function app.apply_tier(p_price bigint, p_bp integer)
returns bigint
language sql immutable strict parallel safe
as $$
  select app.mul_rate(p_price, 10000 + p_bp, 10000)
$$;

create or replace function app.ipo_price(p_pitch_score integer)
returns bigint
language sql immutable strict parallel safe
as $$
  select app.apply_tier(1000, app.tier_bp('PITCH', p_pitch_score))
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

create or replace function app.crisis_shock(p_price bigint)
returns bigint
language sql immutable strict parallel safe
as $$
  select app.mul_rate(p_price, 85, 100)
$$;

-- ───────────────────────────── ipo.ts ─────────────────────────────

create or replace function app.ipo_allocation(p_qty bigint, p_available bigint, p_total bigint)
returns bigint
language sql immutable strict parallel safe
as $$
  select case when p_total <= p_available then p_qty
              else app.floor_div(p_qty::numeric * p_available, p_total::numeric * 10) * 10 end
$$;

-- ───────────────────────────── trading.ts ─────────────────────────────

create or replace function app.buy_reserve(p_qty bigint, p_price bigint)
returns bigint
language sql immutable strict parallel safe
as $$
  select app.mul_rate(p_qty::numeric * p_price, 110, 100)
$$;

create or replace function app.short_reserve(p_qty bigint, p_price bigint)
returns bigint
language sql immutable strict parallel safe
as $$
  select app.mul_rate(app.mul_rate(p_qty::numeric * p_price, 150, 100), 110, 100)
$$;

create or replace function app.short_collateral(p_qty bigint, p_price bigint)
returns bigint
language sql immutable strict parallel safe
as $$
  select app.mul_rate(p_qty::numeric * p_price, 150, 100)
$$;

-- validateOrder(ctx, order) with the same JSON shapes as the engine's OrderContext and OrderRequest.
-- Returns {"ok":true,"reserve":…,"entryPrice":…} or {"ok":false,"code":…}. The order of checks is part of
-- the contract.
create or replace function app.check_order(ctx jsonb, ord jsonb)
returns jsonb
language plpgsql immutable parallel safe
as $$
declare
  fund jsonb := ctx -> 'fund';
  prices jsonb := ctx -> 'prices';
  repl text := ctx ->> 'replacingOrderId';
  company text := ord ->> 'companyId';
  typ text := ord ->> 'type';
  qty numeric;
  price bigint;
  pos jsonb;
  ex numeric;
  sh numeric;
  cash numeric := (fund ->> 'cash')::numeric;
  coll numeric := (fund ->> 'collateral')::numeric;
  pend_same numeric;
  reserved numeric;
  reserve bigint;
  exposure numeric;
begin
  if typ not in ('BUY', 'SELL', 'SHORT', 'COVER') then
    raise exception 'unknown order type %', typ;
  end if;
  if fund ->> 'track' is distinct from 'FINANCE' then return jsonb_build_object('ok', false, 'code', 'NOT_A_FUND'); end if;
  if ctx ->> 'trading' = 'PAUSED' then return jsonb_build_object('ok', false, 'code', 'TRADING_PAUSED'); end if;
  if ctx ->> 'trading' is distinct from 'OPEN' then return jsonb_build_object('ok', false, 'code', 'TRADING_HALTED'); end if;
  if jsonb_typeof(ord -> 'qty') is distinct from 'number' then return jsonb_build_object('ok', false, 'code', 'BAD_QUANTITY'); end if;
  qty := (ord ->> 'qty')::numeric;
  if qty <> trunc(qty) or qty < 1 or qty > 100000 then return jsonb_build_object('ok', false, 'code', 'BAD_QUANTITY'); end if;
  if company = fund ->> 'squadCompanyId' then return jsonb_build_object('ok', false, 'code', 'INSIDER'); end if;
  price := (prices ->> company)::bigint;
  if price is null then return jsonb_build_object('ok', false, 'code', 'NOT_LISTED'); end if;

  pos := coalesce(fund -> 'positions' -> company, '{}'::jsonb);
  ex := coalesce((pos ->> 'exchangeQty')::numeric, 0);
  sh := coalesce((pos ->> 'shortQty')::numeric, 0);

  if typ in ('BUY', 'SHORT') and cash < coll then
    return jsonb_build_object('ok', false, 'code', 'COLLATERAL_DEFICIT');
  end if;

  select coalesce(sum((p ->> 'qty')::numeric), 0) into pend_same
    from jsonb_array_elements(coalesce(fund -> 'pending', '[]'::jsonb)) p
   where p ->> 'companyId' = company and p ->> 'type' = typ and (repl is null or p ->> 'id' <> repl);
  select coalesce(sum((p ->> 'reserve')::numeric), 0) into reserved
    from jsonb_array_elements(coalesce(fund -> 'pending', '[]'::jsonb)) p
   where repl is null or p ->> 'id' <> repl;

  if typ = 'BUY' then
    if ex + pend_same + qty > 4000 then return jsonb_build_object('ok', false, 'code', 'LONG_LIMIT'); end if;
    reserve := app.buy_reserve(qty::bigint, price);
    if reserve > cash - coll - reserved then return jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_CASH'); end if;
    return jsonb_build_object('ok', true, 'reserve', reserve, 'entryPrice', price);
  elsif typ = 'SELL' then
    if qty > ex - pend_same then return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_SHARES'); end if;
    return jsonb_build_object('ok', true, 'reserve', 0, 'entryPrice', price);
  elsif typ = 'SHORT' then
    if sh + pend_same + qty > 2000 then return jsonb_build_object('ok', false, 'code', 'SHORT_LIMIT'); end if;
    with companies as (
      select key as c from jsonb_object_keys(coalesce(fund -> 'positions', '{}'::jsonb)) key
      union
      select p ->> 'companyId' from jsonb_array_elements(coalesce(fund -> 'pending', '[]'::jsonb)) p
    ), q as (
      select c,
             coalesce((fund -> 'positions' -> c ->> 'shortQty')::numeric, 0)
             + coalesce((select sum((p ->> 'qty')::numeric)
                           from jsonb_array_elements(coalesce(fund -> 'pending', '[]'::jsonb)) p
                          where p ->> 'companyId' = c and p ->> 'type' = 'SHORT'
                            and (repl is null or p ->> 'id' <> repl)), 0) as short_qty
        from companies
    )
    select qty * price + coalesce(sum(short_qty * (prices ->> c)::numeric) filter (where short_qty > 0), 0)
      into exposure
      from q;
    if exposure > 25000000 then return jsonb_build_object('ok', false, 'code', 'SHORT_EXPOSURE'); end if;
    reserve := app.short_reserve(qty::bigint, price);
    if reserve > cash - coll - reserved then return jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_CASH'); end if;
    return jsonb_build_object('ok', true, 'reserve', reserve, 'entryPrice', price);
  else
    if qty > sh - pend_same then return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_SHORT'); end if;
    return jsonb_build_object('ok', true, 'reserve', 0, 'entryPrice', price);
  end if;
end
$$;

-- ───────────────────────────── rescue.ts ─────────────────────────────

-- validateFee: returns null when valid, else the rejection code.
create or replace function app.check_fee(p_cash bigint, p_shares bigint, p_ipo_price bigint, p_company_cash bigint, p_retained bigint)
returns text
language sql immutable strict parallel safe
as $$
  select case
    when p_cash < 0 or p_shares < 0 then 'BAD_TERMS'
    when p_shares > 3000 then 'TOO_MANY_SHARES'
    when p_cash + p_shares * p_ipo_price not between 1000000 and 3500000 then 'FEE_RANGE'
    when p_cash > p_company_cash then 'NOT_ENOUGH_CASH'
    when p_shares > p_retained then 'NOT_ENOUGH_SHARES'
  end
$$;

create or replace function app.fee_value(p_cash bigint, p_shares bigint, p_ipo_price bigint)
returns bigint
language sql immutable strict parallel safe
as $$
  select p_cash + p_shares * p_ipo_price
$$;

create or replace function app.deal_band_min(p_post_crisis bigint)
returns bigint
language sql immutable strict parallel safe
as $$
  select app.floor_div(p_post_crisis + 1, 2)
$$;

-- validateDealTerms: null when valid, else the rejection code.
create or replace function app.check_deal_terms(p_amount bigint, p_price bigint, p_post_crisis bigint)
returns text
language sql immutable strict parallel safe
as $$
  select case
    when p_price <= 0 then 'BAD_TERMS'
    when p_amount < 4000000 or p_amount > 8000000 then 'AMOUNT_RANGE'
    when p_price * 2 < p_post_crisis or p_price > p_post_crisis then 'PRICE_RANGE'
    when app.floor_div(p_amount, p_price) < 1 then 'NO_SHARES'
  end
$$;

-- validateDeal (terms + balances): null when valid, else the rejection code.
create or replace function app.check_deal(p_amount bigint, p_price bigint, p_post_crisis bigint, p_fund_available bigint, p_retained bigint)
returns text
language sql immutable strict parallel safe
as $$
  select coalesce(
    app.check_deal_terms(p_amount, p_price, p_post_crisis),
    case
      when app.floor_div(p_amount, p_price) * p_price > p_fund_available then 'FUND_CASH'
      when app.floor_div(p_amount, p_price) > p_retained then 'COMPANY_SHARES'
    end)
$$;

-- ───────────────────────────── calls.ts ─────────────────────────────

create or replace function app.judge_call(p_direction public.call_dir, p_baseline bigint, p_judged bigint)
returns boolean
language sql immutable parallel safe
as $$
  select coalesce(case p_direction when 'BUY' then p_judged > p_baseline when 'SELL' then p_judged < p_baseline end, false)
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
    raise exception 'median needs an odd number of runs';
  end if;
  return (select t from unnest(p_totals) t order by t offset (n - 1) / 2 limit 1);
end
$$;

create or replace function app.needs_extra_runs(p_totals integer[])
returns boolean
language sql immutable strict parallel safe
as $$
  select coalesce(array_length(p_totals, 1), 0) = 3
     and (select max(t) - min(t) from unnest(p_totals) t) > 10
$$;

-- injectionPenalty: the second (and later) offence of a squad costs 10 points (order PITCH → PLAN → FLASH).
create or replace function app.injection_penalty(p_type public.submission_type, p_pitch boolean, p_plan boolean, p_flash boolean)
returns integer
language sql immutable parallel safe
as $$
  select case
    when not coalesce(case p_type when 'PITCH' then p_pitch when 'PLAN' then p_plan else p_flash end, false) then 0
    when (coalesce(p_pitch, false)::int
          + (p_type in ('PLAN', 'FLASH') and coalesce(p_plan, false))::int
          + (p_type = 'FLASH' and coalesce(p_flash, false))::int) >= 2 then 10
    else 0
  end
$$;

-- finalScore: {"final","missing","capped","penalty"}. Missing/late → 0; else clamp(min(median, cap) − penalty, 0, 100).
create or replace function app.final_score(p_type public.submission_type, p_median integer, p_deal_signed boolean, p_penalty integer)
returns jsonb
language sql immutable parallel safe
as $$
  select case
    when p_median is null then jsonb_build_object('final', 0, 'missing', true, 'capped', false, 'penalty', 0)
    else jsonb_build_object(
      'final', greatest(0, least(100,
                 case when p_type = 'PLAN' and not coalesce(p_deal_signed, false) then least(p_median, 50) else p_median end
                 - coalesce(p_penalty, 0))),
      'missing', false,
      'capped', p_type = 'PLAN' and not coalesce(p_deal_signed, false),
      'penalty', coalesce(p_penalty, 0))
  end
$$;

-- ───────────────────────────── scoring.ts ─────────────────────────────

create or replace function app.plan_bonus(p_score integer)
returns bigint
language sql immutable strict parallel safe
as $$
  select greatest(-1000000, least(2500000, 50000::bigint * (p_score - 50)))
$$;

create or replace function app.return_bp(p_final numeric, p_start numeric)
returns bigint
language sql immutable strict parallel safe
as $$
  select app.div_round_half_up((p_final - p_start)::numeric * 10000, p_start)
$$;
