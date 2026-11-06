-- Game core: results, caller identity, time, realtime, rate limits, drafts (with the ticker claim), the locks that
-- turn drafts into submissions, the Q&A board and bulletins.
--
-- Conventions for game functions (public schema, SECURITY DEFINER, search_path = ''):
--   • A team action returns jsonb: {"ok":true,…} or {"ok":false,"code":…,"message":…}. A rejected attempt is written
--     to audit_log (action "rejected") so every attempt is on record, including a save after the lock.
--   • Organiser/system actions raise on permission errors and on misuse; they also return jsonb.
--   • The clock is now() (the database server's clock, the start of the transaction) everywhere.

-- ───────────────────────────── Results ─────────────────────────────

create or replace function app.ok(p_data jsonb default '{}'::jsonb)
returns jsonb
language sql immutable
as $$
  select jsonb_build_object('ok', true) || coalesce(p_data, '{}'::jsonb)
$$;

create or replace function app.fail(p_code text, p_message text, p_data jsonb default '{}'::jsonb)
returns jsonb
language sql immutable
as $$
  select jsonb_build_object('ok', false, 'code', p_code, 'message', p_message) || coalesce(p_data, '{}'::jsonb)
$$;

-- Records a rejected attempt and returns the failure.
create or replace function app.reject(p_event uuid, p_action text, p_code text, p_message text, p_details jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid;
  v_role text;
  v_team uuid;
begin
  select a.user_id, a.role, a.team_id into v_user, v_role, v_team from app.audit_actor() a;
  insert into public.audit_log (event_id, actor_user_id, actor_role, actor_team_id, action, entity, entity_id, after)
  values (p_event, v_user, v_role, v_team, 'rejected', p_action, null,
          jsonb_build_object('code', p_code, 'message', p_message, 'at', clock_timestamp()) || coalesce(p_details, '{}'::jsonb));
  return app.fail(p_code, p_message);
end
$$;

-- ───────────────────────────── Who is calling ─────────────────────────────

-- The calling team (locked: a team's actions are serialised). NULL if the caller is not a team.
create or replace function app.lock_caller_team()
returns public.teams
language sql
as $$
  select t.* from public.accounts a join public.teams t on t.id = a.team_id
   where a.user_id = auth.uid()
   for no key update of t
$$;

-- System = no signed-in user and not the anon role: the service role (judge worker, seed) or the database itself
-- (pg_cron).
create or replace function app.is_system()
returns boolean
language sql stable
as $$
  select auth.uid() is null and coalesce(auth.role(), 'service_role') = 'service_role'
$$;

create or replace function app.require_organiser()
returns void
language plpgsql stable
as $$
begin
  if not (app.is_organiser() or app.is_system()) then
    raise exception 'only an organiser can do this' using errcode = '42501';
  end if;
end
$$;

create or replace function app.require_fairness()
returns void
language plpgsql stable
as $$
begin
  if not (app.is_fairness() or app.is_system()) then
    raise exception 'only the fairness officer can do this' using errcode = '42501';
  end if;
end
$$;

-- The company a team built, and the company it rescues (null until the 23:45 rescue lottery).
create or replace function app.built_company(p_team uuid)
returns public.companies
language sql stable
as $$
  select * from public.companies where founder_team_id = p_team
$$;

create or replace function app.rescued_company(p_team uuid)
returns public.companies
language sql stable
as $$
  select * from public.companies where rescuer_team_id = p_team
$$;

-- ───────────────────────────── Time ─────────────────────────────

create or replace function app.deadline(p_event uuid, p_code public.deadline_code)
returns timestamptz
language sql stable
as $$
  select at from public.deadlines where event_id = p_event and code = p_code
$$;

-- Passed, by the server clock: at the deadline itself the window is already closed (a save at 23:00:00 is refused).
-- While the event is paused, deadlines after the pause began are frozen.
create or replace function app.deadline_passed(p_event uuid, p_code public.deadline_code)
returns boolean
language sql stable
as $$
  select case
    when d.at is null then false
    when e.paused and d.at > e.paused_at then false
    else now() >= d.at
  end
  from public.events e left join public.deadlines d on d.event_id = e.id and d.code = p_code
  where e.id = p_event
$$;

-- The round currently accepting orders (status OPEN and before its close), if any.
create or replace function app.open_round(p_event uuid)
returns public.rounds
language sql stable
as $$
  select r.* from public.rounds r join public.events e on e.id = r.event_id
   where r.event_id = p_event and r.status = 'OPEN' and now() < r.closes_at and r.phase = e.current_phase
   order by r.number limit 1
$$;

-- OPEN, PAUSED or HALTED, exactly as the display badge shows it.
create or replace function app.trading_state(p_event uuid)
returns text
language sql stable
as $$
  select case
    when e.paused then 'PAUSED'
    when (app.open_round(p_event)).id is not null then 'OPEN'
    else 'HALTED'
  end
  from public.events e where e.id = p_event
$$;

-- ───────────────────────────── Realtime ─────────────────────────────

-- Broadcast on the private topic event:<id> (or staff:<id>). Sent inside the transaction, so it goes out on commit
-- only. Clients treat a message as a signal to re-fetch through RLS; no private data is ever in a payload.
create or replace function app.broadcast(p_event uuid, p_kind text, p_payload jsonb default '{}'::jsonb, p_staff boolean default false)
returns void
language plpgsql
as $$
begin
  perform realtime.send(
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('kind', p_kind, 'event_id', p_event, 'at', now()),
    p_kind,
    case when p_staff then 'staff:' else 'event:' end || p_event::text,
    true);
end
$$;

-- ───────────────────────────── Rate limits ─────────────────────────────

-- Fixed-window rate limit per team and bucket. Returns true when the call is allowed (and counts it).
create or replace function app.rate_limit(p_team uuid, p_bucket text, p_max int, p_window interval)
returns boolean
language plpgsql
as $$
declare
  v public.rate_limits;
begin
  insert into public.rate_limits (team_id, bucket, window_start, count) values (p_team, p_bucket, now(), 0)
  on conflict (team_id, bucket) do nothing;
  select * into v from public.rate_limits where team_id = p_team and bucket = p_bucket for no key update;
  if v.window_start + p_window <= now() then
    update public.rate_limits set window_start = now(), count = 1 where team_id = p_team and bucket = p_bucket;
    return true;
  end if;
  if v.count >= p_max then
    return false;
  end if;
  update public.rate_limits set count = count + 1 where team_id = p_team and bucket = p_bucket;
  return true;
end
$$;

-- Every other team action shares one generous bucket (60 per 10 seconds; autosave from four members fits easily).
create or replace function app.too_fast(p_team uuid)
returns boolean
language sql
as $$
  select not app.rate_limit(p_team, 'actions', 60, interval '10 seconds')
$$;

create or replace function app.too_fast_message()
returns text
language sql immutable
as $$
  select 'Too many actions in a few seconds. Wait a moment and try again.'
$$;

-- ───────────────────────────── Drafts ─────────────────────────────

-- Is the team's draft of this type open for saving right now?
--   PRD:      from the problem-card draw (21:15) until the PRD lock (23:00), while the phase is BRIEFING or BUILD.
--   SOLUTION: from the crisis (23:45) until the solution lock (01:45), while the phase is CRISIS_QA or RESCUE.
-- The phase check is a second lock: an early advance closes the window whatever the clock says.
create or replace function app.writing_open(p_event uuid, p_type public.submission_type)
returns boolean
language sql stable
as $$
  select case p_type
    when 'PRD' then e.drawn_at is not null and e.prds_locked_at is null and e.current_phase in ('BRIEFING', 'BUILD')
                    and not app.deadline_passed(e.id, 'PRD_LOCK')
    else e.crisis_applied_at is not null and e.solutions_locked_at is null and e.current_phase in ('CRISIS_QA', 'RESCUE')
         and not app.deadline_passed(e.id, 'SOLUTION_LOCK')
  end and not e.paused
  from public.events e where e.id = p_event
$$;

-- Saves the team's draft (autosave). p_expected_version is the version the editor started from: if a teammate saved
-- in between, the save is refused with the newer draft so the editor can merge. The PRD also carries the company
-- name and the ticker; a ticker is claimed by the first team to save it (and released when cleared or changed).
create or replace function public.save_draft(p_type public.submission_type, p_content jsonb, p_expected_version integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_company public.companies;
  v_draft public.drafts;
  v_problem text;
  v_ticker text;
  v_name text;
begin
  -- Throttle first (it touches only the team's rate-limit row), then lock the team.
  if app.my_team_id() is null then
    raise exception 'only a team can edit a draft' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  v_team := app.lock_caller_team();
  v_company := case p_type when 'PRD' then app.built_company(v_team.id) else app.rescued_company(v_team.id) end;
  if v_company.id is null then
    return app.reject(v_team.event_id, 'save_draft', 'NOT_ALLOWED', 'There is nothing to write here yet.',
                      jsonb_build_object('type', p_type));
  end if;
  -- Lock the company: the lock (drafts → submissions) holds every company of the event, so a save either commits
  -- before the lock reads the draft or waits and then finds the window closed.
  perform 1 from public.companies where id = v_company.id for no key update;
  if not app.writing_open(v_team.event_id, p_type) then
    if p_type = 'PRD' and (select drawn_at from public.events where id = v_team.event_id) is null then
      return app.reject(v_team.event_id, 'save_draft', 'NOT_OPEN', 'The PRD opens when the problem cards are dealt (21:15).');
    end if;
    return app.reject(v_team.event_id, 'save_draft', 'DEADLINE_PASSED',
                      case p_type when 'PRD' then 'The PRD is locked.' else 'The crisis solution is locked.' end,
                      jsonb_build_object('type', p_type, 'expected_version', p_expected_version));
  end if;
  if jsonb_typeof(p_content) is distinct from 'object' or length(p_content::text) > 40000
     or exists (select 1 from jsonb_each(p_content) x
                 where (x.key in (select f.key from app.template_fields(p_type) f)
                        or (p_type = 'PRD' and x.key in ('company_name', 'ticker')))
                   and jsonb_typeof(x.value) not in ('string', 'null')) then
    return app.reject(v_team.event_id, 'save_draft', 'BAD_CONTENT', 'The draft is not valid.');
  end if;
  -- Only the template's fields are kept (and the company name and ticker of a PRD).
  p_content := coalesce((select jsonb_object_agg(x.key, x.value) from jsonb_each(p_content) x
                          where jsonb_typeof(x.value) = 'string'
                            and (x.key in (select f.key from app.template_fields(p_type) f)
                                 or (p_type = 'PRD' and x.key in ('company_name', 'ticker')))), '{}'::jsonb);
  v_problem := app.check_draft(p_type, p_content);
  if v_problem is not null then
    return app.reject(v_team.event_id, 'save_draft', v_problem, case v_problem
      when 'TOO_LONG' then format('At most %s words (you have %s).', case p_type when 'PRD' then 800 else 500 end,
                                  app.submission_words(p_type, p_content))
      when 'BAD_NAME' then 'The company name is at most 60 characters.'
      else 'The ticker is exactly four letters, e.g. MLBT.' end);
  end if;

  select * into v_draft from public.drafts where team_id = v_team.id and type = p_type for no key update;
  if coalesce(v_draft.version, 0) <> p_expected_version then
    return app.fail('VERSION_CONFLICT', 'A teammate saved a newer version.', jsonb_build_object('draft', to_jsonb(v_draft)));
  end if;

  if p_type = 'PRD' then
    v_ticker := nullif(upper(app.content_field(p_content, 'ticker')), '');
    v_name := nullif(app.content_field(p_content, 'company_name'), '');
    if v_ticker is not null and exists (select 1 from public.companies c
                                         where c.event_id = v_team.event_id and c.ticker = v_ticker and c.id <> v_company.id) then
      return app.reject(v_team.event_id, 'save_draft', 'TICKER_TAKEN',
                        format('%s is already taken by another company. Choose another ticker.', v_ticker));
    end if;
    p_content := p_content || jsonb_build_object('ticker', coalesce(v_ticker, ''));
    begin
      update public.companies set ticker = v_ticker, name = v_name where id = v_company.id
         and (ticker, name) is distinct from (v_ticker, v_name);
    exception when unique_violation then
      return app.reject(v_team.event_id, 'save_draft', 'TICKER_TAKEN',
                        format('%s is already taken by another company. Choose another ticker.', v_ticker));
    end;
  end if;

  insert into public.drafts as d (event_id, team_id, company_id, type, content, version, updated_at)
  values (v_team.event_id, v_team.id, v_company.id, p_type, p_content, 1, now())
  on conflict (team_id, type) do update set content = excluded.content, version = d.version + 1, updated_at = now()
  returning * into v_draft;
  return app.ok(jsonb_build_object('draft', to_jsonb(v_draft), 'words', app.submission_words(p_type, p_content)));
end
$$;

-- A default ticker for a company that reached the PRD lock without one: Q + three letters from its team number
-- (T001 → QAAB), skipping any already taken.
create or replace function app.default_tickers(p_event uuid)
returns integer
language plpgsql
as $$
declare
  c record;
  n int;
  v text;
  k int := 0;
begin
  for c in select co.id, t.code from public.companies co join public.teams t on t.id = co.founder_team_id
            where co.event_id = p_event and co.ticker is null order by t.code loop
    n := substring(c.code from 2)::int;
    loop
      v := 'Q' || chr(65 + (n / 676) % 26) || chr(65 + (n / 26) % 26) || chr(65 + n % 26);
      exit when not exists (select 1 from public.companies where event_id = p_event and ticker = v);
      n := n + 1;
    end loop;
    update public.companies set ticker = v, name = coalesce(name, 'Company ' || c.code) where id = c.id;
    k := k + 1;
  end loop;
  update public.companies co set name = 'Company ' || t.code
    from public.teams t where t.id = co.founder_team_id and co.event_id = p_event and co.name is null;
  return k;
end
$$;

-- ───────────────────────────── The locks (23:00 and 01:45) ─────────────────────────────

-- Freezes every draft of one type into a submission (the last version saved before the lock), creates one score
-- row per company (the PRD's points go to the founder, the solution's to the rescuer) and queues three judge
-- readings per submission. A company with no draft, or an empty one, gets no submission and is sealed at 0.
-- Idempotent: runs once per type.
create or replace function app.lock_submissions(p_event uuid, p_type public.submission_type)
returns jsonb
language plpgsql
as $$
declare
  v_event public.events;
  n_sub int;
  n_missing int;
begin
  select * into v_event from public.events where id = p_event for no key update;
  if (p_type = 'PRD' and v_event.prds_locked_at is not null) or (p_type = 'SOLUTION' and v_event.solutions_locked_at is not null) then
    return app.ok(jsonb_build_object('already', true));
  end if;
  if p_type = 'SOLUTION' and v_event.crisis_applied_at is null then
    raise exception 'solutions are locked after the crisis';
  end if;
  -- Every company of the event, so an in-flight save commits first or finds the window closed.
  perform 1 from public.companies where event_id = p_event order by id for no key update;
  -- The deadline is pulled in to now if the lock comes early (an organiser advanced), so the window is closed.
  update public.deadlines set at = least(at, now())
   where event_id = p_event and code = case p_type when 'PRD' then 'PRD_LOCK' else 'SOLUTION_LOCK' end::public.deadline_code;
  if p_type = 'PRD' then
    update public.events set prds_locked_at = now() where id = p_event;
    perform app.default_tickers(p_event);
  else
    update public.events set solutions_locked_at = now() where id = p_event;
  end if;

  insert into public.submissions (event_id, team_id, company_id, type, content, body_text, word_count, draft_version, saved_at, locked_at)
  select d.event_id, d.team_id, d.company_id, d.type, d.content,
         case when p_type = 'PRD'
              then app.submission_text('PRD', d.content || jsonb_build_object('company_name', c.name, 'ticker', c.ticker))
              else app.submission_text(p_type, d.content) end,
         app.submission_words(p_type, d.content), d.version, d.updated_at, now()
    from public.drafts d join public.companies c on c.id = d.company_id
   where d.event_id = p_event and d.type = p_type and app.submission_words(p_type, d.content) > 0;
  get diagnostics n_sub = row_count;

  perform set_config('app.score_writer', 'LOCK', true);
  insert into public.scores (event_id, company_id, team_id, type, submission_id, status)
  select s.event_id, s.company_id, s.team_id, s.type, s.id, 'PENDING'
    from public.submissions s where s.event_id = p_event and s.type = p_type;
  insert into public.scores (event_id, company_id, team_id, type, status, missing, final_score, rationale)
  select c.event_id, c.id, case p_type when 'PRD' then c.founder_team_id else c.rescuer_team_id end, p_type, 'SEALED', true, 0,
         'No saved ' || case p_type when 'PRD' then 'PRD' else 'crisis solution' end || ' at the lock.'
    from public.companies c
   where c.event_id = p_event and (p_type = 'PRD' or c.rescuer_team_id is not null)
     and not exists (select 1 from public.submissions s where s.company_id = c.id and s.type = p_type);
  get diagnostics n_missing = row_count;
  perform set_config('app.score_writer', '', true);

  insert into public.judge_runs (event_id, submission_id, company_id, type, generation, run_no)
  select s.event_id, s.id, s.company_id, s.type, 1, r.n
    from public.submissions s cross join generate_series(1, 3) r(n)
   where s.event_id = p_event and s.type = p_type;

  perform app.broadcast(p_event, 'locked', jsonb_build_object('type', p_type));
  perform app.broadcast(p_event, 'judging_queued', jsonb_build_object('type', p_type, 'submissions', n_sub), true);
  return app.ok(jsonb_build_object('submissions', n_sub, 'missing', n_missing));
end
$$;

-- ───────────────────────────── Q&A board (23:45–00:15) ─────────────────────────────

-- The rescuing team asks the founding team of the company it rescues. Questions close at 00:15 (QA_CLOSE); answers
-- may be written until the solution lock (01:45), so a question asked at 00:14 can still be answered.
create or replace function public.post_question(p_body text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_event public.events;
  v_company public.companies;
  v_q public.qa_questions;
begin
  if app.my_team_id() is null then
    raise exception 'only a team can ask a question' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  v_team := app.lock_caller_team();
  select * into v_event from public.events where id = v_team.event_id;
  v_company := app.rescued_company(v_team.id);
  if v_company.id is null then
    return app.reject(v_team.event_id, 'post_question', 'NOT_ALLOWED', 'You can ask questions once you know the company you rescue.');
  end if;
  if v_event.current_phase <> 'CRISIS_QA' or v_event.paused or app.deadline_passed(v_event.id, 'QA_CLOSE') then
    return app.reject(v_team.event_id, 'post_question', 'QA_CLOSED', 'Questions can be asked from 23:45 until 00:15.');
  end if;
  if length(btrim(coalesce(p_body, ''))) = 0 or length(btrim(p_body)) > 300 then
    return app.reject(v_team.event_id, 'post_question', 'BAD_LENGTH', 'Questions are 1 to 300 characters.');
  end if;
  if not app.rate_limit(v_team.id, 'qa', 10, interval '1 minute') then
    return app.fail('RATE_LIMITED', 'Too many questions in a minute.');
  end if;
  insert into public.qa_questions (event_id, company_id, asker_team_id, body)
  values (v_team.event_id, v_company.id, v_team.id, btrim(p_body))
  returning * into v_q;
  perform app.broadcast(v_team.event_id, 'qa', jsonb_build_object('company_id', v_company.id));
  return app.ok(jsonb_build_object('question_id', v_q.id));
end
$$;

create or replace function public.answer_question(p_question uuid, p_body text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_event public.events;
  v_q public.qa_questions;
  v_words int;
  v_a public.qa_answers;
begin
  if app.my_team_id() is null then
    raise exception 'only a team can answer' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  v_team := app.lock_caller_team();
  select q.* into v_q from public.qa_questions q join public.companies c on c.id = q.company_id
   where q.id = p_question and c.founder_team_id = v_team.id;
  if v_q.id is null then
    return app.reject(v_team.event_id, 'answer_question', 'NOT_ALLOWED', 'Only the team that built the company can answer.');
  end if;
  select * into v_event from public.events where id = v_team.event_id;
  if v_event.current_phase not in ('CRISIS_QA', 'RESCUE') or v_event.paused or app.deadline_passed(v_event.id, 'SOLUTION_LOCK') then
    return app.reject(v_team.event_id, 'answer_question', 'QA_CLOSED', 'Answers can be written until 01:45.');
  end if;
  v_words := app.word_count(coalesce(p_body, ''));
  if v_words < 1 or v_words > 150 or length(btrim(p_body)) > 1500 then
    return app.reject(v_team.event_id, 'answer_question', 'BAD_LENGTH', 'Answers are 1 to 150 words.');
  end if;
  if not app.rate_limit(v_team.id, 'qa_answer', 10, interval '1 minute') then
    return app.fail('RATE_LIMITED', 'Too many answers in a minute.');
  end if;
  insert into public.qa_answers (event_id, question_id, company_id, body, word_count)
  values (v_team.event_id, v_q.id, v_q.company_id, btrim(p_body), v_words)
  returning * into v_a;
  perform app.broadcast(v_team.event_id, 'qa', jsonb_build_object('company_id', v_q.company_id));
  return app.ok(jsonb_build_object('answer_id', v_a.id));
end
$$;

-- Organiser: hide a question (and its answers) that breaks the rules; kept for the record.
create or replace function public.hide_question(p_question uuid, p_hidden boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event uuid;
begin
  perform app.require_organiser();
  update public.qa_questions set hidden = p_hidden where id = p_question returning event_id into v_event;
  if v_event is null then
    raise exception 'no such question';
  end if;
  perform app.broadcast(v_event, 'qa', '{}'::jsonb);
  return app.ok();
end
$$;

-- ───────────────────────────── Bulletins ─────────────────────────────

-- Publishes the prepared twist (the tick does this at 22:15; an organiser may do it by hand). Once only.
create or replace function app.publish_twist(p_event uuid)
returns jsonb
language plpgsql
as $$
declare
  v_b public.bulletins;
begin
  update public.bulletins set published_at = now()
   where event_id = p_event and kind = 'TWIST' and published_at is null
  returning * into v_b;
  if v_b.id is null then
    if not exists (select 1 from public.bulletins where event_id = p_event and kind = 'TWIST') then
      return app.fail('NO_TWIST', 'No twist has been prepared.');
    end if;
    return app.ok(jsonb_build_object('already', true));
  end if;
  update public.events set twist_published_at = now() where id = p_event and twist_published_at is null;
  perform app.broadcast(p_event, 'twist', jsonb_build_object('id', v_b.id, 'title', v_b.title, 'body', v_b.body));
  return app.ok(jsonb_build_object('bulletin', to_jsonb(v_b)));
end
$$;

create or replace function public.publish_twist(p_event uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.require_organiser();
  if (select drawn_at from public.events where id = p_event) is null then
    return app.fail('TOO_EARLY', 'The twist is published after the problem cards are dealt.');
  end if;
  return app.publish_twist(p_event);
end
$$;

-- Organiser: edit the twist before it is published.
create or replace function public.set_twist(p_event uuid, p_title text, p_body text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.require_organiser();
  if exists (select 1 from public.bulletins where event_id = p_event and kind = 'TWIST' and published_at is not null) then
    return app.fail('PUBLISHED', 'The twist has already been published.');
  end if;
  insert into public.bulletins (event_id, kind, title, body, created_by)
  values (p_event, 'TWIST', btrim(p_title), coalesce(p_body, ''), auth.uid())
  on conflict (event_id) where kind = 'TWIST' do update set title = excluded.title, body = excluded.body;
  return app.ok();
end
$$;

-- Organiser: publish a rumour (from 00:30, during Round 2 and after; never moves a price), a general notice or a
-- fairness notice. The twist has its own function.
create or replace function public.publish_bulletin(p_event uuid, p_kind public.bulletin_kind, p_title text, p_body text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.bulletins;
  v_phase public.phase_code;
begin
  perform app.require_organiser();
  if p_kind in ('TWIST', 'CRISIS', 'SYSTEM') then
    raise exception '% bulletins are published by the game itself', p_kind;
  end if;
  select current_phase into v_phase from public.events where id = p_event;
  if p_kind = 'RUMOUR' and v_phase < 'RESCUE' then
    return app.fail('TOO_EARLY', 'Rumours start during Round 2 (from 00:30).');
  end if;
  if length(btrim(coalesce(p_title, ''))) not between 1 and 140 then
    raise exception 'a bulletin title is 1 to 140 characters';
  end if;
  insert into public.bulletins (event_id, kind, title, body, published_at, created_by)
  values (p_event, p_kind, btrim(p_title), coalesce(p_body, ''), now(), auth.uid())
  returning * into v_b;
  perform app.broadcast(p_event, 'bulletin', jsonb_build_object('id', v_b.id, 'bulletin_kind', v_b.kind, 'title', v_b.title, 'body', v_b.body));
  return app.ok(jsonb_build_object('bulletin', to_jsonb(v_b)));
end
$$;
