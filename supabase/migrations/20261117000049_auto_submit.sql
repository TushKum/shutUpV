-- Nobody loses their work for forgetting to press Submit.
--
-- Until now only a submitted version was judged: a team that saved its answer but never pressed Submit scored 0.
-- When a deadline passes, the heartbeat now submits the last saved draft of every company that submitted nothing for
-- that type, if the draft would have been accepted (not empty, within the word limit, and for the PRD a valid name
-- and a free ticker). A team that did submit keeps the version it chose. The submission is marked auto_submitted and
-- timed at the deadline, so the team sees what happened and the judge treats it like any other.

alter table public.submissions add column if not exists auto_submitted boolean not null default false;

create or replace function app.auto_submit_due_drafts(p_event uuid)
returns int
language plpgsql
as $$
declare
  d record;
  v_words int;
  v_name text;
  v_ticker text;
  v_n int := 0;
begin
  for d in
    select dr.*, app.deadline(p_event, app.submission_deadline(dr.type)) as due
      from public.submission_drafts dr
     where dr.event_id = p_event and dr.version > 0
       and app.scoring_closed(p_event, dr.type)
       and not exists (select 1 from public.submissions s where s.company_id = dr.company_id and s.type = dr.type)
     for no key update of dr skip locked
  loop
    v_words := app.submission_words(d.type, d.content);
    continue when v_words = 0 or v_words > app.word_limit(d.type);
    if d.type = 'PITCH' then
      v_name := app.content_field(d.content, 'company_name');
      v_ticker := upper(app.content_field(d.content, 'ticker'));
      continue when length(v_name) < 1 or length(v_name) > 60 or v_ticker !~ '^[A-Z]{3,4}$'
                 or exists (select 1 from public.companies where event_id = p_event and ticker = v_ticker and id <> d.company_id);
      update public.companies set name = v_name, ticker = v_ticker where id = d.company_id;
    end if;
    insert into public.submissions (event_id, squad_id, company_id, type, content, body_text, word_count, submitted_at,
                                    submitted_by_team, auto_submitted)
    values (p_event, d.squad_id, d.company_id, d.type, d.content, app.submission_text(d.type, d.content), v_words,
            coalesce(least(d.due, now()), now()), d.updated_by_team, true);
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;
revoke all on function app.auto_submit_due_drafts(uuid) from public, anon, authenticated;

-- The heartbeat runs it on every tick (cheap: only drafts whose type's deadline has passed and with no submission).
select app.patch_functions(
  '  if v_event.format = ''PRIMUS'' then
    v_actions := v_actions || app.primus_tick(p_event);',
  '  v_res := jsonb_build_object(''n'', app.auto_submit_due_drafts(p_event));
  if (v_res ->> ''n'')::int > 0 then
    v_actions := v_actions || (''auto-submitted '' || (v_res ->> ''n''));
  end if;
  if v_event.format = ''PRIMUS'' then
    v_actions := v_actions || app.primus_tick(p_event);');
