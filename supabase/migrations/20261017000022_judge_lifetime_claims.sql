-- Lifetime claim tokens remain unique when organisers reset retry attempts.
-- Keep retry counts/backoff unchanged and preserve already-running claims on upgrade.

alter table public.judge_runs add column claim_token bigint not null default 0 check (claim_token between 0 and 9007199254740991);

update public.judge_runs set claim_token = attempts;

alter table public.calibration_runs add column claim_token bigint not null default 0 check (claim_token between 0 and 9007199254740991);

update public.calibration_runs set claim_token = attempts;

create or replace function public.claim_judge_runs(p_event uuid, p_limit integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_slot text;
  v_out jsonb;
begin
  if not app.is_system() then
    raise exception 'judge runs are claimed by the judge worker' using errcode = '42501';
  end if;
  select judge_model_slot into v_slot from public.events where id = p_event;
  if v_slot is null then
    raise exception 'no such event';
  end if;
  -- A run whose worker went silent on its fifth attempt is not tried again (an organiser can retry it).
  update public.judge_runs j
     set status = 'FAILED', locked_at = null, finished_at = now(),
         error = left(coalesce(j.error || ' · ', '') || 'no report from the worker (attempt ' || j.attempts || ')', 2000)
   where j.id in (select id from public.judge_runs
                   where event_id = p_event and status = 'RUNNING' and locked_at < now() - interval '3 minutes' and attempts >= 5
                   for update skip locked);
  with c as (
    select id from public.judge_runs
     where event_id = p_event
       and ((status = 'QUEUED' and (not_before is null or not_before <= now()))
            or (status = 'RUNNING' and locked_at < now() - interval '3 minutes' and attempts < 5))
     order by created_at, submission_id, run_no
     limit greatest(least(coalesce(p_limit, 0), 50), 0)
     for update skip locked
  ), u as (
    update public.judge_runs j
       set status = 'RUNNING', attempts = j.attempts + 1, claim_token = j.claim_token + 1, locked_at = now(), not_before = null, slot = v_slot
      from c where j.id = c.id
    returning j.id, j.submission_id, j.company_id, j.type, j.generation, j.run_no, j.attempts, j.claim_token, j.slot, j.created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'run_id', id, 'submission_id', submission_id, 'company_id', company_id, 'type', type, 'generation', generation,
           'run_no', run_no, 'attempts', attempts, 'claim_token', claim_token, 'slot', slot) order by created_at, submission_id, run_no), '[]'::jsonb)
    into v_out from u;
  return v_out;
end
$$;

create or replace function public.claim_calibration_runs(p_event uuid, p_limit integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_slot text;
  v_out jsonb;
begin
  if not app.is_system() then
    raise exception 'calibration runs are claimed by the judge worker' using errcode = '42501';
  end if;
  select judge_model_slot into v_slot from public.events where id = p_event;
  if v_slot is null then
    raise exception 'no such event';
  end if;
  update public.calibration_runs r
     set status = 'FAILED', locked_at = null, finished_at = now(),
         error = left(coalesce(r.error || ' · ', '') || 'no report from the worker (attempt ' || r.attempts || ')', 2000)
   where r.id in (select id from public.calibration_runs
                   where event_id = p_event and status = 'RUNNING' and locked_at < now() - interval '3 minutes' and attempts >= 5
                   for update skip locked);
  with c as (
    select id from public.calibration_runs
     where event_id = p_event
       and ((status = 'QUEUED' and (not_before is null or not_before <= now()))
            or (status = 'RUNNING' and locked_at < now() - interval '3 minutes' and attempts < 5))
     order by created_at, sample_no, run_no
     limit greatest(least(coalesce(p_limit, 0), 50), 0)
     for update skip locked
  ), u as (
    update public.calibration_runs r
       set status = 'RUNNING', attempts = r.attempts + 1, claim_token = r.claim_token + 1, locked_at = now(), not_before = null, slot = v_slot
      from c where r.id = c.id
    returning r.id, r.batch, r.sample_no, r.run_no, r.attempts, r.claim_token, r.slot, r.created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object('run_id', id, 'batch', batch, 'sample_no', sample_no, 'run_no', run_no,
                                               'attempts', attempts, 'claim_token', claim_token, 'slot', slot, 'type', 'PITCH')
                            order by created_at, sample_no, run_no), '[]'::jsonb)
    into v_out from u;
  return v_out;
end
$$;

create or replace function public.finish_judge_run(p_run uuid, p_result jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_run public.judge_runs;
  v_score public.scores;
  v_s jsonb;
  v_status public.judge_run_status;
  v_retry boolean;
  v_out jsonb := '{}'::jsonb;
begin
  if not app.is_system() then
    raise exception 'judge runs are reported by the judge worker' using errcode = '42501';
  end if;
  if jsonb_typeof(p_result) is distinct from 'object' then
    raise exception 'the result is an object';
  end if;
  select * into v_run from public.judge_runs where id = p_run;
  if v_run.id is null then
    raise exception 'no such judge run';
  end if;
  perform app.lock_judging(v_run.submission_id::text);
  select * into v_run from public.judge_runs where id = p_run for no key update;
  if v_run.status <> 'RUNNING' then
    return app.fail('NOT_RUNNING', 'This run has already been reported.', jsonb_build_object('status', v_run.status));
  end if;
  -- The claim it answers ("attempt", as claimed): a worker whose lease ran out, so that the run was claimed again (or
  -- retried by an organiser), no longer holds it.
  if jsonb_typeof(p_result -> 'attempt') is distinct from 'number' then
    return app.fail('STALE', 'A report must name its integer claim attempt.');
  end if;
  if (p_result ->> 'attempt')::numeric <> v_run.claim_token or v_run.claim_token < 1 then
    return app.fail('STALE', 'This run was claimed again since; this report is ignored.', jsonb_build_object('attempts', v_run.attempts));
  end if;

  if p_result -> 'ok' = 'true'::jsonb then
    if not exists (select 1 from public.judge_injection_checks where submission_id = v_run.submission_id)
       and not exists (select 1 from public.injection_logs where submission_id = v_run.submission_id) then
      v_status := 'FAILED';
      p_result := p_result || jsonb_build_object('error', 'The worker did not record the injection check of this submission.');
    elsif not app.judge_output_valid(v_run.type, p_result) then
      v_status := 'FAILED';
      p_result := p_result || jsonb_build_object('error', 'The output does not fit the rubric.');
    else
      v_status := 'DONE';
    end if;
  else
    v_retry := p_result -> 'retryable' = 'true'::jsonb and v_run.attempts < 5;
    v_status := case when v_retry then 'QUEUED' else 'FAILED' end;
  end if;

  update public.judge_runs
     set status = v_status,
         model = coalesce(nullif(p_result ->> 'model', ''), model),
         prompt_sha = coalesce(nullif(p_result ->> 'prompt_sha', ''), prompt_sha),
         request_text = coalesce(left(p_result ->> 'request_text', 200000), request_text),
         raw_response = coalesce(left(p_result ->> 'raw_response', 200000), raw_response),
         breakdown = case when v_status = 'DONE' then p_result -> 'breakdown' end,
         total = case when v_status = 'DONE' then (p_result ->> 'total')::smallint end,
         rationale = case when v_status = 'DONE' then p_result ->> 'rationale' end,
         error = case when v_status = 'DONE' then null else left(coalesce(nullif(p_result ->> 'error', ''), 'Unknown error.'), 2000) end,
         latency_ms = case when jsonb_typeof(p_result -> 'latency_ms') = 'number'
                           then least(greatest((p_result ->> 'latency_ms')::numeric, 0), 2147483647)::int else latency_ms end,
         not_before = case when v_status = 'QUEUED' then now() + app.judge_backoff(v_run.attempts,
                             case when jsonb_typeof(p_result -> 'retry_after_ms') = 'number' then (p_result ->> 'retry_after_ms')::numeric end) end,
         locked_at = null,
         finished_at = case when v_status = 'QUEUED' then null else now() end
   where id = p_run;
  v_out := jsonb_build_object('status', v_status);

  -- The latest generation of the current submission decides the score.
  if v_status = 'DONE'
     and v_run.generation = (select max(generation) from public.judge_runs where submission_id = v_run.submission_id)
     and (app.current_submission(v_run.company_id, v_run.type)).id = v_run.submission_id then
    v_s := app.score_from_runs(v_run.company_id, v_run.type, v_run.submission_id, v_run.generation);
    if v_s ->> 'state' = 'NEEDS_EXTRA' then
      insert into public.judge_runs (event_id, submission_id, company_id, type, generation, run_no)
      select v_run.event_id, v_run.submission_id, v_run.company_id, v_run.type, v_run.generation, n from generate_series(4, 5) n
      on conflict (submission_id, generation, run_no) do nothing;
      v_out := v_out || jsonb_build_object('extra_runs', true);
    elsif v_s ->> 'state' = 'COMPLETE' then
      select * into v_score from public.scores where company_id = v_run.company_id and type = v_run.type for no key update;
      if v_score.status = 'RELEASED' then
        update public.appeals set status = 'READY', new_score = v_s, ready_at = now()
         where company_id = v_run.company_id and type = v_run.type and generation = v_run.generation and status = 'JUDGING';
        if found then
          v_out := v_out || jsonb_build_object('appeal_ready', true);
          perform app.broadcast_staff(v_run.event_id, 'judge');
        end if;
      elsif app.scoring_closed(v_run.event_id, v_run.type) then
        perform app.seal_from(v_run.event_id, v_run.company_id, v_run.type, v_s);
        update public.appeals set status = 'APPLIED', new_score = v_s, ready_at = now(), decided_at = now()
         where company_id = v_run.company_id and type = v_run.type and generation = v_run.generation and status = 'JUDGING';
        v_out := v_out || jsonb_build_object('sealed', jsonb_build_object(
          'final', (v_s ->> 'final')::int, 'median', (v_s ->> 'median')::int, 'runs', (v_s ->> 'runs')::int));
        perform app.broadcast_staff(v_run.event_id, 'judge');
      end if;
    end if;
  elsif v_status = 'FAILED' then
    perform app.broadcast_staff(v_run.event_id, 'judge');
  end if;
  return app.ok(v_out);
end
$$;

create or replace function public.finish_calibration_run(p_run uuid, p_result jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_run public.calibration_runs;
  v_status public.judge_run_status;
  v_totals int[];
  v_nos int[];
  v_out jsonb;
begin
  if not app.is_system() then
    raise exception 'calibration runs are reported by the judge worker' using errcode = '42501';
  end if;
  if jsonb_typeof(p_result) is distinct from 'object' then
    raise exception 'the result is an object';
  end if;
  select * into v_run from public.calibration_runs where id = p_run;
  if v_run.id is null then
    raise exception 'no such calibration run';
  end if;
  perform app.lock_judging('calibration:' || v_run.event_id || ':' || v_run.batch || ':' || v_run.sample_no);
  select * into v_run from public.calibration_runs where id = p_run for no key update;
  if v_run.status <> 'RUNNING' then
    return app.fail('NOT_RUNNING', 'This run has already been reported.', jsonb_build_object('status', v_run.status));
  end if;
  if jsonb_typeof(p_result -> 'attempt') is distinct from 'number' then
    return app.fail('STALE', 'A report must name its integer claim attempt.');
  end if;
  if (p_result ->> 'attempt')::numeric <> v_run.claim_token or v_run.claim_token < 1 then
    return app.fail('STALE', 'This run was claimed again since; this report is ignored.', jsonb_build_object('attempts', v_run.attempts));
  end if;
  if p_result -> 'ok' = 'true'::jsonb then
    v_status := case when app.judge_output_valid('PITCH', p_result) then 'DONE' else 'FAILED' end;
    if v_status = 'FAILED' then
      p_result := p_result || jsonb_build_object('error', 'The output does not fit the rubric.');
    end if;
  else
    v_status := case when p_result -> 'retryable' = 'true'::jsonb and v_run.attempts < 5 then 'QUEUED' else 'FAILED' end;
  end if;
  update public.calibration_runs
     set status = v_status,
         model = coalesce(nullif(p_result ->> 'model', ''), model),
         prompt_sha = coalesce(nullif(p_result ->> 'prompt_sha', ''), prompt_sha),
         request_text = coalesce(left(p_result ->> 'request_text', 200000), request_text),
         raw_response = coalesce(left(p_result ->> 'raw_response', 200000), raw_response),
         breakdown = case when v_status = 'DONE' then p_result -> 'breakdown' end,
         total = case when v_status = 'DONE' then (p_result ->> 'total')::smallint end,
         rationale = case when v_status = 'DONE' then p_result ->> 'rationale' end,
         error = case when v_status = 'DONE' then null else left(coalesce(nullif(p_result ->> 'error', ''), 'Unknown error.'), 2000) end,
         latency_ms = case when jsonb_typeof(p_result -> 'latency_ms') = 'number'
                           then least(greatest((p_result ->> 'latency_ms')::numeric, 0), 2147483647)::int else latency_ms end,
         not_before = case when v_status = 'QUEUED' then now() + app.judge_backoff(v_run.attempts,
                             case when jsonb_typeof(p_result -> 'retry_after_ms') = 'number' then (p_result ->> 'retry_after_ms')::numeric end) end,
         locked_at = null,
         finished_at = case when v_status = 'QUEUED' then null else now() end
   where id = p_run;
  v_out := jsonb_build_object('status', v_status);
  if v_status = 'DONE' then
    select array_agg(run_no::int order by run_no), array_agg(total::int order by run_no) into v_nos, v_totals
      from public.calibration_runs
     where event_id = v_run.event_id and batch = v_run.batch and sample_no = v_run.sample_no and status = 'DONE';
    if v_nos = array[1, 2, 3] and app.needs_extra_runs(v_totals) then
      insert into public.calibration_runs (event_id, batch, sample_no, run_no)
      select v_run.event_id, v_run.batch, v_run.sample_no, r from generate_series(4, 5) r
      on conflict (event_id, batch, sample_no, run_no) do nothing;
      v_out := v_out || jsonb_build_object('extra_runs', true);
    end if;
  end if;
  if v_status <> 'QUEUED' then
    perform app.broadcast_staff(v_run.event_id, 'calibration');
  end if;
  return app.ok(v_out);
end
$$;
