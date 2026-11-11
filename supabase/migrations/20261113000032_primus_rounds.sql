-- PRIMUS Round 2 (docs/PRIMUS.md): the event format, the phase flow IPO → PRESSURE → SATURATION → CLOSE, the
-- sub-rounds' crisis reveals and −5% shocks, the new submission types (CRISIS_k, ADVICE_k, SOLUTION) in every rule
-- function, their windows, their judging context and their release. Mirrors packages/engine (types, submissions,
-- judge, prices, schedule). The marketplace (offers, engagements, escrow, ratings) is in the next migration.

-- ───────────────────────────── Patching a function in place ─────────────────────────────
-- Several long functions need one line changed. Rewriting them whole would copy hundreds of lines, so the current
-- definition is read back, the line replaced, and the definition executed again (grants and settings are kept).

create or replace function app.patch_functions(p_from text, p_to text, p_expect int default 1)
returns int
language plpgsql
as $$
declare
  f oid;
  d text;
  n int := 0;
begin
  for f in select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname in ('app', 'public') and p.prokind = 'f' and strpos(p.prosrc, p_from) > 0
              and p.proname <> 'patch_functions' loop
    d := pg_get_functiondef(f);
    execute replace(d, p_from, p_to);
    n := n + 1;
  end loop;
  if n < p_expect then
    raise exception 'patch_functions: expected % function(s) containing %, found %', p_expect, left(p_from, 60), n;
  end if;
  return n;
end
$$;
revoke all on function app.patch_functions(text, text, int) from public, anon, authenticated;

-- ───────────────────────────── Kinds and sub-rounds of a type ─────────────────────────────

create or replace function app.submission_kind(p_type public.submission_type)
returns text
language sql immutable strict parallel safe
as $$
  select regexp_replace(p_type::text, '_[0-9]$', '')
$$;

-- 1–4 for CRISIS_k and ADVICE_k, 5 for SOLUTION and ADVICE_5, null for the classic types.
create or replace function app.subround_of(p_type public.submission_type)
returns smallint
language sql immutable strict parallel safe
as $$
  select case when p_type = 'SOLUTION' then 5::smallint
              when p_type::text ~ '^(CRISIS|ADVICE)_[0-9]$' then right(p_type::text, 1)::smallint end
$$;

create or replace function app.plan_type(p_k int)
returns public.submission_type
language sql immutable strict parallel safe
as $$
  select case when p_k = 5 then 'SOLUTION' else 'CRISIS_' || p_k end::public.submission_type
$$;

create or replace function app.advice_type(p_k int)
returns public.submission_type
language sql immutable strict parallel safe
as $$
  select ('ADVICE_' || p_k)::public.submission_type
$$;

-- The deadline that closes a type (as submissionDeadline in the engine).
create or replace function app.submission_deadline(p_type public.submission_type)
returns public.deadline_code
language sql immutable strict parallel safe
as $$
  select case when p_type in ('PITCH', 'MEMO') then 'PITCH'
              when app.subround_of(p_type) is not null then 'DUE_' || app.subround_of(p_type)
              else p_type::text end::public.deadline_code
$$;

-- ───────────────────────────── Rules for the new types ─────────────────────────────

create or replace function app.word_limit(p_type public.submission_type)
returns integer
language sql immutable strict parallel safe
as $$
  select case app.submission_kind(p_type) when 'PITCH' then 800 when 'PLAN' then 500 when 'MEMO' then 500
              when 'CRISIS' then 500 when 'SOLUTION' then 600 when 'ADVICE' then 500 else 100 end
$$;

create or replace function app.template_fields(p_type public.submission_type)
returns table (ord int, key text, label text)
language sql immutable
as $$
  select t.ord, t.key, t.label from (values
    ('PITCH', 1, 'problem', 'Problem and target user'),
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
    ('MEMO', 6, 'next_steps', 'Next steps'),
    ('CRISIS', 1, 'impact', 'The crisis and what it does to us'),
    ('CRISIS', 2, 'response', 'Our response'),
    ('CRISIS', 3, 'money', 'The money'),
    ('CRISIS', 4, 'advice_used', 'What we take from our consultant'),
    ('CRISIS', 5, 'time_to_recovery', 'Time to recovery'),
    ('CRISIS', 6, 'risks', 'New risks'),
    ('CRISIS', 7, 'next_steps', 'Next steps'),
    ('SOLUTION', 1, 'solution', 'Our solution'),
    ('SOLUTION', 2, 'fit', 'Why it fits the statement'),
    ('SOLUTION', 3, 'differentiation', 'How we stand apart'),
    ('SOLUTION', 4, 'plan', 'How we will build it'),
    ('SOLUTION', 5, 'impact', 'Business impact'),
    ('SOLUTION', 6, 'risks', 'Risks'),
    ('ADVICE', 1, 'diagnosis', 'Diagnosis'),
    ('ADVICE', 2, 'advice', 'What to do'),
    ('ADVICE', 3, 'evidence', 'Evidence and numbers'),
    ('ADVICE', 4, 'fit', 'Why it fits your company')
  ) t(kind, ord, key, label)
  where t.kind = app.submission_kind(p_type)
$$;

create or replace function app.rubric(p_type public.submission_type)
returns jsonb
language sql immutable strict parallel safe
as $$
  select case app.submission_kind(p_type)
    when 'PITCH' then '{"problem": 20, "solution": 20, "metrics": 15, "business_model": 15, "feasibility": 15,
                        "clarity": 15}'::jsonb
    when 'PLAN' then '{"solves_crisis": 25, "money_logic": 20, "funding_and_deal": 20, "time_to_recovery": 15,
                       "new_risks": 10, "next_steps": 10}'::jsonb
    when 'MEMO' then '{"diagnosis": 25, "options": 20, "recommendation": 20, "numbers": 15, "risks": 10,
                       "next_steps": 10}'::jsonb
    when 'CRISIS' then '{"solves_crisis": 25, "money_logic": 20, "consultant_advice": 15, "time_to_recovery": 15,
                         "new_risks": 15, "next_steps": 10}'::jsonb
    when 'SOLUTION' then '{"fit": 25, "differentiation": 20, "feasibility": 20, "business_impact": 20,
                           "clarity": 15}'::jsonb
    when 'ADVICE' then '{"diagnosis": 25, "actionable_advice": 30, "evidence": 20, "fit": 15, "clarity": 10}'::jsonb
    else '{"responds_to_news": 50, "realistic": 30, "clear": 20}'::jsonb
  end
$$;

-- CRISIS_k and SOLUTION use the plan's tier table; ADVICE (like MEMO) moves no price.
create or replace function app.tier_bp(p_type public.submission_type, p_score integer)
returns integer
language plpgsql immutable strict parallel safe
as $$
begin
  if p_score < 0 or p_score > 100 then
    raise exception 'score must be 0–100, got %', p_score;
  end if;
  return case app.submission_kind(p_type)
    when 'PITCH' then case when p_score >= 80 then 1000 when p_score >= 60 then 500 when p_score >= 50 then 0
                           when p_score >= 40 then -500 else -1000 end
    when 'MEMO' then 0
    when 'ADVICE' then 0
    when 'FLASH' then case when p_score >= 70 then 500 when p_score >= 50 then 0 else -500 end
    else case when p_score >= 90 then 2500 when p_score >= 80 then 2000 when p_score >= 70 then 1000
              when p_score >= 60 then 500 when p_score >= 50 then 0 when p_score >= 40 then -1000 else -2000 end
  end;
end
$$;

-- Score functions call the company-level penalty below (patched before it exists, so it is not patched itself).
select app.patch_functions(
  'app.injection_penalty(p_type, app.offended(p_company, ''PITCH''), app.offended(p_company, ''PLAN''), app.offended(p_company, ''FLASH''))',
  'app.company_injection_penalty(p_company, p_type)');

-- The injection penalty of a company's submission, from what it was caught doing before (the engine's chains:
-- PITCH → PLAN → FLASH, and PITCH → CRISIS_1…4 → SOLUTION; memos never count).
create or replace function app.company_injection_penalty(p_company uuid, p_type public.submission_type)
returns integer
language plpgsql stable
as $$
declare
  v_chain public.submission_type[];
  v_count int;
begin
  if app.submission_kind(p_type) in ('MEMO', 'ADVICE') or not coalesce(app.offended(p_company, p_type), false) then
    return 0;
  end if;
  if app.submission_kind(p_type) in ('PITCH', 'PLAN', 'FLASH') then
    return app.injection_penalty(p_type, app.offended(p_company, 'PITCH'), app.offended(p_company, 'PLAN'), app.offended(p_company, 'FLASH'));
  end if;
  v_chain := array['PITCH', 'CRISIS_1', 'CRISIS_2', 'CRISIS_3', 'CRISIS_4', 'SOLUTION']::public.submission_type[];
  select count(*) into v_count from unnest(v_chain[1:array_position(v_chain, p_type)]) t
   where coalesce(app.offended(p_company, t), false);
  return case when v_count >= 2 then 10 else 0 end;
end
$$;


create or replace function app.scoring_closed(p_event uuid, p_type public.submission_type)
returns boolean
language sql stable
as $$
  select app.deadline_passed(p_event, app.submission_deadline(p_type))
     and (p_type <> 'PLAN' or app.deadline_passed(p_event, 'DEAL'))
$$;

-- ───────────────────────────── The event format and the phase flow ─────────────────────────────

alter table public.events add column if not exists format text not null default 'CLASSIC' check (format in ('CLASSIC', 'PRIMUS'));

-- The classic order (the PRIMUS phases are never next in a classic night).
create or replace function app.phase_after(p_phase public.phase_code)
returns public.phase_code
language sql immutable
as $$
  select x from unnest(enum_range(null::public.phase_code)) x
   where x > p_phase and x not in ('PRESSURE', 'SATURATION') order by x limit 1
$$;

-- The event's own next phase: the next row of its schedule.
create or replace function app.phase_after(p_event uuid, p_phase public.phase_code)
returns public.phase_code
language sql stable
as $$
  select coalesce((select min(code) from public.phases where event_id = p_event and code > p_phase), app.phase_after(p_phase))
$$;

select app.patch_functions('app.phase_after(v_event.current_phase)', 'app.phase_after(v_event.id, v_event.current_phase)', 3);

-- ───────────────────────────── Rounds ─────────────────────────────

alter table public.rounds drop constraint if exists rounds_number_check;
alter table public.rounds add constraint rounds_number_check check (number between 1 and 60);
alter table public.rounds drop constraint if exists rounds_phase_check;
alter table public.rounds add constraint rounds_phase_check
  check (phase in ('ROUNDS_1_4', 'RESCUE_1', 'RESCUE_2', 'ROUNDS_13_21', 'PRESSURE', 'SATURATION'));
-- A round that opens only once these scores are released (the last trading window of each sub-round).
alter table public.rounds add column if not exists waits_for public.submission_type;

select app.patch_functions(
  'exit when r.number = 18 and not app.score_released(p_event, ''FLASH'');',
  'exit when r.number = 18 and v_event.format = ''CLASSIC'' and not app.score_released(p_event, ''FLASH'');
      exit when r.waits_for is not null and not app.score_released(p_event, r.waits_for);');

-- ───────────────────────────── Sub-rounds ─────────────────────────────

create table public.subrounds (
  event_id uuid not null references public.events (id) on delete cascade,
  k smallint not null check (k between 1 and 5),
  revealed_at timestamptz,
  hiring_closed_at timestamptz,
  due_closed_at timestamptz,
  rated_at timestamptz,
  primary key (event_id, k)
);
alter table public.subrounds enable row level security;
create policy subrounds_read on public.subrounds for select to authenticated using (event_id = app.my_event_id() or app.is_staff());

-- Each company's crisis card in each Round 2 sub-round.
create table public.subround_crises (
  event_id uuid not null references public.events (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  k smallint not null check (k between 1 and 4),
  crisis_card_id uuid not null references public.crisis_cards (id),
  primary key (company_id, k)
);
create index subround_crises_event_idx on public.subround_crises (event_id, k);
alter table public.subround_crises enable row level security;
-- Public once revealed (like the classic crisis cards).
create policy subround_crises_read on public.subround_crises for select to authenticated
  using (event_id = app.my_event_id() or app.is_staff());

alter table public.round_prices add column if not exists subround smallint check (subround between 1 and 5);
drop index if exists public.round_prices_once_uq;
create unique index round_prices_once_uq on public.round_prices (company_id, kind, coalesce(subround, 0)) where kind <> 'CLEARING';

-- Reveal sub-round k: every company gets a crisis card (drawn from the deck so several companies share a category),
-- every price falls 5%, and a bulletin says so. Once only.
create or replace function app.reveal_subround(p_event uuid, p_k int)
returns boolean
language plpgsql
as $$
declare
  v_event public.events;
  v_seed text;
  v_cards text[];
  v_n int;
begin
  select * into v_event from public.events where id = p_event for no key update;
  insert into public.subrounds (event_id, k) values (p_event, p_k) on conflict do nothing;
  if (select revealed_at from public.subrounds where event_id = p_event and k = p_k) is not null then
    return false;
  end if;
  if not exists (select 1 from public.crisis_cards where event_id = p_event) then
    raise exception 'the crisis deck is empty';
  end if;
  select seed into v_seed from public.event_secrets where event_id = p_event;
  select count(*) into v_n from public.squads where event_id = p_event;
  v_cards := app.lottery_crises(app.sha256_hex(coalesce(v_seed, p_event::text) || coalesce(v_event.dice, '') || ':crisis:' || p_k), v_n,
    (select jsonb_agg(jsonb_build_object('id', id::text, 'category', category, 'number', number) order by category, number)
       from public.crisis_cards where event_id = p_event));
  insert into public.subround_crises (event_id, company_id, k, crisis_card_id)
  select p_event, c.id, p_k, v_cards[s.number]::uuid
    from public.companies c join public.squads s on s.id = c.squad_id where c.event_id = p_event;

  perform set_config('app.price_writer', 'CRISIS', true);
  insert into public.round_prices (event_id, company_id, kind, subround, market_before, market_after, ai_before, ai_after, tier_bp)
  select p_event, c.id, 'SUB_SHOCK', p_k, c.market_price, app.apply_tier(c.market_price, -500),
         c.ai_price, app.apply_tier(c.ai_price, -500), -500
    from public.companies c where c.event_id = p_event and c.market_price is not null;
  update public.companies c set market_price = rp.market_after, ai_price = rp.ai_after
    from public.round_prices rp
   where c.event_id = p_event and rp.event_id = p_event and rp.company_id = c.id and rp.kind = 'SUB_SHOCK' and rp.subround = p_k;
  perform app.recalculate_collateral(p_event);

  update public.subrounds set revealed_at = now() where event_id = p_event and k = p_k;
  insert into public.bulletins (event_id, kind, title, body, published_at)
  values (p_event, 'CRISIS', format('Crisis %s: every company is hit', p_k),
          'Each company has a new crisis card. All share prices fell 5% and trading is halted for 5 minutes. '
          || 'Product teams: hire a firm, then write your response plan before the due time.', now());
  perform app.broadcast(p_event, 'subround', jsonb_build_object('k', p_k, 'step', 'reveal'));
  return true;
end
$$;
revoke all on function app.reveal_subround(uuid, int) from public, anon, authenticated;

-- The PRIMUS part of the heartbeat. Later migrations add the hiring, due and rating steps.
create or replace function app.primus_tick(p_event uuid)
returns text[]
language plpgsql
as $$
declare
  v_event public.events;
  v_actions text[] := '{}';
  k int;
begin
  select * into v_event from public.events where id = p_event;
  if v_event.format <> 'PRIMUS' or v_event.current_phase <> 'PRESSURE' then
    return v_actions;
  end if;
  for k in 1..4 loop
    if app.deadline_passed(p_event, ('REVEAL_' || k)::public.deadline_code) and app.reveal_subround(p_event, k) then
      v_actions := v_actions || ('revealed crisis ' || k);
    end if;
  end loop;
  return v_actions;
end
$$;
revoke all on function app.primus_tick(uuid) from public, anon, authenticated;

select app.patch_functions(
  '  if v_event.auto_advance then
    select * into v_phase from public.phases where event_id = p_event and code = v_event.current_phase;',
  '  if v_event.format = ''PRIMUS'' then
    v_actions := v_actions || app.primus_tick(p_event);
  end if;

  if v_event.auto_advance then
    select * into v_phase from public.phases where event_id = p_event and code = v_event.current_phase;');

-- Entering PRESSURE reveals crisis 1 as soon as its time has come (the tick does it otherwise); entering SATURATION
-- runs Round 3's start (the Finance injection, in a later migration).
create or replace function app.enter_saturation(p_event uuid)
returns void
language plpgsql
as $$
begin
  null;
end
$$;
revoke all on function app.enter_saturation(uuid) from public, anon, authenticated;

select app.patch_functions(
  '    when ''CRISIS'' then perform app.apply_crisis(p_event);',
  '    when ''CRISIS'' then perform app.apply_crisis(p_event);
    when ''PRESSURE'' then perform app.primus_tick(p_event);
    when ''SATURATION'' then perform app.enter_saturation(p_event);');

-- ───────────────────────────── Submission windows ─────────────────────────────

-- Is sub-round k's work open now (Round 2: from its reveal to its due time, in PRESSURE; Round 3: from the end of
-- the draft to its due time, in SATURATION)?
create or replace function app.subround_open(p_event uuid, p_k int)
returns boolean
language sql stable
as $$
  select e.format = 'PRIMUS'
     and not app.deadline_passed(e.id, ('DUE_' || p_k)::public.deadline_code)
     and case when p_k = 5 then e.current_phase = 'SATURATION' and app.deadline_passed(e.id, 'DRAFT')
              else e.current_phase = 'PRESSURE'
                   and exists (select 1 from public.subrounds s where s.event_id = e.id and s.k = p_k and s.revealed_at is not null) end
    from public.events e where e.id = p_event
$$;

create or replace function app.submission_window(p_team public.teams, p_type public.submission_type, out allowed boolean, out open boolean, out deadline_code public.deadline_code)
language plpgsql stable
as $$
declare
  v_event public.events;
begin
  select * into v_event from public.events where id = p_team.event_id;
  deadline_code := app.submission_deadline(p_type);
  if app.subround_of(p_type) is not null then
    -- The Product team writes its own plan and solution; a firm writes advice (and co-edits a solution) through
    -- save_draft_for / submit_for, for a client that hired it.
    allowed := p_team.track = 'PRODUCT' and app.submission_kind(p_type) in ('CRISIS', 'SOLUTION');
    open := v_event.drawn_at is not null and app.subround_open(v_event.id, app.subround_of(p_type));
    return;
  end if;
  allowed := case p_type when 'PITCH' then p_team.track = 'PRODUCT' when 'MEMO' then p_team.track = 'CONSULTING'
                   else p_team.track in ('PRODUCT', 'CONSULTING') end;
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

-- ───────────────────────────── Release ─────────────────────────────

-- Releasing a PRIMUS type: plans move the price by their tier (Round 3: scaled by rank, in a later migration);
-- advice moves no price (the firm's bonus is paid by the marketplace migration's hook).
create or replace function app.release_primus(p_event uuid, p_type public.submission_type)
returns jsonb
language plpgsql
as $$
declare
  v_event public.events;
  v_k int := app.subround_of(p_type);
  v_movers jsonb;
begin
  select * into v_event from public.events where id = p_event;
  if v_event.current_phase not in ('PRESSURE', 'SATURATION', 'CLOSE') then
    return app.fail('WRONG_PHASE', 'Round 2 and Round 3 scores are released during those rounds.');
  end if;
  if app.submission_kind(p_type) = 'ADVICE' then
    if not app.deadline_passed(p_event, ('RATE_' || v_k)::public.deadline_code) then
      return app.fail('RATINGS_OPEN', 'Advice scores are released once the clients'' ratings have closed.');
    end if;
    update public.scores set status = 'RELEASED', released_at = now(), released_by = auth.uid()
     where event_id = p_event and type = p_type;
    perform app.after_advice_release(p_event, v_k);
    perform app.broadcast(p_event, 'verdicts', jsonb_build_object('type', p_type, 'movers', '[]'::jsonb));
    return app.ok(jsonb_build_object('released', (select count(*) from public.scores where event_id = p_event and type = p_type)));
  end if;
  if (app.open_round(p_event)).id is not null then
    return app.fail('TRADING_OPEN', 'Release scores between rounds, while trading is closed.');
  end if;
  perform set_config('app.price_writer', 'TIER', true);
  insert into public.round_prices (event_id, company_id, kind, subround, market_before, market_after, ai_before, ai_after, tier_bp)
  select p_event, c.id, 'SUB_TIER', v_k, c.market_price, app.apply_tier(c.market_price, t.bp), c.ai_price,
         app.apply_tier(c.ai_price, t.bp), t.bp
    from public.companies c
    join lateral (select app.release_tier_bp(c.id, p_type) as bp) t on true
   where c.event_id = p_event and c.market_price is not null
     and exists (select 1 from public.scores s where s.company_id = c.id and s.type = p_type);
  update public.companies c set market_price = rp.market_after, ai_price = rp.ai_after
    from public.round_prices rp
   where c.event_id = p_event and rp.event_id = p_event and rp.company_id = c.id and rp.kind = 'SUB_TIER' and rp.subround = v_k;
  perform app.recalculate_collateral(p_event);
  update public.scores set status = 'RELEASED', released_at = now(), released_by = auth.uid()
   where event_id = p_event and type = p_type;

  select jsonb_agg(m order by abs((m ->> 'tier_bp')::int) desc, m ->> 'ticker') into v_movers from (
    select jsonb_build_object('company_id', c.id, 'ticker', c.ticker, 'score', s.final_score, 'tier_bp', rp.tier_bp,
                              'price', c.market_price) as m
      from public.scores s join public.companies c on c.id = s.company_id
      left join public.round_prices rp on rp.company_id = c.id and rp.kind = 'SUB_TIER' and rp.subround = v_k
     where s.event_id = p_event and s.type = p_type) x;
  perform app.broadcast(p_event, 'verdicts', jsonb_build_object('type', p_type, 'movers', coalesce(v_movers, '[]'::jsonb)));
  return app.ok(jsonb_build_object('released', jsonb_array_length(coalesce(v_movers, '[]'::jsonb))));
end
$$;
revoke all on function app.release_primus(uuid, public.submission_type) from public, anon, authenticated;

-- The price move a released plan gives its company (Round 3 scales it by rank in a later migration).
create or replace function app.release_tier_bp(p_company uuid, p_type public.submission_type)
returns integer
language sql stable
as $$
  select coalesce((select s.tier_bp from public.scores s where s.company_id = p_company and s.type = p_type), 0)
$$;

-- Paid by the marketplace migration (the firm's reputation bonus); nothing until then.
create or replace function app.after_advice_release(p_event uuid, p_k int)
returns void
language plpgsql
as $$
begin
  null;
end
$$;
revoke all on function app.after_advice_release(uuid, int) from public, anon, authenticated;

select app.patch_functions(
  '  if (app.open_round(p_event)).id is not null then
    return app.fail(''TRADING_OPEN'', ''Release scores between rounds, while trading is closed.'');
  end if;
  if p_type = ''PITCH'' and v_event.current_phase <> ''READING'' then',
  '  if app.subround_of(p_type) is not null then
    return app.release_primus(p_event, p_type);
  end if;
  if (app.open_round(p_event)).id is not null then
    return app.fail(''TRADING_OPEN'', ''Release scores between rounds, while trading is closed.'');
  end if;
  if p_type = ''PITCH'' and v_event.current_phase <> ''READING'' then');

-- ───────────────────────────── Judging context ─────────────────────────────

-- The client's crisis card in sub-round k, as the judge's context.
create or replace function app.subround_card(p_company uuid, p_k int)
returns jsonb
language sql stable
as $$
  select jsonb_build_object('category', k.category, 'title', k.title, 'body', k.body)
    from public.subround_crises x join public.crisis_cards k on k.id = x.crisis_card_id
   where x.company_id = p_company and x.k = p_k
$$;

-- What a PRIMUS submission is judged with: the PRD, the sub-round's crisis card (Round 3: the problem statement,
-- added by a later migration) and, for a plan or solution, the hired firm's advice memo.
create or replace function app.primus_judge_context(p_company uuid, p_type public.submission_type)
returns jsonb
language plpgsql stable
as $$
declare
  v_k int := app.subround_of(p_type);
  v_out jsonb;
begin
  v_out := jsonb_build_object('pitch_text', (app.current_submission(p_company, 'PITCH')).body_text);
  if v_k between 1 and 4 then
    v_out := v_out || jsonb_build_object('crisis_card', app.subround_card(p_company, v_k));
  else
    v_out := v_out || jsonb_build_object('statement', app.company_statement(p_company));
  end if;
  if app.submission_kind(p_type) in ('CRISIS', 'SOLUTION') then
    v_out := v_out || jsonb_build_object('advice_text', (app.current_submission(p_company, app.advice_type(v_k))).body_text);
  end if;
  return v_out;
end
$$;

-- The problem statement a company drafted in Round 3 (a later migration fills it in).
create or replace function app.company_statement(p_company uuid)
returns jsonb
language sql stable
as $$
  select null::jsonb
$$;

select app.patch_functions(
  '  elsif v_run.type = ''FLASH'' then
    v_out := v_out || jsonb_build_object(''bulletin'', (',
  '  elsif app.subround_of(v_run.type) is not null then
    v_out := v_out || app.primus_judge_context(v_company.id, v_run.type);
  elsif v_run.type = ''FLASH'' then
    v_out := v_out || jsonb_build_object(''bulletin'', (');

-- ───────────────────────────── Seeding a PRIMUS event ─────────────────────────────

create or replace function public.seed_event(p jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_e jsonb := p -> 'event';
  v_event uuid;
  v_rehearsal boolean := coalesce((v_e ->> 'is_rehearsal')::boolean, false);
  v_team jsonb;
  v_staff jsonb;
  v_team_id uuid;
  v_n_product int;
  v_n_consulting int;
  v_n_finance int;
  v_start bigint;
  v_txn uuid;
begin
  perform set_config('app.actor', 'seed', true);

  select count(*) filter (where x ->> 'track' = 'PRODUCT'),
         count(*) filter (where x ->> 'track' = 'CONSULTING'),
         count(*) filter (where x ->> 'track' = 'FINANCE')
    into v_n_product, v_n_consulting, v_n_finance
    from jsonb_array_elements(coalesce(p -> 'teams', '[]')) x;

  if not (v_n_product = v_n_consulting and v_n_consulting = v_n_finance) then
    raise exception 'each track needs the same number of teams (got % product, % consulting, % finance)',
      v_n_product, v_n_consulting, v_n_finance;
  end if;
  if v_n_product not between 3 and 50 then
    raise exception 'between 3 and 50 teams per track are needed (got %)', v_n_product;
  end if;
  if not v_rehearsal and v_n_product <> 50 then
    raise exception 'the live event needs exactly 50 teams per track (got %)', v_n_product;
  end if;

  insert into public.events (slug, name, is_rehearsal, clock_speed, timezone, starts_at, seed_commitment, format)
  values (
    v_e ->> 'slug',
    v_e ->> 'name',
    v_rehearsal,
    coalesce((v_e ->> 'clock_speed')::int, 1),
    coalesce(v_e ->> 'timezone', 'Asia/Kolkata'),
    (v_e ->> 'starts_at')::timestamptz,
    nullif(v_e ->> 'seed_commitment', ''),
    coalesce(nullif(v_e ->> 'format', ''), 'CLASSIC')
  )
  returning id into v_event;

  insert into public.phases (event_id, seq, code, starts_at, ends_at)
  select v_event, (x ->> 'seq')::smallint, (x ->> 'code')::public.phase_code,
         (x ->> 'starts_at')::timestamptz, (x ->> 'ends_at')::timestamptz
    from jsonb_array_elements(p -> 'schedule' -> 'phases') x;

  insert into public.rounds (event_id, number, phase, opens_at, closes_at, waits_for)
  select v_event, (x ->> 'number')::smallint, (x ->> 'phase')::public.phase_code,
         (x ->> 'opens_at')::timestamptz, (x ->> 'closes_at')::timestamptz,
         nullif(x ->> 'waits_for', '')::public.submission_type
    from jsonb_array_elements(p -> 'schedule' -> 'rounds') x;

  insert into public.deadlines (event_id, code, at)
  select v_event, (x ->> 'code')::public.deadline_code, (x ->> 'at')::timestamptz
    from jsonb_array_elements(p -> 'schedule' -> 'deadlines') x;

  for v_team in select * from jsonb_array_elements(p -> 'teams') loop
    insert into public.teams (event_id, code, track, name)
    values (v_event, v_team ->> 'code', (v_team ->> 'track')::public.track, v_team ->> 'name')
    returning id into v_team_id;

    insert into public.accounts (user_id, role, team_id, display_name)
    values ((v_team ->> 'user_id')::uuid, 'TEAM', v_team_id, v_team ->> 'code');

    insert into public.members (event_id, team_id, full_name, roll_number)
    select v_event, v_team_id, m ->> 'full_name', nullif(m ->> 'roll_number', '')
      from jsonb_array_elements(coalesce(v_team -> 'members', '[]')) m;

    if v_team ->> 'track' = 'PRODUCT' then
      insert into public.companies (event_id, product_team_id) values (v_event, v_team_id);
    end if;

    v_start := coalesce((p -> 'starting_cash_cents' ->> (v_team ->> 'track'))::bigint, 0);
    if v_start <> 0 then
      v_txn := gen_random_uuid();
      insert into public.ledger_entries (event_id, txn_id, kind, team_id, cash_delta_cents, memo)
      values (v_event, v_txn, 'STARTING_CASH', v_team_id, v_start, 'Starting cash'),
             (v_event, v_txn, 'STARTING_CASH', null, -v_start, 'Starting cash');
      update public.teams set cash_cents = cash_cents + v_start where id = v_team_id;
      update public.events set exchange_cash_cents = exchange_cash_cents - v_start where id = v_event;
    end if;
  end loop;

  -- Staff accounts are global (they also run the rehearsal event).
  for v_staff in select * from jsonb_array_elements(coalesce(p -> 'staff', '[]')) loop
    if (v_staff ->> 'role') not in ('ORGANISER', 'FAIRNESS', 'DISPLAY') then
      raise exception 'staff role must be ORGANISER, FAIRNESS or DISPLAY (got %)', v_staff ->> 'role';
    end if;
    if exists (select 1 from public.accounts a
               where a.user_id = (v_staff ->> 'user_id')::uuid and a.role = 'TEAM') then
      raise exception 'staff account % is already a team login', v_staff ->> 'display_name';
    end if;
    insert into public.accounts (user_id, role, display_name, roll_number)
    values ((v_staff ->> 'user_id')::uuid, (v_staff ->> 'role')::public.account_role,
            v_staff ->> 'display_name', nullif(v_staff ->> 'roll_number', ''))
    on conflict (user_id) do update
      set role = excluded.role, display_name = excluded.display_name, roll_number = excluded.roll_number;
  end loop;

  insert into public.problem_cards (event_id, number, sector, title, body)
  select v_event, (x ->> 'number')::smallint, x ->> 'sector', x ->> 'title', x ->> 'body'
    from jsonb_array_elements(coalesce(p -> 'problem_cards', '[]')) x;

  insert into public.crisis_cards (event_id, category, number, title, body)
  select v_event, x ->> 'category', coalesce((x ->> 'number')::smallint, 1), x ->> 'title', x ->> 'body'
    from jsonb_array_elements(coalesce(p -> 'crisis_cards', '[]')) x;

  return v_event;
end
$$;
revoke all on function public.seed_event(jsonb) from public, anon, authenticated;
grant execute on function public.seed_event(jsonb) to service_role;

revoke all on function app.submission_kind(public.submission_type), app.subround_of(public.submission_type),
  app.plan_type(int), app.advice_type(int), app.submission_deadline(public.submission_type),
  app.company_injection_penalty(uuid, public.submission_type), app.phase_after(uuid, public.phase_code),
  app.subround_open(uuid, int), app.release_tier_bp(uuid, public.submission_type), app.subround_card(uuid, int),
  app.primus_judge_context(uuid, public.submission_type), app.company_statement(uuid)
  from public, anon, authenticated;
