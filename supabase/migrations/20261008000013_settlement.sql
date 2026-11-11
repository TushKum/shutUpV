-- Settlement (05:00–05:30): consultant bonuses, final values, rankings, awards and collusion flags; the fairness
-- officer's decisions; two-person ledger corrections.

alter table public.awards drop constraint awards_event_id_code_place_key;
create unique index awards_unique_winner on public.awards (event_id, code, coalesce(team_id, company_id));

-- ───────────────────────────── Bonuses and final values ─────────────────────────────

create or replace function app.plan_score(p_company uuid)
returns integer
language sql stable
as $$
  select coalesce((select final_score from public.scores where company_id = p_company and type = 'PLAN'), 0)
$$;

-- Pays every consultant its plan bonus, deal bonus and call earnings (from the exchange). Idempotent per event.
create or replace function app.pay_consultant_bonuses(p_event uuid)
returns void
language plpgsql
as $$
declare
  v_txn uuid := gen_random_uuid();
  v_total bigint;
begin
  create temporary table if not exists _bonus (team_id uuid, company_id uuid, kind public.ledger_kind, amount bigint, memo text) on commit drop;
  truncate _bonus;
  insert into _bonus
  select s.consulting_team_id, c.id, 'BONUS_PLAN'::public.ledger_kind, app.plan_bonus(app.plan_score(c.id)),
         'Plan bonus: $500 × (' || app.plan_score(c.id) || ' − 50)'
    from public.squads s join public.companies c on c.squad_id = s.id where s.event_id = p_event
  union all
  select s.consulting_team_id, c.id, 'BONUS_DEAL'::public.ledger_kind, 500000, 'Deal bonus: signed by 02:45'
    from public.squads s join public.companies c on c.squad_id = s.id join public.deals d on d.squad_id = s.id
   where s.event_id = p_event and d.executed_at is not null and d.executed_at <= app.deadline(p_event, 'DEAL_BONUS')
  union all
  select k.consultant_team_id, null, 'CALL_EARNINGS'::public.ledger_kind, sum(k.earnings_cents), 'Correct calls: ' || count(*) filter (where k.correct)
    from public.calls k where k.event_id = p_event group by k.consultant_team_id having sum(k.earnings_cents) > 0;

  insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, cash_delta_cents, memo)
  select p_event, v_txn, kind, team_id, company_id, amount, memo from _bonus where amount <> 0;
  insert into public.ledger_entries (event_id, txn_id, kind, team_id, cash_delta_cents, memo)
  select p_event, v_txn, kind, null, -sum(amount), 'Paid by the exchange' from _bonus where amount <> 0 group by kind;
  update public.teams t set cash_cents = t.cash_cents + x.amount
    from (select team_id, sum(amount) as amount from _bonus group by team_id) x where t.id = x.team_id;
  select coalesce(sum(amount), 0) into v_total from _bonus;
  update public.events set exchange_cash_cents = exchange_cash_cents - v_total where id = p_event;
  insert into public.public_ledger (event_id, txn_id, kind, label, company_id, cash_cents, details)
  select p_event, v_txn, b.kind::text, app.event_label(s.number, 'consultant ' || lower(replace(b.kind::text, '_', ' '))),
         b.company_id, b.amount, jsonb_build_object('squad', s.number)
    from _bonus b join public.squads s on s.consulting_team_id = b.team_id where b.amount <> 0;
end
$$;

-- Final value of every team (after shorts were covered at the close and bonuses were paid).
create or replace function app.compute_results(p_event uuid)
returns void
language plpgsql
as $$
begin
  delete from public.results where event_id = p_event;

  -- Product: retained shares × closing price + cash. Tie-break: higher plan score.
  insert into public.results (event_id, team_id, track, final_value_cents, start_value_cents, return_bp, tiebreak, eligible, details)
  select p_event, t.id, 'PRODUCT', coalesce(h.qty, 0)::bigint * c.closing_price + t.cash_cents,
         60000::bigint * c.ipo_price + 5000000,
         app.return_bp(coalesce(h.qty, 0)::bigint * c.closing_price + t.cash_cents, 60000::bigint * c.ipo_price + 5000000),
         jsonb_build_object('plan_score', app.plan_score(c.id)), not t.disqualified,
         jsonb_build_object('retained', coalesce(h.qty, 0), 'cash', t.cash_cents, 'closing_price', c.closing_price, 'company_id', c.id)
    from public.teams t join public.companies c on c.product_team_id = t.id
    left join public.holdings h on h.team_id = t.id and h.company_id = c.id and h.lot = 'RETAINED'
   where t.event_id = p_event and t.track = 'PRODUCT';

  -- Consulting: cash (fee cash and bonuses) + fee shares × closing price. Tie-break: its squad company's plan score.
  insert into public.results (event_id, team_id, track, final_value_cents, start_value_cents, return_bp, tiebreak, eligible, details)
  select p_event, t.id, 'CONSULTING', t.cash_cents + coalesce(h.qty, 0)::bigint * coalesce(c.closing_price, 0), 0, null,
         jsonb_build_object('plan_score', app.plan_score(c.id)), not t.disqualified,
         jsonb_build_object('cash', t.cash_cents, 'fee_shares', coalesce(h.qty, 0), 'closing_price', c.closing_price, 'company_id', c.id)
    from public.teams t join public.squads s on s.consulting_team_id = t.id join public.companies c on c.squad_id = s.id
    left join public.holdings h on h.team_id = t.id and h.company_id = c.id and h.lot = 'FEE'
   where t.event_id = p_event and t.track = 'CONSULTING';

  -- Finance: cash + long shares × closing price − short shares × closing price (shorts were covered at the close,
  -- so they are already in cash). Ranked by return on $500,000; tie-break: smaller largest single position.
  -- The AI-price valuation (best-judging fund) adds back the cost of covering and values every position at the AI price.
  insert into public.results (event_id, team_id, track, final_value_cents, start_value_cents, return_bp, tiebreak, eligible, details)
  select p_event, t.id, 'FINANCE', t.cash_cents + coalesce(p.long_value, 0), 50000000,
         app.return_bp(t.cash_cents + coalesce(p.long_value, 0), 50000000),
         jsonb_build_object('largest_position', coalesce(p.largest, 0)), not t.disqualified,
         jsonb_build_object('cash', t.cash_cents, 'long_value', coalesce(p.long_value, 0),
                            'ai_value', t.cash_cents + coalesce(p.cover_cost, 0) + coalesce(p.long_ai, 0) - coalesce(p.short_ai, 0))
    from public.teams t
    left join (
      select x.team_id,
             sum(x.long_qty::bigint * x.closing) as long_value,
             max(greatest(x.long_qty::bigint * x.closing, x.short_qty::bigint * x.closing)) as largest,
             sum(x.short_qty::bigint * x.closing) as cover_cost,
             sum(x.long_qty::bigint * x.ai) as long_ai,
             sum(x.short_qty::bigint * x.ai) as short_ai
        from (
          select h.team_id, h.company_id, c.closing_price as closing, c.ai_price as ai,
                 coalesce(sum(h.qty) filter (where h.lot in ('EXCHANGE', 'SQUAD')), 0) as long_qty,
                 coalesce(max(sc.qty), 0) as short_qty
            from public.holdings h join public.companies c on c.id = h.company_id
            left join (select l.team_id, l.company_id, sum(l.share_delta) as qty from public.ledger_entries l
                        where l.event_id = p_event and l.kind = 'SHORT_CLOSE' group by l.team_id, l.company_id) sc
                   on sc.team_id = h.team_id and sc.company_id = h.company_id
           where h.event_id = p_event and h.lot in ('EXCHANGE', 'SQUAD', 'SHORT')
           group by h.team_id, h.company_id, c.closing_price, c.ai_price) x
       group by x.team_id) p on p.team_id = t.id
   where t.event_id = p_event and t.track = 'FINANCE';
end
$$;

-- Ranks (competition ranking 1, 2, 2, 4) and awards, over eligible (not disqualified) teams. Re-run after every
-- disqualification or correction.
create or replace function app.compute_rankings(p_event uuid)
returns void
language plpgsql
as $$
begin
  -- Only rows that change are written.
  update public.results r set eligible = not t.disqualified from public.teams t
   where t.id = r.team_id and r.event_id = p_event and r.eligible is distinct from not t.disqualified;
  update public.results r set rank = x.rnk
    from (select id, case when eligible then rank() over (partition by track, eligible order by final_value_cents desc,
                   case when track = 'FINANCE' then -(tiebreak ->> 'largest_position')::numeric
                        else (tiebreak ->> 'plan_score')::numeric end desc) end as rnk
            from public.results where event_id = p_event) x
   where r.id = x.id and r.rank is distinct from x.rnk;

  delete from public.awards where event_id = p_event;
  insert into public.awards (event_id, code, place, team_id, metric)
  select p_event, track || '_TOP3', rank, team_id, jsonb_build_object('final_value', final_value_cents, 'return_bp', return_bp)
    from public.results where event_id = p_event and eligible and rank <= 3;

  -- Best turnaround: highest closing ÷ post-crisis price (compared exactly); tie → higher plan score.
  insert into public.awards (event_id, code, place, company_id, team_id, metric)
  select p_event, 'BEST_TURNAROUND', 1, a.id, a.product_team_id,
         jsonb_build_object('closing_price', a.closing_price, 'post_crisis_price', a.post_crisis_price)
    from public.companies a join public.teams ta on ta.id = a.product_team_id
   where a.event_id = p_event and a.closing_price is not null and not ta.disqualified
     and not exists (
       select 1 from public.companies b join public.teams tb on tb.id = b.product_team_id
        where b.event_id = p_event and b.closing_price is not null and not tb.disqualified
          and (b.closing_price::numeric * a.post_crisis_price > a.closing_price::numeric * b.post_crisis_price
               or (b.closing_price::numeric * a.post_crisis_price = a.closing_price::numeric * b.post_crisis_price
                   and app.plan_score(b.id) > app.plan_score(a.id))));

  -- Best rescue plan: highest final plan score; tie → higher raw median, then the ticker (A before Z).
  insert into public.awards (event_id, code, place, company_id, team_id, metric)
  select p_event, 'BEST_RESCUE_PLAN', 1, s.company_id, c.product_team_id, jsonb_build_object('score', s.final_score, 'median', s.median)
    from public.scores s join public.companies c on c.id = s.company_id join public.teams t on t.id = c.product_team_id
   where s.event_id = p_event and s.type = 'PLAN' and not t.disqualified
     and not exists (
       select 1 from public.scores s2 join public.companies c2 on c2.id = s2.company_id join public.teams t2 on t2.id = c2.product_team_id
        where s2.event_id = p_event and s2.type = 'PLAN' and not t2.disqualified
          and (s2.final_score > s.final_score
               or (s2.final_score = s.final_score and coalesce(s2.median, 0) > coalesce(s.median, 0))
               or (s2.final_score = s.final_score and coalesce(s2.median, 0) = coalesce(s.median, 0)
                   and c2.ticker collate "C" < c.ticker collate "C")));

  -- Best-judging fund: highest value at AI prices only; tie → smaller largest position.
  insert into public.awards (event_id, code, place, team_id, metric)
  select p_event, 'BEST_JUDGING_FUND', 1, r.team_id,
         jsonb_build_object('ai_value', (r.details ->> 'ai_value')::bigint,
                            'return_bp', app.return_bp((r.details ->> 'ai_value')::bigint, 50000000))
    from public.results r
   where r.event_id = p_event and r.track = 'FINANCE' and r.eligible
     and not exists (
       select 1 from public.results r2
        where r2.event_id = p_event and r2.track = 'FINANCE' and r2.eligible
          and ((r2.details ->> 'ai_value')::bigint > (r.details ->> 'ai_value')::bigint
               or ((r2.details ->> 'ai_value')::bigint = (r.details ->> 'ai_value')::bigint
                   and (r2.tiebreak ->> 'largest_position')::bigint < (r.tiebreak ->> 'largest_position')::bigint)));
end
$$;

-- ───────────────────────────── Collusion flags ─────────────────────────────

-- Nested loops are switched off for this one batch query: during the night the order tables grow faster than
-- autovacuum re-analyses them, and with stale row estimates the planner picks a nested-loop self-join over all
-- filled orders (seconds instead of milliseconds for 50 funds).
create or replace function app.generate_flags(p_event uuid)
returns integer
language plpgsql
set enable_nestloop = off
as $$
declare
  n int;
begin
  if exists (select 1 from public.flags where event_id = p_event) then
    return 0;
  end if;

  -- 1. Plan below 50 and 3 or more funds at the 4,000-share long cap.
  insert into public.flags (event_id, kind, company_id, team_ids, details)
  select p_event, 1, c.id, array[c.product_team_id] || array_agg(h.team_id order by h.team_id),
         jsonb_build_object('plan_score', app.plan_score(c.id), 'funds_at_cap', count(*), 'ticker', c.ticker)
    from public.companies c join public.holdings h on h.company_id = c.id and h.lot = 'EXCHANGE' and h.qty = 4000
   where c.event_id = p_event and app.plan_score(c.id) < 50
   group by c.id, c.product_team_id, c.ticker
  having count(*) >= 3;

  -- 2. Pairs of funds with order vectors (round, ticker, signed qty) of cosine similarity ≥ 0.9, ≥ 5 orders each.
  with v as (
    select o.team_id, r.number, o.company_id,
           sum(case when o.type in ('BUY', 'COVER') then o.qty else -o.qty end)::numeric as val
      from public.orders o join public.rounds r on r.id = o.round_id
     where o.event_id = p_event and o.status = 'FILLED'
     group by o.team_id, r.number, o.company_id
  ), active as (
    select team_id, count(*) as orders from public.orders
     where event_id = p_event and status = 'FILLED' group by team_id having count(*) >= 5
  ), norms as (
    select v.team_id, sum(v.val * v.val) as nn from v join active using (team_id) group by v.team_id
  ), dots as (
    select a.team_id as ta, b.team_id as tb, sum(a.val * b.val) as dot
      from v a join v b on a.number = b.number and a.company_id = b.company_id and a.team_id < b.team_id
      join active xa on xa.team_id = a.team_id join active xb on xb.team_id = b.team_id
     group by a.team_id, b.team_id
  )
  insert into public.flags (event_id, kind, team_ids, details)
  select p_event, 2, array[d.ta, d.tb],
         jsonb_build_object('cosine', round(d.dot / sqrt(na.nn * nb.nn), 3), 'orders', jsonb_build_array(xa.orders, xb.orders))
    from dots d join norms na on na.team_id = d.ta join norms nb on nb.team_id = d.tb
    join active xa on xa.team_id = d.ta join active xb on xb.team_id = d.tb
   where d.dot > 0 and na.nn > 0 and nb.nn > 0 and 100 * d.dot * d.dot >= 81 * na.nn * nb.nn;

  -- 3. Fee ≥ $33,000, or deal price ≤ 55% of the post-crisis price, where the plan scored below 50.
  insert into public.flags (event_id, kind, company_id, team_ids, details)
  select p_event, 3, c.id, array[s.product_team_id, s.consulting_team_id, s.finance_team_id],
         jsonb_build_object('plan_score', app.plan_score(c.id), 'fee_value', f.value_cents, 'deal_price', d.price_cents,
                            'post_crisis_price', c.post_crisis_price, 'ticker', c.ticker)
    from public.squads s join public.companies c on c.squad_id = s.id
    left join public.fees f on f.squad_id = s.id and f.executed_at is not null
    left join public.deals d on d.squad_id = s.id and d.executed_at is not null
   where s.event_id = p_event and app.plan_score(c.id) < 50
     and (coalesce(f.value_cents, 0) >= 3300000 or (d.price_cents is not null and d.price_cents::bigint * 100 <= 55 * c.post_crisis_price));

  select count(*) into n from public.flags where event_id = p_event;
  return n;
end
$$;

-- The 05:00 settlement. Idempotent.
create or replace function app.settle(p_event uuid)
returns void
language plpgsql
as $$
begin
  perform 1 from public.events where id = p_event and settled_at is null for no key update;
  if not found then
    return;
  end if;
  if (select market_closed_at from public.events where id = p_event) is null then
    raise exception 'the market must be closed before settlement';
  end if;
  perform app.pay_consultant_bonuses(p_event);
  perform app.compute_results(p_event);
  perform app.generate_flags(p_event);
  perform app.compute_rankings(p_event);
  update public.events set settled_at = now() where id = p_event;
  perform app.broadcast(p_event, 'settled');
end
$$;

-- Fairness officer: clear a flag or disqualify the teams involved, with a logged reason.
create or replace function public.decide_flag(p_flag uuid, p_status public.flag_status, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_flag public.flags;
begin
  perform app.require_fairness();
  if p_status = 'OPEN' then
    raise exception 'decide CLEARED or DISQUALIFIED';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'give a reason (at least 5 characters)';
  end if;
  select * into v_flag from public.flags where id = p_flag;
  if v_flag.id is null then
    raise exception 'no such flag';
  end if;
  -- One decision at a time per event (two decisions on overlapping flags must not race the recompute below).
  perform 1 from public.events where id = v_flag.event_id for no key update;
  select * into v_flag from public.flags where id = p_flag for no key update;
  if (select current_phase from public.events where id = v_flag.event_id) >= 'AWARDS' then
    raise exception 'flags are decided before the awards';
  end if;
  update public.flags set status = p_status, reason = btrim(p_reason), decided_by = auth.uid(), decided_at = now()
   where id = p_flag;
  -- A team is disqualified while any flag naming it is DISQUALIFIED, so a decision can be reversed (a mis-click)
  -- without clearing a team that another flag still disqualifies.
  update public.teams t
     set disqualified = d.reason is not null, disqualified_reason = d.reason
    from (select tid, (select f.reason from public.flags f
                        where f.event_id = v_flag.event_id and f.status = 'DISQUALIFIED' and tid = any (f.team_ids)
                        order by f.decided_at desc limit 1) as reason
            from unnest(v_flag.team_ids) tid) d
   where t.id = d.tid and (t.disqualified, t.disqualified_reason) is distinct from (d.reason is not null, d.reason);
  -- Rankings change only when someone's eligibility did.
  if found then
    perform app.compute_rankings(v_flag.event_id);
  end if;
  return app.ok();
end
$$;

-- ───────────────────────────── Ledger corrections (two people) ─────────────────────────────

-- Entries: [{"team_id","cash_delta_cents","company_id"?,"lot"?,"share_delta"?}]. The exchange takes the other side.
-- A correction entry: {team_id, company_id?, lot?, cash_delta_cents?, share_delta?}. share_delta is the change in
-- the lot's quantity (for a SHORT lot: more shares short). Returns why the entries are not acceptable, or null.
-- Checked when requested and again, against the state at that moment, when approved.
create or replace function app.correction_problem(p_event uuid, p_entries jsonb)
returns text
language plpgsql stable
as $$
declare
  e jsonb;
  v_team public.teams;
  v_company public.companies;
  v_cash numeric;
  v_shares numeric;
begin
  if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) not between 1 and 50 then
    return 'a correction needs 1 to 50 entries';
  end if;
  for e in select * from jsonb_array_elements(p_entries) loop
    if jsonb_typeof(e) <> 'object'
       or exists (select 1 from jsonb_object_keys(e) k where k not in ('team_id', 'company_id', 'lot', 'cash_delta_cents', 'share_delta')) then
      return 'each entry has only team_id, company_id, lot, cash_delta_cents and share_delta';
    end if;
    if coalesce(e ->> 'team_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return 'each entry needs a team_id';
    end if;
    select * into v_team from public.teams where id = (e ->> 'team_id')::uuid and event_id = p_event;
    if v_team.id is null then
      return format('team %s is not in this event', e ->> 'team_id');
    end if;
    if (e ? 'cash_delta_cents' and jsonb_typeof(e -> 'cash_delta_cents') <> 'number')
       or (e ? 'share_delta' and jsonb_typeof(e -> 'share_delta') <> 'number') then
      return 'cash_delta_cents and share_delta are whole numbers';
    end if;
    v_cash := coalesce((e ->> 'cash_delta_cents')::numeric, 0);
    v_shares := coalesce((e ->> 'share_delta')::numeric, 0);
    if v_cash <> trunc(v_cash) or v_shares <> trunc(v_shares) or abs(v_cash) > 100000000 or abs(v_shares) > 100000 then
      return 'cash_delta_cents is a whole number up to ±$1,000,000 and share_delta a whole number up to ±100,000';
    end if;
    if v_cash = 0 and v_shares = 0 then
      return 'each entry changes cash or shares';
    end if;
    v_company := null;
    if e ? 'company_id' then
      if coalesce(e ->> 'company_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        return 'company_id is not a company id';
      end if;
      select * into v_company from public.companies where id = (e ->> 'company_id')::uuid and event_id = p_event and squad_id is not null;
      if v_company.id is null then
        return format('company %s is not in this event', e ->> 'company_id');
      end if;
    end if;
    if e ? 'lot' and (e ->> 'lot' is null or (e ->> 'lot') not in (select x::text from unnest(enum_range(null::public.lot_type)) x)) then
      return format('unknown lot %s', e ->> 'lot');
    end if;
    if v_shares <> 0 then
      if v_company.id is null or not e ? 'lot' then
        return 'a share correction needs a company of this event and a lot';
      end if;
      -- A lot belongs to one kind of team: the company's own Product team (RETAINED), a consultant (FEE), a fund.
      if not (case e ->> 'lot'
                when 'RETAINED' then v_team.id = v_company.product_team_id
                when 'FEE' then v_team.track = 'CONSULTING'
                else v_team.track = 'FINANCE' end) then
        return format('a %s lot cannot belong to team %s', e ->> 'lot', v_team.code);
      end if;
      if e ->> 'lot' = 'SHORT' and (select market_closed_at from public.events where id = p_event) is not null then
        return 'shorts were covered at the close; correct the cash instead';
      end if;
    end if;
  end loop;
  return null;
end
$$;

create or replace function public.request_correction(p_event uuid, p_reason text, p_entries jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_problem text;
begin
  if not app.is_organiser() then
    raise exception 'only an organiser can request a correction' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'give a reason (at least 10 characters)';
  end if;
  v_problem := app.correction_problem(p_event, p_entries);
  if v_problem is not null then
    raise exception '%', v_problem;
  end if;
  insert into public.corrections (event_id, requested_by, reason, entries)
  values (p_event, auth.uid(), btrim(p_reason), p_entries) returning id into v_id;
  return app.ok(jsonb_build_object('correction_id', v_id));
end
$$;

-- A second organiser (or the fairness officer) approves or rejects. Approved corrections are applied and published.
create or replace function public.decide_correction(p_correction uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_c public.corrections;
  v_txn uuid := gen_random_uuid();
  e jsonb;
  v_lot public.lot_type;
  v_d int;
  v_s int;
  v_cash bigint;
  v_teams uuid[];
  v_problem text;
begin
  if not (app.is_organiser() or app.is_fairness()) then
    raise exception 'only an organiser or the fairness officer can decide a correction' using errcode = '42501';
  end if;
  select * into v_c from public.corrections where id = p_correction;
  if v_c.id is null then
    raise exception 'no pending correction with that id';
  end if;
  -- Lock order: the event first, so a correction never interleaves with a clearing (which holds the event too).
  perform 1 from public.events where id = v_c.event_id for no key update;
  select * into v_c from public.corrections where id = p_correction for no key update;
  if v_c.status <> 'PENDING' then
    raise exception 'no pending correction with that id';
  end if;
  if v_c.requested_by = auth.uid() then
    raise exception 'a correction needs a second person: you requested this one' using errcode = '42501';
  end if;
  if not p_approve then
    update public.corrections set status = 'REJECTED', decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = v_c.id;
    return app.ok();
  end if;
  v_problem := app.correction_problem(v_c.event_id, v_c.entries);
  if v_problem is not null then
    raise exception '%', v_problem;
  end if;
  v_teams := array(select distinct (x ->> 'team_id')::uuid from jsonb_array_elements(v_c.entries) x);
  perform 1 from public.teams where id = any (v_teams) order by id for no key update;
  for e in select * from jsonb_array_elements(v_c.entries) loop
    v_cash := coalesce((e ->> 'cash_delta_cents')::numeric, 0)::bigint;
    update public.teams set cash_cents = cash_cents + v_cash where id = (e ->> 'team_id')::uuid;
    v_d := coalesce((e ->> 'share_delta')::numeric, 0)::int;
    v_lot := (e ->> 'lot')::public.lot_type;
    -- In the ledger a SHORT lot's quantity is −Σ share_delta: more shares short is shares delivered.
    v_s := case when v_lot = 'SHORT' then -1 else 1 end;
    if v_d <> 0 then
      insert into public.holdings (event_id, team_id, company_id, lot, qty, cost_cents)
      values (v_c.event_id, (e ->> 'team_id')::uuid, (e ->> 'company_id')::uuid, v_lot, 0, 0)
      on conflict (team_id, company_id, lot) do nothing;
      update public.holdings set qty = qty + v_d, updated_at = now()
       where team_id = (e ->> 'team_id')::uuid and company_id = (e ->> 'company_id')::uuid and lot = v_lot;
      update public.companies set exchange_inventory = exchange_inventory - v_s * v_d where id = (e ->> 'company_id')::uuid;
    end if;
    insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, lot, cash_delta_cents, share_delta, ref_table, ref_id, memo) values
      (v_c.event_id, v_txn, 'CORRECTION', (e ->> 'team_id')::uuid, (e ->> 'company_id')::uuid, v_lot,
       v_cash, v_s * v_d, 'corrections', v_c.id, v_c.reason),
      (v_c.event_id, v_txn, 'CORRECTION', null, (e ->> 'company_id')::uuid, null,
       -v_cash, -v_s * v_d, 'corrections', v_c.id, v_c.reason);
    update public.events set exchange_cash_cents = exchange_cash_cents - v_cash where id = v_c.event_id;
  end loop;
  -- A pending sell or cover must still be coverable, or the round could never clear.
  if exists (
    select 1 from public.orders o join public.rounds r on r.id = o.round_id
      left join public.holdings h on h.team_id = o.team_id and h.company_id = o.company_id
                                 and h.lot = case when o.type = 'SELL' then 'EXCHANGE' else 'SHORT' end::public.lot_type
     where r.event_id = v_c.event_id and r.status = 'OPEN' and o.status = 'PENDING' and o.type in ('SELL', 'COVER')
     group by o.team_id, o.company_id, o.type, h.qty
    having sum(o.qty) > coalesce(h.qty, 0)) then
    raise exception 'this correction leaves a pending sell or cover larger than the position; the team must cancel or edit it first';
  end if;
  -- A correction moves no price: only the named funds' collateral can change.
  perform app.recalculate_collateral(v_c.event_id, v_teams);
  update public.corrections set status = 'APPROVED', decided_by = auth.uid(), decided_at = now(), decision_note = p_note,
         applied_txn_id = v_txn, published_at = now() where id = v_c.id;
  insert into public.public_ledger (event_id, txn_id, kind, label, details)
  values (v_c.event_id, v_txn, 'CORRECTION', 'Ledger correction', jsonb_build_object('reason', v_c.reason, 'entries', jsonb_array_length(v_c.entries)));
  if (select settled_at from public.events where id = v_c.event_id) is not null then
    perform app.compute_results(v_c.event_id);
    perform app.compute_rankings(v_c.event_id);
  end if;
  perform app.broadcast(v_c.event_id, 'correction');
  return app.ok(jsonb_build_object('txn_id', v_txn));
end
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.decide_flag(uuid, public.flag_status, text)', 'public.request_correction(uuid, text, jsonb)',
    'public.decide_correction(uuid, boolean, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
