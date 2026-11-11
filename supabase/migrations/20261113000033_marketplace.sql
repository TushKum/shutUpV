-- PRIMUS marketplace (docs/PRIMUS.md): from Round 2, Product teams hire Consulting firms for one sub-round at a time.
-- A firm keeps a profile (specialities, rate card, Round 3 asking fee). A company sends an offer (cash and/or
-- shares); the firm accepts, counters or declines; each side may counter at most 3 times. Accepting is binding: the
-- cash goes into escrow, held by the exchange. At the due time the escrow is paid to the firm if its advice memo is
-- in, refunded otherwise (shares move with it). The client then rates the firm 1–5 (a missing rating counts as 3).
-- When the advice scores are released the firm earns $500 × (score − 50) (clamped like the plan bonus) plus
-- $1,000 × (rating − 3). Capacity: one firm per company and at most two clients per firm, per sub-round.

create table public.firm_profiles (
  team_id uuid primary key references public.teams (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  headline text not null default '' check (length(headline) <= 140),
  specialities text[] not null default '{}' check (cardinality(specialities) <= 8),
  rate_card text not null default '' check (length(rate_card) <= 600),
  asking_cents bigint not null default 0 check (asking_cents between 0 and 100000000),
  updated_at timestamptz not null default now()
);
alter table public.firm_profiles enable row level security;
create policy firm_profiles_read on public.firm_profiles for select to authenticated
  using (event_id = app.my_event_id() or app.is_staff());

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  k smallint not null check (k between 1 and 5),
  company_id uuid not null references public.companies (id) on delete cascade,
  firm_team_id uuid not null references public.teams (id) on delete cascade,
  cash_cents bigint not null check (cash_cents >= 0),
  shares integer not null check (shares >= 0),
  note text not null default '' check (length(note) <= 300),
  status text not null default 'OPEN' check (status in ('OPEN', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'LAPSED')),
  -- Whose move it is while open.
  turn text not null default 'FIRM' check (turn in ('FIRM', 'COMPANY')),
  company_counters smallint not null default 0,
  firm_counters smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  check (cash_cents > 0 or shares > 0)
);
create unique index offers_open_uq on public.offers (company_id, firm_team_id, k) where status = 'OPEN';
create index offers_firm_idx on public.offers (firm_team_id, k);
alter table public.offers enable row level security;
-- The two sides (and staff) see an offer.
create policy offers_read on public.offers for select to authenticated using (
  app.is_staff() or firm_team_id = app.my_team_id()
  or exists (select 1 from public.companies c where c.id = company_id and c.product_team_id = app.my_team_id()));

create table public.engagements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  k smallint not null check (k between 1 and 5),
  company_id uuid not null references public.companies (id) on delete cascade,
  firm_team_id uuid not null references public.teams (id) on delete cascade,
  offer_id uuid references public.offers (id) on delete set null,
  cash_cents bigint not null check (cash_cents >= 0),
  shares integer not null check (shares >= 0),
  escrow text not null default 'HELD' check (escrow in ('HELD', 'RELEASED', 'REFUNDED')),
  rating smallint check (rating between 1 and 5),
  rating_default boolean not null default false,
  rated_at timestamptz,
  bonus_cents bigint,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (company_id, k)
);
create index engagements_firm_idx on public.engagements (firm_team_id, k);
alter table public.engagements enable row level security;
-- Who hired whom, and on what terms, is public (the guide's transparency: plans are public, the market sees fees).
create policy engagements_read on public.engagements for select to authenticated
  using (event_id = app.my_event_id() or app.is_staff());

-- ───────────────────────────── Windows ─────────────────────────────

-- The sub-round whose hiring is open now (null if none): Round 2 from a reveal to its HIRE_k; Round 3 from the end of
-- the draft to HIRE_5.
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
    when e.current_phase = 'SATURATION' and app.deadline_passed(e.id, 'DRAFT') and not app.deadline_passed(e.id, 'HIRE_5') then 5::smallint
  end
    from public.events e where e.id = p_event
$$;

-- The caller's company (Product teams).
create or replace function app.my_company()
returns public.companies
language sql stable
as $$
  select c.* from public.companies c where c.product_team_id = app.my_team_id()
$$;

-- An offer's terms are possible: the company has the cash and the retained shares; in Round 3 the fee's value is
-- 5–20% of the company's cash.
create or replace function app.offer_problem(p_company public.companies, p_k int, p_cash bigint, p_shares int)
returns text
language plpgsql stable
as $$
declare
  v_cash bigint;
  v_retained int;
  v_value bigint;
begin
  if p_cash < 0 or p_shares < 0 or (p_cash = 0 and p_shares = 0) then
    return 'Offer cash, shares or both.';
  end if;
  select cash_cents into v_cash from public.teams where id = p_company.product_team_id;
  select coalesce(sum(qty), 0) into v_retained from public.holdings
   where team_id = p_company.product_team_id and company_id = p_company.id and lot = 'RETAINED';
  if p_cash > v_cash then
    return 'Your company does not have that much cash.';
  end if;
  if p_shares > v_retained then
    return format('Your company retains only %s shares.', v_retained);
  end if;
  if p_k = 5 then
    v_value := p_cash + p_shares::bigint * coalesce(p_company.market_price, 0);
    if v_value < v_cash * 5 / 100 or v_value > v_cash * 20 / 100 then
      return 'In Round 3 a fee is worth 5% to 20% of the company''s cash.';
    end if;
  end if;
  return null;
end
$$;

-- ───────────────────────────── Firm profile ─────────────────────────────

create or replace function public.save_firm_profile(p_headline text, p_specialities text[], p_rate_card text, p_asking_cents bigint)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
begin
  if app.my_team_id() is null then
    raise exception 'only a team can edit its firm profile' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  v_team := app.lock_caller_team();
  if v_team.track <> 'CONSULTING' then
    return app.fail('NOT_ALLOWED', 'Only Consulting firms have a profile.');
  end if;
  if length(coalesce(p_headline, '')) > 140 or length(coalesce(p_rate_card, '')) > 600
     or cardinality(coalesce(p_specialities, '{}')) > 8 or coalesce(p_asking_cents, 0) not between 0 and 100000000 then
    return app.fail('BAD_CONTENT', 'Keep the headline to 140 characters, the rate card to 600 and at most 8 specialities.');
  end if;
  insert into public.firm_profiles (team_id, event_id, headline, specialities, rate_card, asking_cents, updated_at)
  values (v_team.id, v_team.event_id, btrim(coalesce(p_headline, '')),
          coalesce((select array_agg(btrim(s)) from unnest(p_specialities) s where btrim(s) <> ''), '{}'),
          btrim(coalesce(p_rate_card, '')), coalesce(p_asking_cents, 0), now())
  on conflict (team_id) do update set headline = excluded.headline, specialities = excluded.specialities,
    rate_card = excluded.rate_card, asking_cents = excluded.asking_cents, updated_at = now();
  return app.ok();
end
$$;

-- ───────────────────────────── Offers ─────────────────────────────

create or replace function public.make_offer(p_firm uuid, p_cash bigint, p_shares integer, p_note text default '')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_company public.companies;
  v_firm public.teams;
  v_k smallint;
  v_problem text;
  v_offer public.offers;
begin
  if app.my_team_id() is null then
    raise exception 'only a team can make an offer' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  v_team := app.lock_caller_team();
  if v_team.track <> 'PRODUCT' then
    return app.fail('NOT_ALLOWED', 'Only a Product team hires a firm.');
  end if;
  select * into v_company from public.companies where product_team_id = v_team.id for no key update;
  select * into v_firm from public.teams where id = p_firm and event_id = v_team.event_id and track = 'CONSULTING';
  if v_firm.id is null then
    return app.fail('NO_SUCH_FIRM', 'No such Consulting firm.');
  end if;
  v_k := app.hiring_subround(v_team.event_id);
  if v_k is null then
    return app.fail('HIRING_CLOSED', 'Hiring is not open now.');
  end if;
  if exists (select 1 from public.engagements where company_id = v_company.id and k = v_k) then
    return app.fail('ALREADY_HIRED', 'Your company has already hired a firm this sub-round.');
  end if;
  if (select count(*) from public.engagements where firm_team_id = p_firm and k = v_k) >= 2 then
    return app.fail('FIRM_FULL', 'That firm already has two clients this sub-round.');
  end if;
  if exists (select 1 from public.offers where company_id = v_company.id and firm_team_id = p_firm and k = v_k and status = 'OPEN') then
    return app.fail('OFFER_OPEN', 'You already have an open offer with that firm.');
  end if;
  v_problem := app.offer_problem(v_company, v_k, coalesce(p_cash, 0), coalesce(p_shares, 0));
  if v_problem is not null then
    return app.fail('BAD_TERMS', v_problem);
  end if;
  insert into public.offers (event_id, k, company_id, firm_team_id, cash_cents, shares, note, turn)
  values (v_team.event_id, v_k, v_company.id, p_firm, coalesce(p_cash, 0), coalesce(p_shares, 0), left(btrim(coalesce(p_note, '')), 300), 'FIRM')
  returning * into v_offer;
  perform app.broadcast(v_team.event_id, 'offers', jsonb_build_object('firm', p_firm, 'company', v_company.id));
  return app.ok(jsonb_build_object('offer', to_jsonb(v_offer)));
end
$$;

-- p_action: ACCEPT, DECLINE or COUNTER (with new terms) by the side whose turn it is; WITHDRAW by the company.
create or replace function public.respond_offer(p_offer uuid, p_action text, p_cash bigint default null, p_shares integer default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_offer public.offers;
  v_company public.companies;
  v_side text;
  v_problem text;
  v_eng public.engagements;
  v_txn uuid := gen_random_uuid();
begin
  if app.my_team_id() is null then
    raise exception 'only a team can answer an offer' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  v_team := app.lock_caller_team();
  select * into v_offer from public.offers where id = p_offer and event_id = v_team.event_id;
  if v_offer.id is null then
    return app.fail('NO_SUCH_OFFER', 'No such offer.');
  end if;
  select * into v_company from public.companies where id = v_offer.company_id;
  v_side := case when v_team.id = v_offer.firm_team_id then 'FIRM' when v_team.id = v_company.product_team_id then 'COMPANY' end;
  if v_side is null then
    return app.fail('NOT_ALLOWED', 'This offer is not yours.');
  end if;
  -- Both teams are locked in id order before the offer, so two answers never interleave.
  perform 1 from public.teams where id in (v_offer.firm_team_id, v_company.product_team_id) order by id for no key update;
  select * into v_offer from public.offers where id = p_offer for no key update;
  if v_offer.status <> 'OPEN' then
    return app.fail('OFFER_CLOSED', format('This offer is %s.', lower(v_offer.status)));
  end if;
  if app.hiring_subround(v_team.event_id) is distinct from v_offer.k then
    return app.fail('HIRING_CLOSED', 'Hiring for this sub-round has closed.');
  end if;
  p_action := upper(coalesce(p_action, ''));
  if p_action = 'WITHDRAW' then
    if v_side <> 'COMPANY' then
      return app.fail('NOT_ALLOWED', 'Only the company withdraws its offer.');
    end if;
    update public.offers set status = 'WITHDRAWN', decided_at = now(), updated_at = now() where id = p_offer returning * into v_offer;
    return app.ok(jsonb_build_object('offer', to_jsonb(v_offer)));
  end if;
  if v_offer.turn <> v_side then
    return app.fail('NOT_YOUR_TURN', 'Wait for the other side to answer.');
  end if;
  if p_action = 'DECLINE' then
    update public.offers set status = 'DECLINED', decided_at = now(), updated_at = now() where id = p_offer returning * into v_offer;
    perform app.broadcast(v_team.event_id, 'offers', jsonb_build_object('offer', p_offer));
    return app.ok(jsonb_build_object('offer', to_jsonb(v_offer)));
  elsif p_action = 'COUNTER' then
    if (v_side = 'FIRM' and v_offer.firm_counters >= 3) or (v_side = 'COMPANY' and v_offer.company_counters >= 3) then
      return app.fail('NO_COUNTERS_LEFT', 'You have used your three counters: accept or decline.');
    end if;
    v_problem := app.offer_problem(v_company, v_offer.k, coalesce(p_cash, -1), coalesce(p_shares, -1));
    if v_problem is not null then
      return app.fail('BAD_TERMS', v_problem);
    end if;
    update public.offers set cash_cents = p_cash, shares = p_shares, updated_at = now(),
           turn = case v_side when 'FIRM' then 'COMPANY' else 'FIRM' end,
           firm_counters = firm_counters + (v_side = 'FIRM')::int, company_counters = company_counters + (v_side = 'COMPANY')::int
     where id = p_offer returning * into v_offer;
    perform app.broadcast(v_team.event_id, 'offers', jsonb_build_object('offer', p_offer));
    return app.ok(jsonb_build_object('offer', to_jsonb(v_offer)));
  elsif p_action <> 'ACCEPT' then
    return app.fail('BAD_ACTION', 'Accept, decline or counter.');
  end if;

  -- Accept: binding. Capacity and the terms are checked again now.
  if exists (select 1 from public.engagements where company_id = v_company.id and k = v_offer.k) then
    return app.fail('ALREADY_HIRED', 'The company has already hired a firm this sub-round.');
  end if;
  if (select count(*) from public.engagements where firm_team_id = v_offer.firm_team_id and k = v_offer.k) >= 2 then
    return app.fail('FIRM_FULL', 'The firm already has two clients this sub-round.');
  end if;
  v_problem := app.offer_problem(v_company, v_offer.k, v_offer.cash_cents, v_offer.shares);
  if v_problem is not null then
    return app.fail('BAD_TERMS', v_problem);
  end if;
  update public.offers set status = 'ACCEPTED', decided_at = now(), updated_at = now() where id = p_offer returning * into v_offer;
  -- The company's other open offers this sub-round lapse; so do the firm's if it is now full.
  update public.offers set status = 'LAPSED', decided_at = now(), updated_at = now()
   where status = 'OPEN' and k = v_offer.k and (company_id = v_company.id
      or (firm_team_id = v_offer.firm_team_id and (select count(*) from public.engagements e
           where e.firm_team_id = v_offer.firm_team_id and e.k = v_offer.k) >= 1));
  insert into public.engagements (event_id, k, company_id, firm_team_id, offer_id, cash_cents, shares)
  values (v_offer.event_id, v_offer.k, v_company.id, v_offer.firm_team_id, v_offer.id, v_offer.cash_cents, v_offer.shares)
  returning * into v_eng;
  if v_offer.cash_cents > 0 then
    update public.teams set cash_cents = cash_cents - v_offer.cash_cents where id = v_company.product_team_id;
    update public.events set exchange_cash_cents = exchange_cash_cents + v_offer.cash_cents where id = v_offer.event_id;
    insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, cash_delta_cents, ref_table, ref_id, memo) values
      (v_offer.event_id, v_txn, 'ESCROW_HOLD', v_company.product_team_id, v_company.id, -v_offer.cash_cents, 'engagements', v_eng.id, 'Consulting fee into escrow'),
      (v_offer.event_id, v_txn, 'ESCROW_HOLD', null, v_company.id, v_offer.cash_cents, 'engagements', v_eng.id, 'Held by the exchange');
  end if;
  insert into public.public_ledger (event_id, txn_id, kind, label, company_id, ticker, cash_cents, shares, details)
  values (v_offer.event_id, v_txn, 'HIRE', format('%s hired a firm (%s)', coalesce(v_company.ticker, 'A company'),
            case when v_offer.k = 5 then 'Round 3' else 'crisis ' || v_offer.k end),
          v_company.id, v_company.ticker, v_offer.cash_cents, v_offer.shares, jsonb_build_object('k', v_offer.k, 'firm', v_offer.firm_team_id));
  perform app.broadcast(v_team.event_id, 'offers', jsonb_build_object('offer', p_offer, 'accepted', true));
  return app.ok(jsonb_build_object('offer', to_jsonb(v_offer), 'engagement', to_jsonb(v_eng)));
end
$$;

-- ───────────────────────────── Escrow and ratings ─────────────────────────────

-- At the due time: pay the firm if its advice memo is in, refund the company otherwise. Once per engagement.
create or replace function app.settle_engagements(p_event uuid, p_k int)
returns int
language plpgsql
as $$
declare
  e public.engagements;
  v_company public.companies;
  v_paid boolean;
  v_txn uuid;
  n int := 0;
begin
  for e in select * from public.engagements where event_id = p_event and k = p_k and settled_at is null order by id for no key update loop
    select * into v_company from public.companies where id = e.company_id;
    v_paid := (app.current_submission(e.company_id, app.advice_type(p_k))).id is not null;
    v_txn := gen_random_uuid();
    perform 1 from public.teams where id in (e.firm_team_id, v_company.product_team_id) order by id for no key update;
    if e.cash_cents > 0 then
      update public.teams set cash_cents = cash_cents + e.cash_cents
       where id = case when v_paid then e.firm_team_id else v_company.product_team_id end;
      update public.events set exchange_cash_cents = exchange_cash_cents - e.cash_cents where id = p_event;
      insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, cash_delta_cents, ref_table, ref_id, memo) values
        (p_event, v_txn, case when v_paid then 'ESCROW_RELEASE' else 'ESCROW_REFUND' end::public.ledger_kind, null, e.company_id,
         -e.cash_cents, 'engagements', e.id, 'Escrow paid out'),
        (p_event, v_txn, case when v_paid then 'ESCROW_RELEASE' else 'ESCROW_REFUND' end::public.ledger_kind,
         case when v_paid then e.firm_team_id else v_company.product_team_id end, e.company_id, e.cash_cents, 'engagements', e.id,
         case when v_paid then 'Consulting fee received' else 'Consulting fee refunded: no advice memo' end);
    end if;
    if v_paid and e.shares > 0 then
      -- Shares move only when earned (the company keeps them until then); never more than it still retains.
      e.shares := least(e.shares, (select coalesce(sum(qty), 0) from public.holdings
                                    where team_id = v_company.product_team_id and company_id = e.company_id and lot = 'RETAINED'));
      update public.holdings set qty = qty - e.shares, updated_at = now()
       where team_id = v_company.product_team_id and company_id = e.company_id and lot = 'RETAINED';
      insert into public.holdings (event_id, team_id, company_id, lot, qty, cost_cents)
      values (p_event, e.firm_team_id, e.company_id, 'FEE', e.shares, 0)
      on conflict (team_id, company_id, lot) do update set qty = public.holdings.qty + excluded.qty, updated_at = now();
      insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, lot, share_delta, ref_table, ref_id, memo) values
        (p_event, v_txn, 'ESCROW_RELEASE', v_company.product_team_id, e.company_id, 'RETAINED', -e.shares, 'engagements', e.id, 'Fee shares paid'),
        (p_event, v_txn, 'ESCROW_RELEASE', e.firm_team_id, e.company_id, 'FEE', e.shares, 'engagements', e.id, 'Fee shares received');
    end if;
    update public.engagements set escrow = case when v_paid then 'RELEASED' else 'REFUNDED' end, settled_at = now(),
           shares = case when v_paid then e.shares else shares end
     where id = e.id;
    n := n + 1;
  end loop;
  return n;
end
$$;

create or replace function public.rate_firm(p_k integer, p_rating integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_eng public.engagements;
begin
  if app.my_team_id() is null then
    raise exception 'only a team can rate its firm' using errcode = '42501';
  end if;
  v_team := app.lock_caller_team();
  select e.* into v_eng from public.engagements e join public.companies c on c.id = e.company_id
   where c.product_team_id = v_team.id and e.k = p_k for no key update of e;
  if v_eng.id is null then
    return app.fail('NO_ENGAGEMENT', 'Your company did not hire a firm in this sub-round.');
  end if;
  if p_rating not between 1 and 5 then
    return app.fail('BAD_RATING', 'Rate from 1 to 5.');
  end if;
  if not app.deadline_passed(v_team.event_id, ('DUE_' || p_k)::public.deadline_code)
     or app.deadline_passed(v_team.event_id, ('RATE_' || p_k)::public.deadline_code) then
    return app.fail('RATING_CLOSED', 'You rate your firm after the due time, until ratings close.');
  end if;
  update public.engagements set rating = p_rating, rating_default = false, rated_at = now() where id = v_eng.id returning * into v_eng;
  return app.ok(jsonb_build_object('engagement', to_jsonb(v_eng)));
end
$$;

-- The firm's reputation bonus for sub-round k, paid when the advice scores are released.
create or replace function app.after_advice_release(p_event uuid, p_k int)
returns void
language plpgsql
as $$
declare
  v_txn uuid := gen_random_uuid();
  v_total bigint;
begin
  create temporary table if not exists _abonus (engagement uuid, team_id uuid, company_id uuid, amount bigint, memo text) on commit drop;
  truncate _abonus;
  insert into _abonus
  select e.id, e.firm_team_id, e.company_id,
         app.plan_bonus(coalesce(s.final_score, 0)) + 100000::bigint * (coalesce(e.rating, 3) - 3),
         format('Advice bonus: $500 × (%s − 50) + $1,000 × (%s − 3)', coalesce(s.final_score, 0), coalesce(e.rating, 3))
    from public.engagements e
    left join public.scores s on s.company_id = e.company_id and s.type = app.advice_type(p_k)
   where e.event_id = p_event and e.k = p_k and e.bonus_cents is null and e.escrow = 'RELEASED';
  update public.engagements e set bonus_cents = b.amount from _abonus b where e.id = b.engagement;
  insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, cash_delta_cents, ref_table, ref_id, memo)
  select p_event, v_txn, 'BONUS_ADVICE', team_id, company_id, amount, 'engagements', engagement, memo from _abonus where amount <> 0;
  select coalesce(sum(amount), 0) into v_total from _abonus;
  if v_total <> 0 then
    insert into public.ledger_entries (event_id, txn_id, kind, team_id, cash_delta_cents, memo)
    values (p_event, v_txn, 'BONUS_ADVICE', null, -v_total, 'Paid by the exchange');
  end if;
  update public.teams t set cash_cents = t.cash_cents + x.amount
    from (select team_id, sum(amount) as amount from _abonus group by team_id) x where t.id = x.team_id;
  update public.events set exchange_cash_cents = exchange_cash_cents - v_total where id = p_event;
end
$$;

-- ───────────────────────────── The heartbeat ─────────────────────────────

create or replace function app.primus_tick(p_event uuid)
returns text[]
language plpgsql
as $$
declare
  v_event public.events;
  v_actions text[] := '{}';
  v_sub public.subrounds;
  v_k int;
  n int;
begin
  select * into v_event from public.events where id = p_event;
  if v_event.format <> 'PRIMUS' or v_event.current_phase not in ('PRESSURE', 'SATURATION') then
    return v_actions;
  end if;
  if v_event.current_phase = 'PRESSURE' then
    for v_k in 1..4 loop
      if app.deadline_passed(p_event, ('REVEAL_' || v_k)::public.deadline_code) and app.reveal_subround(p_event, v_k) then
        v_actions := v_actions || ('revealed crisis ' || v_k);
      end if;
    end loop;
  end if;
  for v_k in 1..5 loop
    insert into public.subrounds (event_id, k) values (p_event, v_k) on conflict do nothing;
    select * into v_sub from public.subrounds where event_id = p_event and subrounds.k = v_k for no key update;
    if (v_k <= 4 and v_sub.revealed_at is null) or (v_k = 5 and v_event.current_phase <> 'SATURATION') then
      continue;
    end if;
    if v_sub.hiring_closed_at is null and app.deadline_passed(p_event, ('HIRE_' || v_k)::public.deadline_code) then
      update public.offers set status = 'LAPSED', decided_at = now(), updated_at = now()
       where event_id = p_event and offers.k = v_k and status = 'OPEN';
      update public.subrounds set hiring_closed_at = now() where event_id = p_event and subrounds.k = v_k;
      v_actions := v_actions || ('hiring closed ' || v_k);
    end if;
    if v_sub.due_closed_at is null and app.deadline_passed(p_event, ('DUE_' || v_k)::public.deadline_code) then
      n := app.settle_engagements(p_event, v_k);
      update public.subrounds set due_closed_at = now() where event_id = p_event and subrounds.k = v_k;
      v_actions := v_actions || ('escrow settled ' || v_k || ': ' || n);
    end if;
    if v_sub.rated_at is null and app.deadline_passed(p_event, ('RATE_' || v_k)::public.deadline_code) then
      update public.engagements set rating = 3, rating_default = true, rated_at = now()
       where event_id = p_event and engagements.k = v_k and rating is null;
      update public.subrounds set rated_at = now() where event_id = p_event and subrounds.k = v_k;
      v_actions := v_actions || ('ratings closed ' || v_k);
    end if;
  end loop;
  return v_actions;
end
$$;

-- ───────────────────────────── A firm writes for its client ─────────────────────────────

-- The engagement that lets the caller (a firm) write this type for this company, or null.
create or replace function app.writing_engagement(p_team public.teams, p_company uuid, p_type public.submission_type)
returns public.engagements
language sql stable
as $$
  select e.* from public.engagements e
   where p_team.track = 'CONSULTING' and e.firm_team_id = p_team.id and e.company_id = p_company
     and e.k = app.subround_of(p_type) and app.submission_kind(p_type) in ('ADVICE', 'SOLUTION')
$$;

create or replace function public.save_draft_for(p_company uuid, p_type public.submission_type, p_content jsonb, p_expected_version integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_company public.companies;
  v_draft public.submission_drafts;
begin
  if app.my_team_id() is null then
    raise exception 'only a team can edit a draft' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  v_team := app.lock_caller_team();
  select * into v_company from public.companies where id = p_company and event_id = v_team.event_id;
  if v_company.id is null or (app.writing_engagement(v_team, p_company, p_type)).id is null then
    return app.reject(v_team.event_id, 'save_draft', 'NOT_ALLOWED', 'Your firm was not hired to write this.');
  end if;
  if not app.subround_open(v_team.event_id, app.subround_of(p_type)) then
    return app.reject(v_team.event_id, 'save_draft', 'DEADLINE_PASSED', 'This submission is closed.', jsonb_build_object('type', p_type));
  end if;
  if jsonb_typeof(p_content) <> 'object' or length(p_content::text) > 20000
     or exists (select 1 from jsonb_each(p_content) x
                 where x.key in (select f.key from app.template_fields(p_type) f) and jsonb_typeof(x.value) not in ('string', 'null')) then
    return app.reject(v_team.event_id, 'save_draft', 'BAD_CONTENT', 'The draft is not valid.');
  end if;
  p_content := coalesce((select jsonb_object_agg(x.key, x.value) from jsonb_each(p_content) x
                          where x.key in (select f.key from app.template_fields(p_type) f)), '{}'::jsonb);
  select * into v_draft from public.submission_drafts where company_id = p_company and type = p_type for no key update;
  if v_draft.id is null then
    insert into public.submission_drafts (event_id, squad_id, company_id, type)
    values (v_company.event_id, v_company.squad_id, p_company, p_type) returning * into v_draft;
  end if;
  if v_draft.version <> p_expected_version then
    return app.fail('VERSION_CONFLICT', 'Someone else saved a newer version.', jsonb_build_object('draft', to_jsonb(v_draft)));
  end if;
  update public.submission_drafts
     set content = p_content, version = version + 1, updated_at = now(), updated_by_team = v_team.id
   where id = v_draft.id
  returning * into v_draft;
  return app.ok(jsonb_build_object('draft', to_jsonb(v_draft), 'words', app.submission_words(p_type, p_content)));
end
$$;

create or replace function public.submit_for(p_company uuid, p_type public.submission_type)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_company public.companies;
  v_draft public.submission_drafts;
  v_sub public.submissions;
  v_words int;
begin
  if app.my_team_id() is null then
    raise exception 'only a team can submit' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) or not app.rate_limit(app.my_team_id(), 'submit', 10, interval '1 minute') then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  v_team := app.lock_caller_team();
  select * into v_company from public.companies where id = p_company and event_id = v_team.event_id for no key update;
  if v_company.id is null or (app.writing_engagement(v_team, p_company, p_type)).id is null then
    return app.reject(v_team.event_id, 'submit', 'NOT_ALLOWED', 'Your firm was not hired to write this.', jsonb_build_object('type', p_type));
  end if;
  select * into v_draft from public.submission_drafts where company_id = p_company and type = p_type for no key update;
  if not app.subround_open(v_team.event_id, app.subround_of(p_type)) then
    return app.reject(v_team.event_id, 'submit', 'DEADLINE_PASSED', 'The deadline has passed; this submission was not accepted.',
                      jsonb_build_object('type', p_type, 'at', now()));
  end if;
  select * into v_sub from public.submissions where company_id = p_company and type = p_type and superseded_at is null;
  if v_sub.id is not null and v_sub.content = v_draft.content then
    return app.ok(jsonb_build_object('submission', to_jsonb(v_sub), 'duplicate', true));
  end if;
  v_words := app.submission_words(p_type, coalesce(v_draft.content, '{}'::jsonb));
  if v_words = 0 then
    return app.reject(v_team.event_id, 'submit', 'EMPTY', 'Write something before submitting.', jsonb_build_object('type', p_type));
  end if;
  if v_words > app.word_limit(p_type) then
    return app.reject(v_team.event_id, 'submit', 'TOO_LONG', format('At most %s words (you have %s).', app.word_limit(p_type), v_words),
                      jsonb_build_object('type', p_type, 'words', v_words));
  end if;
  update public.submissions set superseded_at = now() where company_id = p_company and type = p_type and superseded_at is null;
  insert into public.submissions (event_id, squad_id, company_id, type, content, body_text, word_count, submitted_by_team)
  values (v_team.event_id, v_company.squad_id, p_company, p_type, v_draft.content, app.submission_text(p_type, v_draft.content), v_words, v_team.id)
  returning * into v_sub;
  return app.ok(jsonb_build_object('submission', to_jsonb(v_sub)));
end
$$;

-- ───────────────────────────── Firm value ─────────────────────────────

-- Every firm's value now: cash (fees and bonuses) + fee shares × the current price, with its average client rating.
create or replace function public.firm_values(p_event uuid)
returns table (team_id uuid, code text, name text, cash_cents bigint, fee_share_value_cents bigint, value_cents bigint,
               clients integer, avg_rating numeric)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.code, t.name, t.cash_cents,
         coalesce((select sum(h.qty::bigint * coalesce(c.market_price, 0)) from public.holdings h
                     join public.companies c on c.id = h.company_id where h.team_id = t.id and h.lot = 'FEE'), 0)::bigint,
         t.cash_cents + coalesce((select sum(h.qty::bigint * coalesce(c.market_price, 0)) from public.holdings h
                     join public.companies c on c.id = h.company_id where h.team_id = t.id and h.lot = 'FEE'), 0)::bigint,
         (select count(*) from public.engagements e where e.firm_team_id = t.id)::int,
         (select round(avg(e.rating), 2) from public.engagements e where e.firm_team_id = t.id and e.rating is not null)
    from public.teams t
   where t.event_id = p_event and t.track = 'CONSULTING'
     and (p_event = app.my_event_id() or app.is_staff())
   order by 6 desc, t.code
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.save_firm_profile(text, text[], text, bigint)', 'public.make_offer(uuid, bigint, integer, text)',
    'public.respond_offer(uuid, text, bigint, integer)', 'public.rate_firm(integer, integer)',
    'public.save_draft_for(uuid, public.submission_type, jsonb, integer)', 'public.submit_for(uuid, public.submission_type)',
    'public.firm_values(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

revoke all on function app.hiring_subround(uuid), app.my_company(), app.offer_problem(public.companies, int, bigint, int),
  app.settle_engagements(uuid, int), app.after_advice_release(uuid, int), app.primus_tick(uuid),
  app.writing_engagement(public.teams, uuid, public.submission_type) from public, anon, authenticated;
