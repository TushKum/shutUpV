-- The Round 1 practice market (PRIMUS): while Product teams write their PRDs (phase BUILD), Finance teams trade a
-- scripted market named after the 50 Product teams, with $100,000 of practice money each. Prices tick every 5 seconds
-- along paths with candlestick patterns planted in them (generated in packages/engine/src/candles.ts and stored here
-- by the server, with the service role, when Round 1 starts). A tick is readable only once its time has come. When
-- Round 1 ends (entering READING), each fund's practice profit, capped at $50,000 and never a loss, is paid into its
-- real cash as a PRACTICE_EDGE ledger entry: an edge, not capital received (the return is measured on capital).
--
-- And, for the real market: each trading round's high and low. While a round is open, every order changes the
-- company's indicative price (the clearing rule applied to the orders so far); round_ranges keeps the round's open,
-- high, low and latest indicative price, so the trading screen can show it moving and the candles get real wicks.

alter type public.ledger_kind add value if not exists 'PRACTICE_EDGE';

-- ───────────────────────────── Practice market ─────────────────────────────

create table public.practice_markets (
  event_id uuid primary key references public.events (id) on delete cascade,
  starts_at timestamptz not null,
  tick_seconds int not null default 5 check (tick_seconds between 1 and 60),
  steps int not null check (steps > 0),
  settled_at timestamptz,
  created_at timestamptz not null default now()
);

-- One row per ticker (a Product team) and tick.
create table public.practice_ticks (
  event_id uuid not null references public.events (id) on delete cascade,
  ticker_team_id uuid not null references public.teams (id) on delete cascade,
  step int not null check (step >= 0),
  at timestamptz not null,
  price_cents int not null check (price_cents > 0),
  primary key (ticker_team_id, step)
);
create index practice_ticks_event_at_idx on public.practice_ticks (event_id, at);
-- Every fund's terminal reads the newest tick of all the tickers every 5 seconds, by step.
create index practice_ticks_event_step_idx on public.practice_ticks (event_id, step);

create table public.practice_accounts (
  team_id uuid primary key references public.teams (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  cash_cents bigint not null,
  trades int not null default 0,
  equity_cents bigint,
  edge_cents bigint,
  updated_at timestamptz not null default now()
);
create index practice_accounts_event_idx on public.practice_accounts (event_id);

create table public.practice_positions (
  team_id uuid not null references public.teams (id) on delete cascade,
  ticker_team_id uuid not null references public.teams (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  qty int not null default 0 check (qty between -2000 and 4000),
  primary key (team_id, ticker_team_id)
);

create table public.practice_trades (
  id bigserial primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  ticker_team_id uuid not null references public.teams (id) on delete cascade,
  type public.order_type not null,
  qty int not null check (qty > 0),
  price_cents int not null,
  created_at timestamptz not null default now()
);
create index practice_trades_team_idx on public.practice_trades (team_id, created_at desc);

alter table public.practice_markets enable row level security;
alter table public.practice_ticks enable row level security;
alter table public.practice_accounts enable row level security;
alter table public.practice_positions enable row level security;
alter table public.practice_trades enable row level security;

grant select on public.practice_markets, public.practice_ticks, public.practice_accounts, public.practice_positions,
  public.practice_trades to authenticated;

create policy practice_markets_read on public.practice_markets for select to authenticated
  using ((select app.sees_all_events()) or event_id = (select app.my_event_id()));
-- Never a tick from the future: the path is scripted, so it must not be readable before its time.
create policy practice_ticks_read on public.practice_ticks for select to authenticated
  using (at <= now() and ((select app.sees_all_events()) or event_id = (select app.my_event_id())));
-- Every fund's practice result is public within the event (the leaderboard); positions and trades are its own.
create policy practice_accounts_read on public.practice_accounts for select to authenticated
  using ((select app.sees_all_events()) or event_id = (select app.my_event_id()));
create policy practice_positions_read on public.practice_positions for select to authenticated
  using ((select app.is_staff()) or team_id = (select app.my_team_id()));
create policy practice_trades_read on public.practice_trades for select to authenticated
  using ((select app.is_staff()) or team_id = (select app.my_team_id()));

-- The latest price of a ticker at a time (the last tick at or before it).
create or replace function app.practice_price(p_ticker uuid, p_at timestamptz default now())
returns int
language sql stable
as $$
  select t.price_cents from public.practice_ticks t
   where t.ticker_team_id = p_ticker and t.at <= p_at order by t.step desc limit 1
$$;
revoke all on function app.practice_price(uuid, timestamptz) from public, anon, authenticated;

-- Stores the scripted paths (server only, with the service role). Rows: [{"ticker": "<team id>", "prices": [..]}],
-- every path the same length; tick k is at p_starts_at + k × tick seconds. Once per event: a second call is a no-op.
create or replace function public.practice_prepare(p_event uuid, p_starts_at timestamptz, p_tick_seconds int, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_steps int;
  v_event public.events;
begin
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.id is null then
    return app.fail('NO_EVENT', 'No such event.');
  end if;
  if exists (select 1 from public.practice_markets where event_id = p_event) then
    return app.ok(jsonb_build_object('already', true));
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return app.fail('BAD_CONTENT', 'No practice prices.');
  end if;
  v_steps := jsonb_array_length(p_rows -> 0 -> 'prices');
  if exists (select 1 from jsonb_array_elements(p_rows) r
              where jsonb_array_length(r -> 'prices') <> v_steps
                 or not exists (select 1 from public.teams t where t.id = (r ->> 'ticker')::uuid and t.event_id = p_event and t.track = 'PRODUCT')) then
    return app.fail('BAD_CONTENT', 'Every path must be the same length and name a Product team of this event.');
  end if;
  insert into public.practice_markets (event_id, starts_at, tick_seconds, steps) values (p_event, p_starts_at, p_tick_seconds, v_steps);
  insert into public.practice_ticks (event_id, ticker_team_id, step, at, price_cents)
  select p_event, (r ->> 'ticker')::uuid, p.ord - 1, p_starts_at + make_interval(secs => (p.ord - 1) * p_tick_seconds), p.price::int
    from jsonb_array_elements(p_rows) r
   cross join lateral jsonb_array_elements_text(r -> 'prices') with ordinality as p(price, ord);
  return app.ok(jsonb_build_object('steps', v_steps, 'tickers', jsonb_array_length(p_rows)));
end
$$;
revoke all on function public.practice_prepare(uuid, timestamptz, int, jsonb) from public, anon, authenticated;
grant execute on function public.practice_prepare(uuid, timestamptz, int, jsonb) to service_role;

-- A fund's practice equity at a time: cash plus every position at its latest price.
create or replace function app.practice_equity(p_team uuid, p_at timestamptz default now())
returns bigint
language sql stable
as $$
  select a.cash_cents + coalesce((select sum(p.qty::bigint * coalesce(app.practice_price(p.ticker_team_id, p_at), 0))
                                    from public.practice_positions p where p.team_id = a.team_id and p.qty <> 0), 0)
    from public.practice_accounts a where a.team_id = p_team
$$;
revoke all on function app.practice_equity(uuid, timestamptz) from public, anon, authenticated;

-- A practice trade at the current price, filled at once. BUY and SELL work the long side, SHORT and COVER the short
-- side (a company is held long or short, not both). Limits: 4,000 shares long and 2,000 short per company, and the
-- cash left must cover 150% of every short at the current price.
create or replace function public.practice_trade(p_ticker uuid, p_type public.order_type, p_qty integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_event public.events;
  v_market public.practice_markets;
  v_acct public.practice_accounts;
  v_pos int;
  v_new int;
  v_price int;
  v_cash bigint;
  v_shorts bigint;
begin
  if app.my_team_id() is null then
    raise exception 'only a team can trade' using errcode = '42501';
  end if;
  if not app.rate_limit(app.my_team_id(), 'practice', 30, interval '10 seconds') then
    return app.fail('RATE_LIMITED', 'Too many trades at once. Wait a few seconds.');
  end if;
  v_team := app.lock_caller_team();
  if v_team.track <> 'FINANCE' then
    return app.fail('NOT_FINANCE', 'Only Finance teams trade in the practice market.');
  end if;
  select * into v_event from public.events where id = v_team.event_id;
  select * into v_market from public.practice_markets where event_id = v_team.event_id;
  if v_market.event_id is null or v_event.current_phase <> 'BUILD' or v_market.settled_at is not null or v_event.paused then
    return app.fail('PRACTICE_CLOSED', 'The practice market is open during Round 1 only.');
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 4000 then
    return app.fail('BAD_QTY', 'Trade between 1 and 4,000 shares.');
  end if;
  v_price := app.practice_price(p_ticker);
  if v_price is null or not exists (select 1 from public.teams t where t.id = p_ticker and t.event_id = v_team.event_id and t.track = 'PRODUCT') then
    return app.fail('NO_PRICE', 'That company has no price yet.');
  end if;

  insert into public.practice_accounts (team_id, event_id, cash_cents)
  values (v_team.id, v_team.event_id, 10000000) on conflict (team_id) do nothing;
  select * into v_acct from public.practice_accounts where team_id = v_team.id for update;
  select coalesce((select qty from public.practice_positions where team_id = v_team.id and ticker_team_id = p_ticker), 0) into v_pos;

  case p_type
    when 'BUY' then
      if v_pos < 0 then return app.fail('COVER_FIRST', 'You are short this company: COVER first.'); end if;
      v_new := v_pos + p_qty;
      if v_new > 4000 then return app.fail('LIMIT', 'At most 4,000 shares of one company.'); end if;
      v_cash := v_acct.cash_cents - p_qty::bigint * v_price;
    when 'SELL' then
      if p_qty > v_pos then return app.fail('NOT_HELD', 'You can sell only shares you hold (' || greatest(v_pos, 0) || ').'); end if;
      v_new := v_pos - p_qty;
      v_cash := v_acct.cash_cents + p_qty::bigint * v_price;
    when 'SHORT' then
      if v_pos > 0 then return app.fail('SELL_FIRST', 'You hold this company: SELL first.'); end if;
      v_new := v_pos - p_qty;
      if v_new < -2000 then return app.fail('LIMIT', 'At most 2,000 shares short of one company.'); end if;
      v_cash := v_acct.cash_cents + p_qty::bigint * v_price;
    when 'COVER' then
      if p_qty > -v_pos then return app.fail('NOT_SHORT', 'You can cover only shares you are short (' || greatest(-v_pos, 0) || ').'); end if;
      v_new := v_pos + p_qty;
      v_cash := v_acct.cash_cents - p_qty::bigint * v_price;
  end case;

  -- The cash left must cover 150% of every short (this one included) at the current prices.
  select coalesce(sum(-q.qty::bigint * coalesce(app.practice_price(q.ticker_team_id), 0)), 0) into v_shorts
    from (select ticker_team_id, qty from public.practice_positions where team_id = v_team.id and ticker_team_id <> p_ticker
          union all select p_ticker, v_new) q
   where q.qty < 0;
  if v_cash < 0 or v_cash < (v_shorts * 3) / 2 then
    return app.fail('NO_CASH', 'Not enough practice cash for that (shorts need 150% cover).');
  end if;

  insert into public.practice_positions (team_id, ticker_team_id, event_id, qty) values (v_team.id, p_ticker, v_team.event_id, v_new)
  on conflict (team_id, ticker_team_id) do update set qty = excluded.qty;
  update public.practice_accounts set cash_cents = v_cash, trades = trades + 1, updated_at = now() where team_id = v_team.id;
  insert into public.practice_trades (event_id, team_id, ticker_team_id, type, qty, price_cents)
  values (v_team.event_id, v_team.id, p_ticker, p_type, p_qty, v_price);
  return app.ok(jsonb_build_object('price', v_price, 'position', v_new, 'cash', v_cash,
                                   'equity', app.practice_equity(v_team.id)));
end
$$;
revoke all on function public.practice_trade(uuid, public.order_type, integer) from public, anon;
grant execute on function public.practice_trade(uuid, public.order_type, integer) to authenticated;

-- Closes the practice market (on entering READING): every fund's equity at the last price, and its edge (profit,
-- at most $50,000) paid into its real cash by the exchange. Once.
create or replace function app.settle_practice(p_event uuid)
returns void
language plpgsql
as $$
declare
  v_txn uuid := gen_random_uuid();
  v_total bigint;
  v_market public.practice_markets;
begin
  select * into v_market from public.practice_markets where event_id = p_event for update;
  if v_market.event_id is null or v_market.settled_at is not null then
    return;
  end if;
  update public.practice_accounts a set equity_cents = app.practice_equity(a.team_id), updated_at = now() where a.event_id = p_event;
  update public.practice_accounts a set edge_cents = greatest(0, least(5000000, a.equity_cents - 10000000)) where a.event_id = p_event;
  insert into public.ledger_entries (event_id, txn_id, kind, team_id, cash_delta_cents, memo)
  select p_event, v_txn, 'PRACTICE_EDGE', a.team_id, a.edge_cents, 'Round 1 practice market: profit carried into the real fund'
    from public.practice_accounts a where a.event_id = p_event and a.edge_cents > 0;
  select coalesce(sum(edge_cents), 0) into v_total from public.practice_accounts where event_id = p_event and edge_cents > 0;
  if v_total > 0 then
    insert into public.ledger_entries (event_id, txn_id, kind, team_id, cash_delta_cents, memo)
    values (p_event, v_txn, 'PRACTICE_EDGE', null, -v_total, 'Paid by the exchange');
    update public.teams t set cash_cents = t.cash_cents + a.edge_cents
      from public.practice_accounts a where a.team_id = t.id and a.event_id = p_event and a.edge_cents > 0;
    update public.events set exchange_cash_cents = exchange_cash_cents - v_total where id = p_event;
    insert into public.public_ledger (event_id, txn_id, kind, label, cash_cents)
    values (p_event, v_txn, 'PRACTICE_EDGE', 'Round 1 practice market: funds'' profits carried into the real market', v_total);
  end if;
  update public.practice_markets set settled_at = now() where event_id = p_event;
  insert into public.bulletins (event_id, kind, title, body, published_at)
  values (p_event, 'GENERAL', 'The practice market has closed',
          'Every fund''s practice profit (up to $50,000) has been added to its real cash for the IPO.', now());
end
$$;
revoke all on function app.settle_practice(uuid) from public, anon, authenticated;

select app.patch_functions(
  '    when ''READING'' then perform app.default_tickers(p_event);',
  '    when ''READING'' then perform app.default_tickers(p_event); perform app.settle_practice(p_event);');

-- ───────────────────────────── Real market: each round's high and low ─────────────────────────────

create table public.round_ranges (
  round_id uuid not null references public.rounds (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  open_cents int not null,
  high_cents int not null,
  low_cents int not null,
  last_cents int not null,
  updated_at timestamptz not null default now(),
  primary key (round_id, company_id)
);
create index round_ranges_event_idx on public.round_ranges (event_id);
alter table public.round_ranges enable row level security;
grant select on public.round_ranges to authenticated;
create policy round_ranges_read on public.round_ranges for select to authenticated
  using ((select app.sees_all_events()) or event_id = (select app.my_event_id()));

-- After every order change in an open round: the company's indicative price (the clearing rule on the pending
-- orders) and the round's high and low so far. The clearing itself (which fills the orders) is skipped.
create or replace function app.track_round_range()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_round uuid := coalesce(new.round_id, old.round_id);
  v_company uuid := coalesce(new.company_id, old.company_id);
  v_event uuid := coalesce(new.event_id, old.event_id);
  v_open int;
  v_price int;
begin
  if coalesce(current_setting('app.price_writer', true), '') = 'CLEARING' then
    return null;
  end if;
  if not exists (select 1 from public.rounds r where r.id = v_round and r.status = 'OPEN') then
    return null;
  end if;
  select c.market_price into v_open from public.companies c where c.id = v_company;
  if v_open is null then
    return null;
  end if;
  insert into public.round_ranges (round_id, company_id, event_id, open_cents, high_cents, low_cents, last_cents)
  values (v_round, v_company, v_event, v_open, v_open, v_open, v_open) on conflict do nothing;
  perform 1 from public.round_ranges where round_id = v_round and company_id = v_company for update;
  -- After the lock, so an order committed while waiting is counted.
  select app.clearing_price(v_open, coalesce(sum(case when o.type in ('BUY', 'COVER') then o.qty else -o.qty end), 0))
    into v_price
    from public.orders o where o.round_id = v_round and o.company_id = v_company and o.status = 'PENDING';
  update public.round_ranges
     set last_cents = v_price, high_cents = greatest(high_cents, v_price), low_cents = least(low_cents, v_price), updated_at = now()
   where round_id = v_round and company_id = v_company;
  return null;
end
$$;
revoke all on function app.track_round_range() from public, anon, authenticated;

create trigger orders_track_range
  after insert or update of qty, status or delete on public.orders
  for each row execute function app.track_round_range();

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261118000052'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
