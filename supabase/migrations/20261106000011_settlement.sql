-- The leaderboard (live until 03:30, then frozen and hidden until AWARDS), settlement (results, rankings, awards,
-- collusion flags), the fairness officer's decisions, two-person ledger corrections, the final grants and the cron
-- heartbeat.

-- ───────────────────────────── Leaderboard ─────────────────────────────

-- The total so far for every team: Round 1 points once the PRD scores are revealed (23:30), Round 2 points once the
-- solution scores are revealed (02:45), and Round 3 points at current market prices once trading has begun (02:15).
-- Ranked like the final results: total, then Round 2, then Round 1, then the exact return.
create or replace function app.live_leaderboard(p_event uuid)
returns table (team_id uuid, code text, r1 int, r2 int, r3 int, total int, portfolio bigint, rank int)
language sql stable
as $$
  with e as (select * from public.events where id = p_event),
  t as (
    select t.id, t.code, t.disqualified,
           coalesce((select s.final_score from public.scores s join public.companies c on c.id = s.company_id
                      where c.founder_team_id = t.id and s.type = 'PRD' and s.status = 'REVEALED'), 0)::int as r1,
           coalesce((select s.final_score from public.scores s
                      where s.team_id = t.id and s.type = 'SOLUTION' and s.status = 'REVEALED'), 0)::int as r2,
           t.cash_cents + coalesce((select sum(h.qty::bigint * c.market_price) from public.holdings h
                                     join public.companies c on c.id = h.company_id
                                    where h.team_id = t.id and h.qty > 0), 0) as portfolio
      from public.teams t where t.event_id = p_event
  ),
  s as (
    select t.*, case when (select current_phase from e) >= 'MARKET_BLIND'
                     then app.round3_points(t.portfolio, (select 10000000)) else 0 end as r3
      from t
  )
  select s.id, s.code, s.r1, s.r2, s.r3, s.r1 + s.r2 + s.r3, s.portfolio,
         case when s.disqualified then null
              else (rank() over (partition by s.disqualified
                                 order by s.r1 + s.r2 + s.r3 desc, s.r2 desc, s.r1 desc, s.portfolio desc))::int end
    from s
$$;

-- 03:30: the leaderboard is snapshotted and stops for teams and the projector until the awards. Idempotent.
create or replace function app.freeze_leaderboard(p_event uuid)
returns void
language plpgsql
as $$
begin
  perform 1 from public.events where id = p_event and leaderboard_frozen_at is null for no key update;
  if not found then
    return;
  end if;
  insert into public.leaderboard_frozen (event_id, team_id, rank, r1_points, r2_points, r3_points, total)
  select p_event, l.team_id, coalesce(l.rank, 0), l.r1, l.r2, l.r3, l.total from app.live_leaderboard(p_event) l
  on conflict do nothing;
  update public.events set leaderboard_frozen_at = now() where id = p_event;
  update public.deadlines set at = least(at, now()) where event_id = p_event and code = 'LEADERBOARD_FREEZE';
  perform app.broadcast(p_event, 'leaderboard_frozen');
end
$$;

-- The rankings endpoint. Staff: always (live, or the results after settlement). Teams and the projector: the live
-- board until it freezes at 03:30, then 403 until AWARDS, when the final results are public.
create or replace function public.leaderboard(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_event public.events;
begin
  select * into v_event from public.events where id = p_event;
  if v_event.id is null or not (app.is_staff() or app.my_event_id() = p_event) then
    raise exception 'no such event' using errcode = '42501';
  end if;
  if not app.is_organiser() and not app.is_fairness() and v_event.current_phase < 'AWARDS'
     and v_event.leaderboard_frozen_at is not null then
    raise exception 'the leaderboard is frozen until the awards' using errcode = '42501';
  end if;
  if v_event.settled_at is not null and (v_event.current_phase >= 'AWARDS' or app.is_organiser() or app.is_fairness()) then
    return app.ok(jsonb_build_object('final', true, 'rows', coalesce((
      select jsonb_agg(jsonb_build_object('team_id', r.team_id, 'code', t.code, 'name', t.name, 'r1', r.r1_points,
                                          'r2', r.r2_points, 'r3', r.r3_points, 'total', r.total, 'rank', r.rank,
                                          'return_bp', r.return_bp, 'eligible', r.eligible)
                       order by r.rank nulls last, t.code)
        from public.results r join public.teams t on t.id = r.team_id where r.event_id = p_event), '[]'::jsonb)));
  end if;
  return app.ok(jsonb_build_object('final', false, 'frozen', v_event.leaderboard_frozen_at is not null, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object('team_id', l.team_id, 'code', l.code, 'r1', l.r1, 'r2', l.r2, 'r3', l.r3,
                                        'total', l.total, 'rank', l.rank) order by l.rank nulls last, l.code)
      from app.live_leaderboard(p_event) l), '[]'::jsonb)));
end
$$;

-- ───────────────────────────── Settlement ─────────────────────────────

-- One row per team: R1 = its PRD score, R2 = the score of the solution it wrote, R3 = 50 + 2.5 × return %, from the
-- portfolio at closing prices.
create or replace function app.compute_results(p_event uuid)
returns void
language sql
as $$
  insert into public.results (event_id, team_id, r1_points, r2_points, r3_points, portfolio_cents, return_bp, total, eligible, details, computed_at)
  select p_event, x.id, x.r1, x.r2, app.round3_points(x.portfolio, 10000000), x.portfolio, app.return_bp(x.portfolio, 10000000),
         x.r1 + x.r2 + app.round3_points(x.portfolio, 10000000), not x.disqualified,
         jsonb_build_object('cash', x.cash_cents), now()
    from (select t.id, t.disqualified, t.cash_cents,
                 coalesce((select s.final_score from public.scores s join public.companies c on c.id = s.company_id
                            where c.founder_team_id = t.id and s.type = 'PRD'), 0)::int as r1,
                 coalesce((select s.final_score from public.scores s where s.team_id = t.id and s.type = 'SOLUTION'), 0)::int as r2,
                 t.cash_cents + coalesce((select sum(h.qty::bigint * c.closing_price) from public.holdings h
                                           join public.companies c on c.id = h.company_id
                                          where h.team_id = t.id and h.qty > 0), 0) as portfolio
            from public.teams t where t.event_id = p_event) x
  on conflict (team_id) do update
    set r1_points = excluded.r1_points, r2_points = excluded.r2_points, r3_points = excluded.r3_points,
        portfolio_cents = excluded.portfolio_cents, return_bp = excluded.return_bp, total = excluded.total,
        eligible = excluded.eligible, details = excluded.details, computed_at = now()
$$;

-- Ranks (total, then R2, then R1, then the exact return; teams still exactly tied share the rank) and the awards.
-- Disqualified teams are left out of both.
create or replace function app.compute_rankings(p_event uuid)
returns void
language plpgsql
as $$
begin
  update public.results r set eligible = not t.disqualified from public.teams t where t.id = r.team_id and r.event_id = p_event;
  update public.results r set rank = x.rank
    from (select id, case when eligible then rank() over (partition by eligible
                                                          order by total desc, r2_points desc, r1_points desc, portfolio_cents desc) end as rank
            from public.results where event_id = p_event) x
   where r.id = x.id;

  delete from public.awards where event_id = p_event;
  insert into public.awards (event_id, code, place, team_id, metric)
  select p_event, case rank when 1 then 'WINNER' when 2 then 'RUNNER_UP' else 'THIRD' end, rank, team_id,
         jsonb_build_object('total', total)
    from public.results where event_id = p_event and rank between 1 and 3;
  insert into public.awards (event_id, code, team_id, metric)
  select p_event, 'BEST_PRD', team_id, jsonb_build_object('score', r1_points) from public.results
   where event_id = p_event and eligible and r1_points = (select max(r1_points) from public.results where event_id = p_event and eligible);
  insert into public.awards (event_id, code, team_id, metric)
  select p_event, 'BEST_SOLUTION', team_id, jsonb_build_object('score', r2_points) from public.results
   where event_id = p_event and eligible and r2_points = (select max(r2_points) from public.results where event_id = p_event and eligible);
  insert into public.awards (event_id, code, team_id, metric)
  select p_event, 'BEST_INVESTOR', team_id, jsonb_build_object('return_bp', return_bp, 'portfolio', portfolio_cents) from public.results
   where event_id = p_event and eligible
     and portfolio_cents = (select max(portfolio_cents) from public.results where event_id = p_event and eligible);
  -- Best company: the biggest rise from the post-crisis price to the closing price (compared exactly), given to the
  -- team that built it and the team that rescued it; both must be eligible.
  with c as (
    select c.* from public.companies c
      join public.teams f on f.id = c.founder_team_id and not f.disqualified
      join public.teams r on r.id = c.rescuer_team_id and not r.disqualified
     where c.event_id = p_event and c.closing_price is not null and c.post_crisis_price is not null
  ), best as (
    select c.* from c where not exists (
      select 1 from c o where o.closing_price::bigint * c.post_crisis_price > c.closing_price::bigint * o.post_crisis_price)
  )
  insert into public.awards (event_id, code, team_id, company_id, metric)
  select p_event, 'BEST_COMPANY', x.team_id, b.id,
         jsonb_build_object('rise_bp', app.rise_bp(b.post_crisis_price, b.closing_price), 'post_crisis', b.post_crisis_price,
                            'closing', b.closing_price, 'ticker', b.ticker)
    from best b cross join lateral (values (b.founder_team_id), (b.rescuer_team_id)) x(team_id)
  on conflict (event_id, code, team_id) do nothing;
end
$$;

-- The three collusion flags (for the fairness officer only).
create or replace function app.generate_flags(p_event uuid)
returns void
language plpgsql
as $$
begin
  delete from public.flags where event_id = p_event and status = 'OPEN';

  -- 1. Reciprocal buying: two teams each bought shares of the company the other built.
  with bought as (
    select o.team_id as buyer, c.founder_team_id as founder, c.id as company_id, sum(o.qty) as qty
      from public.orders o join public.companies c on c.id = o.company_id
     where o.event_id = p_event and o.status = 'FILLED' and o.type = 'BUY'
     group by o.team_id, c.founder_team_id, c.id
  )
  insert into public.flags (event_id, kind, team_ids, details)
  select p_event, 1, array[a.buyer, b.buyer],
         jsonb_build_object(ta.code, jsonb_build_object('company', ca.ticker, 'bought', a.qty),
                            tb.code, jsonb_build_object('company', cb.ticker, 'bought', b.qty))
    from bought a join bought b on b.buyer = a.founder and b.founder = a.buyer
    join public.teams ta on ta.id = a.buyer join public.teams tb on tb.id = b.buyer
    join public.companies ca on ca.id = a.company_id join public.companies cb on cb.id = b.company_id
   where ta.code < tb.code;

  -- 2. At least 4,000 shares of one company whose closing price is below the team's average cost.
  insert into public.flags (event_id, kind, company_id, team_ids, details)
  select p_event, 2, h.company_id, array[h.team_id],
         jsonb_build_object('qty', h.qty, 'cost', h.cost_cents, 'closing_price', c.closing_price, 'ticker', c.ticker)
    from public.holdings h join public.companies c on c.id = h.company_id
   where h.event_id = p_event and h.qty >= 4000 and h.qty::bigint * c.closing_price < h.cost_cents;

  -- 3. Five or more teams reaching the 5,000-share limit on the same company in the same round (fewer than 5,000
  -- before the round's clearing, exactly 5,000 after).
  with moves as (
    select l.team_id, l.company_id, r.number, sum(l.share_delta) as delta
      from public.ledger_entries l join public.rounds r on r.id = l.round_id
     where l.event_id = p_event and l.kind = 'TRADE' and l.team_id is not null
     group by l.team_id, l.company_id, r.number
  ), pos as (
    select m.*, sum(m.delta) over (partition by m.team_id, m.company_id order by m.number) as after from moves m
  ), reach as (
    select p.company_id, p.number, array_agg(p.team_id order by t.code) as teams
      from pos p join public.teams t on t.id = p.team_id
     where p.after = 5000 and p.after - p.delta < 5000
     group by p.company_id, p.number
  )
  insert into public.flags (event_id, kind, company_id, team_ids, details)
  select p_event, 3, r.company_id, r.teams,
         jsonb_build_object('round', r.number, 'teams', cardinality(r.teams), 'ticker', c.ticker)
    from reach r join public.companies c on c.id = r.company_id
   where cardinality(r.teams) >= 5;
end
$$;

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
  perform app.compute_results(p_event);
  perform app.generate_flags(p_event);
  perform app.compute_rankings(p_event);
  update public.events set settled_at = now() where id = p_event;
  perform app.broadcast(p_event, 'settled', '{}'::jsonb, true);
end
$$;

-- Fairness officer: clear a flag or disqualify the teams it names, with a logged reason.
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
  if found then
    perform app.compute_rankings(v_flag.event_id);
  end if;
  return app.ok();
end
$$;

-- ───────────────────────────── Ledger corrections (two people) ─────────────────────────────

-- An entry: {team_id, company_id?, cash_delta_cents?, share_delta?}; the exchange takes the other side. Returns why
-- the entries are not acceptable, or null. Checked when requested and again, against the state then, when approved.
create or replace function app.correction_problem(p_event uuid, p_entries jsonb)
returns text
language plpgsql stable
as $$
declare
  e jsonb;
  v_cash numeric;
  v_shares numeric;
  uuid_re text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) not between 1 and 50 then
    return 'a correction needs 1 to 50 entries';
  end if;
  for e in select * from jsonb_array_elements(p_entries) loop
    if jsonb_typeof(e) <> 'object'
       or exists (select 1 from jsonb_object_keys(e) k where k not in ('team_id', 'company_id', 'cash_delta_cents', 'share_delta')) then
      return 'each entry has only team_id, company_id, cash_delta_cents and share_delta';
    end if;
    if coalesce(e ->> 'team_id', '') !~* uuid_re
       or not exists (select 1 from public.teams where id = (e ->> 'team_id')::uuid and event_id = p_event) then
      return 'each entry needs a team of this event';
    end if;
    if (e ? 'cash_delta_cents' and jsonb_typeof(e -> 'cash_delta_cents') <> 'number')
       or (e ? 'share_delta' and jsonb_typeof(e -> 'share_delta') <> 'number') then
      return 'cash_delta_cents and share_delta are whole numbers';
    end if;
    v_cash := coalesce((e ->> 'cash_delta_cents')::numeric, 0);
    v_shares := coalesce((e ->> 'share_delta')::numeric, 0);
    if v_cash <> trunc(v_cash) or v_shares <> trunc(v_shares) or abs(v_cash) > 100000000 or abs(v_shares) > 5000 then
      return 'cash_delta_cents is a whole number up to ±$1,000,000 and share_delta a whole number up to ±5,000';
    end if;
    if v_cash = 0 and v_shares = 0 then
      return 'each entry changes cash or shares';
    end if;
    if v_shares <> 0 and (coalesce(e ->> 'company_id', '') !~* uuid_re
        or not exists (select 1 from public.companies where id = (e ->> 'company_id')::uuid and event_id = p_event)) then
      return 'a share correction needs a company of this event';
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
  perform app.broadcast(p_event, 'correction_requested', '{}'::jsonb, true);
  return app.ok(jsonb_build_object('correction_id', v_id));
end
$$;

-- A second organiser (or the fairness officer) approves or rejects. An approved correction is applied and published.
create or replace function public.decide_correction(p_correction uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_c public.corrections;
  v_txn uuid := gen_random_uuid();
  e jsonb;
  v_d int;
  v_cash bigint;
  v_team uuid;
  v_company uuid;
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
  -- Lock order: the event first, so a correction never interleaves with a clearing.
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
    v_team := (e ->> 'team_id')::uuid;
    v_company := nullif(e ->> 'company_id', '')::uuid;
    v_cash := coalesce((e ->> 'cash_delta_cents')::numeric, 0)::bigint;
    v_d := coalesce((e ->> 'share_delta')::numeric, 0)::int;
    update public.teams set cash_cents = cash_cents + v_cash where id = v_team;
    if v_d <> 0 then
      insert into public.holdings (event_id, team_id, company_id, qty, cost_cents)
      values (v_c.event_id, v_team, v_company, 0, 0)
      on conflict (team_id, company_id) do nothing;
      -- Shares taken away leave at the average cost; shares added come at no cost (the cash entry says what they cost).
      update public.holdings
         set qty = qty + v_d,
             cost_cents = case when v_d < 0 then cost_cents - app.mul_rate(cost_cents, -v_d, qty) else cost_cents end,
             updated_at = now()
       where team_id = v_team and company_id = v_company;
    end if;
    insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, cash_delta_cents, share_delta, ref_table, ref_id, memo) values
      (v_c.event_id, v_txn, 'CORRECTION', v_team, v_company, v_cash, v_d, 'corrections', v_c.id, v_c.reason),
      (v_c.event_id, v_txn, 'CORRECTION', null, v_company, -v_cash, -v_d, 'corrections', v_c.id, v_c.reason);
    update public.events set exchange_cash_cents = exchange_cash_cents - v_cash where id = v_c.event_id;
  end loop;
  -- A pending sell must still be coverable, or the round could never clear.
  if exists (
    select 1 from public.orders o join public.rounds r on r.id = o.round_id
      left join public.holdings h on h.team_id = o.team_id and h.company_id = o.company_id
     where r.event_id = v_c.event_id and r.status = 'OPEN' and o.status = 'PENDING' and o.type = 'SELL'
     group by o.team_id, o.company_id, h.qty
    having sum(o.qty) > coalesce(h.qty, 0)) then
    raise exception 'this correction leaves a pending sell larger than the position; the team must cancel or edit it first';
  end if;
  update public.corrections set status = 'APPROVED', decided_by = auth.uid(), decided_at = now(), decision_note = p_note,
         applied_txn_id = v_txn, published_at = now() where id = v_c.id;
  insert into public.public_ledger (event_id, txn_id, kind, label, details)
  values (v_c.event_id, v_txn, 'CORRECTION', 'Ledger correction',
          jsonb_build_object('reason', v_c.reason, 'entries', jsonb_array_length(v_c.entries)));
  if (select settled_at from public.events where id = v_c.event_id) is not null then
    perform app.compute_results(v_c.event_id);
    perform app.compute_rankings(v_c.event_id);
  end if;
  perform app.broadcast(v_c.event_id, 'correction');
  return app.ok(jsonb_build_object('txn_id', v_txn));
end
$$;

-- ───────────────────────────── Heartbeat ─────────────────────────────

-- Ticks every running event, each in its own subtransaction: one event's failure (logged to error_log, shown in the
-- admin health view) never stops another event's rounds.
create or replace function app.tick_all()
returns integer
language plpgsql
as $$
declare
  v_id uuid;
  n int := 0;
begin
  perform set_config('lock_timeout', '3s', true);
  for v_id in select id from public.events where current_phase between 'CHECKIN' and 'SETTLEMENT' order by id loop
    begin
      perform public.tick(v_id);
      n := n + 1;
    exception when others then
      insert into public.error_log (event_id, source, message, context)
      values (v_id, 'tick', sqlerrm, jsonb_build_object('sqlstate', sqlstate));
    end;
  end loop;
  return n;
end
$$;

-- Every 2 seconds (Supabase pg_cron ≥ 1.5 supports second-level schedules). Skipped where pg_cron is not installed
-- (local tests); the admin console also calls tick() while it is open.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    perform cron.unschedule(jobid) from cron.job where jobname in ('msim-tick', 'primus-tick');
    perform cron.schedule('primus-tick', '2 seconds', 'select app.tick_all()');
  end if;
exception when others then
  raise warning 'pg_cron heartbeat not scheduled: %', sqlerrm;
end $$;

-- ───────────────────────────── Grants ─────────────────────────────

-- Internal functions: callable only by their owner (the SECURITY DEFINER game functions) and triggers. Signed-in
-- users may execute only the helpers that Row Level Security policies call.
revoke all on all functions in schema app from public, anon, authenticated, service_role;
grant execute on function
  app.my_role(),
  app.my_team_id(),
  app.my_event_id(),
  app.my_company_id(),
  app.my_rescue_company_id(),
  app.is_staff(),
  app.is_organiser(),
  app.is_fairness(),
  app.sees_all_events(),
  app.in_my_event(uuid),
  app.phase_reached(uuid, public.phase_code),
  app.can_hear(text)
to authenticated;

-- Game functions: signed-in users (each checks its caller); never anon.
do $$
declare f text;
begin
  foreach f in array array[
    'public.save_draft(public.submission_type, jsonb, integer)',
    'public.post_question(text)', 'public.answer_question(uuid, text)', 'public.hide_question(uuid, boolean)',
    'public.publish_twist(uuid)', 'public.set_twist(uuid, text, text)',
    'public.publish_bulletin(uuid, public.bulletin_kind, text, text)',
    'public.max_quantity(uuid, public.order_type, uuid)',
    'public.place_order(uuid, public.order_type, integer, text)', 'public.edit_order(uuid, integer)', 'public.cancel_order(uuid)',
    'public.set_seed_commitment(uuid, text)', 'public.run_lottery(uuid, text, text)', 'public.lottery_record(uuid)',
    'public.advance_phase(uuid, public.phase_code)', 'public.pause_event(uuid)', 'public.resume_event(uuid)',
    'public.extend_event(uuid, integer)', 'public.set_auto_advance(uuid, boolean)', 'public.close_round_now(uuid)',
    'public.tick(uuid)', 'public.leaderboard(uuid)',
    'public.decide_flag(uuid, public.flag_status, text)', 'public.request_correction(uuid, text, jsonb)',
    'public.decide_correction(uuid, boolean, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- The judge worker (service role) seals scores; nobody else can.
revoke all on function public.seal_score(uuid, public.submission_type) from public, anon, authenticated;
grant execute on function public.seal_score(uuid, public.submission_type) to service_role;
