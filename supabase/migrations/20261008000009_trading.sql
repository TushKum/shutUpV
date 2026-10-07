-- Trading: order entry (validated by app.check_order, the port of the engine's validateOrder), the IPO book
-- and allocation, and round clearing (the port of the engine's clearRound), each in one transaction.

-- ───────────────────────────── Fund context for validation ─────────────────────────────

-- The fund's company in its own squad (insider rule), or NULL.
create or replace function app.squad_company_of(p_team uuid)
returns uuid
language sql stable
as $$
  select c.id from public.squads s join public.companies c on c.squad_id = s.id
   where p_team in (s.product_team_id, s.consulting_team_id, s.finance_team_id)
$$;

-- The engine's OrderContext as JSON (fund view, prices, trading state) for a team in its event.
create or replace function app.order_context(p_team public.teams, p_replacing uuid default null)
returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'trading', app.trading_state(p_team.event_id),
    'prices', coalesce((select jsonb_object_agg(c.id::text, c.market_price) from public.companies c
                         where c.event_id = p_team.event_id and c.market_price is not null), '{}'::jsonb),
    'fund', jsonb_build_object(
      'track', p_team.track,
      'cash', p_team.cash_cents,
      'collateral', p_team.collateral_cents,
      'squadCompanyId', app.squad_company_of(p_team.id)::text,
      'positions', coalesce((
        select jsonb_object_agg(p.company_id::text, jsonb_build_object('exchangeQty', p.ex, 'shortQty', p.sh))
          from (select h.company_id,
                       coalesce(sum(h.qty) filter (where h.lot = 'EXCHANGE'), 0) as ex,
                       coalesce(sum(h.qty) filter (where h.lot = 'SHORT'), 0) as sh
                  from public.holdings h
                 where h.team_id = p_team.id and h.lot in ('EXCHANGE', 'SHORT')
                 group by h.company_id) p), '{}'::jsonb),
      'pending', coalesce((
        select jsonb_agg(jsonb_build_object('id', o.id::text, 'companyId', o.company_id::text, 'type', o.type,
                                            'qty', o.qty, 'reserve', o.reserve_cents) order by o.created_at)
          from public.orders o join public.rounds r on r.id = o.round_id
         where o.team_id = p_team.id and o.status = 'PENDING' and r.status = 'OPEN'), '[]'::jsonb)))
  || case when p_replacing is null then '{}'::jsonb else jsonb_build_object('replacingOrderId', p_replacing::text) end
$$;

-- Sliding-window rate limit per team and bucket. Returns true when the call is allowed (and counts it).
create or replace function app.rate_limit(p_team uuid, p_bucket text, p_max int, p_window interval)
returns boolean
language plpgsql
as $$
declare
  v public.rate_limits;
begin
  insert into public.rate_limits (team_id, bucket, window_start, count) values (p_team, p_bucket, now(), 0)
  on conflict (team_id, bucket) do nothing;
  select * into v from public.rate_limits where team_id = p_team and bucket = p_bucket for update;
  if v.window_start + p_window <= now() then
    update public.rate_limits set window_start = now(), count = 1 where team_id = p_team and bucket = p_bucket;
    return true;
  end if;
  if v.count >= p_max then
    return false;
  end if;
  update public.rate_limits set count = count + 1 where team_id = p_team and bucket = p_bucket;
  return true;
end
$$;

-- ───────────────────────────── Orders ─────────────────────────────

create or replace function public.place_order(p_company uuid, p_type public.order_type, p_qty integer, p_client_ref text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_round public.rounds;
  v_check jsonb;
  v_order public.orders;
  v_details jsonb := jsonb_build_object('company_id', p_company, 'type', p_type, 'qty', p_qty);
begin
  v_team := app.lock_caller_team();
  if v_team.id is null then
    raise exception 'only a team can place orders' using errcode = '42501';
  end if;
  if p_client_ref is not null then
    select * into v_order from public.orders where team_id = v_team.id and client_ref = p_client_ref;
    if v_order.id is not null then
      return app.ok(jsonb_build_object('order', to_jsonb(v_order), 'duplicate', true));
    end if;
  end if;
  if not app.rate_limit(v_team.id, 'orders', 20, interval '10 seconds') then
    return app.reject(v_team.event_id, 'place_order', 'RATE_LIMITED', 'Too many order actions. Wait a few seconds.', v_details);
  end if;

  -- Lock the open round in share mode: clearing takes it exclusively, so an order can never slip in
  -- while a round is being cleared.
  select r.* into v_round from public.rounds r where r.id = (app.open_round(v_team.event_id)).id for share;

  v_check := app.check_order(app.order_context(v_team),
                             jsonb_build_object('companyId', p_company::text, 'type', p_type, 'qty', p_qty));
  if not (v_check ->> 'ok')::boolean then
    return app.reject(v_team.event_id, 'place_order', v_check ->> 'code', app.order_message(v_check ->> 'code'), v_details);
  end if;
  if v_round.id is null or v_round.status <> 'OPEN' or now() >= v_round.closes_at then
    return app.reject(v_team.event_id, 'place_order', 'TRADING_HALTED', app.order_message('TRADING_HALTED'), v_details);
  end if;

  insert into public.orders (event_id, round_id, team_id, company_id, type, qty, entry_price, reserve_cents, client_ref)
  values (v_team.event_id, v_round.id, v_team.id, p_company, p_type, p_qty,
          (v_check ->> 'entryPrice')::int, (v_check ->> 'reserve')::bigint, p_client_ref)
  returning * into v_order;
  return app.ok(jsonb_build_object('order', to_jsonb(v_order)));
end
$$;

create or replace function public.edit_order(p_order uuid, p_qty integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_order public.orders;
  v_round public.rounds;
  v_check jsonb;
  v_details jsonb := jsonb_build_object('order_id', p_order, 'qty', p_qty);
begin
  v_team := app.lock_caller_team();
  if v_team.id is null then
    raise exception 'only a team can edit orders' using errcode = '42501';
  end if;
  if not app.rate_limit(v_team.id, 'orders', 20, interval '10 seconds') then
    return app.reject(v_team.event_id, 'edit_order', 'RATE_LIMITED', 'Too many order actions. Wait a few seconds.', v_details);
  end if;
  select * into v_order from public.orders where id = p_order and team_id = v_team.id for update;
  if v_order.id is null or v_order.status <> 'PENDING' then
    return app.reject(v_team.event_id, 'edit_order', 'NOT_EDITABLE', 'That order can no longer be changed.', v_details);
  end if;
  select * into v_round from public.rounds where id = v_order.round_id for share;
  if v_round.status <> 'OPEN' or now() >= v_round.closes_at then
    return app.reject(v_team.event_id, 'edit_order', 'TRADING_HALTED', app.order_message('TRADING_HALTED'), v_details);
  end if;
  v_check := app.check_order(app.order_context(v_team, v_order.id),
                             jsonb_build_object('companyId', v_order.company_id::text, 'type', v_order.type, 'qty', p_qty));
  if not (v_check ->> 'ok')::boolean then
    return app.reject(v_team.event_id, 'edit_order', v_check ->> 'code', app.order_message(v_check ->> 'code'), v_details);
  end if;
  update public.orders
     set qty = p_qty, reserve_cents = (v_check ->> 'reserve')::bigint, entry_price = (v_check ->> 'entryPrice')::int,
         updated_at = now()
   where id = v_order.id
  returning * into v_order;
  return app.ok(jsonb_build_object('order', to_jsonb(v_order)));
end
$$;

create or replace function public.cancel_order(p_order uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_order public.orders;
  v_round public.rounds;
begin
  v_team := app.lock_caller_team();
  if v_team.id is null then
    raise exception 'only a team can cancel orders' using errcode = '42501';
  end if;
  if not app.rate_limit(v_team.id, 'orders', 20, interval '10 seconds') then
    return app.reject(v_team.event_id, 'cancel_order', 'RATE_LIMITED', 'Too many order actions. Wait a few seconds.',
                      jsonb_build_object('order_id', p_order));
  end if;
  select * into v_order from public.orders where id = p_order and team_id = v_team.id for update;
  if v_order.id is null or v_order.status <> 'PENDING' then
    return app.reject(v_team.event_id, 'cancel_order', 'NOT_EDITABLE', 'That order can no longer be changed.',
                      jsonb_build_object('order_id', p_order));
  end if;
  select * into v_round from public.rounds where id = v_order.round_id for share;
  if v_round.status <> 'OPEN' or now() >= v_round.closes_at then
    return app.reject(v_team.event_id, 'cancel_order', 'TRADING_HALTED', app.order_message('TRADING_HALTED'),
                      jsonb_build_object('order_id', p_order));
  end if;
  update public.orders set status = 'CANCELLED', cancelled_at = now(), updated_at = now() where id = v_order.id
  returning * into v_order;
  return app.ok(jsonb_build_object('order', to_jsonb(v_order)));
end
$$;

create or replace function app.order_message(p_code text)
returns text
language sql immutable
as $$
  select case p_code
    when 'NOT_A_FUND' then 'Only Finance teams can trade.'
    when 'TRADING_PAUSED' then 'Trading is paused.'
    when 'TRADING_HALTED' then 'Trading is closed right now.'
    when 'BAD_QUANTITY' then 'Enter a whole number of shares (1 to 100,000).'
    when 'INSIDER' then 'A fund cannot trade its own squad''s company.'
    when 'NOT_LISTED' then 'That company is not trading.'
    when 'COLLATERAL_DEFICIT' then 'Your collateral is short: buys and new shorts are blocked until cash covers it.'
    when 'LONG_LIMIT' then 'That would take you over 4,000 shares of this company (including pending buys).'
    when 'NOT_ENOUGH_SHARES' then 'You can only sell shares you own (minus pending sells).'
    when 'SHORT_LIMIT' then 'That would take you over 2,000 shares short in this company (including pending shorts).'
    when 'SHORT_EXPOSURE' then 'That would take your total short exposure over $250,000.'
    when 'INSUFFICIENT_CASH' then 'Not enough available cash for this order.'
    when 'NOT_ENOUGH_SHORT' then 'You can only cover shares you are short (minus pending covers).'
    else p_code
  end
$$;

-- ───────────────────────────── IPO ─────────────────────────────

-- validateIpoBids: {"ok":true,"totalCost":…} or {"ok":false,"code":…,"companyId":…}. Book: [{"companyId","qty"}],
-- a later entry for the same company replaces an earlier one.
create or replace function app.check_ipo_book(p_cash bigint, p_squad_company text, p_book jsonb, p_prices jsonb)
returns jsonb
language plpgsql immutable
as $$
declare
  v_total numeric := 0;
  v_qty numeric;
  b record;
begin
  -- One entry per company, in the order each company first appears, carrying its last quantity (as the engine's Map).
  for b in
    select x.company, x.qty from (
      select e.x ->> 'companyId' as company, e.x -> 'qty' as qty,
             min(e.i) over (partition by e.x ->> 'companyId') as first_pos,
             row_number() over (partition by e.x ->> 'companyId' order by e.i desc) as rn
        from jsonb_array_elements(p_book) with ordinality as e(x, i)) x
     where x.rn = 1
     order by x.first_pos
  loop
    if jsonb_typeof(b.qty) is distinct from 'number' then
      return jsonb_build_object('ok', false, 'code', 'BAD_QUANTITY', 'companyId', b.company);
    end if;
    v_qty := (b.qty #>> '{}')::numeric;
    if v_qty <> trunc(v_qty) or v_qty < 0 or v_qty > 4000 then
      return jsonb_build_object('ok', false, 'code', 'BAD_QUANTITY', 'companyId', b.company);
    end if;
    continue when v_qty = 0;
    if b.company = p_squad_company then
      return jsonb_build_object('ok', false, 'code', 'INSIDER', 'companyId', b.company);
    end if;
    if p_prices ->> b.company is null then
      return jsonb_build_object('ok', false, 'code', 'NOT_LISTED', 'companyId', b.company);
    end if;
    v_total := v_total + v_qty * (p_prices ->> b.company)::numeric;
  end loop;
  if v_total > p_cash then
    return jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_CASH');
  end if;
  return jsonb_build_object('ok', true, 'totalCost', v_total::bigint);
end
$$;

create or replace function public.place_ipo_bid(p_company uuid, p_qty integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_event public.events;
  v_book jsonb;
  v_prices jsonb;
  v_check jsonb;
  v_details jsonb := jsonb_build_object('company_id', p_company, 'qty', p_qty);
begin
  v_team := app.lock_caller_team();
  if v_team.id is null then
    raise exception 'only a team can bid' using errcode = '42501';
  end if;
  select * into v_event from public.events where id = v_team.event_id for share;
  if v_team.track <> 'FINANCE' then
    return app.reject(v_team.event_id, 'place_ipo_bid', 'NOT_A_FUND', 'Only Finance teams can bid at the IPO.', v_details);
  end if;
  if v_event.current_phase <> 'IPO' or v_event.paused or v_event.ipo_allocated_at is not null
     or app.deadline_passed(v_event.id, 'IPO_BIDS') then
    return app.reject(v_team.event_id, 'place_ipo_bid', 'IPO_CLOSED', 'IPO bids are not open.', v_details);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('companyId', b.company_id::text, 'qty', b.qty_requested)), '[]'::jsonb)
    into v_book from public.ipo_bids b where b.team_id = v_team.id;
  v_book := v_book || jsonb_build_array(jsonb_build_object('companyId', p_company::text, 'qty', p_qty));
  select coalesce(jsonb_object_agg(c.id::text, c.ipo_price), '{}'::jsonb) into v_prices
    from public.companies c where c.event_id = v_team.event_id and c.ipo_price is not null;
  v_check := app.check_ipo_book(v_team.cash_cents, app.squad_company_of(v_team.id)::text, v_book, v_prices);
  if not (v_check ->> 'ok')::boolean then
    return app.reject(v_team.event_id, 'place_ipo_bid', v_check ->> 'code',
      case v_check ->> 'code'
        when 'BAD_QUANTITY' then 'Request 0 to 4,000 shares per company.'
        when 'INSIDER' then 'A fund cannot bid for its own squad''s company.'
        when 'NOT_LISTED' then 'That company has no IPO price.'
        else 'Your total requests cost more than your cash at IPO prices.' end,
      v_details);
  end if;
  insert into public.ipo_bids (event_id, team_id, company_id, qty_requested, price)
  values (v_team.event_id, v_team.id, p_company, p_qty, (v_prices ->> p_company::text)::int)
  on conflict (team_id, company_id) do update set qty_requested = excluded.qty_requested, updated_at = now();
  return app.ok(jsonb_build_object('company_id', p_company, 'qty', p_qty, 'total_cost', (v_check ->> 'totalCost')::bigint));
end
$$;

-- Allocates every company's IPO (pro rata, rounded down to 10 shares when oversubscribed). Idempotent.
create or replace function app.allocate_ipo(p_event uuid)
returns void
language plpgsql
as $$
declare
  v_txn uuid := gen_random_uuid();
  v_total_cash bigint;
begin
  perform 1 from public.events where id = p_event and ipo_allocated_at is null for update;
  if not found then
    return;
  end if;

  with totals as (
    select company_id, sum(qty_requested) as total from public.ipo_bids where event_id = p_event group by company_id
  )
  update public.ipo_bids b
     set qty_allocated = app.ipo_allocation(b.qty_requested, 35000, t.total), updated_at = now()
    from totals t
   where b.company_id = t.company_id and b.event_id = p_event;

  insert into public.holdings (event_id, team_id, company_id, lot, qty, cost_cents)
  select p_event, b.team_id, b.company_id, 'EXCHANGE', 0, 0
    from public.ipo_bids b where b.event_id = p_event and b.qty_allocated > 0
  on conflict (team_id, company_id, lot) do nothing;

  update public.holdings h
     set qty = h.qty + b.qty_allocated, cost_cents = h.cost_cents + b.qty_allocated::bigint * b.price, updated_at = now()
    from public.ipo_bids b
   where b.event_id = p_event and b.qty_allocated > 0
     and h.team_id = b.team_id and h.company_id = b.company_id and h.lot = 'EXCHANGE';

  update public.teams t set cash_cents = t.cash_cents - x.cost
    from (select team_id, sum(qty_allocated::bigint * price) as cost from public.ipo_bids
           where event_id = p_event and qty_allocated > 0 group by team_id) x
   where t.id = x.team_id;

  update public.companies c set exchange_inventory = c.exchange_inventory - x.alloc
    from (select company_id, sum(qty_allocated) as alloc from public.ipo_bids
           where event_id = p_event and qty_allocated > 0 group by company_id) x
   where c.id = x.company_id;

  insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, lot, cash_delta_cents, share_delta, price_cents, ref_table, ref_id, memo)
  select p_event, v_txn, 'IPO_ALLOCATION', b.team_id, b.company_id, 'EXCHANGE', -(b.qty_allocated::bigint * b.price),
         b.qty_allocated, b.price, 'ipo_bids', b.id, 'IPO allocation'
    from public.ipo_bids b where b.event_id = p_event and b.qty_allocated > 0;
  insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, cash_delta_cents, share_delta, price_cents, memo)
  select p_event, v_txn, 'IPO_ALLOCATION', null, b.company_id, sum(b.qty_allocated::bigint * b.price), -sum(b.qty_allocated),
         min(b.price), 'IPO allocation (exchange)'
    from public.ipo_bids b where b.event_id = p_event and b.qty_allocated > 0 group by b.company_id;

  select coalesce(sum(qty_allocated::bigint * price), 0) into v_total_cash
    from public.ipo_bids where event_id = p_event and qty_allocated > 0;
  update public.events set exchange_cash_cents = exchange_cash_cents + v_total_cash, ipo_allocated_at = now() where id = p_event;

  insert into public.public_ledger (event_id, txn_id, kind, label, company_id, ticker, cash_cents, shares, price_cents, details)
  select p_event, v_txn, 'IPO', 'IPO allocation', c.id, c.ticker, sum(b.qty_allocated::bigint * b.price), sum(b.qty_allocated),
         c.ipo_price, jsonb_build_object('requested', sum(b.qty_requested), 'available', 35000, 'bidders', count(*))
    from public.ipo_bids b join public.companies c on c.id = b.company_id
   where b.event_id = p_event and b.qty_requested > 0
   group by c.id, c.ticker, c.ipo_price;

  perform app.broadcast(p_event, 'ipo_allocated');
end
$$;

-- ───────────────────────────── Clearing ─────────────────────────────

-- Clears one round, all companies at once, in one transaction; idempotent (a cleared round is left as is).
-- Without p_force the round must have reached its closing time. Rounds clear in order.
create or replace function app.clear_round(p_round uuid, p_force boolean default false)
returns jsonb
language plpgsql
as $$
declare
  v_round public.rounds;
  v_prev public.rounds;
  v_txn uuid := gen_random_uuid();
  v_exchange_cash bigint;
  v_started timestamptz := clock_timestamp();
begin
  select * into v_round from public.rounds where id = p_round for update;
  if v_round.id is null then
    raise exception 'no such round';
  end if;
  if v_round.status = 'CLEARED' then
    return app.ok(jsonb_build_object('already', true, 'round', v_round.number));
  end if;
  if not p_force and now() < v_round.closes_at then
    raise exception 'round % has not reached its closing time', v_round.number;
  end if;
  if v_round.number > 1 then
    select * into v_prev from public.rounds where event_id = v_round.event_id and number = v_round.number - 1;
    if v_prev.status <> 'CLEARED' then
      raise exception 'round % must be cleared before round %', v_prev.number, v_round.number;
    end if;
  end if;

  perform set_config('app.price_writer', 'CLEARING', true);

  -- Prices: one row for every listed company, traded or not.
  insert into public.round_prices (event_id, company_id, round_id, kind, market_before, market_after, ai_before, ai_after,
                                   buy_qty, sell_qty, short_qty, cover_qty, net_qty, capped_net)
  select c.event_id, c.id, v_round.id, 'CLEARING', c.market_price,
         app.clearing_price(c.market_price, coalesce(a.buy, 0) + coalesce(a.cover, 0) - coalesce(a.sell, 0) - coalesce(a.short, 0)),
         c.ai_price, c.ai_price,
         coalesce(a.buy, 0), coalesce(a.sell, 0), coalesce(a.short, 0), coalesce(a.cover, 0),
         coalesce(a.buy, 0) + coalesce(a.cover, 0) - coalesce(a.sell, 0) - coalesce(a.short, 0),
         app.capped_net(coalesce(a.buy, 0) + coalesce(a.cover, 0) - coalesce(a.sell, 0) - coalesce(a.short, 0))
    from public.companies c
    left join (select o.company_id,
                      sum(o.qty) filter (where o.type = 'BUY') as buy,
                      sum(o.qty) filter (where o.type = 'SELL') as sell,
                      sum(o.qty) filter (where o.type = 'SHORT') as short,
                      sum(o.qty) filter (where o.type = 'COVER') as cover
                 from public.orders o where o.round_id = v_round.id and o.status = 'PENDING'
                group by o.company_id) a on a.company_id = c.id
   where c.event_id = v_round.event_id and c.market_price is not null;

  update public.companies c
     set market_price = rp.market_after, exchange_inventory = c.exchange_inventory - rp.net_qty
    from public.round_prices rp
   where rp.round_id = v_round.id and rp.kind = 'CLEARING' and rp.company_id = c.id;

  -- Every valid order fills at its company's new price.
  update public.orders o
     set status = 'FILLED', fill_price = c.market_price, filled_at = now(), updated_at = now()
    from public.companies c
   where o.round_id = v_round.id and o.status = 'PENDING' and c.id = o.company_id;

  -- Positions, per fund and company, in the engine's order: SELL then BUY on the exchange lot (sells leave at
  -- average cost), COVER then SHORT on the short lot (covers release proceeds pro rata).
  create temporary table if not exists _fills (team_id uuid, company_id uuid, price int, s int, b int, sh int, cv int) on commit drop;
  truncate _fills;
  insert into _fills
  select o.team_id, o.company_id, min(o.fill_price),
         coalesce(sum(o.qty) filter (where o.type = 'SELL'), 0), coalesce(sum(o.qty) filter (where o.type = 'BUY'), 0),
         coalesce(sum(o.qty) filter (where o.type = 'SHORT'), 0), coalesce(sum(o.qty) filter (where o.type = 'COVER'), 0)
    from public.orders o where o.round_id = v_round.id and o.status = 'FILLED'
   group by o.team_id, o.company_id;

  insert into public.holdings (event_id, team_id, company_id, lot, qty, cost_cents)
  select v_round.event_id, f.team_id, f.company_id, l.lot, 0, 0
    from _fills f cross join (values ('EXCHANGE'::public.lot_type), ('SHORT'::public.lot_type)) l(lot)
   where (l.lot = 'EXCHANGE' and f.s + f.b > 0) or (l.lot = 'SHORT' and f.sh + f.cv > 0)
  on conflict (team_id, company_id, lot) do nothing;

  if exists (select 1 from _fills f join public.holdings h on h.team_id = f.team_id and h.company_id = f.company_id
              where (h.lot = 'EXCHANGE' and f.s > h.qty) or (h.lot = 'SHORT' and f.cv > h.qty)) then
    raise exception 'a fund sells or covers more than it holds; refusing to clear round %', v_round.number;
  end if;

  update public.holdings h
     set qty = h.qty - f.s + f.b,
         cost_cents = h.cost_cents - case when f.s > 0 then app.mul_rate(h.cost_cents, f.s, h.qty) else 0 end
                      + f.b::bigint * f.price,
         updated_at = now()
    from _fills f
   where h.team_id = f.team_id and h.company_id = f.company_id and h.lot = 'EXCHANGE' and f.s + f.b > 0;

  update public.holdings h
     set qty = h.qty - f.cv + f.sh,
         cost_cents = h.cost_cents - case when f.cv > 0 then app.mul_rate(h.cost_cents, f.cv, h.qty) else 0 end
                      + f.sh::bigint * f.price,
         updated_at = now()
    from _fills f
   where h.team_id = f.team_id and h.company_id = f.company_id and h.lot = 'SHORT' and f.sh + f.cv > 0;

  update public.teams t
     set cash_cents = t.cash_cents + x.delta
    from (select team_id, sum((s - b + sh - cv)::bigint * price) as delta from _fills group by team_id) x
   where t.id = x.team_id;

  -- Ledger: one row per filled order for the fund, one row per company for the exchange. share_delta is shares
  -- received (+) or delivered (−): a short sale delivers shares, so a SHORT lot's quantity is −Σ its share_delta.
  insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, lot, cash_delta_cents, share_delta,
                                     price_cents, round_id, ref_table, ref_id, memo)
  select o.event_id, v_txn, 'TRADE', o.team_id, o.company_id,
         case when o.type in ('BUY', 'SELL') then 'EXCHANGE' else 'SHORT' end::public.lot_type,
         case when o.type in ('SELL', 'SHORT') then 1 else -1 end * o.qty::bigint * o.fill_price,
         case when o.type in ('BUY', 'COVER') then o.qty else -o.qty end,
         o.fill_price, o.round_id, 'orders', o.id, o.type::text || ' round ' || v_round.number
    from public.orders o where o.round_id = v_round.id and o.status = 'FILLED';
  insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, cash_delta_cents, share_delta, price_cents, round_id, memo)
  select rp.event_id, v_txn, 'TRADE', null, rp.company_id, rp.net_qty::bigint * rp.market_after, -rp.net_qty,
         rp.market_after, v_round.id, 'Exchange, round ' || v_round.number
    from public.round_prices rp
   where rp.round_id = v_round.id and rp.kind = 'CLEARING' and (rp.buy_qty + rp.sell_qty + rp.short_qty + rp.cover_qty) > 0;

  select coalesce(sum(net_qty::bigint * market_after), 0) into v_exchange_cash
    from public.round_prices where round_id = v_round.id and kind = 'CLEARING';
  update public.events set exchange_cash_cents = exchange_cash_cents + v_exchange_cash where id = v_round.event_id;

  -- Collateral: 150% of every open short at the new prices.
  perform app.recalculate_collateral(v_round.event_id);

  insert into public.public_ledger (event_id, txn_id, kind, label, company_id, ticker, shares, price_cents, round_number, details)
  select rp.event_id, v_txn, 'ROUND', 'Round ' || v_round.number, rp.company_id, c.ticker, rp.net_qty, rp.market_after,
         v_round.number,
         jsonb_build_object('buy', rp.buy_qty, 'sell', rp.sell_qty, 'short', rp.short_qty, 'cover', rp.cover_qty,
                            'net', rp.net_qty, 'before', rp.market_before)
    from public.round_prices rp join public.companies c on c.id = rp.company_id
   where rp.round_id = v_round.id and rp.kind = 'CLEARING' and (rp.buy_qty + rp.sell_qty + rp.short_qty + rp.cover_qty) > 0;

  update public.rounds set status = 'CLEARED', closed_at = coalesce(closed_at, now()), cleared_at = now()
   where id = v_round.id;

  if v_round.number = 4 then
    perform app.judge_calls(v_round.event_id, 1);
  end if;

  perform app.broadcast(v_round.event_id, 'round_cleared', jsonb_build_object(
    'round', v_round.number,
    'prices', (select jsonb_object_agg(company_id::text, jsonb_build_array(market_before, market_after))
                 from public.round_prices where round_id = v_round.id and kind = 'CLEARING')));

  return app.ok(jsonb_build_object('round', v_round.number,
                                   'orders', (select count(*) from public.orders where round_id = v_round.id and status = 'FILLED'),
                                   'ms', round(extract(epoch from clock_timestamp() - v_started) * 1000)));
end
$$;

create or replace function app.recalculate_collateral(p_event uuid)
returns void
language sql
as $$
  update public.teams t
     set collateral_cents = coalesce((
           select sum(app.short_collateral(h.qty, c.market_price))
             from public.holdings h join public.companies c on c.id = h.company_id
            where h.team_id = t.id and h.lot = 'SHORT' and h.qty > 0), 0)
   where t.event_id = p_event and t.track = 'FINANCE'
$$;

revoke all on function public.place_order(uuid, public.order_type, integer, text) from public, anon;
revoke all on function public.edit_order(uuid, integer) from public, anon;
revoke all on function public.cancel_order(uuid) from public, anon;
revoke all on function public.place_ipo_bid(uuid, integer) from public, anon;
grant execute on function public.place_order(uuid, public.order_type, integer, text) to authenticated;
grant execute on function public.edit_order(uuid, integer) to authenticated;
grant execute on function public.cancel_order(uuid) to authenticated;
grant execute on function public.place_ipo_bid(uuid, integer) to authenticated;
