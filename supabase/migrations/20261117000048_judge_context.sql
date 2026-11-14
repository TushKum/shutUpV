-- What the AI judge is given for a PRIMUS submission, completed.
--
-- The judge prompts (prompts/CRISIS.md, ADVICE.md, SOLUTION.md) tell the judge it receives the company's PRD, the
-- crisis card or the Round 3 statement, and the hired firm's advice. The database already supplied them
-- (app.primus_judge_context); the worker now sends them (apps/web/lib/judge/request.ts). This migration adds what
-- was still missing for a fair, anonymous judgement:
--   • whether the company hired a firm at all (the judge is told "hired no firm" or "the firm sent nothing");
--   • the hired firm's team and member names, so they are replaced by the ticker like the squad's own names (a firm
--     from another squad writes the advice memo and co-writes the solution);
--   • for a PRD in an event played in sectors, the sector brief the squad was dealt (prompts/PITCH.md).

create or replace function app.primus_judge_context(p_company uuid, p_type public.submission_type)
returns jsonb
language plpgsql stable
as $$
declare
  v_k int := app.subround_of(p_type);
  v_firm uuid;
  v_out jsonb;
begin
  select g.firm_team_id into v_firm from public.engagements g where g.company_id = p_company and g.k = v_k;
  v_out := jsonb_build_object(
    'pitch_text', (app.current_submission(p_company, 'PITCH')).body_text,
    'firm_hired', v_firm is not null,
    'firm_names', coalesce((
      select jsonb_agg(distinct x.name) from (
        select t.name from public.teams t where t.id = v_firm
        union all select m.full_name from public.members m where m.team_id = v_firm) x
       where x.name is not null and btrim(x.name) <> ''), '[]'::jsonb),
    'firm_member_names', coalesce((
      select jsonb_agg(distinct m.full_name) from public.members m
       where m.team_id = v_firm and btrim(m.full_name) <> ''), '[]'::jsonb));
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

-- The PRD of an event played in sectors is read with its sector brief.
select app.patch_functions(
  '  elsif app.subround_of(v_run.type) is not null then
    v_out := v_out || app.primus_judge_context(v_company.id, v_run.type);',
  '  elsif v_run.type = ''PITCH'' then
    v_out := v_out || jsonb_build_object(''problem_card'', (
      select jsonb_build_object(''sector'', pc.sector, ''title'', pc.title, ''body'', pc.body)
        from public.problem_cards pc
       where pc.id = v_squad.chosen_card_id and btrim(coalesce(pc.sector, '''')) <> ''''));
  elsif app.subround_of(v_run.type) is not null then
    v_out := v_out || app.primus_judge_context(v_company.id, v_run.type);');
