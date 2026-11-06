-- Trading (Round 3): order entry validated by app.check_order (the port of the engine's validateOrder) and round
-- clearing (the port of clearRound), each in one transaction.

-- The engine's OrderContext as JSON for a team in its event.
create or replace function app.order_context(p_team public.teams, p_replacing uuid default null)
returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'trading', app.trading_state(p_team.event_id),
    'prices', coalesce((select jsonb_object_agg(c.id::text, c.market_price) from public.companies c
                         where c.event_id = p_team.event_id and c.market_price is not null), '{}'::jsonb),
    'trader', jsonb_build_object(
      'cash', p_team.cash_cents,
      'builtCompanyId', (app.built_company(p_team.id)).id::text,
      'rescuedCompanyId', (app.rescued_company(p_team.id)).id::text,
      'positions', coalesce((
        select jsonb_object_agg(h.company_id::text, jsonb_build_object('qty', h.qty, 'cost', h.cost_cents))
          from public.holdings h where h.team_id = p_team.id and h.qty > 0), '{}'::jsonb),
      'pending', coalesce((
        select jsonb_agg(jsonb_build_object('id', o.id::text, 'companyId', o.company_id::text, 'type', o.type,
                                            'qty', o.qty, 'reserve', o.reserve_cents) order by o.created_at)
          from public.orders o join public.rounds r on r.id = o.round_id
         where o.team_id = p_team.id and o.status = 'PENDING' and r.status = 'OPEN'), '[]'::jsonb)))
  || case when p_replacing is null then '{}'::jsonb else jsonb_build_object('replacingOrderId', p_replacing::text) end
$$;

-- The largest quantity that would pass validation right now (the engine's maxQuantity), for the order ticket.
create or replace function public.max_quantity(p_company uuid, p_type public.order_type, p_replacing uuid default null)
returns integer
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_ctx jsonb;
  lo int := 1;
  hi int := 5000;
  mid int;
begin
  select t.* into v_team from public.teams t where t.id = app.my_team_id();
  if v_team.id is null then
    raise exception 'only a team can trade' using errcode = '42501';
  end if;
  v_ctx := app.order_context(v_team, p_replacing);
  if not (app.check_order(v_ctx, jsonb_build_object('companyId', p_company::text, 'type', p_type, 'qty', 1)) ->> 'ok')::boolean then
    return 0;
  end if;
  if (app.check_order(v_ctx, jsonb_build_object('companyId', p_company::text, 'type', p_type, 'qty', hi)) ->> 'ok')::boolean then
    return hi;
  end if;
  while hi - lo > 1 loop
    mid := (lo + hi) / 2;
    if (app.check_order(v_ctx, jsonb_build_object('companyId', p_company::text, 'type', p_type, 'qty', mid)) ->> 'ok')::boolean then
      lo := mid;
    else
      hi := mid;
    end if;
  end loop;
  return lo;
end
$$;

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
  -- A team action locks only its own team row (after the throttle). A clearing locks every team of the event
  -- before it reads the orders, so an order either commits before the clearing reads the book or waits for it
  -- and then finds the round closed.
  if app.my_team_id() is null then
    raise exception 'only a team can place orders' using errcode = '42501';
  end if;
  if not app.rate_limit(app.my_team_id(), 'orders', 20, interval '10 seconds') then
    return app.fail('RATE_LIMITED', 'Too many order actions. Wait a few seconds.');
  end if;
  v_team := app.lock_caller_team();
  if p_client_ref is not null then
    select * into v_order from public.orders where team_id = v_team.id and client_ref = p_client_ref;
    if v_order.id is not null then
      return app.ok(jsonb_build_object('order', to_jsonb(v_order), 'duplicate', true));
    end if;
  end if;
  v_round := app.open_round(v_team.event_id);
  v_check := app.check_order(app.order_context(v_team),
                             jsonb_build_object('companyId', p_company::text, 'type', p_type, 'qty', p_qty));
  if not (v_check ->> 'ok')::boolean then
    return app.reject(v_team.event_id, 'place_order', v_check ->> 'code', app.order_message(v_check ->> 'code'), v_details);
  end if;
  if v_round.id is null then
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
  if app.my_team_id() is null then
    raise exception 'only a team can edit orders' using errcode = '42501';
  end if;
  if not app.rate_limit(app.my_team_id(), 'orders', 20, interval '10 seconds') then
    return app.fail('RATE_LIMITED', 'Too many order actions. Wait a few seconds.');
  end if;
  v_team := app.lock_caller_team();
  select * into v_order from public.orders where id = p_order and team_id = v_team.id for no key update;
  if v_order.id is null or v_order.status <> 'PENDING' then
    return app.reject(v_team.event_id, 'edit_order', 'NOT_EDITABLE', 'That order can no longer be changed.', v_details);
  end if;
  v_round := app.open_round(v_team.event_id);
  if v_round.id is distinct from v_order.round_id then
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
begin
  if app.my_team_id() is null then
    raise exception 'only a team can cancel orders' using errcode = '42501';
  end if;
  if not app.rate_limit(app.my_team_id(), 'orders', 20, interval '10 seconds') then
    return app.fail('RATE_LIMITED', 'Too many order actions. Wait a few seconds.');
  end if;
  v_team := app.lock_caller_team();
  select * into v_order from public.orders where id = p_order and team_id = v_team.id for no key update;
  if v_order.id is null or v_order.status <> 'PENDING' then
    return app.reject(v_team.event_id, 'cancel_order', 'NOT_EDITABLE', 'That order can no longer be changed.',
                      jsonb_build_object('order_id', p_order));
  end if;
  if (app.open_round(v_team.event_id)).id is distinct from v_order.round_id then
    return app.reject(v_team.event_id, 'cancel_order', 'TRADING_HALTED', app.order_message('TRADING_HALTED'),
                      jsonb_build_object('order_id', p_order));
  end if;
  update public.orders set status = 'CANCELLED', cancelled_at = now(), updated_at = now() where id = v_order.id
  returning * into v_order;
  return app.ok(jsonb_build_object('order', to_jsonb(v_order)));
end
$$;

-- ───────────────────────────── Clearing ─────────────────────────────

-- One round, every company at once (the engine's clearRound): a CLEARING price row for every listed company, every
-- pending order fills at its company's new price, per team and company sells are applied before buys (sold shares
-- leave at the average cost). The exchange takes the other side of every trade.
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
  select * into v_round from public.rounds where id = p_round for no key update;
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

  -- Every team, in id order, before reading the book: an order in flight commits first, a later one finds the
  -- round closed.
  update public.rounds set status = 'CLOSED', closed_at = coalesce(closed_at, now()) where id = v_round.id;
  perform 1 from public.teams where event_id = v_round.event_id order by id for no key update;

  perform set_config('app.price_writer', 'CLEARING', true);

  insert into public.round_prices (event_id, company_id, round_id, kind, market_before, market_after, score_before, score_after,
                                   buy_qty, sell_qty, net_qty, capped_net)
  select c.event_id, c.id, v_round.id, 'CLEARING', c.market_price,
         app.clearing_price(c.market_price, coalesce(a.buy, 0) - coalesce(a.sell, 0)),
         c.score_price, c.score_price, coalesce(a.buy, 0), coalesce(a.sell, 0),
         coalesce(a.buy, 0) - coalesce(a.sell, 0), app.capped_net(coalesce(a.buy, 0) - coalesce(a.sell, 0))
    from public.companies c
    left join (select o.company_id,
                      sum(o.qty) filter (where o.type = 'BUY') as buy,
                      sum(o.qty) filter (where o.type = 'SELL') as sell
                 from public.orders o where o.round_id = v_round.id and o.status = 'PENDING'
                group by o.company_id) a on a.company_id = c.id
   where c.event_id = v_round.event_id and c.market_price is not null;

  update public.companies c set market_price = rp.market_after
    from public.round_prices rp
   where rp.round_id = v_round.id and rp.kind = 'CLEARING' and rp.company_id = c.id;
  perform set_config('app.price_writer', '', true);

  update public.orders o
     set status = 'FILLED', fill_price = c.market_price, filled_at = now(), updated_at = now()
    from public.companies c
   where o.round_id = v_round.id and o.status = 'PENDING' and c.id = o.company_id;

  create temporary table if not exists _fills (team_id uuid, company_id uuid, price int, s int, b int) on commit drop;
  truncate _fills;
  insert into _fills
  select o.team_id, o.company_id, min(o.fill_price),
         coalesce(sum(o.qty) filter (where o.type = 'SELL'), 0), coalesce(sum(o.qty) filter (where o.type = 'BUY'), 0)
    from public.orders o where o.round_id = v_round.id and o.status = 'FILLED'
   group by o.team_id, o.company_id;

  insert into public.holdings (event_id, team_id, company_id, qty, cost_cents)
  select v_round.event_id, f.team_id, f.company_id, 0, 0 from _fills f
  on conflict (team_id, company_id) do nothing;

  if exists (select 1 from _fills f join public.holdings h on h.team_id = f.team_id and h.company_id = f.company_id
              where f.s > h.qty) then
    raise exception 'a team sells more than it holds; refusing to clear round %', v_round.number;
  end if;

  update public.holdings h
     set qty = h.qty - f.s + f.b,
         cost_cents = h.cost_cents - case when f.s > 0 then app.mul_rate(h.cost_cents, f.s, h.qty) else 0 end
                      + f.b::bigint * f.price,
         updated_at = now()
    from _fills f
   where h.team_id = f.team_id and h.company_id = f.company_id;

  update public.teams t
     set cash_cents = t.cash_cents + x.delta
    from (select team_id, sum((s - b)::bigint * price) as delta from _fills group by team_id) x
   where t.id = x.team_id;

  -- Ledger: one row per filled order for the team, one row per company for the exchange.
  insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, cash_delta_cents, share_delta,
                                     price_cents, round_id, ref_table, ref_id, memo)
  select o.event_id, v_txn, 'TRADE', o.team_id, o.company_id,
         case when o.type = 'SELL' then 1 else -1 end * o.qty::bigint * o.fill_price,
         case when o.type = 'BUY' then o.qty else -o.qty end,
         o.fill_price, o.round_id, 'orders', o.id, o.type::text || ' round ' || v_round.number
    from public.orders o where o.round_id = v_round.id and o.status = 'FILLED';
  insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, cash_delta_cents, share_delta, price_cents, round_id, memo)
  select rp.event_id, v_txn, 'TRADE', null, rp.company_id, rp.net_qty::bigint * rp.market_after, -rp.net_qty,
         rp.market_after, v_round.id, 'Exchange, round ' || v_round.number
    from public.round_prices rp
   where rp.round_id = v_round.id and rp.kind = 'CLEARING' and rp.buy_qty + rp.sell_qty > 0;

  select coalesce(sum(net_qty::bigint * market_after), 0) into v_exchange_cash
    from public.round_prices where round_id = v_round.id and kind = 'CLEARING';
  update public.events set exchange_cash_cents = exchange_cash_cents + v_exchange_cash where id = v_round.event_id;

  -- The public ledger: every filled trade (team code, company, side, quantity, price) and the round's totals.
  insert into public.public_ledger (event_id, txn_id, kind, label, team_code, company_id, ticker, side, shares, price_cents,
                                    cash_cents, round_number)
  select o.event_id, v_txn, 'TRADE', t.code || ' ' || lower(o.type::text) || 's ' || o.qty || ' ' || c.ticker,
         t.code, o.company_id, c.ticker, o.type::text, o.qty, o.fill_price, o.qty::bigint * o.fill_price, v_round.number
    from public.orders o join public.teams t on t.id = o.team_id join public.companies c on c.id = o.company_id
   where o.round_id = v_round.id and o.status = 'FILLED'
   order by c.ticker, o.type, t.code;
  insert into public.public_ledger (event_id, txn_id, kind, label, company_id, ticker, shares, price_cents, round_number, details)
  select rp.event_id, v_txn, 'ROUND', 'Round ' || v_round.number, rp.company_id, c.ticker, rp.net_qty, rp.market_after,
         v_round.number,
         jsonb_build_object('buy', rp.buy_qty, 'sell', rp.sell_qty, 'net', rp.net_qty, 'before', rp.market_before)
    from public.round_prices rp join public.companies c on c.id = rp.company_id
   where rp.round_id = v_round.id and rp.kind = 'CLEARING' and rp.buy_qty + rp.sell_qty > 0;

  update public.rounds set status = 'CLEARED', cleared_at = now() where id = v_round.id;

  perform app.broadcast(v_round.event_id, 'round_cleared', jsonb_build_object('round', v_round.number));

  return app.ok(jsonb_build_object('round', v_round.number,
                                   'orders', (select count(*) from public.orders where round_id = v_round.id and status = 'FILLED'),
                                   'ms', round(extract(epoch from clock_timestamp() - v_started) * 1000)));
end
$$;
