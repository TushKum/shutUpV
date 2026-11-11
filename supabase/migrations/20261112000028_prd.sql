-- PRIMUS Round 1: the pitch card becomes the PRD (Product Requirements Document).
-- The submission type keeps its code, PITCH, so every rule that reads it (IPO tier, release, publication, settlement)
-- is unchanged. What changes: the template sections, the word limit (400 → 800) and the judge's rubric.
-- Mirrors TEMPLATES, RULES.WORD_LIMIT and RUBRICS in packages/engine.

create or replace function app.word_limit(p_type public.submission_type)
returns integer
language sql immutable strict parallel safe
as $$
  select case p_type when 'PITCH' then 800 when 'PLAN' then 500 else 100 end
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
    ('FLASH', 1, 'answer', 'Our answer')
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
    else '{"responds_to_news": 50, "realistic": 30, "clear": 20}'::jsonb
  end
$$;

create or replace function public.submit_submission(p_type public.submission_type)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_squad public.squads;
  v_draft public.submission_drafts;
  v_company public.companies;
  v_words int;
  v_limit int := app.word_limit(p_type);
  v_ticker text;
  v_name text;
  v_sub public.submissions;
  w record;
begin
  -- Throttle first (it touches only the team's rate-limit row), then lock the team (PLAN §46).
  if app.my_team_id() is null then
    raise exception 'only a team can submit' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) or not app.rate_limit(app.my_team_id(), 'submit', 10, interval '1 minute') then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  v_team := app.lock_caller_team();
  v_squad := app.squad_of_team(v_team.id);
  select * into w from app.submission_window(v_team, p_type);
  if v_squad.id is null or not w.allowed then
    return app.reject(v_team.event_id, 'submit', 'NOT_ALLOWED', 'Your team cannot submit this.', jsonb_build_object('type', p_type));
  end if;
  -- The draft and the company are locked before the window is checked: an advance that publishes the work locks
  -- every company first, so a submission either commits before it or sees the window closed.
  select * into v_draft from public.submission_drafts where squad_id = v_squad.id and type = p_type for no key update;
  select * into v_company from public.companies where squad_id = v_squad.id for no key update;
  select * into w from app.submission_window(v_team, p_type);
  if not w.open then
    return app.reject(v_team.event_id, 'submit', 'DEADLINE_PASSED', 'The deadline has passed; this submission was not accepted.',
                      jsonb_build_object('type', p_type, 'at', now()));
  end if;
  -- Submitting the same text again changes nothing and stores nothing.
  select * into v_sub from public.submissions where company_id = v_company.id and type = p_type and superseded_at is null;
  if v_sub.id is not null and v_sub.content = v_draft.content then
    return app.ok(jsonb_build_object('submission', to_jsonb(v_sub), 'duplicate', true));
  end if;
  v_words := app.submission_words(p_type, v_draft.content);
  if v_words = 0 then
    return app.reject(v_team.event_id, 'submit', 'EMPTY', 'Write something before submitting.', jsonb_build_object('type', p_type));
  end if;
  if v_words > v_limit then
    return app.reject(v_team.event_id, 'submit', 'TOO_LONG', format('At most %s words (you have %s).', v_limit, v_words),
                      jsonb_build_object('type', p_type, 'words', v_words));
  end if;
  if p_type = 'PITCH' then
    v_name := app.content_field(v_draft.content, 'company_name');
    v_ticker := upper(app.content_field(v_draft.content, 'ticker'));
    if length(v_name) < 1 or length(v_name) > 60 then
      return app.reject(v_team.event_id, 'submit', 'MISSING_NAME', 'Enter the company name (up to 60 characters).');
    end if;
    if v_ticker !~ '^[A-Z]{3,4}$' then
      return app.reject(v_team.event_id, 'submit', 'BAD_TICKER', 'The ticker is 3 or 4 letters, e.g. AQS.');
    end if;
    if exists (select 1 from public.companies where event_id = v_team.event_id and ticker = v_ticker and id <> v_company.id) then
      return app.reject(v_team.event_id, 'submit', 'TICKER_TAKEN', 'Another company already uses that ticker.');
    end if;
    update public.companies set name = v_name, ticker = v_ticker where id = v_company.id;
  end if;

  update public.submissions set superseded_at = now()
   where company_id = v_company.id and type = p_type and superseded_at is null;
  insert into public.submissions (event_id, squad_id, company_id, type, content, body_text, word_count, submitted_by_team)
  values (v_team.event_id, v_squad.id, v_company.id, p_type, v_draft.content,
          app.submission_text(p_type, v_draft.content), v_words, v_team.id)
  returning * into v_sub;
  return app.ok(jsonb_build_object('submission', to_jsonb(v_sub)));
end
$$;
revoke all on function app.word_limit(public.submission_type) from public, anon, authenticated;
