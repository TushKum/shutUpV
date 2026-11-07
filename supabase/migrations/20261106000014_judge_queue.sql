-- Phase 6 (the AI judge): the queue the judge worker works through, re-runs and appeals, and calibration.
--
-- The locks (23:00, 01:45) already queue three readings per submission (app.lock_submissions). Workers (the control
-- panel's "Run the judge here", or `pnpm judge-worker` on a laptop, both as the service role) claim readings, build the
-- request from judge_input, call the round's model and report each reading. When a generation's three readings are
-- done, the score is sealed (public.seal_score): the median, the injection penalty, the final score. Nobody types in a
-- score: a human-panel fallback goes through the same three readings (finish_judge_run with the panel's marks).
--
-- Re-runs (technical errors only, with a written reason): before the reveal one organiser queues a new generation and
-- the new median replaces the old score. After the reveal the new score waits as an appeal until a second organiser
-- approves it; applying it re-applies the score's own price effect (see app.apply_appeal_prices) and is logged.

-- ───────────────────────────── Claiming ─────────────────────────────

-- How long a claimed reading may run before another worker may claim it again.
create or replace function app.judge_lease()
returns interval
language sql immutable
as $$
  select interval '3 minutes'
$$;

-- Up to p_limit readings: queued and due, or running with an expired lease. Each is marked RUNNING with a new claim
-- token (a late report for an earlier claim is then ignored) and the model slot of its round. The scores of the
-- submissions claimed move from PENDING to SCORING.
create or replace function public.claim_judge_runs(p_event uuid, p_limit integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if not app.is_system() then
    raise exception 'readings are claimed by the judge worker' using errcode = '42501';
  end if;
  with picked as (
    select j.id
      from public.judge_runs j
     where j.event_id = p_event
       and ((j.status = 'QUEUED' and (j.not_before is null or j.not_before <= now()))
            or (j.status = 'RUNNING' and j.locked_at < now() - app.judge_lease()))
     order by j.type, j.generation, j.created_at, j.run_no
     limit greatest(1, least(coalesce(p_limit, 1), 50))
     for update of j skip locked
  ), claimed as (
    update public.judge_runs j
       set status = 'RUNNING', attempts = j.attempts + 1, claim_token = j.claim_token + 1, locked_at = now(),
           slot = case j.type when 'PRD' then e.prd_model_slot else e.solution_model_slot end
      from picked, public.events e
     where j.id = picked.id and e.id = j.event_id
    returning j.id, j.submission_id, j.company_id, j.type, j.generation, j.run_no, j.attempts, j.claim_token, j.slot
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'run_id', c.id, 'submission_id', c.submission_id, 'company_id', c.company_id, 'type', c.type,
           'generation', c.generation, 'run_no', c.run_no, 'attempts', c.attempts, 'claim_token', c.claim_token,
           'slot', c.slot) order by c.type, c.run_no), '[]'::jsonb)
    into v_rows from claimed c;

  perform set_config('app.score_writer', 'CLAIM', true);
  update public.scores s set status = 'SCORING', updated_at = now()
   where s.event_id = p_event and s.status = 'PENDING'
     and exists (select 1 from jsonb_array_elements(v_rows) r where (r ->> 'submission_id')::uuid = s.submission_id);
  perform set_config('app.score_writer', '', true);
  return v_rows;
end
$$;

-- ───────────────────────────── What one reading needs ─────────────────────────────

-- Everything the worker needs to build one reading's request. Names to hide (each becomes the ticker): the company's
-- name, the author team's name and its members' names; for a crisis solution also the founding team (whose PRD is in
-- the context) and the rescuing team's own company. Context: a PRD is read with its problem card and the twist; a
-- crisis solution with the rescued company's PRD and its crisis card.
create or replace function public.judge_input(p_run uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_run public.judge_runs;
  v_sub public.submissions;
  v_co public.companies;
  v_teams uuid[];
  v_names text[];
  v_members text[];
  v_context jsonb;
begin
  if not app.is_system() then
    raise exception 'the judge input is for the judge worker' using errcode = '42501';
  end if;
  select * into v_run from public.judge_runs where id = p_run;
  if v_run.id is null then
    raise exception 'no such reading';
  end if;
  select * into v_sub from public.submissions where id = v_run.submission_id;
  select * into v_co from public.companies where id = v_run.company_id;

  v_teams := array_remove(array[v_sub.team_id, v_co.founder_team_id, v_co.rescuer_team_id], null);
  select array_agg(distinct x) into v_names from (
    select v_co.name as x
    union all select t.name from public.teams t where t.id = any(v_teams)
    union all select t.code from public.teams t where t.id = any(v_teams)
    union all select m.full_name from public.members m where m.team_id = any(v_teams)
    union all select oc.name from public.companies oc where oc.founder_team_id = any(v_teams)
    union all select oc.ticker from public.companies oc where oc.founder_team_id = any(v_teams) and oc.id <> v_co.id
  ) n where x is not null and length(btrim(x)) > 0;
  select array_agg(distinct m.full_name) into v_members from public.members m where m.team_id = any(v_teams);

  if v_run.type = 'PRD' then
    v_context := jsonb_build_object(
      'problem_card', (select jsonb_build_object('sector', p.sector, 'title', p.title, 'body', p.body)
                         from public.problem_cards p where p.id = v_co.problem_card_id),
      'twist', (select jsonb_build_object('title', b.title, 'body', b.body)
                  from public.bulletins b where b.event_id = v_run.event_id and b.kind = 'TWIST' and b.published_at is not null));
  else
    v_context := jsonb_build_object(
      'prd_text', (select s.body_text from public.submissions s where s.company_id = v_co.id and s.type = 'PRD'),
      'crisis_card', (select jsonb_build_object('category', c.category, 'title', c.title, 'body', c.body)
                        from public.crisis_cards c where c.id = v_co.crisis_card_id));
  end if;

  return jsonb_build_object(
    'run_id', v_run.id, 'type', v_run.type, 'ticker', v_co.ticker, 'company_name', v_co.name,
    'names', coalesce(to_jsonb(v_names), '[]'::jsonb), 'member_names', coalesce(to_jsonb(v_members), '[]'::jsonb),
    'submission_id', v_sub.id, 'submission_text', v_sub.body_text,
    'context', v_context,
    'injections_recorded', exists (select 1 from public.judge_injection_checks k where k.submission_id = v_sub.id));
end
$$;

-- Lines removed from a submission because they spoke to the judge, recorded once per submission (also with none):
-- a reading is not accepted for a submission that was never checked. The second removed line of a team costs 10
-- points when the score is sealed (app.injection_penalty).
create or replace function public.record_injections(p_submission uuid, p_hits jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_sub public.submissions;
  n int;
begin
  if not app.is_system() then
    raise exception 'injections are recorded by the judge worker' using errcode = '42501';
  end if;
  select * into v_sub from public.submissions where id = p_submission for no key update;
  if v_sub.id is null then
    raise exception 'no such submission';
  end if;
  if exists (select 1 from public.judge_injection_checks where submission_id = p_submission) then
    return app.ok(jsonb_build_object('already', true));
  end if;
  if jsonb_typeof(coalesce(p_hits, '[]'::jsonb)) <> 'array' then
    raise exception 'hits must be an array';
  end if;
  insert into public.injection_logs (event_id, submission_id, team_id, company_id, type, line, pattern)
  select v_sub.event_id, v_sub.id, v_sub.team_id, v_sub.company_id, v_sub.type, left(h ->> 'line', 2000), left(h ->> 'pattern', 200)
    from jsonb_array_elements(coalesce(p_hits, '[]'::jsonb)) h
   where coalesce(h ->> 'line', '') <> '';
  get diagnostics n = row_count;
  insert into public.judge_injection_checks (submission_id, event_id, hits) values (p_submission, v_sub.event_id, n);
  return app.ok(jsonb_build_object('hits', n));
end
$$;

-- ───────────────────────────── Reporting a reading ─────────────────────────────

-- What the three readings of a generation would give: the median, the team's injection penalty and the final score,
-- with the breakdown and reason of the first reading whose total is the median. The same rule as public.seal_score;
-- used for a re-judged score that waits as an appeal. Null until the three readings are done.
create or replace function app.score_from_runs(p_submission uuid, p_generation smallint)
returns jsonb
language plpgsql stable
as $$
declare
  v_sub public.submissions;
  v_totals int[];
  v_median int;
  v_rep public.judge_runs;
  v_penalty int;
begin
  select * into v_sub from public.submissions where id = p_submission;
  select array_agg(j.total::int order by j.run_no) into v_totals
    from public.judge_runs j where j.submission_id = p_submission and j.generation = p_generation and j.status = 'DONE';
  if coalesce(cardinality(v_totals), 0) <> 3 then
    return null;
  end if;
  v_median := app.median_score(v_totals);
  select * into v_rep from public.judge_runs j
   where j.submission_id = p_submission and j.generation = p_generation and j.status = 'DONE' and j.total = v_median
   order by j.run_no limit 1;
  v_penalty := app.injection_penalty(v_sub.type, app.injection_hits(v_sub.team_id, 'PRD'), app.injection_hits(v_sub.team_id, 'SOLUTION'));
  return jsonb_build_object('generation', p_generation, 'run_totals', to_jsonb(v_totals), 'median', v_median, 'penalty', v_penalty,
                            'final', (app.final_score(v_median, v_penalty) ->> 'final')::int,
                            'breakdown', v_rep.breakdown, 'rationale', v_rep.rationale);
end
$$;

-- A worker reports one reading. `p_result.attempt` must be the reading's current claim token, and the reading must
-- still be RUNNING; otherwise the report is ignored (STALE, NOT_RUNNING). A valid answer is stored; when the
-- generation's three readings are done the score is sealed, or, for a re-judged score after its reveal, the appeal is
-- ready for a second organiser. A failure goes back to the queue with a backoff while it is retryable and has had
-- fewer than 5 attempts; otherwise the reading FAILS (an organiser can retry failed readings, say after switching to
-- the backup model).
create or replace function public.finish_judge_run(p_run uuid, p_result jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_run public.judge_runs;
  v_ok boolean := coalesce((p_result ->> 'ok')::boolean, false);
  v_score public.scores;
  v_new jsonb;
  v_seal jsonb;
  v_appeal public.appeals;
  v_wait int;
begin
  if not app.is_system() then
    raise exception 'readings are reported by the judge worker' using errcode = '42501';
  end if;
  select * into v_run from public.judge_runs where id = p_run for no key update;
  if v_run.id is null then
    raise exception 'no such reading';
  end if;
  if v_run.status <> 'RUNNING' then
    return app.fail('NOT_RUNNING', 'This reading is not in flight.');
  end if;
  if jsonb_typeof(p_result -> 'attempt') is distinct from 'number' or (p_result ->> 'attempt')::bigint <> v_run.claim_token then
    return app.fail('STALE', 'This reading has been claimed again since.');
  end if;

  if v_ok then
    if not exists (select 1 from public.judge_injection_checks where submission_id = v_run.submission_id) then
      v_ok := false;
      p_result := p_result || jsonb_build_object('error', 'The submission was not checked for lines aimed at the judge.', 'retryable', false);
    elsif not app.judge_run_valid(v_run.type, p_result -> 'breakdown', (p_result ->> 'total')::int, p_result ->> 'rationale') then
      v_ok := false;
      p_result := p_result || jsonb_build_object('error', 'The answer does not fit the rubric.', 'retryable', false);
    end if;
  end if;

  if v_ok then
    update public.judge_runs
       set status = 'DONE', model = p_result ->> 'model', prompt_sha = p_result ->> 'prompt_sha',
           request_text = p_result ->> 'request_text', raw_response = p_result ->> 'raw_response',
           breakdown = p_result -> 'breakdown', total = (p_result ->> 'total')::smallint, rationale = p_result ->> 'rationale',
           error = null, latency_ms = (p_result ->> 'latency_ms')::int, finished_at = now(), locked_at = null
     where id = p_run;
  else
    v_wait := coalesce((p_result ->> 'retry_after_ms')::int, (5000 * power(2, greatest(v_run.attempts - 1, 0)))::int);
    update public.judge_runs
       set status = case when coalesce((p_result ->> 'retryable')::boolean, false) and v_run.attempts < 5 then 'QUEUED' else 'FAILED' end::public.judge_run_status,
           not_before = now() + make_interval(secs => least(greatest(v_wait, 0), 120000) / 1000.0),
           model = coalesce(p_result ->> 'model', model), prompt_sha = coalesce(p_result ->> 'prompt_sha', prompt_sha),
           request_text = coalesce(p_result ->> 'request_text', request_text), raw_response = p_result ->> 'raw_response',
           error = left(coalesce(p_result ->> 'error', 'unknown error'), 2000), latency_ms = (p_result ->> 'latency_ms')::int,
           locked_at = null
     where id = p_run
    returning * into v_run;
    return app.ok(jsonb_build_object('status', v_run.status));
  end if;

  -- The generation is complete: seal, or prepare the appeal.
  select * into v_score from public.scores where company_id = v_run.company_id and type = v_run.type;
  v_new := app.score_from_runs(v_run.submission_id, v_run.generation);
  if v_new is null then
    return app.ok(jsonb_build_object('status', 'DONE'));
  end if;
  select * into v_appeal from public.appeals
   where company_id = v_run.company_id and type = v_run.type and generation = v_run.generation and status = 'JUDGING';
  if v_score.status = 'REVEALED' then
    update public.appeals set status = 'READY', new_score = v_new, ready_at = now() where id = v_appeal.id;
    perform app.broadcast(v_run.event_id, 'appeal_ready', jsonb_build_object('appeal', v_appeal.id), true);
    return app.ok(jsonb_build_object('status', 'DONE', 'appeal_ready', v_appeal.id));
  end if;
  v_seal := public.seal_score(v_run.company_id, v_run.type);
  if v_appeal.id is not null then
    update public.appeals set status = 'APPLIED', new_score = v_new, ready_at = now(), decided_at = now(),
                              effects = jsonb_build_object('before_reveal', true)
     where id = v_appeal.id;
  end if;
  return app.ok(jsonb_build_object('status', 'DONE', 'sealed', v_seal));
end
$$;

-- ───────────────────────────── Organiser controls ─────────────────────────────

-- Failed readings of a round back to the queue (for example after switching the round to its backup model).
create or replace function public.retry_failed_runs(p_event uuid, p_type public.submission_type)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  perform app.require_organiser();
  update public.judge_runs set status = 'QUEUED', attempts = 0, not_before = null, error = null, locked_at = null
   where event_id = p_event and type = p_type and status = 'FAILED';
  get diagnostics n = row_count;
  perform app.broadcast(p_event, 'judging_queued', jsonb_build_object('type', p_type, 'retried', n), true);
  return app.ok(jsonb_build_object('retried', n));
end
$$;

-- A technical re-run of one company's judging (an appeal), with a written reason: three new readings (a new
-- generation). Before the reveal the score goes back to SCORING and the new score replaces it when sealed. After the
-- reveal the score stays as it is until a second organiser applies the re-judged one (public.apply_appeal). Not while
-- the current readings are still in flight, not for a company that had nothing saved at the lock, and not from the
-- awards on.
create or replace function public.rerun_judging(p_company uuid, p_type public.submission_type, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_score public.scores;
  v_event public.events;
  v_gen smallint;
  v_appeal uuid;
begin
  perform app.require_organiser();
  select * into v_score from public.scores where company_id = p_company and type = p_type for no key update;
  if v_score.id is null then
    return app.fail('NO_SUBMISSION', 'Nothing is locked for this company yet.');
  end if;
  select * into v_event from public.events where id = v_score.event_id;
  if v_event.current_phase >= 'AWARDS' then
    return app.fail('TOO_LATE', 'The results have been announced.');
  end if;
  if v_score.missing or v_score.submission_id is null then
    return app.fail('NO_SUBMISSION', 'This company had no saved submission at the lock; there is nothing to re-judge.');
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    return app.fail('NO_REASON', 'Write the reason for the re-run (at least 5 characters).');
  end if;
  if exists (select 1 from public.appeals where company_id = p_company and type = p_type and status in ('JUDGING', 'READY')) then
    return app.fail('OPEN_APPEAL', 'This company already has a re-run in progress.');
  end if;
  if exists (select 1 from public.judge_runs where submission_id = v_score.submission_id and status in ('QUEUED', 'RUNNING')) then
    return app.fail('STILL_JUDGING', 'The current readings are still being judged.');
  end if;

  select coalesce(max(generation), 0) + 1 into v_gen from public.judge_runs where submission_id = v_score.submission_id;
  insert into public.judge_runs (event_id, submission_id, company_id, type, generation, run_no)
  select v_score.event_id, v_score.submission_id, p_company, p_type, v_gen, n from generate_series(1, 3) n;
  insert into public.appeals (event_id, company_id, type, submission_id, generation, after_reveal, reason, requested_by, old_score)
  values (v_score.event_id, p_company, p_type, v_score.submission_id, v_gen, v_score.status = 'REVEALED', btrim(p_reason), auth.uid(),
          jsonb_build_object('final', v_score.final_score, 'median', v_score.median, 'penalty', v_score.penalty,
                             'run_totals', to_jsonb(v_score.run_totals), 'generation', v_score.generation))
  returning id into v_appeal;
  if v_score.status <> 'REVEALED' then
    perform set_config('app.score_writer', 'RERUN', true);
    update public.scores set status = 'SCORING', updated_at = now() where id = v_score.id;
    perform set_config('app.score_writer', '', true);
  end if;
  perform app.broadcast(v_score.event_id, 'judging_queued', jsonb_build_object('type', p_type, 'appeal', v_appeal), true);
  return app.ok(jsonb_build_object('appeal', v_appeal, 'generation', v_gen, 'after_reveal', v_score.status = 'REVEALED'));
end
$$;

-- The score's own price effect, re-applied for a changed score after its reveal. A PRD sets the starting price
-- ($10.00 + $0.10 × (score − 50)); a crisis solution sets the 02:45 reveal factor (1 + 0.5% × (score − 50)). The
-- market price moves now by new effect ÷ old effect (rounded half-up); the history of prices is not rewritten. The
-- score-based price is worked out again from the scores (start × 0.85 × reveal factor, by the stage of the night),
-- and after the close the closing price follows (½ market at the close × the same ratio + ½ score-based).
create or replace function app.apply_appeal_prices(p_company uuid, p_type public.submission_type, p_old integer, p_new integer)
returns jsonb
language plpgsql
as $$
declare
  v_co public.companies;
  v_event public.events;
  v_num bigint;
  v_den bigint;
  v_prd int;
  v_sol int;
  v_start bigint;
  v_score_price bigint;
  v_market bigint;
  v_close_market bigint;
  v_old public.companies;
begin
  select * into v_co from public.companies where id = p_company for no key update;
  v_old := v_co;
  select * into v_event from public.events where id = v_co.event_id;
  if p_type = 'PRD' then
    v_num := app.start_price(p_new);
    v_den := app.start_price(p_old);
  else
    v_num := app.reveal_factor_bp(p_new);
    v_den := app.reveal_factor_bp(p_old);
  end if;
  select final_score into v_prd from public.scores where company_id = p_company and type = 'PRD';
  select final_score into v_sol from public.scores where company_id = p_company and type = 'SOLUTION' and status = 'REVEALED';
  v_start := app.start_price(coalesce(v_prd, 0));
  v_score_price := case when v_event.crisis_applied_at is null then v_start
                        else app.score_price(v_start, case when v_event.scores_revealed_at is null then null else coalesce(v_sol, 0) end) end;
  v_market := greatest(1, app.mul_rate(v_co.market_price, v_num, v_den));
  v_close_market := case when v_co.closing_market_price is null then null else greatest(1, app.mul_rate(v_co.closing_market_price, v_num, v_den)) end;

  perform set_config('app.price_writer', 'APPEAL', true);
  update public.companies
     set market_price = v_market, score_price = v_score_price, closing_market_price = v_close_market,
         closing_price = case when v_close_market is null then closing_price else app.closing_price(v_close_market, v_score_price) end
   where id = p_company
  returning * into v_co;
  insert into public.round_prices (event_id, company_id, kind, market_before, market_after, score_before, score_after, factor_bp)
  values (v_co.event_id, p_company, 'APPEAL', v_old.market_price, v_market, v_old.score_price, v_score_price,
          app.div_round_half_up(v_num * 10000, v_den));
  perform set_config('app.price_writer', '', true);
  return jsonb_build_object('market_before', v_old.market_price, 'market_price', v_market, 'score_before', v_old.score_price,
                            'score_price', v_score_price, 'closing_price', v_co.closing_price,
                            'ratio_bp', app.div_round_half_up(v_num * 10000, v_den));
end
$$;

-- A second organiser applies a re-judged score after its reveal: the score, the price effect, and (after
-- settlement) the results, ranks and awards. Logged in the audit trail with both organisers.
create or replace function public.apply_appeal(p_appeal uuid, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_a public.appeals;
  v_score public.scores;
  v_event public.events;
  v_new jsonb;
  v_effects jsonb := '{}'::jsonb;
begin
  perform app.require_organiser();
  select * into v_a from public.appeals where id = p_appeal for no key update;
  if v_a.id is null then
    raise exception 'no such appeal';
  end if;
  if v_a.status <> 'READY' then
    return app.fail('NOT_READY', 'This appeal is not waiting for approval.');
  end if;
  if v_a.requested_by = auth.uid() then
    return app.fail('SAME_ORGANISER', 'A second organiser must approve the change.');
  end if;
  select * into v_event from public.events where id = v_a.event_id;
  if v_event.current_phase >= 'AWARDS' then
    return app.fail('TOO_LATE', 'The results have been announced.');
  end if;
  select * into v_score from public.scores where company_id = v_a.company_id and type = v_a.type for no key update;
  v_new := v_a.new_score;

  if (v_new ->> 'final')::int is distinct from v_score.final_score then
    -- The new score first, so the score-based price is worked out from it.
    perform set_config('app.score_writer', 'APPEAL', true);
    update public.scores set final_score = (v_new ->> 'final')::smallint where id = v_score.id;
    perform set_config('app.score_writer', '', true);
    v_effects := app.apply_appeal_prices(v_a.company_id, v_a.type, v_score.final_score, (v_new ->> 'final')::int);
  end if;
  perform set_config('app.score_writer', 'APPEAL', true);
  update public.scores
     set generation = (v_new ->> 'generation')::smallint,
         run_totals = array(select jsonb_array_elements_text(v_new -> 'run_totals')::smallint),
         median = (v_new ->> 'median')::smallint, penalty = (v_new ->> 'penalty')::smallint,
         final_score = (v_new ->> 'final')::smallint, breakdown = v_new -> 'breakdown', rationale = v_new ->> 'rationale',
         updated_at = now()
   where id = v_score.id;
  perform set_config('app.score_writer', '', true);
  if v_event.settled_at is not null then
    perform app.compute_results(v_a.event_id);
    perform app.compute_rankings(v_a.event_id);
    v_effects := v_effects || jsonb_build_object('results', true);
  end if;
  update public.appeals set status = 'APPLIED', decided_by = auth.uid(), decided_at = now(), note = nullif(btrim(coalesce(p_note, '')), ''), effects = v_effects
   where id = p_appeal;
  perform app.broadcast(v_a.event_id, 'appeal_applied', jsonb_build_object('company_id', v_a.company_id, 'type', v_a.type));
  return app.ok(jsonb_build_object('final', (v_new ->> 'final')::int, 'effects', v_effects));
end
$$;

-- An organiser closes a re-judged score after its reveal without applying it (the old score stands), with a note.
create or replace function public.dismiss_appeal(p_appeal uuid, p_note text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_a public.appeals;
begin
  perform app.require_organiser();
  select * into v_a from public.appeals where id = p_appeal for no key update;
  if v_a.id is null then
    raise exception 'no such appeal';
  end if;
  if v_a.status <> 'READY' then
    return app.fail('NOT_READY', 'Only a re-judged score waiting for approval can be dismissed.');
  end if;
  if length(btrim(coalesce(p_note, ''))) < 5 then
    return app.fail('NO_REASON', 'Write why the re-judged score is not applied (at least 5 characters).');
  end if;
  update public.appeals set status = 'DISMISSED', decided_by = auth.uid(), decided_at = now(), note = btrim(p_note) where id = p_appeal;
  perform app.broadcast(v_a.event_id, 'appeal_dismissed', jsonb_build_object('appeal', p_appeal), true);
  return app.ok();
end
$$;

-- ───────────────────────────── Calibration ─────────────────────────────

-- A new batch of sample PRDs and crisis solutions with the range each should score in (organiser). At most 40.
-- Each sample: {type, title, expected_min, expected_max, company_name, ticker, context_text, body_text}.
create or replace function public.upload_calibration_samples(p_event uuid, p_samples jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_batch smallint;
  n int;
begin
  perform app.require_organiser();
  if jsonb_typeof(p_samples) <> 'array' or jsonb_array_length(p_samples) not between 1 and 40 then
    return app.fail('BAD_SAMPLES', 'Upload between 1 and 40 samples.');
  end if;
  if exists (select 1 from jsonb_array_elements(p_samples) s
              where s ->> 'type' not in ('PRD', 'SOLUTION') or coalesce(btrim(s ->> 'body_text'), '') = ''
                 or coalesce(btrim(s ->> 'title'), '') = '' or coalesce(btrim(s ->> 'ticker'), '') = ''
                 or (s ->> 'expected_min')::int not between 0 and 100 or (s ->> 'expected_max')::int not between 0 and 100
                 or (s ->> 'expected_min')::int > (s ->> 'expected_max')::int) then
    return app.fail('BAD_SAMPLES', 'Every sample needs a type (PRD or SOLUTION), a title, a ticker, a text and an expected range within 0–100.');
  end if;
  select coalesce(max(batch), 0) + 1 into v_batch from public.calibration_samples where event_id = p_event;
  insert into public.calibration_samples (event_id, batch, sample_no, type, title, expected_min, expected_max, company_name, ticker, context_text, body_text, created_by)
  select p_event, v_batch, o.n, (s ->> 'type')::public.submission_type, btrim(s ->> 'title'), (s ->> 'expected_min')::int,
         (s ->> 'expected_max')::int, coalesce(nullif(btrim(s ->> 'company_name'), ''), btrim(s ->> 'ticker')), upper(btrim(s ->> 'ticker')),
         coalesce(s ->> 'context_text', ''), s ->> 'body_text', auth.uid()
    from jsonb_array_elements(p_samples) with ordinality as o(s, n);
  get diagnostics n = row_count;
  return app.ok(jsonb_build_object('batch', v_batch, 'samples', n));
end
$$;

-- Three readings of every sample of a batch (the latest by default), with each round's current model slot.
create or replace function public.start_calibration(p_event uuid, p_batch smallint default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_batch smallint;
  n int;
begin
  perform app.require_organiser();
  v_batch := coalesce(p_batch, (select max(batch) from public.calibration_samples where event_id = p_event));
  if v_batch is null then
    return app.fail('NO_SAMPLES', 'Upload the calibration samples first.');
  end if;
  if exists (select 1 from public.calibration_runs where event_id = p_event and batch = v_batch) then
    return app.fail('ALREADY_STARTED', 'This batch has been judged already; upload a new batch to judge again.');
  end if;
  insert into public.calibration_runs (event_id, batch, sample_no, run_no)
  select p_event, v_batch, s.sample_no, r from public.calibration_samples s cross join generate_series(1, 3) r
   where s.event_id = p_event and s.batch = v_batch;
  get diagnostics n = row_count;
  perform app.broadcast(p_event, 'judging_queued', jsonb_build_object('calibration', v_batch), true);
  return app.ok(jsonb_build_object('batch', v_batch, 'queued', n));
end
$$;

create or replace function public.claim_calibration_runs(p_event uuid, p_limit integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if not app.is_system() then
    raise exception 'readings are claimed by the judge worker' using errcode = '42501';
  end if;
  with picked as (
    select r.id from public.calibration_runs r
     where r.event_id = p_event
       and ((r.status = 'QUEUED' and (r.not_before is null or r.not_before <= now()))
            or (r.status = 'RUNNING' and r.locked_at < now() - app.judge_lease()))
     order by r.batch, r.sample_no, r.run_no
     limit greatest(1, least(coalesce(p_limit, 1), 50))
     for update of r skip locked
  ), claimed as (
    update public.calibration_runs r
       set status = 'RUNNING', attempts = r.attempts + 1, claim_token = r.claim_token + 1, locked_at = now(),
           slot = case s.type when 'PRD' then e.prd_model_slot else e.solution_model_slot end
      from picked, public.events e, public.calibration_samples s
     where r.id = picked.id and e.id = r.event_id and s.event_id = r.event_id and s.batch = r.batch and s.sample_no = r.sample_no
    returning r.id, r.batch, r.sample_no, r.run_no, r.attempts, r.claim_token, r.slot, s.type
  )
  select coalesce(jsonb_agg(jsonb_build_object('run_id', c.id, 'batch', c.batch, 'sample_no', c.sample_no, 'run_no', c.run_no,
                                              'attempts', c.attempts, 'claim_token', c.claim_token, 'slot', c.slot, 'type', c.type)
                           order by c.sample_no, c.run_no), '[]'::jsonb)
    into v_rows from claimed c;
  return v_rows;
end
$$;

create or replace function public.calibration_input(p_run uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_r public.calibration_runs;
  v_s public.calibration_samples;
begin
  if not app.is_system() then
    raise exception 'the calibration input is for the judge worker' using errcode = '42501';
  end if;
  select * into v_r from public.calibration_runs where id = p_run;
  if v_r.id is null then
    raise exception 'no such calibration reading';
  end if;
  select * into v_s from public.calibration_samples where event_id = v_r.event_id and batch = v_r.batch and sample_no = v_r.sample_no;
  return jsonb_build_object('run_id', v_r.id, 'batch', v_r.batch, 'sample_no', v_r.sample_no, 'run_no', v_r.run_no,
                            'type', v_s.type, 'title', v_s.title, 'ticker', v_s.ticker, 'company_name', v_s.company_name,
                            'names', jsonb_build_array(v_s.company_name), 'context_text', v_s.context_text, 'text', v_s.body_text);
end
$$;

create or replace function public.finish_calibration_run(p_run uuid, p_result jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_r public.calibration_runs;
  v_type public.submission_type;
  v_ok boolean := coalesce((p_result ->> 'ok')::boolean, false);
  v_wait int;
begin
  if not app.is_system() then
    raise exception 'readings are reported by the judge worker' using errcode = '42501';
  end if;
  select * into v_r from public.calibration_runs where id = p_run for no key update;
  if v_r.id is null then
    raise exception 'no such calibration reading';
  end if;
  if v_r.status <> 'RUNNING' then
    return app.fail('NOT_RUNNING', 'This reading is not in flight.');
  end if;
  if jsonb_typeof(p_result -> 'attempt') is distinct from 'number' or (p_result ->> 'attempt')::bigint <> v_r.claim_token then
    return app.fail('STALE', 'This reading has been claimed again since.');
  end if;
  select type into v_type from public.calibration_samples where event_id = v_r.event_id and batch = v_r.batch and sample_no = v_r.sample_no;
  if v_ok and not app.judge_run_valid(v_type, p_result -> 'breakdown', (p_result ->> 'total')::int, p_result ->> 'rationale') then
    v_ok := false;
    p_result := p_result || jsonb_build_object('error', 'The answer does not fit the rubric.', 'retryable', false);
  end if;
  if v_ok then
    update public.calibration_runs
       set status = 'DONE', model = p_result ->> 'model', prompt_sha = p_result ->> 'prompt_sha', request_text = p_result ->> 'request_text',
           raw_response = p_result ->> 'raw_response', breakdown = p_result -> 'breakdown', total = (p_result ->> 'total')::smallint,
           rationale = p_result ->> 'rationale', error = null, latency_ms = (p_result ->> 'latency_ms')::int, finished_at = now(), locked_at = null
     where id = p_run
    returning * into v_r;
  else
    v_wait := coalesce((p_result ->> 'retry_after_ms')::int, (5000 * power(2, greatest(v_r.attempts - 1, 0)))::int);
    update public.calibration_runs
       set status = case when coalesce((p_result ->> 'retryable')::boolean, false) and v_r.attempts < 5 then 'QUEUED' else 'FAILED' end::public.judge_run_status,
           not_before = now() + make_interval(secs => least(greatest(v_wait, 0), 120000) / 1000.0),
           model = coalesce(p_result ->> 'model', model), error = left(coalesce(p_result ->> 'error', 'unknown error'), 2000),
           raw_response = p_result ->> 'raw_response', latency_ms = (p_result ->> 'latency_ms')::int, locked_at = null
     where id = p_run
    returning * into v_r;
  end if;
  return app.ok(jsonb_build_object('status', v_r.status));
end
$$;

-- ───────────────────────────── Grants ─────────────────────────────

do $$
declare f text;
begin
  foreach f in array array[
    'public.claim_judge_runs(uuid, integer)', 'public.judge_input(uuid)', 'public.record_injections(uuid, jsonb)',
    'public.finish_judge_run(uuid, jsonb)', 'public.claim_calibration_runs(uuid, integer)', 'public.calibration_input(uuid)',
    'public.finish_calibration_run(uuid, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.retry_failed_runs(uuid, public.submission_type)', 'public.rerun_judging(uuid, public.submission_type, text)',
    'public.apply_appeal(uuid, text)', 'public.dismiss_appeal(uuid, text)',
    'public.upload_calibration_samples(uuid, jsonb)', 'public.start_calibration(uuid, smallint)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
revoke all on function app.score_from_runs(uuid, smallint) from public, anon, authenticated;
revoke all on function app.apply_appeal_prices(uuid, public.submission_type, integer, integer) from public, anon, authenticated;
revoke all on function app.judge_lease() from public, anon, authenticated;
