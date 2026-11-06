-- The verifiable lottery (21:15 and 23:45), sealing and revealing the judges' scores, and every price event outside
-- clearing: the starting prices (23:30), the crisis (23:45), the score reveal (02:45) and the close (04:30).

-- ───────────────────────────── Lottery ─────────────────────────────

create or replace function public.set_seed_commitment(p_event uuid, p_commitment text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.require_organiser();
  if lower(btrim(coalesce(p_commitment, ''))) !~ '^[0-9a-f]{64}$' then
    raise exception 'the commitment must be a SHA-256 hex digest (64 hex characters)';
  end if;
  -- Published the day before: once the event has started it is fixed, so the check on stage proves the draw was not
  -- chosen on the night.
  update public.events set seed_commitment = lower(btrim(p_commitment))
   where id = p_event and drawn_at is null and current_phase = 'SETUP';
  if not found then
    raise exception 'the seed commitment is fixed once the event has started';
  end if;
  return app.ok();
end
$$;

-- 21:15: checks the seed against the published commitment and deals one problem card per team. The seed is kept
-- (staff only) until 23:45, when the same seed and dice give the crisis cards and the rescue circle and the seed is
-- published.
create or replace function public.run_lottery(p_event uuid, p_seed text, p_dice text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_root text;
  n int;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.current_phase not in ('BRIEFING', 'BUILD') then
    raise exception 'the lottery is drawn at the start of Round 1 (BRIEFING or BUILD)';
  end if;
  if v_event.drawn_at is not null then
    raise exception 'the lottery has already been drawn';
  end if;
  if v_event.seed_commitment is null then
    raise exception 'no seed commitment was published';
  end if;
  if btrim(coalesce(p_dice, '')) !~ '^[0-9]{1,6}$' then
    raise exception 'the dice roll must be a number';
  end if;
  -- A short or guessable seed could be found from its published hash, revealing the crisis draw early.
  if coalesce(p_seed, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'the seed must be 64 lower-case hex characters (32 random bytes: pnpm new-seed)';
  end if;
  if app.sha256_hex(p_seed) <> v_event.seed_commitment then
    return app.fail('COMMITMENT_MISMATCH', 'SHA-256 of that seed does not match the published commitment.');
  end if;
  if not exists (select 1 from public.crisis_cards where event_id = p_event) then
    raise exception 'the crisis deck is empty: add the crisis cards before the draw';
  end if;

  v_root := app.sha256_hex(p_seed || btrim(p_dice));
  -- Cards are identified by their number (as text), in number order: the published record uses the same keys.
  update public.companies c set problem_card_id = pc.id
    from app.lottery_problems(v_root,
                              array(select code from public.teams where event_id = p_event),
                              array(select number::text from public.problem_cards where event_id = p_event order by number)) d
    join public.teams t on t.event_id = p_event and t.code = d.team
    join public.problem_cards pc on pc.event_id = p_event and pc.number = d.card::int
   where c.founder_team_id = t.id;
  get diagnostics n = row_count;

  insert into public.event_secrets (event_id, seed, entered_by) values (p_event, p_seed, auth.uid())
  on conflict (event_id) do update set seed = excluded.seed, entered_at = now(), entered_by = excluded.entered_by;
  update public.events set dice = btrim(p_dice), drawn_at = now() where id = p_event;

  perform app.broadcast(p_event, 'problem_draw', jsonb_build_object(
    'commitment', v_event.seed_commitment, 'dice', btrim(p_dice), 'verified', true, 'teams', n));
  return app.ok(jsonb_build_object('teams', n));
end
$$;

-- The published lottery record (the engine's LotteryRecord), available once the seed is revealed at 23:45.
create or replace function public.lottery_record(p_event uuid)
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
  if v_event.seed_revealed is null then
    return app.fail('NOT_YET', 'The lottery record is published after the crisis (23:45).');
  end if;
  return app.ok(jsonb_build_object('record', jsonb_build_object(
    'seed', v_event.seed_revealed,
    'dice', v_event.dice,
    'commitment', v_event.seed_commitment,
    'teams', (select jsonb_agg(code order by code) from public.teams where event_id = p_event),
    'problemCards', (select jsonb_agg(number::text order by number) from public.problem_cards where event_id = p_event),
    'crisisCards', (select jsonb_agg(number::text order by number) from public.crisis_cards where event_id = p_event),
    'draws', (select jsonb_agg(jsonb_build_object('team', t.code, 'problem', pc.number::text, 'crisis', cc.number::text,
                                                  'rescues', ft.code) order by t.code)
                from public.teams t
                join public.companies own on own.founder_team_id = t.id
                left join public.problem_cards pc on pc.id = own.problem_card_id
                left join public.crisis_cards cc on cc.id = own.crisis_card_id
                left join public.companies res on res.rescuer_team_id = t.id
                left join public.teams ft on ft.id = res.founder_team_id
               where t.event_id = p_event))));
end
$$;

-- ───────────────────────────── Scores ─────────────────────────────

-- Lines removed from a team's submission of one type (0 when none, or not checked yet).
create or replace function app.injection_hits(p_team uuid, p_type public.submission_type)
returns integer
language sql stable
as $$
  select coalesce((select k.hits from public.submissions s join public.judge_injection_checks k on k.submission_id = s.id
                    where s.team_id = p_team and s.type = p_type), 0)
$$;

-- Seals a company's score from the judge's three stored readings of its submission (latest generation): the median,
-- the injection penalty (the team's second removed line, once) and the final score. The published breakdown and
-- reason are the first reading whose total is the median. Called by the judge worker (service role) only: nobody can
-- type in a score.
create or replace function public.seal_score(p_company uuid, p_type public.submission_type)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_score public.scores;
  v_gen smallint;
  v_runs public.judge_runs[];
  v_totals int[];
  v_median int;
  v_rep public.judge_runs;
  v_final jsonb;
  v_penalty int;
  v_run public.judge_runs;
begin
  if not app.is_system() then
    raise exception 'scores are sealed by the judge worker' using errcode = '42501';
  end if;
  select * into v_score from public.scores where company_id = p_company and type = p_type for no key update;
  if v_score.id is null then
    return app.fail('NO_SUBMISSION', 'Nothing is locked for this company yet.');
  end if;
  if v_score.missing then
    return app.fail('NO_SUBMISSION', 'This company had no saved submission at the lock; it scores 0.');
  end if;
  if v_score.status = 'REVEALED' then
    return app.fail('ALREADY_REVEALED', 'This score has been revealed; a change goes through an appeal.');
  end if;
  if not exists (select 1 from public.judge_injection_checks where submission_id = v_score.submission_id) then
    return app.fail('NOT_CHECKED', 'The submission has not been checked for lines aimed at the judge.');
  end if;

  select max(generation) into v_gen from public.judge_runs where submission_id = v_score.submission_id;
  select array_agg(j order by j.run_no) into v_runs
    from public.judge_runs j where j.submission_id = v_score.submission_id and j.generation = v_gen and j.status = 'DONE';
  v_totals := array(select r.total::int from unnest(coalesce(v_runs, '{}')) r order by r.run_no);
  if array(select r.run_no::int from unnest(coalesce(v_runs, '{}')) r order by r.run_no) is distinct from array[1, 2, 3] then
    return app.fail('RUNS_INCOMPLETE', 'The judge needs three readings.', jsonb_build_object('runs', cardinality(v_totals)));
  end if;
  foreach v_run in array v_runs loop
    if not app.judge_run_valid(p_type, v_run.breakdown, v_run.total, v_run.rationale) then
      raise exception 'judge reading % of company % does not fit the rubric', v_run.run_no, p_company;
    end if;
  end loop;

  v_median := app.median_score(v_totals);
  select r.* into v_rep from unnest(v_runs) r where r.total = v_median order by r.run_no limit 1;
  v_penalty := app.injection_penalty(p_type, app.injection_hits(v_score.team_id, 'PRD'), app.injection_hits(v_score.team_id, 'SOLUTION'));
  v_final := app.final_score(v_median, v_penalty);
  perform set_config('app.score_writer', 'SEAL', true);
  update public.scores
     set generation = v_gen, status = 'SEALED', run_totals = v_totals::smallint[], median = v_median, penalty = v_penalty,
         final_score = (v_final ->> 'final')::int, breakdown = v_rep.breakdown, rationale = v_rep.rationale, updated_at = now()
   where id = v_score.id;
  perform set_config('app.score_writer', '', true);
  perform app.broadcast(v_score.event_id, 'score_sealed', jsonb_build_object('type', p_type), true);
  return app.ok(jsonb_build_object('final', (v_final ->> 'final')::int, 'median', v_median, 'penalty', v_penalty));
end
$$;

-- Every company of the event has a sealed (or revealed) score of this type.
create or replace function app.all_sealed(p_event uuid, p_type public.submission_type)
returns boolean
language sql stable
as $$
  select not exists (
    select 1 from public.companies c
     where c.event_id = p_event and (p_type = 'PRD' or c.rescuer_team_id is not null)
       and not exists (select 1 from public.scores s where s.company_id = c.id and s.type = p_type
                          and s.status in ('SEALED', 'REVEALED')))
$$;

-- ───────────────────────────── 23:30 starting prices ─────────────────────────────

-- Reveals every PRD score at once and sets each company's starting price = $10.00 + $0.10 × (score − 50); the market
-- price and the score-based price start there too. Idempotent.
create or replace function app.reveal_prd(p_event uuid)
returns void
language plpgsql
as $$
begin
  perform 1 from public.events where id = p_event and prices_started_at is null for no key update;
  if not found then
    return;
  end if;
  if not app.all_sealed(p_event, 'PRD') then
    raise exception 'every PRD score must be sealed before the starting prices';
  end if;
  perform set_config('app.price_writer', 'START', true);
  update public.companies c
     set start_price = app.start_price(s.final_score), market_price = app.start_price(s.final_score),
         score_price = app.start_price(s.final_score)
    from public.scores s
   where s.company_id = c.id and s.type = 'PRD' and c.event_id = p_event;
  insert into public.round_prices (event_id, company_id, kind, market_after, score_after)
  select p_event, c.id, 'START', c.start_price, c.score_price from public.companies c where c.event_id = p_event;
  perform set_config('app.price_writer', '', true);
  perform set_config('app.score_writer', 'REVEAL', true);
  update public.scores set status = 'REVEALED', revealed_at = now() where event_id = p_event and type = 'PRD';
  perform set_config('app.score_writer', '', true);
  update public.events set prices_started_at = now() where id = p_event;
  perform app.broadcast(p_event, 'prices_started', jsonb_build_object(
    'top', (select jsonb_agg(x) from (
              select jsonb_build_object('company_id', c.id, 'name', c.name, 'ticker', c.ticker, 'score', s.final_score) as x
                from public.scores s join public.companies c on c.id = s.company_id
               where s.event_id = p_event and s.type = 'PRD'
               order by s.final_score desc, c.ticker limit 5) t)));
end
$$;

-- ───────────────────────────── 23:45 the crisis ─────────────────────────────

-- From the seed and dice entered at 21:15: one crisis card per company (each type to the same number of companies)
-- and the rescue circle. Every price × 0.85 (market and score-based). The seed is published. Idempotent.
create or replace function app.apply_crisis(p_event uuid)
returns void
language plpgsql
as $$
declare
  v_event public.events;
  v_seed text;
  v_root text;
  v_teams text[];
begin
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.crisis_applied_at is not null then
    return;
  end if;
  if v_event.prices_started_at is null then
    raise exception 'the crisis comes after the starting prices';
  end if;
  select seed into v_seed from public.event_secrets where event_id = p_event;
  if v_seed is null or v_event.dice is null then
    raise exception 'the crisis draw needs the lottery seed and dice';
  end if;
  v_root := app.sha256_hex(v_seed || v_event.dice);
  v_teams := array(select code from public.teams where event_id = p_event);

  update public.companies c set crisis_card_id = cc.id
    from app.lottery_crises(v_root, v_teams,
           (select jsonb_agg(jsonb_build_object('id', number::text, 'number', number)) from public.crisis_cards where event_id = p_event)) d
    join public.teams t on t.event_id = p_event and t.code = d.team
    join public.crisis_cards cc on cc.event_id = p_event and cc.number = d.card::int
   where c.founder_team_id = t.id;
  update public.companies c set rescuer_team_id = r.id
    from app.lottery_circle(v_root, v_teams) d
    join public.teams r on r.event_id = p_event and r.code = d.rescuer
    join public.teams f on f.event_id = p_event and f.code = d.founder
   where c.founder_team_id = f.id;

  perform set_config('app.price_writer', 'CRISIS', true);
  insert into public.round_prices (event_id, company_id, kind, market_before, market_after, score_before, score_after)
  select p_event, c.id, 'CRISIS', c.market_price, app.crisis_shock(c.market_price), c.score_price, app.crisis_shock(c.score_price)
    from public.companies c where c.event_id = p_event;
  update public.companies c set market_price = rp.market_after, score_price = rp.score_after, post_crisis_price = rp.market_after
    from public.round_prices rp
   where c.event_id = p_event and rp.event_id = p_event and rp.company_id = c.id and rp.kind = 'CRISIS';
  perform set_config('app.price_writer', '', true);

  update public.events set crisis_applied_at = now(), seed_revealed = v_seed where id = p_event;
  delete from public.event_secrets where event_id = p_event;
  insert into public.bulletins (event_id, kind, title, body, published_at)
  values (p_event, 'CRISIS', 'Crisis: every company is hit',
          'Each company has received its crisis card and every share price fell 15%. Each team now rescues another '
          || 'team''s company: see your rescue card. The Q&A board is open until 00:15.', now());
  perform app.broadcast(p_event, 'crisis', jsonb_build_object('seed', v_seed, 'dice', v_event.dice));
end
$$;

-- ───────────────────────────── 02:15 solutions published, 02:45 the reveal ─────────────────────────────

create or replace function app.publish_solutions(p_event uuid)
returns void
language plpgsql
as $$
begin
  update public.events set solutions_published_at = now() where id = p_event and solutions_published_at is null;
  if found then
    perform app.broadcast(p_event, 'solutions_published');
  end if;
end
$$;

-- Reveals every crisis-solution score at once: each company's market price and score-based price × (1 + 0.5% ×
-- (score − 50)). Round 2 must have cleared first. Idempotent.
create or replace function app.reveal_solutions(p_event uuid)
returns void
language plpgsql
as $$
begin
  perform 1 from public.events where id = p_event and scores_revealed_at is null for no key update;
  if not found then
    return;
  end if;
  if not app.all_sealed(p_event, 'SOLUTION') then
    raise exception 'every crisis-solution score must be sealed before the reveal';
  end if;
  if exists (select 1 from public.rounds where event_id = p_event and number <= 2 and status <> 'CLEARED') then
    raise exception 'rounds 1 and 2 clear before the score reveal';
  end if;
  perform set_config('app.price_writer', 'REVEAL', true);
  insert into public.round_prices (event_id, company_id, kind, market_before, market_after, score_before, score_after, factor_bp)
  select p_event, c.id, 'REVEAL', c.market_price, app.apply_reveal(c.market_price, s.final_score),
         c.score_price, app.apply_reveal(c.score_price, s.final_score), app.reveal_factor_bp(s.final_score)
    from public.companies c join public.scores s on s.company_id = c.id and s.type = 'SOLUTION'
   where c.event_id = p_event;
  update public.companies c set market_price = rp.market_after, score_price = rp.score_after
    from public.round_prices rp
   where c.event_id = p_event and rp.event_id = p_event and rp.company_id = c.id and rp.kind = 'REVEAL';
  perform set_config('app.price_writer', '', true);
  perform set_config('app.score_writer', 'REVEAL', true);
  update public.scores set status = 'REVEALED', revealed_at = now() where event_id = p_event and type = 'SOLUTION';
  perform set_config('app.score_writer', '', true);
  update public.events set scores_revealed_at = now() where id = p_event;
  perform app.broadcast(p_event, 'scores_revealed', jsonb_build_object(
    'movers', (select jsonb_agg(x) from (
                 select jsonb_build_object('company_id', rp.company_id, 'ticker', c.ticker, 'factor_bp', rp.factor_bp,
                                           'before', rp.market_before, 'after', rp.market_after) as x
                   from public.round_prices rp join public.companies c on c.id = rp.company_id
                  where rp.event_id = p_event and rp.kind = 'REVEAL'
                  order by abs(rp.factor_bp - 10000) desc, c.ticker limit 10) t)));
end
$$;

-- ───────────────────────────── 04:30 the close ─────────────────────────────

-- Market price at the close = average of the round 8 and round 9 clearing prices; closing price = ½ market +
-- ½ score-based. Idempotent.
create or replace function app.close_market(p_event uuid)
returns void
language plpgsql
as $$
begin
  perform 1 from public.events where id = p_event and market_closed_at is null for no key update;
  if not found then
    return;
  end if;
  if exists (select 1 from public.rounds where event_id = p_event and status <> 'CLEARED') then
    raise exception 'every round must be cleared before the close';
  end if;
  perform set_config('app.price_writer', 'CLOSE', true);
  with px as (
    select c.id,
           app.avg_half_up((select rp.market_after from public.round_prices rp join public.rounds r on r.id = rp.round_id
                             where rp.company_id = c.id and rp.kind = 'CLEARING' and r.number = 8),
                           (select rp.market_after from public.round_prices rp join public.rounds r on r.id = rp.round_id
                             where rp.company_id = c.id and rp.kind = 'CLEARING' and r.number = 9)) as market
      from public.companies c where c.event_id = p_event
  )
  update public.companies c set closing_market_price = px.market, closing_price = app.closing_price(px.market, c.score_price)
    from px where px.id = c.id;
  insert into public.round_prices (event_id, company_id, kind, market_before, market_after, score_before, score_after)
  select p_event, c.id, 'CLOSE', c.closing_market_price, c.closing_price, c.score_price, c.score_price
    from public.companies c where c.event_id = p_event;
  perform set_config('app.price_writer', '', true);
  update public.events set market_closed_at = now() where id = p_event;
  perform app.broadcast(p_event, 'closing_bell');
end
$$;
