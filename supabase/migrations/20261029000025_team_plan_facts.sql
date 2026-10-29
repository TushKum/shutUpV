-- What a team's "Do this now" bar, alerts and Home need to know, in one call instead of a dozen (every team page
-- reads it, and every broadcast re-reads every open page). Returns only what the team could read itself through
-- RLS: its event's schedule and deadlines, which score types are released, whether the flash bulletin is out, and
-- its own squad's submissions, fee and deal, its own calls (Consulting), its own IPO bids (Finance) and the visible
-- questions to its own company that have no answer yet (Product, from Reading).

create or replace function public.team_plan_facts()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_event public.events;
  v_squad uuid;
  v_company uuid;
begin
  select * into v_team from public.teams where id = app.my_team_id();
  if v_team.id is null then
    raise exception 'only a team can read its plan' using errcode = '42501';
  end if;
  select * into v_event from public.events where id = v_team.event_id;
  v_squad := app.my_squad_id();
  select id into v_company from public.companies where squad_id = v_squad;
  return jsonb_build_object(
    'deadlines', coalesce((select jsonb_agg(jsonb_build_object('code', d.code, 'at', d.at)) from public.deadlines d where d.event_id = v_event.id), '[]'::jsonb),
    'phases', coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'starts_at', p.starts_at)) from public.phases p where p.event_id = v_event.id), '[]'::jsonb),
    'ipo_allocated_at', v_event.ipo_allocated_at,
    'market_closed_at', v_event.market_closed_at,
    'released', coalesce((select jsonb_agg(distinct s.type) from public.scores s where s.event_id = v_event.id and s.status = 'RELEASED'), '[]'::jsonb),
    'flash_published', exists (select 1 from public.bulletins b where b.event_id = v_event.id and b.kind = 'FLASH' and b.published_at is not null),
    'submitted', coalesce((select jsonb_agg(distinct s.type) from public.submissions s where s.squad_id = v_squad and s.superseded_at is null), '[]'::jsonb),
    'fee', (select jsonb_build_object('value_cents', f.value_cents, 'updated_by_team', f.updated_by_team,
              'product_confirmed_at', f.product_confirmed_at, 'consulting_confirmed_at', f.consulting_confirmed_at,
              'executed_at', f.executed_at, 'is_default', f.is_default)
              from public.fees f where f.squad_id = v_squad),
    'deal', (select jsonb_build_object('amount_cents', d.amount_cents, 'price_cents', d.price_cents,
               'signed_product_at', d.signed_product_at, 'signed_consulting_at', d.signed_consulting_at,
               'signed_finance_at', d.signed_finance_at, 'executed_at', d.executed_at)
               from public.deals d where d.squad_id = v_squad),
    'calls', case when v_team.track = 'CONSULTING' then coalesce(
               (select jsonb_agg(jsonb_build_object('call_no', c.call_no, 'direction', c.direction)) from public.calls c where c.consultant_team_id = v_team.id),
               '[]'::jsonb) else '[]'::jsonb end,
    'ipo_bids', case when v_team.track = 'FINANCE' then
               (select count(*) from public.ipo_bids b where b.team_id = v_team.id and b.qty_requested > 0) else 0 end,
    'unanswered', case when v_team.track = 'PRODUCT' and v_company is not null and v_event.current_phase >= 'READING' then
               (select count(*) from public.qa_questions q
                 where q.company_id = v_company and not q.hidden
                   and not exists (select 1 from public.qa_answers a where a.question_id = q.id)) else 0 end
  );
end
$$;

revoke all on function public.team_plan_facts() from public, anon;
grant execute on function public.team_plan_facts() to authenticated;
