-- Price events outside clearing: the crisis shock, score tiers and the close; sealing and releasing scores;
-- judging consultant calls.

-- ───────────────────────────── Scores ─────────────────────────────

-- The judged submission of a company: its last on-time (current) submission of that type.
create or replace function app.current_submission(p_company uuid, p_type public.submission_type)
returns public.submissions
language sql stable
as $$
  select * from public.submissions where company_id = p_company and type = p_type and superseded_at is null
$$;

-- Was the squad's deal fully signed by the 03:00 deadline?
create or replace function app.deal_signed_in_time(p_company uuid)
returns boolean
language sql stable
as $$
  select coalesce(d.executed_at <= app.deadline(d.event_id, 'DEAL'), false)
    from public.deals d where d.company_id = p_company
$$;

-- Offences: judged submissions of the squad from which a line aimed at the judge was stripped.
create or replace function app.offended(p_company uuid, p_type public.submission_type)
returns boolean
language sql stable
as $$
  select exists (select 1 from public.injection_logs l where l.submission_id = (app.current_submission(p_company, p_type)).id)
$$;

-- Seals a score from the judge's runs (3, or 5 when the first 3 spread more than 10 points): median, the plan
-- cap when the deal was not signed by 03:00, the injection penalty, the tier. Called by the judge worker.
create or replace function public.seal_score(p_company uuid, p_type public.submission_type, p_run_totals integer[],
                                             p_breakdown jsonb, p_rationale text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_company public.companies;
  v_sub public.submissions;
  v_existing public.scores;
  v_n int := coalesce(array_length(p_run_totals, 1), 0);
  v_median int;
  v_final jsonb;
  v_penalty int;
begin
  perform app.require_organiser();
  select * into v_company from public.companies where id = p_company;
  v_sub := app.current_submission(p_company, p_type);
  if v_sub.id is null then
    raise exception 'company % has no on-time % submission; use seal_missing_scores', v_company.ticker, p_type;
  end if;
  if not (v_n = 5 or (v_n = 3 and not app.needs_extra_runs(p_run_totals))) then
    raise exception 'a score needs 3 runs within 10 points, or 5 runs';
  end if;
  if exists (select 1 from unnest(p_run_totals) t where t < 0 or t > 100) then
    raise exception 'run totals must be 0–100';
  end if;
  select * into v_existing from public.scores where company_id = p_company and type = p_type for update;
  if v_existing.status = 'RELEASED' then
    raise exception 'this score has been released; use rerun_released_score for a technical appeal';
  end if;
  v_median := app.median_score(p_run_totals);
  v_penalty := app.injection_penalty(p_type, app.offended(p_company, 'PITCH'), app.offended(p_company, 'PLAN'), app.offended(p_company, 'FLASH'));
  v_final := app.final_score(p_type, v_median, app.deal_signed_in_time(p_company), v_penalty);
  insert into public.scores (event_id, company_id, type, submission_id, status, run_totals, median, missing, late, capped, penalty,
                             final_score, tier_bp, breakdown, rationale, updated_at)
  values (v_company.event_id, p_company, p_type, v_sub.id, 'SEALED', p_run_totals::smallint[], v_median, false, false,
          (v_final ->> 'capped')::boolean, v_penalty, (v_final ->> 'final')::int,
          app.tier_bp(p_type, (v_final ->> 'final')::int), p_breakdown, p_rationale, now())
  on conflict (company_id, type) do update
    set submission_id = excluded.submission_id, status = 'SEALED', run_totals = excluded.run_totals, median = excluded.median,
        missing = false, late = false, capped = excluded.capped, penalty = excluded.penalty, final_score = excluded.final_score,
        tier_bp = excluded.tier_bp, breakdown = excluded.breakdown, rationale = excluded.rationale, updated_at = now();
  return app.ok(jsonb_build_object('final', (v_final ->> 'final')::int, 'median', v_median, 'penalty', v_penalty,
                                   'capped', (v_final ->> 'capped')::boolean));
end
$$;

-- Every company with no on-time submission of this type scores 0 (missing or late). Idempotent.
create or replace function public.seal_missing_scores(p_event uuid, p_type public.submission_type)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  perform app.require_organiser();
  insert into public.scores (event_id, company_id, type, status, run_totals, median, missing, late, capped, penalty, final_score, tier_bp, rationale)
  select p_event, c.id, p_type, 'SEALED', '{}', null, true, false, false, 0, 0, app.tier_bp(p_type, 0),
         'No on-time submission.'
    from public.companies c
   where c.event_id = p_event and c.squad_id is not null
     and (app.current_submission(c.id, p_type)).id is null
     and not exists (select 1 from public.scores s where s.company_id = c.id and s.type = p_type)
  on conflict (company_id, type) do nothing;
  get diagnostics n = row_count;
  return app.ok(jsonb_build_object('sealed_missing', n));
end
$$;

-- Releases every company's sealed score of one type at once and applies its tier atomically:
-- PITCH sets IPO prices; PLAN and FLASH move both the market price and the AI price.
create or replace function public.release_scores(p_event uuid, p_type public.submission_type)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_unsealed int;
  v_movers jsonb;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event for update;
  if app.score_released(p_event, p_type) then
    return app.fail('ALREADY_RELEASED', 'These scores have already been released.');
  end if;
  select count(*) into v_unsealed from public.companies c
   where c.event_id = p_event and c.squad_id is not null
     and not exists (select 1 from public.scores s where s.company_id = c.id and s.type = p_type and s.status = 'SEALED');
  if v_unsealed > 0 then
    return app.fail('NOT_READY', format('%s companies have no sealed %s score yet.', v_unsealed, p_type));
  end if;
  if (app.open_round(p_event)).id is not null then
    return app.fail('TRADING_OPEN', 'Release scores between rounds, while trading is closed.');
  end if;
  if p_type = 'PITCH' and v_event.current_phase <> 'READING' then
    return app.fail('WRONG_PHASE', 'Pitch scores are released at the end of READING (23:15).');
  end if;
  if p_type = 'PLAN' and v_event.current_phase not in ('PLANS_PUBLISHED', 'VERDICTS') then
    return app.fail('WRONG_PHASE', 'Plan scores are released at VERDICTS (03:30).');
  end if;
  if p_type = 'FLASH' and (v_event.current_phase <> 'ROUNDS_13_21'
      or not exists (select 1 from public.rounds where event_id = p_event and number = 17 and status = 'CLEARED')) then
    return app.fail('WRONG_PHASE', 'Flash scores are released after round 17 clears (04:20).');
  end if;

  perform set_config('app.price_writer', case when p_type = 'PITCH' then 'IPO' else 'TIER' end, true);
  if p_type = 'PITCH' then
    with s as (select company_id, app.ipo_price(final_score) as price from public.scores where event_id = p_event and type = 'PITCH')
    update public.companies c set ipo_price = s.price, market_price = s.price, ai_price = s.price from s where c.id = s.company_id;
    insert into public.round_prices (event_id, company_id, kind, market_before, market_after, ai_before, ai_after, tier_bp)
    select p_event, s.company_id, 'IPO', null, c.ipo_price, null, c.ai_price, s.tier_bp
      from public.scores s join public.companies c on c.id = s.company_id where s.event_id = p_event and s.type = 'PITCH';
  else
    insert into public.round_prices (event_id, company_id, kind, market_before, market_after, ai_before, ai_after, tier_bp)
    select p_event, c.id, case when p_type = 'PLAN' then 'PLAN_TIER' else 'FLASH_TIER' end::public.price_kind,
           c.market_price, app.apply_tier(c.market_price, s.tier_bp), c.ai_price, app.apply_tier(c.ai_price, s.tier_bp), s.tier_bp
      from public.companies c join public.scores s on s.company_id = c.id and s.type = p_type
     where c.event_id = p_event;
    update public.companies c set market_price = rp.market_after, ai_price = rp.ai_after
      from public.round_prices rp
     where rp.company_id = c.id and rp.kind = case when p_type = 'PLAN' then 'PLAN_TIER' else 'FLASH_TIER' end::public.price_kind;
    perform app.recalculate_collateral(p_event);
  end if;

  update public.scores set status = 'RELEASED', released_at = now(), released_by = auth.uid()
   where event_id = p_event and type = p_type;

  if p_type = 'FLASH' then
    perform app.judge_calls(p_event, 2);
  end if;

  select jsonb_agg(m order by abs((m ->> 'tier_bp')::int) desc, m ->> 'ticker') into v_movers from (
    select jsonb_build_object('company_id', c.id, 'ticker', c.ticker, 'score', s.final_score, 'tier_bp', s.tier_bp,
                              'price', c.market_price) as m
      from public.scores s join public.companies c on c.id = s.company_id where s.event_id = p_event and s.type = p_type) x;
  perform app.broadcast(p_event, 'verdicts', jsonb_build_object('type', p_type, 'movers', coalesce(v_movers, '[]'::jsonb)));
  return app.ok(jsonb_build_object('released', jsonb_array_length(coalesce(v_movers, '[]'::jsonb))));
end
$$;

-- ───────────────────────────── Consultant calls ─────────────────────────────

-- Call 1: IPO price → round 4 clearing price. Call 2: price after the plan tier → price after the flash tier.
-- Call 3: price after the flash tier → closing price. Missing or equal is wrong. $2,500 per correct call.
create or replace function app.judge_calls(p_event uuid, p_call_no integer)
returns void
language plpgsql
as $$
begin
  update public.calls k
     set baseline_price = x.baseline, judged_price = x.judged,
         correct = app.judge_call(k.direction, x.baseline, x.judged),
         earnings_cents = case when app.judge_call(k.direction, x.baseline, x.judged) then 250000 else 0 end
    from (
      select c.id as company_id,
             case p_call_no
               when 1 then c.ipo_price::bigint
               when 2 then (select market_after from public.round_prices where company_id = c.id and kind = 'PLAN_TIER')
               else (select market_after from public.round_prices where company_id = c.id and kind = 'FLASH_TIER') end as baseline,
             case p_call_no
               when 1 then (select rp.market_after from public.round_prices rp join public.rounds r on r.id = rp.round_id
                             where rp.company_id = c.id and rp.kind = 'CLEARING' and r.number = 4)
               when 2 then (select market_after from public.round_prices where company_id = c.id and kind = 'FLASH_TIER')
               else c.closing_price::bigint end as judged
        from public.companies c where c.event_id = p_event
    ) x
   where k.event_id = p_event and k.call_no = p_call_no and k.company_id = x.company_id;
end
$$;

-- ───────────────────────────── Crisis ─────────────────────────────

-- 00:30: every company gets its crisis card (same generator, stream "crisis"), both prices × 0.85, and the
-- result is stored as the post-crisis price. The seed is revealed now (PLAN.md Q1). Idempotent.
create or replace function app.apply_crisis(p_event uuid)
returns void
language plpgsql
as $$
declare
  v_event public.events;
  v_seed text;
  v_root text;
  v_cards text[];
  v_n int;
begin
  select * into v_event from public.events where id = p_event for update;
  if v_event.crisis_applied_at is not null then
    return;
  end if;
  select seed into v_seed from public.event_secrets where event_id = p_event;
  if v_seed is null or v_event.dice is null then
    raise exception 'the crisis draw needs the lottery seed and dice';
  end if;
  if not exists (select 1 from public.crisis_cards where event_id = p_event) then
    raise exception 'the crisis deck is empty';
  end if;
  v_root := app.sha256_hex(v_seed || v_event.dice);
  select count(*) into v_n from public.squads where event_id = p_event;
  v_cards := app.lottery_crises(v_root, v_n,
    (select jsonb_agg(jsonb_build_object('id', id::text, 'category', category, 'number', number)) from public.crisis_cards where event_id = p_event));

  perform set_config('app.price_writer', 'CRISIS', true);
  update public.companies c set crisis_card_id = v_cards[s.number]::uuid
    from public.squads s where s.id = c.squad_id and s.event_id = p_event;
  insert into public.round_prices (event_id, company_id, kind, market_before, market_after, ai_before, ai_after)
  select p_event, c.id, 'CRISIS', c.market_price, app.crisis_shock(c.market_price), c.ai_price, app.crisis_shock(c.ai_price)
    from public.companies c where c.event_id = p_event and c.market_price is not null;
  update public.companies c set market_price = rp.market_after, ai_price = rp.ai_after, post_crisis_price = rp.market_after
    from public.round_prices rp where rp.company_id = c.id and rp.kind = 'CRISIS';
  perform app.recalculate_collateral(p_event);

  update public.events set crisis_applied_at = now(), seed_revealed = v_seed where id = p_event;
  insert into public.bulletins (event_id, kind, title, body, published_at)
  values (p_event, 'CRISIS', 'Crisis: every company is hit',
          'Each company has received its crisis card. All share prices fell 15%. Trading resumes at 00:45.', now());
  perform app.broadcast(p_event, 'crisis', jsonb_build_object('seed', v_seed, 'dice', v_event.dice));
end
$$;

-- ───────────────────────────── Close ─────────────────────────────

-- 05:00: market price = average of rounds 20 and 21; closing price = (market + AI) ÷ 2; every short is covered
-- at the closing price; call 3 is judged. Idempotent.
create or replace function app.close_market(p_event uuid)
returns void
language plpgsql
as $$
declare
  v_txn uuid := gen_random_uuid();
  v_cover bigint;
begin
  perform 1 from public.events where id = p_event and market_closed_at is null for update;
  if not found then
    return;
  end if;
  if exists (select 1 from public.rounds where event_id = p_event and number in (20, 21) and status <> 'CLEARED') then
    raise exception 'rounds 20 and 21 must be cleared before the close';
  end if;
  perform set_config('app.price_writer', 'CLOSE', true);
  with px as (
    select c.id,
           app.avg_half_up((select rp.market_after from public.round_prices rp join public.rounds r on r.id = rp.round_id
                             where rp.company_id = c.id and rp.kind = 'CLEARING' and r.number = 20),
                           (select rp.market_after from public.round_prices rp join public.rounds r on r.id = rp.round_id
                             where rp.company_id = c.id and rp.kind = 'CLEARING' and r.number = 21)) as market
      from public.companies c where c.event_id = p_event and c.market_price is not null
  )
  update public.companies c set closing_market_price = px.market, closing_price = app.avg_half_up(px.market, c.ai_price)
    from px where px.id = c.id;
  insert into public.round_prices (event_id, company_id, kind, market_before, market_after, ai_before, ai_after)
  select p_event, c.id, 'CLOSE', c.closing_market_price, c.closing_price, c.ai_price, c.ai_price
    from public.companies c where c.event_id = p_event and c.closing_price is not null;

  -- Cover every short at the closing price.
  insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, lot, cash_delta_cents, share_delta, price_cents, memo)
  select p_event, v_txn, 'SHORT_CLOSE', h.team_id, h.company_id, 'SHORT', -(h.qty::bigint * c.closing_price), h.qty,
         c.closing_price, 'Short covered at the closing price'
    from public.holdings h join public.companies c on c.id = h.company_id
   where h.event_id = p_event and h.lot = 'SHORT' and h.qty > 0;
  insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, cash_delta_cents, share_delta, price_cents, memo)
  select p_event, v_txn, 'SHORT_CLOSE', null, h.company_id, sum(h.qty::bigint * c.closing_price), -sum(h.qty), min(c.closing_price),
         'Shorts covered at the close (exchange)'
    from public.holdings h join public.companies c on c.id = h.company_id
   where h.event_id = p_event and h.lot = 'SHORT' and h.qty > 0
   group by h.company_id;
  update public.teams t set cash_cents = t.cash_cents - x.cost
    from (select h.team_id, sum(h.qty::bigint * c.closing_price) as cost from public.holdings h
            join public.companies c on c.id = h.company_id
           where h.event_id = p_event and h.lot = 'SHORT' and h.qty > 0 group by h.team_id) x
   where t.id = x.team_id;
  update public.companies c set exchange_inventory = c.exchange_inventory - x.qty
    from (select company_id, sum(qty) as qty from public.holdings where event_id = p_event and lot = 'SHORT' and qty > 0 group by company_id) x
   where c.id = x.company_id;
  select coalesce(sum(h.qty::bigint * c.closing_price), 0) into v_cover
    from public.holdings h join public.companies c on c.id = h.company_id where h.event_id = p_event and h.lot = 'SHORT' and h.qty > 0;
  update public.holdings set qty = 0, cost_cents = 0, updated_at = now() where event_id = p_event and lot = 'SHORT' and qty > 0;
  update public.teams set collateral_cents = 0 where event_id = p_event and track = 'FINANCE';
  update public.events set exchange_cash_cents = exchange_cash_cents + v_cover, market_closed_at = now() where id = p_event;

  perform app.judge_calls(p_event, 3);
  perform app.broadcast(p_event, 'closing_bell', jsonb_build_object(
    'prices', (select jsonb_object_agg(id::text, closing_price) from public.companies where event_id = p_event and closing_price is not null)));
end
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.seal_score(uuid, public.submission_type, integer[], jsonb, text)',
    'public.seal_missing_scores(uuid, public.submission_type)',
    'public.release_scores(uuid, public.submission_type)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
