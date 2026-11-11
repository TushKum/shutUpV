-- PRIMUS Round 1: the Consulting team's crisis memo (submission type MEMO). Every Consulting team answers the same
-- standalone case (in prompts/MEMO.md) in up to 500 words while Product writes the PRD, by the same deadline (PITCH).
-- The AI judge scores it like any submission; the score moves no price. Released from READING, it pays the firm a
-- reputation bonus at settlement: $500 × (score − 50), from −$10,000 to +$25,000 (the plan bonus's rule).
-- A released memo score is final (like a released pitch score). Mirrors TEMPLATES, RUBRICS, RULES.WORD_LIMIT,
-- tierBp, injectionPenalty and memoBonus in packages/engine.

create or replace function app.word_limit(p_type public.submission_type)
returns integer
language sql immutable strict parallel safe
as $$
  select case p_type when 'PITCH' then 800 when 'PLAN' then 500 when 'MEMO' then 500 else 100 end
$$;

create or replace function app.template_fields(p_type public.submission_type)
returns table (ord int, key text, label text)
language sql immutable
as $$
  select t.ord, t.key, t.label from (values
    ('PITCH'::public.submission_type, 1, 'problem', 'Problem and target user'),
    ('PITCH', 2, 'solution', 'Proposed solution'),
    ('PITCH', 3, 'mvp', 'Core features and MVP scope'),
    ('PITCH', 4, 'metrics', 'Success metrics'),
    ('PITCH', 5, 'business_model', 'Business model'),
    ('PITCH', 6, 'advantage', 'Competitive edge'),
    ('PITCH', 7, 'risks', 'Key risks'),
    ('PLAN', 1, 'crisis', 'The crisis'),
    ('PLAN', 2, 'new_plan', 'The new plan'),
    ('PLAN', 3, 'money', 'The money'),
    ('PLAN', 4, 'deal', 'The rescue deal'),
    ('PLAN', 5, 'time_to_recovery', 'Time to recovery'),
    ('PLAN', 6, 'risks', 'Risks'),
    ('PLAN', 7, 'next_steps', 'Next three steps'),
    ('FLASH', 1, 'answer', 'Our answer'),
    ('MEMO', 1, 'diagnosis', 'Diagnosis'),
    ('MEMO', 2, 'options', 'Options and trade-offs'),
    ('MEMO', 3, 'recommendation', 'Recommendation'),
    ('MEMO', 4, 'numbers', 'The numbers'),
    ('MEMO', 5, 'risks', 'Risks'),
    ('MEMO', 6, 'next_steps', 'Next steps')
  ) t(type, ord, key, label)
  where t.type = p_type
$$;

create or replace function app.rubric(p_type public.submission_type)
returns jsonb
language sql immutable strict parallel safe
as $$
  select case p_type
    when 'PITCH' then '{"problem": 20, "solution": 20, "metrics": 15, "business_model": 15, "feasibility": 15,
                        "clarity": 15}'::jsonb
    when 'PLAN' then '{"solves_crisis": 25, "money_logic": 20, "funding_and_deal": 20, "time_to_recovery": 15,
                       "new_risks": 10, "next_steps": 10}'::jsonb
    when 'MEMO' then '{"diagnosis": 25, "options": 20, "recommendation": 20, "numbers": 15, "risks": 10,
                       "next_steps": 10}'::jsonb
    else '{"responds_to_news": 50, "realistic": 30, "clear": 20}'::jsonb
  end
$$;

-- tierBp: the memo moves no price.
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
    when 'MEMO' then 0
    else case when p_score >= 70 then 500 when p_score >= 50 then 0 else -500 end
  end;
end
$$;

-- injectionPenalty: the memo is the Consulting team's own piece and never a second offence.
create or replace function app.injection_penalty(p_type public.submission_type, p_pitch boolean, p_plan boolean, p_flash boolean)
returns integer
language sql immutable parallel safe
as $$
  select case
    when p_type = 'MEMO' then 0
    when not coalesce(case p_type when 'PITCH' then p_pitch when 'PLAN' then p_plan else p_flash end, false) then 0
    when (coalesce(p_pitch, false)::int
          + (p_type in ('PLAN', 'FLASH') and coalesce(p_plan, false))::int
          + (p_type = 'FLASH' and coalesce(p_flash, false))::int) >= 2 then 10
    else 0
  end
$$;

-- The memo closes with the pitch (the PRD).
create or replace function app.scoring_closed(p_event uuid, p_type public.submission_type)
returns boolean
language sql stable
as $$
  select app.deadline_passed(p_event, case when p_type = 'MEMO' then 'PITCH' else p_type::text end::public.deadline_code)
     and (p_type <> 'PLAN' or app.deadline_passed(p_event, 'DEAL'))
$$;

alter table public.appeals drop constraint if exists appeals_check;
alter table public.appeals add constraint appeals_check check (not after_release or type not in ('PITCH', 'MEMO'));

create or replace function app.submission_window(p_team public.teams, p_type public.submission_type, out allowed boolean, out open boolean, out deadline_code public.deadline_code)
language plpgsql stable
as $$
declare
  v_event public.events;
begin
  select * into v_event from public.events where id = p_team.event_id;
  allowed := case p_type when 'PITCH' then p_team.track = 'PRODUCT' when 'MEMO' then p_team.track = 'CONSULTING'
                   else p_team.track in ('PRODUCT', 'CONSULTING') end;
  deadline_code := case p_type when 'PITCH' then 'PITCH' when 'MEMO' then 'PITCH' when 'PLAN' then 'PLAN' else 'FLASH' end;
  -- Open from its start until its deadline, and never once the phase that publishes this work has begun
  -- (an early advance also pulls the deadline in; this is the second lock).
  open := v_event.drawn_at is not null and not app.deadline_passed(v_event.id, deadline_code) and case p_type
    when 'PITCH' then v_event.current_phase between 'SQUAD_DRAW' and 'BUILD'
    when 'MEMO' then v_event.current_phase between 'SQUAD_DRAW' and 'BUILD'
    when 'PLAN' then v_event.current_phase between 'CRISIS' and 'RESCUE_2'
    else exists (select 1 from public.bulletins b where b.event_id = v_event.id and b.kind = 'FLASH'
                    and b.published_at is not null and b.published_at <= now())
         and not app.score_released(v_event.id, 'FLASH')
  end;
end
$$;

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
  select * into v_event from public.events where id = p_event for no key update;
  if app.score_released(p_event, p_type) then
    return app.fail('ALREADY_RELEASED', 'These scores have already been released.');
  end if;
  select count(*) into v_unsealed from public.companies c
   where c.event_id = p_event and c.squad_id is not null
     and not exists (select 1 from public.scores s where s.company_id = c.id and s.type = p_type and s.status = 'SEALED');
  if v_unsealed > 0 then
    return app.fail('NOT_READY', format('%s companies have no sealed %s score yet.', v_unsealed, p_type));
  end if;
  -- What was sealed must still be what is judged (defence in depth: sealing waits for the deadline).
  if not app.scoring_closed(p_event, p_type) or exists (
       select 1 from public.scores s where s.event_id = p_event and s.type = p_type
          and s.submission_id is distinct from (app.current_submission(s.company_id, p_type)).id) then
    return app.fail('NOT_READY', 'A submission changed after its score was sealed; judge it again.');
  end if;
  -- The plan cap must still match the deal (a schedule shift can never reopen the deal window, but check anyway).
  if p_type = 'PLAN' and exists (
       select 1 from public.scores s where s.event_id = p_event and s.type = 'PLAN' and not s.missing
          and s.capped is distinct from not app.deal_signed_in_time(s.company_id)) then
    return app.fail('NOT_READY', 'A deal changed after its plan score was sealed; judge it again.');
  end if;
  if p_type = 'PITCH' and not app.deadline_passed(p_event, 'CALL_1') then
    return app.fail('CALL_1_OPEN', 'Pitch scores and IPO prices are released after consultant call 1 closes (23:15).');
  end if;
  if p_type = 'MEMO' then
    if v_event.current_phase not between 'READING' and 'CLOSE' then
      return app.fail('WRONG_PHASE', 'Crisis memo scores are released from READING (23:15) until the close.');
    end if;
    update public.scores set status = 'RELEASED', released_at = now(), released_by = auth.uid()
     where event_id = p_event and type = 'MEMO';
    get diagnostics v_unsealed = row_count;
    perform app.broadcast(p_event, 'verdicts', jsonb_build_object('type', p_type, 'movers', '[]'::jsonb));
    return app.ok(jsonb_build_object('released', v_unsealed));
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
     where c.event_id = p_event and rp.event_id = p_event and rp.company_id = c.id
       and rp.kind = case when p_type = 'PLAN' then 'PLAN_TIER' else 'FLASH_TIER' end::public.price_kind;
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

create or replace function public.rerun_judging(p_company uuid, p_type public.submission_type, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_company public.companies;
  v_sub public.submissions;
  v_score public.scores;
  v_gen smallint;
  v_appeal uuid;
begin
  perform app.require_organiser();
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'give a reason (at least 5 characters)';
  end if;
  select * into v_company from public.companies where id = p_company and squad_id is not null;
  if v_company.id is null then
    raise exception 'no such company';
  end if;
  perform 1 from public.events where id = v_company.event_id for no key update;
  if (select current_phase from public.events where id = v_company.event_id) >= 'AWARDS' then
    return app.fail('TOO_LATE', 'Appeals are decided before the awards.');
  end if;
  if not app.scoring_closed(v_company.event_id, p_type) then
    return app.fail('NOT_READY', 'A submission is judged after its deadline.');
  end if;
  v_sub := app.current_submission(p_company, p_type);
  if v_sub.id is null then
    return app.fail('NO_SUBMISSION', 'This company has no on-time submission to judge again.');
  end if;
  perform app.lock_judging(v_sub.id::text);
  if exists (select 1 from public.judge_runs where submission_id = v_sub.id and status in ('QUEUED', 'RUNNING')) then
    return app.fail('IN_PROGRESS', 'The judge is still working on this submission; wait for its runs to finish.');
  end if;
  select * into v_score from public.scores where company_id = p_company and type = p_type for no key update;
  if v_score.status = 'RELEASED' and p_type = 'MEMO' then
    return app.fail('MEMO_RELEASED', 'A released crisis memo score is final; it cannot be judged again.');
  end if;
  if v_score.status = 'RELEASED' and p_type = 'PITCH' then
    return app.fail('PITCH_RELEASED', 'A released pitch score has set the IPO price and the IPO is allocated; it cannot be judged again.');
  end if;
  if exists (select 1 from public.appeals where company_id = p_company and type = p_type and status = 'READY') then
    return app.fail('APPEAL_OPEN', 'An appeal of this score has a new score waiting: apply or dismiss it first.');
  end if;
  -- An earlier re-run whose runs failed is replaced by this one.
  update public.appeals set status = 'DISMISSED', decided_by = auth.uid(), decided_at = now(), note = 'Replaced by a new re-run.'
   where company_id = p_company and type = p_type and status = 'JUDGING';

  select coalesce(max(generation), 0) + 1 into v_gen from public.judge_runs where submission_id = v_sub.id;
  insert into public.judge_runs (event_id, submission_id, company_id, type, generation, run_no)
  select v_company.event_id, v_sub.id, p_company, p_type, v_gen, n from generate_series(1, 3) n;
  insert into public.appeals (event_id, company_id, type, submission_id, generation, after_release, reason, requested_by, old_score)
  values (v_company.event_id, p_company, p_type, v_sub.id, v_gen, coalesce(v_score.status = 'RELEASED', false), btrim(p_reason), auth.uid(),
          case when v_score.id is not null then jsonb_build_object(
            'final', v_score.final_score, 'median', v_score.median, 'tier_bp', v_score.tier_bp, 'penalty', v_score.penalty,
            'capped', v_score.capped, 'run_totals', to_jsonb(v_score.run_totals), 'generation', v_score.generation,
            'status', v_score.status) end)
  returning id into v_appeal;
  if v_score.id is not null and v_score.status <> 'RELEASED' then
    update public.scores set status = 'SCORING', updated_at = now() where id = v_score.id;
  end if;
  perform app.broadcast_staff(v_company.event_id, 'judge');
  return app.ok(jsonb_build_object('appeal_id', v_appeal, 'generation', v_gen, 'after_release', coalesce(v_score.status = 'RELEASED', false)));
end
$$;

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
  select s.consulting_team_id, c.id, 'BONUS_MEMO'::public.ledger_kind, app.plan_bonus(m.final_score),
         'Crisis memo bonus: $500 × (' || m.final_score || ' − 50)'
    from public.squads s join public.companies c on c.squad_id = s.id
    join public.scores m on m.company_id = c.id and m.type = 'MEMO' and m.status = 'RELEASED'
   where s.event_id = p_event
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
