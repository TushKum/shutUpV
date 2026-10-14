-- The AI judge (Phase 6): the run queue that judge workers drain, sealing as soon as a submission's runs are complete,
-- the backup-model switch, retries, technical re-runs and appeals (PLAN decision 19), and calibration runs.
-- docs/JUDGE.md is the contract with the worker (apps/web/lib/judge).

-- ───────────────────────────── Queue ─────────────────────────────

alter table public.judge_runs
  add column not_before timestamptz,                                     -- sent back to the queue: not claimed before
  add column slot text check (slot in ('PRIMARY', 'BACKUP'));            -- the model slot of its last claim

-- One row per submission once a worker has stripped and logged its lines aimed at the judge (also when there were
-- none), so they are logged once however many runs of it are in flight.
create table public.judge_injection_checks (
  submission_id uuid primary key references public.submissions (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  hits integer not null check (hits >= 0),
  checked_at timestamptz not null default now()
);

-- A technical re-run of one company's submission: a new generation of runs 1–3. Before release the new score is
-- sealed as soon as its runs are done (APPLIED). After release (PLAN and FLASH) it is an appeal: the new score waits
-- (READY) until an organiser applies or dismisses it.
create table public.appeals (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  type public.submission_type not null,
  submission_id uuid not null references public.submissions (id) on delete cascade,
  generation smallint not null,
  after_release boolean not null,
  reason text not null check (length(reason) between 5 and 1000),
  status text not null default 'JUDGING' check (status in ('JUDGING', 'READY', 'APPLIED', 'DISMISSED')),
  requested_by uuid,
  requested_at timestamptz not null default now(),
  old_score jsonb,
  new_score jsonb,
  ready_at timestamptz,
  decided_by uuid,
  decided_at timestamptz,
  note text,
  effects jsonb,
  check (not after_release or type <> 'PITCH')
);
create unique index appeals_open_uq on public.appeals (company_id, type) where status in ('JUDGING', 'READY');
create index appeals_event_idx on public.appeals (event_id, requested_at desc);

-- Calibration (before the event): the sample pitches of prompts/calibration/pitches.json, judged like real pitches
-- (3 runs, 5 when they spread more than 10) but never sealed. Each start is a new batch.
create table public.calibration_samples (
  event_id uuid not null references public.events (id) on delete cascade,
  batch smallint not null check (batch > 0),
  sample_no smallint not null check (sample_no between 1 and 20),
  title text not null,
  expected_min smallint not null check (expected_min between 0 and 100),
  expected_max smallint not null check (expected_max between 0 and 100),
  company_name text not null,
  ticker text not null,
  body_text text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (event_id, batch, sample_no),
  check (expected_min <= expected_max)
);

create table public.calibration_runs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  batch smallint not null,
  sample_no smallint not null,
  run_no smallint not null check (run_no between 1 and 5),
  status public.judge_run_status not null default 'QUEUED',
  attempts smallint not null default 0,
  locked_at timestamptz,
  not_before timestamptz,
  slot text check (slot in ('PRIMARY', 'BACKUP')),
  model text,
  prompt_sha text,
  request_text text,
  raw_response text,
  breakdown jsonb,
  total smallint check (total between 0 and 100),
  rationale text,
  error text,
  latency_ms integer,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (event_id, batch, sample_no, run_no),
  foreign key (event_id, batch, sample_no) references public.calibration_samples (event_id, batch, sample_no) on delete cascade
);
create index calibration_runs_status_idx on public.calibration_runs (event_id, status);

-- Staff read everything here; nothing is written except through the functions below.
grant select on public.judge_injection_checks, public.appeals, public.calibration_samples, public.calibration_runs to authenticated;
alter table public.judge_injection_checks enable row level security;
alter table public.appeals enable row level security;
alter table public.calibration_samples enable row level security;
alter table public.calibration_runs enable row level security;
create policy judge_injection_checks_read on public.judge_injection_checks for select to authenticated using ((select app.is_staff()));
create policy appeals_read on public.appeals for select to authenticated using ((select app.is_staff()));
create policy calibration_samples_read on public.calibration_samples for select to authenticated using ((select app.is_staff()));
create policy calibration_runs_read on public.calibration_runs for select to authenticated using ((select app.is_staff()));
create trigger audit after insert or update or delete on public.appeals for each row execute function app.audit_row();

-- ───────────────────────────── Shared rules ─────────────────────────────

-- How long a run sent back to the queue waits: what the API asked for (1 s to 2 min), else 5 s × 2^attempts, at most
-- 2 minutes.
create or replace function app.judge_backoff(p_attempts integer, p_retry_after_ms numeric)
returns interval
language sql immutable
as $$
  select make_interval(secs => case
    when p_retry_after_ms > 0 then least(greatest(p_retry_after_ms, 1000), 120000) / 1000.0
    else least(5 * power(2, greatest(coalesce(p_attempts, 0), 0)), 120) end)
$$;

-- Runs of one submission (or one calibration sample) are reported one at a time, so the report that completes a
-- generation always sees the others.
create or replace function app.lock_judging(p_key text)
returns void
language sql
as $$
  select pg_advisory_xact_lock(hashtextextended('judge:' || p_key, 0))
$$;

-- What a worker's result says, checked: {"valid": bool, "total": int} for an ok result. The worker validates too
-- (and asks the model again); this is the database's own check before a run counts.
create or replace function app.judge_output_valid(p_type public.submission_type, p_result jsonb)
returns boolean
language plpgsql immutable
as $$
declare
  v_total numeric;
begin
  if jsonb_typeof(p_result -> 'total') is distinct from 'number' or jsonb_typeof(p_result -> 'rationale') is distinct from 'string'
     or jsonb_typeof(p_result -> 'model') is distinct from 'string' or btrim(p_result ->> 'model') = '' then
    return false;
  end if;
  v_total := (p_result ->> 'total')::numeric;
  return v_total = trunc(v_total) and v_total between 0 and 100
     and app.judge_run_valid(p_type, p_result -> 'breakdown', v_total::int, p_result ->> 'rationale');
end
$$;

-- The score that a generation of runs gives, by the rule of the brief: 3 runs, or 5 when the first 3 spread more
-- than 10 points; the median; the plan cap when the deal was not signed by 03:00; the injection penalty; the tier.
-- {"state": "INCOMPLETE" | "NEEDS_EXTRA" | "COMPLETE", "runs", and when COMPLETE: "submission_id", "generation",
-- "run_totals", "median", "penalty", "capped", "final", "tier_bp", "breakdown", "rationale"}. The published breakdown
-- and rationale are those of the first run whose total is the median.
create or replace function app.score_from_runs(p_company uuid, p_type public.submission_type, p_sub uuid, p_gen smallint)
returns jsonb
language plpgsql stable
as $$
declare
  v_runs public.judge_runs[];
  v_nos int[];
  v_totals int[];
  v_run public.judge_runs;
  v_rep public.judge_runs;
  v_median int;
  v_penalty int;
  v_final jsonb;
begin
  select array_agg(j order by j.run_no) into v_runs
    from public.judge_runs j where j.submission_id = p_sub and j.generation = p_gen and j.status = 'DONE';
  v_runs := coalesce(v_runs, '{}');
  v_nos := array(select r.run_no::int from unnest(v_runs) r order by r.run_no);
  v_totals := array(select r.total::int from unnest(v_runs) r order by r.run_no);
  if v_nos = array[1, 2, 3] and app.needs_extra_runs(v_totals) then
    return jsonb_build_object('state', 'NEEDS_EXTRA', 'runs', 3);
  end if;
  if v_nos not in (array[1, 2, 3], array[1, 2, 3, 4, 5]) then
    return jsonb_build_object('state', 'INCOMPLETE', 'runs', cardinality(v_nos));
  end if;
  foreach v_run in array v_runs loop
    if not app.judge_run_valid(p_type, v_run.breakdown, v_run.total, v_run.rationale) then
      raise exception 'judge run % of company % does not fit the rubric', v_run.run_no, p_company;
    end if;
  end loop;
  v_median := app.median_score(v_totals);
  select r.* into v_rep from unnest(v_runs) r where r.total = v_median order by r.run_no limit 1;
  v_penalty := app.injection_penalty(p_type, app.offended(p_company, 'PITCH'), app.offended(p_company, 'PLAN'), app.offended(p_company, 'FLASH'));
  v_final := app.final_score(p_type, v_median, app.deal_signed_in_time(p_company), v_penalty);
  return jsonb_build_object(
    'state', 'COMPLETE', 'runs', cardinality(v_totals), 'submission_id', p_sub, 'generation', p_gen,
    'run_totals', to_jsonb(v_totals), 'median', v_median, 'penalty', v_penalty, 'capped', (v_final ->> 'capped')::boolean,
    'final', (v_final ->> 'final')::int, 'tier_bp', app.tier_bp(p_type, (v_final ->> 'final')::int),
    'breakdown', v_rep.breakdown, 'rationale', v_rep.rationale);
end
$$;

-- Writes a complete score (from app.score_from_runs) as SEALED.
create or replace function app.seal_from(p_event uuid, p_company uuid, p_type public.submission_type, p_s jsonb)
returns void
language sql
as $$
  insert into public.scores (event_id, company_id, type, submission_id, generation, status, run_totals, median, missing, late,
                             capped, penalty, final_score, tier_bp, breakdown, rationale, updated_at)
  values (p_event, p_company, p_type, (p_s ->> 'submission_id')::uuid, (p_s ->> 'generation')::smallint, 'SEALED',
          array(select x::smallint from jsonb_array_elements_text(p_s -> 'run_totals') x), (p_s ->> 'median')::smallint, false, false,
          (p_s ->> 'capped')::boolean, (p_s ->> 'penalty')::smallint, (p_s ->> 'final')::smallint, (p_s ->> 'tier_bp')::int,
          p_s -> 'breakdown', p_s ->> 'rationale', now())
  on conflict (company_id, type) do update
    set submission_id = excluded.submission_id, generation = excluded.generation, status = 'SEALED',
        run_totals = excluded.run_totals, median = excluded.median, missing = false, late = false, capped = excluded.capped,
        penalty = excluded.penalty, final_score = excluded.final_score, tier_bp = excluded.tier_bp,
        breakdown = excluded.breakdown, rationale = excluded.rationale, updated_at = now()
$$;

-- seal_score keeps its contract (Phase 2), now through the shared rule.
create or replace function public.seal_score(p_company uuid, p_type public.submission_type)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_company public.companies;
  v_sub public.submissions;
  v_existing public.scores;
  v_gen smallint;
  v_s jsonb;
begin
  if not app.is_system() then
    raise exception 'scores are sealed by the judge worker' using errcode = '42501';
  end if;
  select * into v_company from public.companies where id = p_company and squad_id is not null for no key update;
  if v_company.id is null then
    raise exception 'no such company';
  end if;
  if not app.scoring_closed(v_company.event_id, p_type) then
    return app.fail('NOT_READY', format('%s scores are sealed after the %s deadline.', p_type,
                                        case when p_type = 'PLAN' then 'plan and deal' else lower(p_type::text) end));
  end if;
  v_sub := app.current_submission(p_company, p_type);
  if v_sub.id is null then
    return app.fail('NO_SUBMISSION', 'This company has no on-time submission; seal_missing_scores gives it 0.');
  end if;
  select * into v_existing from public.scores where company_id = p_company and type = p_type for no key update;
  if v_existing.status = 'RELEASED' then
    return app.fail('ALREADY_RELEASED', 'This score has been released.');
  end if;
  select max(generation) into v_gen from public.judge_runs where submission_id = v_sub.id;
  v_s := app.score_from_runs(p_company, p_type, v_sub.id, v_gen);
  if v_s ->> 'state' <> 'COMPLETE' then
    return app.fail('RUNS_INCOMPLETE', 'The judge needs 3 runs within 10 points, or 5 runs.',
                    jsonb_build_object('runs', (v_s ->> 'runs')::int));
  end if;
  perform app.seal_from(v_company.event_id, p_company, p_type, v_s);
  return app.ok(jsonb_build_object('final', (v_s ->> 'final')::int, 'median', (v_s ->> 'median')::int,
                                   'penalty', (v_s ->> 'penalty')::int, 'capped', (v_s ->> 'capped')::boolean,
                                   'runs', (v_s ->> 'runs')::int));
end
$$;

-- ───────────────────────────── Starting and steering ─────────────────────────────

-- After a type's deadline: runs 1–3 for every company's current submission that has no runs yet.
create or replace function public.start_judging(p_event uuid, p_type public.submission_type)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_queued int;
  v_companies int;
begin
  perform app.require_organiser();
  perform 1 from public.events where id = p_event for no key update;
  if not found then
    raise exception 'no such event';
  end if;
  if not app.scoring_closed(p_event, p_type) then
    return app.fail('NOT_READY', format('%s judging starts after the %s deadline.', initcap(p_type::text),
                                        case when p_type = 'PLAN' then 'plan and deal' else lower(p_type::text) end));
  end if;
  if app.score_released(p_event, p_type) then
    return app.fail('ALREADY_RELEASED', 'These scores have already been released.');
  end if;
  with subs as (
    select s.id, s.company_id from public.submissions s join public.companies c on c.id = s.company_id
     where s.event_id = p_event and s.type = p_type and s.superseded_at is null and c.squad_id is not null
       and not exists (select 1 from public.judge_runs j where j.submission_id = s.id)
  ), ins as (
    insert into public.judge_runs (event_id, submission_id, company_id, type, generation, run_no)
    select p_event, s.id, s.company_id, p_type, 1, n from subs s cross join generate_series(1, 3) n
    returning submission_id
  )
  select count(*), count(distinct submission_id) into v_queued, v_companies from ins;
  perform app.broadcast_staff(p_event, 'judge');
  return app.ok(jsonb_build_object('queued', v_queued, 'companies', v_companies));
end
$$;

-- The model slot for runs claimed from now on (the worker maps PRIMARY / BACKUP to JUDGE_MODEL / JUDGE_BACKUP_MODEL).
create or replace function public.set_judge_model(p_event uuid, p_slot text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.require_organiser();
  if p_slot is null or p_slot not in ('PRIMARY', 'BACKUP') then
    raise exception 'the model slot is PRIMARY or BACKUP';
  end if;
  update public.events set judge_model_slot = p_slot where id = p_event and judge_model_slot <> p_slot;
  if not found and not exists (select 1 from public.events where id = p_event) then
    raise exception 'no such event';
  end if;
  perform app.broadcast_staff(p_event, 'judge');
  return app.ok(jsonb_build_object('slot', p_slot));
end
$$;

-- FAILED runs of a type (of each submission's latest generation, unless its appeal was dismissed) go back to the
-- queue with fresh attempts.
create or replace function public.retry_failed_runs(p_event uuid, p_type public.submission_type)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  perform app.require_organiser();
  update public.judge_runs j
     set status = 'QUEUED', attempts = 0, not_before = null, locked_at = null, finished_at = null
   where j.event_id = p_event and j.type = p_type and j.status = 'FAILED'
     and j.generation = (select max(x.generation) from public.judge_runs x where x.submission_id = j.submission_id)
     and j.submission_id = (app.current_submission(j.company_id, j.type)).id
     and not exists (select 1 from public.appeals a
                      where a.submission_id = j.submission_id and a.generation = j.generation and a.status = 'DISMISSED');
  get diagnostics n = row_count;
  perform app.broadcast_staff(p_event, 'judge');
  return app.ok(jsonb_build_object('retried', n));
end
$$;

-- A technical re-run of one company's submission (a new generation of runs 1–3), with the reason. Before release the
-- score goes back to SCORING and is sealed again when the runs are done. After release (PLAN and FLASH; a pitch score
-- has set the IPO price and the IPO is allocated) it is an appeal whose new score waits for apply_appeal.
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

-- ───────────────────────────── The worker's side (service role) ─────────────────────────────

-- Up to p_limit runs: QUEUED and due, or RUNNING whose worker has not reported for 3 minutes. Each is marked
-- RUNNING with one more attempt and the event's current model slot.
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
       set status = 'RUNNING', attempts = j.attempts + 1, locked_at = now(), not_before = null, slot = v_slot
      from c where j.id = c.id
    returning j.id, j.submission_id, j.company_id, j.type, j.generation, j.run_no, j.attempts, j.slot, j.created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'run_id', id, 'submission_id', submission_id, 'company_id', company_id, 'type', type, 'generation', generation,
           'run_no', run_no, 'attempts', attempts, 'slot', slot) order by created_at, submission_id, run_no), '[]'::jsonb)
    into v_out from u;
  return v_out;
end
$$;

-- Everything a worker needs to build one run's request: the submission, the names to replace with the ticker (the
-- company and the squad's three teams and their members), and the context (PLAN: the pitch card, the crisis card and
-- the deal; FLASH: the published flash bulletin).
create or replace function public.judge_input(p_run uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_run public.judge_runs;
  v_sub public.submissions;
  v_company public.companies;
  v_squad public.squads;
  v_out jsonb;
begin
  if not app.is_system() then
    raise exception 'judge input is read by the judge worker' using errcode = '42501';
  end if;
  select * into v_run from public.judge_runs where id = p_run;
  if v_run.id is null then
    raise exception 'no such judge run';
  end if;
  select * into v_sub from public.submissions where id = v_run.submission_id;
  select * into v_company from public.companies where id = v_run.company_id;
  select * into v_squad from public.squads where id = v_company.squad_id;
  v_out := jsonb_build_object(
    'run_id', v_run.id, 'type', v_run.type, 'ticker', v_company.ticker, 'company_name', v_company.name,
    'names', coalesce((
      select jsonb_agg(distinct x.name) from (
        select v_company.name as name
        union all select t.name from public.teams t
         where t.id in (v_squad.product_team_id, v_squad.consulting_team_id, v_squad.finance_team_id)
        union all select m.full_name from public.members m
         where m.team_id in (v_squad.product_team_id, v_squad.consulting_team_id, v_squad.finance_team_id)) x
       where x.name is not null and btrim(x.name) <> ''), '[]'::jsonb),
    'submission_id', v_sub.id, 'submission_text', v_sub.body_text,
    'injections_recorded', exists (select 1 from public.judge_injection_checks k where k.submission_id = v_sub.id)
                           or exists (select 1 from public.injection_logs l where l.submission_id = v_sub.id));
  if v_run.type = 'PLAN' then
    v_out := v_out || jsonb_build_object(
      'pitch_text', (app.current_submission(v_company.id, 'PITCH')).body_text,
      'crisis_card', (select jsonb_build_object('category', k.category, 'title', k.title, 'body', k.body)
                        from public.crisis_cards k where k.id = v_company.crisis_card_id),
      'deal', coalesce((
        select jsonb_build_object('signed', coalesce(app.deal_signed_in_time(v_company.id), false), 'executed_at', d.executed_at,
                                  'amount_cents', d.amount_cents, 'price_cents', d.price_cents, 'shares', d.shares,
                                  'deadline', app.deadline(v_company.event_id, 'DEAL'))
          from public.deals d where d.company_id = v_company.id),
        jsonb_build_object('signed', false, 'executed_at', null, 'amount_cents', null, 'price_cents', null, 'shares', null,
                           'deadline', app.deadline(v_company.event_id, 'DEAL'))));
  elsif v_run.type = 'FLASH' then
    v_out := v_out || jsonb_build_object('bulletin', (
      select jsonb_build_object('title', b.title, 'body', b.body) from public.bulletins b
       where b.event_id = v_company.event_id and b.kind = 'FLASH' and b.published_at is not null
       order by b.published_at desc limit 1));
  end if;
  return v_out;
end
$$;

-- The lines a worker stripped from a submission (each {line, pattern}), logged once per submission: the first report
-- counts, later ones (parallel runs of the same submission) change nothing.
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
  if jsonb_typeof(p_hits) is distinct from 'array' or jsonb_array_length(p_hits) > 200
     or exists (select 1 from jsonb_array_elements(p_hits) h
                 where jsonb_typeof(h -> 'line') is distinct from 'string' or jsonb_typeof(h -> 'pattern') is distinct from 'string') then
    raise exception 'hits are an array of {line, pattern} strings (at most 200)';
  end if;
  select * into v_sub from public.submissions where id = p_submission;
  if v_sub.id is null then
    raise exception 'no such submission';
  end if;
  perform app.lock_judging(v_sub.id::text);
  if exists (select 1 from public.judge_injection_checks where submission_id = v_sub.id) then
    return app.ok(jsonb_build_object('recorded', false));
  end if;
  -- Logged by hand before (a test or a repair): keep those, and only mark the submission as checked.
  if not exists (select 1 from public.injection_logs where submission_id = v_sub.id) then
    insert into public.injection_logs (event_id, submission_id, squad_id, company_id, type, line, pattern)
    select v_sub.event_id, v_sub.id, v_sub.squad_id, v_sub.company_id, v_sub.type, left(h ->> 'line', 1000), left(h ->> 'pattern', 100)
      from jsonb_array_elements(p_hits) h;
  end if;
  select count(*) into n from public.injection_logs where submission_id = v_sub.id;
  insert into public.judge_injection_checks (submission_id, event_id, hits) values (v_sub.id, v_sub.event_id, n);
  return app.ok(jsonb_build_object('recorded', true, 'hits', n));
end
$$;

-- A worker's report of one run. Ok: the output is checked again here, the run is DONE, runs 4–5 are queued when the
-- first 3 spread more than 10 points, and a complete generation is sealed (before release) or makes its appeal READY
-- (after release). Not ok: a retryable error goes back to the queue with a backoff until the fifth attempt; anything
-- else fails the run. A report for a run that is no longer in flight (DONE or FAILED) changes nothing.
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
  if v_run.status not in ('QUEUED', 'RUNNING') then
    return app.fail('NOT_RUNNING', 'This run has already been reported.', jsonb_build_object('status', v_run.status));
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

-- ───────────────────────────── Appeals ─────────────────────────────

-- Applies an appeal's new score to a released PLAN or FLASH score (PLAN decision 19): the score and its tier, the AI
-- price (the AI price before the plan tier with the released tiers applied again), and once the market has closed the
-- closing price, what the shorts covered at the close pay, consultant call 3, and once settled the plan bonus, the
-- results and the rankings. The market price history that has already happened is not rewritten; the change is
-- recorded as an APPEAL price row. Collusion flags are not generated again (the fairness officer sees the new score).
create or replace function public.apply_appeal(p_appeal uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_a public.appeals;
  v_event public.events;
  v_c public.companies;
  v_score public.scores;
  v_s jsonb;
  v_squad public.squads;
  v_plan_old int;
  v_flash_old int;
  v_plan_new int;
  v_flash_new int;
  v_flash_released boolean;
  v_base int;
  v_ai_check int;
  v_ai_new int;
  v_close_new int;
  v_delta int := 0;
  v_txn uuid := gen_random_uuid();
  v_cover bigint := 0;
  v_bonus bigint := 0;
  v_calls jsonb := '[]'::jsonb;
  v_effects jsonb;
begin
  perform app.require_organiser();
  select * into v_a from public.appeals where id = p_appeal;
  if v_a.id is null then
    raise exception 'no such appeal';
  end if;
  select * into v_event from public.events where id = v_a.event_id for no key update;
  perform app.lock_judging(v_a.submission_id::text);
  select * into v_a from public.appeals where id = p_appeal for no key update;
  if v_a.status <> 'READY' or not v_a.after_release then
    return app.fail('NOT_READY', 'This appeal has no new score waiting to be applied.');
  end if;
  if v_event.current_phase >= 'AWARDS' then
    return app.fail('TOO_LATE', 'Appeals are decided before the awards.');
  end if;
  select * into v_c from public.companies where id = v_a.company_id for no key update;
  select * into v_score from public.scores where company_id = v_a.company_id and type = v_a.type for no key update;
  if v_score.status is distinct from 'RELEASED' or v_score.submission_id is distinct from v_a.submission_id then
    return app.fail('STALE', 'The released score no longer matches this appeal.');
  end if;
  v_s := app.score_from_runs(v_a.company_id, v_a.type, v_a.submission_id, v_a.generation);
  if v_s ->> 'state' <> 'COMPLETE' then
    raise exception 'the appeal''s runs are not complete';
  end if;

  -- The AI price before the plan tier never changes; the released tiers are applied to it again. The old tiers must
  -- reproduce today's AI price (nothing else moves it), so the new one differs only by this score.
  select ai_before into v_base from public.round_prices where company_id = v_c.id and kind = 'PLAN_TIER';
  if v_base is null then
    raise exception 'no plan tier is recorded for %', v_c.ticker;
  end if;
  v_flash_released := exists (select 1 from public.scores where company_id = v_c.id and type = 'FLASH' and status = 'RELEASED');
  v_plan_old := (select tier_bp from public.scores where company_id = v_c.id and type = 'PLAN');
  v_flash_old := (select tier_bp from public.scores where company_id = v_c.id and type = 'FLASH');
  v_plan_new := case when v_a.type = 'PLAN' then (v_s ->> 'tier_bp')::int else v_plan_old end;
  v_flash_new := case when v_a.type = 'FLASH' then (v_s ->> 'tier_bp')::int else v_flash_old end;
  v_ai_check := app.apply_tier(v_base, v_plan_old);
  v_ai_new := app.apply_tier(v_base, v_plan_new);
  if v_flash_released then
    v_ai_check := app.apply_tier(v_ai_check, v_flash_old);
    v_ai_new := app.apply_tier(v_ai_new, v_flash_new);
  end if;
  if v_ai_check is distinct from v_c.ai_price then
    raise exception 'the AI price of % (%) does not follow from its tiers (%)', v_c.ticker, v_c.ai_price, v_ai_check;
  end if;
  if v_c.closing_price is not null then
    v_close_new := app.avg_half_up(v_c.closing_market_price, v_ai_new);
    v_delta := v_close_new - v_c.closing_price;
  end if;

  -- The score (its release time stays: the verdicts were shown when they were).
  update public.scores
     set generation = v_a.generation, run_totals = array(select x::smallint from jsonb_array_elements_text(v_s -> 'run_totals') x),
         median = (v_s ->> 'median')::smallint, capped = (v_s ->> 'capped')::boolean, penalty = (v_s ->> 'penalty')::smallint,
         final_score = (v_s ->> 'final')::smallint, tier_bp = (v_s ->> 'tier_bp')::int, breakdown = v_s -> 'breakdown',
         rationale = v_s ->> 'rationale', updated_at = now()
   where id = v_score.id;

  perform set_config('app.price_writer', 'APPEAL', true);
  update public.companies set ai_price = v_ai_new, closing_price = coalesce(v_close_new, closing_price) where id = v_c.id;
  insert into public.round_prices (event_id, company_id, kind, market_before, market_after, ai_before, ai_after, tier_bp)
  values (v_c.event_id, v_c.id, 'APPEAL', coalesce(v_c.closing_price, v_c.market_price), coalesce(v_close_new, v_c.market_price),
          v_c.ai_price, v_ai_new, (v_s ->> 'tier_bp')::int);

  -- Shorts covered at the close pay the new closing price for the shares they covered.
  if v_delta <> 0 then
    create temporary table if not exists _appeal_cover (team_id uuid, qty bigint) on commit drop;
    truncate _appeal_cover;
    insert into _appeal_cover
    select team_id, sum(share_delta)::bigint from public.ledger_entries
     where company_id = v_c.id and kind = 'SHORT_CLOSE' and team_id is not null
     group by team_id having sum(share_delta) <> 0;
    select coalesce(sum(qty * v_delta), 0) into v_cover from _appeal_cover;
    if v_cover <> 0 then
      insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, lot, cash_delta_cents, share_delta, price_cents, memo)
      select v_c.event_id, v_txn, 'SHORT_CLOSE', team_id, v_c.id, 'SHORT', -(qty * v_delta), 0, v_close_new,
             'Technical appeal: shorts covered at the new closing price'
        from _appeal_cover;
      insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, cash_delta_cents, share_delta, price_cents, memo)
      values (v_c.event_id, v_txn, 'SHORT_CLOSE', null, v_c.id, v_cover, 0, v_close_new, 'Technical appeal: shorts covered at the new closing price (exchange)');
      update public.teams t set cash_cents = t.cash_cents - x.qty * v_delta from _appeal_cover x where t.id = x.team_id;
      update public.events set exchange_cash_cents = exchange_cash_cents + v_cover where id = v_c.event_id;
    end if;
  end if;

  -- Consultant call 3 compares the price after the flash tier with the closing price.
  if v_close_new is not null then
    create temporary table if not exists _appeal_calls (id uuid, team_id uuid, earnings bigint) on commit drop;
    truncate _appeal_calls;
    insert into _appeal_calls select id, consultant_team_id, earnings_cents from public.calls where company_id = v_c.id and call_no = 3;
    perform app.judge_calls(v_c.event_id, 3);
    select coalesce(jsonb_agg(jsonb_build_object('team_id', x.team_id, 'cents', k.earnings_cents - x.earnings)), '[]'::jsonb) into v_calls
      from _appeal_calls x join public.calls k on k.id = x.id where k.earnings_cents is distinct from x.earnings;
    -- Call earnings were paid at settlement: pay or take back the difference.
    if v_event.settled_at is not null and jsonb_array_length(v_calls) > 0 then
      insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, cash_delta_cents, memo)
      select v_c.event_id, v_txn, 'CALL_EARNINGS', (x ->> 'team_id')::uuid, v_c.id, (x ->> 'cents')::bigint,
             'Technical appeal: call 3 judged at the new closing price'
        from jsonb_array_elements(v_calls) x;
      insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, cash_delta_cents, memo)
      select v_c.event_id, v_txn, 'CALL_EARNINGS', null, v_c.id, -sum((x ->> 'cents')::bigint), 'Paid by the exchange'
        from jsonb_array_elements(v_calls) x;
      update public.teams t set cash_cents = t.cash_cents + y.cents
        from (select (x ->> 'team_id')::uuid as team_id, sum((x ->> 'cents')::bigint) as cents
                from jsonb_array_elements(v_calls) x group by 1) y where t.id = y.team_id;
      update public.events set exchange_cash_cents = exchange_cash_cents
             - (select sum((x ->> 'cents')::bigint) from jsonb_array_elements(v_calls) x) where id = v_c.event_id;
    end if;
  end if;

  -- The plan bonus was paid at settlement: pay or take back the difference.
  if v_event.settled_at is not null and v_a.type = 'PLAN' then
    v_bonus := app.plan_bonus((v_s ->> 'final')::int) - app.plan_bonus(v_score.final_score);
    if v_bonus <> 0 then
      select * into v_squad from public.squads where id = v_c.squad_id;
      insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, cash_delta_cents, memo) values
        (v_c.event_id, v_txn, 'BONUS_PLAN', v_squad.consulting_team_id, v_c.id, v_bonus,
         format('Technical appeal: plan bonus for %s instead of %s', v_s ->> 'final', v_score.final_score)),
        (v_c.event_id, v_txn, 'BONUS_PLAN', null, v_c.id, -v_bonus, 'Paid by the exchange');
      update public.teams set cash_cents = cash_cents + v_bonus where id = v_squad.consulting_team_id;
      update public.events set exchange_cash_cents = exchange_cash_cents - v_bonus where id = v_c.event_id;
      insert into public.public_ledger (event_id, txn_id, kind, label, company_id, cash_cents, details)
      values (v_c.event_id, v_txn, 'BONUS_PLAN', app.event_label(v_squad.number, 'consultant plan bonus (appeal)'), v_c.id, v_bonus,
              jsonb_build_object('squad', v_squad.number));
    end if;
  end if;

  if v_event.settled_at is not null then
    perform app.compute_results(v_c.event_id);
    perform app.compute_rankings(v_c.event_id);
  end if;

  v_effects := jsonb_build_object(
    'score', jsonb_build_object('from', v_score.final_score, 'to', (v_s ->> 'final')::int),
    'tier_bp', jsonb_build_object('from', v_score.tier_bp, 'to', (v_s ->> 'tier_bp')::int),
    'ai_price', jsonb_build_object('from', v_c.ai_price, 'to', v_ai_new),
    'closing_price', case when v_close_new is not null then jsonb_build_object('from', v_c.closing_price, 'to', v_close_new) end,
    'short_cover_cents', v_cover, 'plan_bonus_cents', v_bonus, 'calls', v_calls,
    'settled', v_event.settled_at is not null);
  update public.appeals set status = 'APPLIED', decided_by = auth.uid(), decided_at = now(), effects = v_effects where id = v_a.id;
  insert into public.public_ledger (event_id, txn_id, kind, label, company_id, ticker, price_cents, details)
  values (v_c.event_id, v_txn, 'APPEAL', format('Technical appeal: %s %s score %s → %s', v_c.ticker, lower(v_a.type::text),
                                                v_score.final_score, v_s ->> 'final'),
          v_c.id, v_c.ticker, coalesce(v_close_new, v_ai_new), v_effects - 'calls');
  perform app.broadcast(v_c.event_id, 'appeal', jsonb_build_object('company_id', v_c.id, 'type', v_a.type));
  perform app.broadcast_staff(v_c.event_id, 'judge');
  return app.ok(jsonb_build_object('effects', v_effects));
end
$$;

-- Keeps the released score: the appeal's runs (if any are still waiting) are dropped.
create or replace function public.dismiss_appeal(p_appeal uuid, p_note text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_a public.appeals;
begin
  perform app.require_organiser();
  if length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'give a reason (at least 5 characters)';
  end if;
  select * into v_a from public.appeals where id = p_appeal;
  if v_a.id is null then
    raise exception 'no such appeal';
  end if;
  perform 1 from public.events where id = v_a.event_id for no key update;
  perform app.lock_judging(v_a.submission_id::text);
  select * into v_a from public.appeals where id = p_appeal for no key update;
  if v_a.status not in ('JUDGING', 'READY') or not v_a.after_release then
    return app.fail('NOT_OPEN', 'Only an open appeal of a released score can be dismissed.');
  end if;
  update public.judge_runs set status = 'FAILED', locked_at = null, finished_at = now(), error = 'The appeal was dismissed.'
   where submission_id = v_a.submission_id and generation = v_a.generation and status in ('QUEUED', 'RUNNING');
  update public.appeals set status = 'DISMISSED', decided_by = auth.uid(), decided_at = now(), note = btrim(p_note) where id = v_a.id;
  perform app.broadcast_staff(v_a.event_id, 'judge');
  return app.ok();
end
$$;

-- The awards wait for every open appeal, as they wait for every collusion flag.
create or replace function app.gate_blocker(p_event uuid)
returns text
language sql stable
as $$
  select case e.current_phase
    when 'SETUP' then case
      when e.seed_commitment is null then 'Publish the seed commitment before the event starts.'
      when not exists (select 1 from public.problem_cards p where p.event_id = e.id) then 'Upload the problem deck before the event starts.'
      when (select count(*) from public.problem_cards p where p.event_id = e.id)
           < (select count(*) from public.teams t where t.event_id = e.id and t.track = 'PRODUCT') + 2
        then format('The problem deck needs at least %s cards (squads + 2) before the event starts.',
                    (select count(*) from public.teams t where t.event_id = e.id and t.track = 'PRODUCT') + 2)
      when not exists (select 1 from public.crisis_cards c where c.event_id = e.id) then 'Upload the crisis deck before the event starts.'
    end
    when 'SQUAD_DRAW' then case when e.drawn_at is null then 'The lottery has not been drawn.' end
    when 'READING' then case when not app.score_released(e.id, 'PITCH') then 'Pitch scores have not been released.' end
    when 'VERDICTS' then case when not app.score_released(e.id, 'PLAN') then 'Plan scores have not been released.' end
    when 'ROUNDS_13_21' then case when not app.score_released(e.id, 'FLASH') then 'Flash scores have not been released.' end
    when 'APPEALS' then case
      when exists (select 1 from public.flags f where f.event_id = e.id and f.status = 'OPEN')
        then 'Collusion flags are still open for the fairness officer.'
      when exists (select 1 from public.appeals a where a.event_id = e.id and a.after_release and a.status in ('JUDGING', 'READY'))
        then 'A technical appeal is still open: apply or dismiss it on the Judge page.'
    end
    when 'AWARDS' then 'The event has ended.'
  end
  from public.events e where e.id = p_event
$$;

-- ───────────────────────────── Calibration ─────────────────────────────

-- A new batch of the sample pitches ([{sample_no, title, expected: {min, max}, text}], read from
-- prompts/calibration/pitches.json by the console), runs 1–3 each. The first line of a text is "Name (TICKER)".
create or replace function public.start_calibration(p_event uuid, p_samples jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_batch smallint;
  s jsonb;
  v_head text[];
  n int := 0;
begin
  perform app.require_organiser();
  if jsonb_typeof(p_samples) is distinct from 'array' or jsonb_array_length(p_samples) not between 1 and 20 then
    raise exception 'calibration needs 1 to 20 sample pitches';
  end if;
  perform 1 from public.events where id = p_event for no key update;
  if not found then
    raise exception 'no such event';
  end if;
  select coalesce(max(batch), 0) + 1 into v_batch from public.calibration_samples where event_id = p_event;
  for s in select * from jsonb_array_elements(p_samples) loop
    if jsonb_typeof(s -> 'sample_no') is distinct from 'number' or jsonb_typeof(s -> 'title') is distinct from 'string'
       or jsonb_typeof(s -> 'text') is distinct from 'string' or jsonb_typeof(s -> 'expected' -> 'min') is distinct from 'number'
       or jsonb_typeof(s -> 'expected' -> 'max') is distinct from 'number' then
      raise exception 'each sample has sample_no, title, expected {min, max} and text';
    end if;
    v_head := regexp_match(split_part(s ->> 'text', E'\n', 1), '^(.+) \(([A-Z]{3,4})\)$');
    if v_head is null then
      raise exception 'sample %: the first line must be "Company name (TICKER)"', s ->> 'sample_no';
    end if;
    insert into public.calibration_samples (event_id, batch, sample_no, title, expected_min, expected_max, company_name, ticker, body_text, created_by)
    values (p_event, v_batch, (s ->> 'sample_no')::smallint, s ->> 'title', (s -> 'expected' ->> 'min')::smallint,
            (s -> 'expected' ->> 'max')::smallint, v_head[1], v_head[2], s ->> 'text', auth.uid());
    insert into public.calibration_runs (event_id, batch, sample_no, run_no)
    select p_event, v_batch, (s ->> 'sample_no')::smallint, r from generate_series(1, 3) r;
    n := n + 3;
  end loop;
  perform app.broadcast_staff(p_event, 'judge');
  return app.ok(jsonb_build_object('batch', v_batch, 'queued', n));
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
       set status = 'RUNNING', attempts = r.attempts + 1, locked_at = now(), not_before = null, slot = v_slot
      from c where r.id = c.id
    returning r.id, r.batch, r.sample_no, r.run_no, r.attempts, r.slot, r.created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object('run_id', id, 'batch', batch, 'sample_no', sample_no, 'run_no', run_no,
                                               'attempts', attempts, 'slot', slot, 'type', 'PITCH')
                            order by created_at, sample_no, run_no), '[]'::jsonb)
    into v_out from u;
  return v_out;
end
$$;

create or replace function public.calibration_input(p_run uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if not app.is_system() then
    raise exception 'calibration input is read by the judge worker' using errcode = '42501';
  end if;
  select jsonb_build_object('run_id', r.id, 'type', 'PITCH', 'batch', r.batch, 'sample_no', r.sample_no, 'run_no', r.run_no,
                            'ticker', s.ticker, 'company_name', s.company_name, 'names', jsonb_build_array(s.company_name),
                            'text', s.body_text, 'title', s.title)
    into v_out
    from public.calibration_runs r join public.calibration_samples s using (event_id, batch, sample_no)
   where r.id = p_run;
  if v_out is null then
    raise exception 'no such calibration run';
  end if;
  return v_out;
end
$$;

-- As finish_judge_run, without sealing: runs 4–5 are queued when the first 3 spread more than 10 points.
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
  if v_run.status not in ('QUEUED', 'RUNNING') then
    return app.fail('NOT_RUNNING', 'This run has already been reported.', jsonb_build_object('status', v_run.status));
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

-- ───────────────────────────── Grants ─────────────────────────────

-- Internal helpers: only the functions above (as their owner) call them.
revoke all on function app.judge_backoff(integer, numeric), app.lock_judging(text),
  app.judge_output_valid(public.submission_type, jsonb), app.score_from_runs(uuid, public.submission_type, uuid, smallint),
  app.seal_from(uuid, uuid, public.submission_type, jsonb)
  from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.start_judging(uuid, public.submission_type)', 'public.set_judge_model(uuid, text)',
    'public.retry_failed_runs(uuid, public.submission_type)', 'public.rerun_judging(uuid, public.submission_type, text)',
    'public.apply_appeal(uuid)', 'public.dismiss_appeal(uuid, text)', 'public.start_calibration(uuid, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array[
    'public.claim_judge_runs(uuid, integer)', 'public.judge_input(uuid)', 'public.record_injections(uuid, jsonb)',
    'public.finish_judge_run(uuid, jsonb)', 'public.claim_calibration_runs(uuid, integer)',
    'public.calibration_input(uuid)', 'public.finish_calibration_run(uuid, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
