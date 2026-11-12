-- "Do this now" for a PRIMUS event's Rounds 2 and 3. team_plan_facts (what the team portal's task card, action bar
-- and alerts are made from, one call per page) gains the event's format and, during PRESSURE and SATURATION, a
-- `primus` object: the crisis under way, whether hiring and writing are open, and where this team stands in it.
--   Product: the firm it hired, its open offers (whose turn), the engagements it can rate now, its place in the
--            Round 3 draft.
--   Consulting: whether its profile is filled in, the offers waiting for its answer, its clients of this crisis and
--            whether the memo for each is in.
-- Everything here is something the team can already read through RLS (its own offers; engagements, sub-rounds and
-- the draft are public within the event; a firm reads its clients' submissions).

create or replace function app.team_primus_facts(p_team public.teams, p_event public.events, p_company uuid)
returns jsonb
language plpgsql stable
as $$
declare
  v_k int;
  v_hiring int := app.hiring_subround(p_event.id);
  v_out jsonb;
  v_mine public.draft_picks;
  v_cur public.draft_picks;
begin
  if p_event.current_phase = 'SATURATION' then
    v_k := 5;
  else
    select max(s.k) into v_k from public.subrounds s
     where s.event_id = p_event.id and s.k between 1 and 4 and s.revealed_at is not null;
  end if;
  v_out := jsonb_build_object(
    'k', v_k,
    'hiring_k', v_hiring,
    'work_open', v_k is not null and coalesce(app.subround_open(p_event.id, v_k), false));

  if p_team.track = 'PRODUCT' and p_company is not null then
    v_out := v_out || jsonb_build_object(
      'engagement', (select jsonb_build_object('firm', f.code, 'firm_team_id', e.firm_team_id, 'cash_cents', e.cash_cents,
                                               'shares', e.shares, 'escrow', e.escrow)
                       from public.engagements e join public.teams f on f.id = e.firm_team_id
                      where e.company_id = p_company and e.k = v_k),
      'offers_my_turn', (select count(*) from public.offers o
                          where o.company_id = p_company and o.k = v_hiring and o.status = 'OPEN' and o.turn = 'COMPANY'),
      'offers_waiting', (select count(*) from public.offers o
                          where o.company_id = p_company and o.k = v_hiring and o.status = 'OPEN' and o.turn = 'FIRM'),
      'rate', coalesce((select jsonb_agg(jsonb_build_object('k', e.k, 'firm', f.code, 'rating', e.rating) order by e.k)
                          from public.engagements e join public.teams f on f.id = e.firm_team_id
                         where e.company_id = p_company
                           and app.deadline_passed(p_event.id, ('DUE_' || e.k)::public.deadline_code)
                           and not app.deadline_passed(p_event.id, ('RATE_' || e.k)::public.deadline_code)), '[]'::jsonb));
    if p_event.current_phase = 'SATURATION' then
      select * into v_mine from public.draft_picks d where d.company_id = p_company;
      v_cur := app.current_pick(p_event.id);
      v_out := v_out || jsonb_build_object('draft', case when v_mine.company_id is null then null else jsonb_build_object(
        'pick_no', v_mine.pick_no,
        'picked', v_mine.statement_id is not null,
        'by_default', v_mine.by_default,
        'statement', (select jsonb_build_object('number', s.number, 'title', s.title)
                        from public.problem_statements s where s.id = v_mine.statement_id),
        'my_turn', v_mine.statement_id is null and v_cur.company_id = p_company and not app.deadline_passed(p_event.id, 'DRAFT'),
        'closes_at', case when v_cur.company_id = p_company then v_cur.closes_at end,
        'ahead', (select count(*) from public.draft_picks d
                   where d.event_id = p_event.id and d.statement_id is null and d.pick_no < v_mine.pick_no)) end);
    end if;
  elsif p_team.track = 'CONSULTING' then
    v_out := v_out || jsonb_build_object(
      'profile_set', exists (select 1 from public.firm_profiles fp where fp.team_id = p_team.id and fp.headline <> ''),
      'offers_my_turn', (select count(*) from public.offers o
                          where o.firm_team_id = p_team.id and o.k = v_hiring and o.status = 'OPEN' and o.turn = 'FIRM'),
      'offers_waiting', (select count(*) from public.offers o
                          where o.firm_team_id = p_team.id and o.k = v_hiring and o.status = 'OPEN' and o.turn = 'COMPANY'),
      'clients', coalesce((select jsonb_agg(jsonb_build_object(
                              'company_id', c.id, 'ticker', c.ticker, 'name', c.name, 'escrow', e.escrow,
                              'submitted', (app.current_submission(c.id, app.advice_type(v_k))).id is not null)
                            order by c.ticker collate "C", c.id)
                            from public.engagements e join public.companies c on c.id = e.company_id
                           where e.firm_team_id = p_team.id and e.k = v_k), '[]'::jsonb));
  end if;
  return v_out;
end
$$;
revoke all on function app.team_primus_facts(public.teams, public.events, uuid) from public, anon, authenticated;

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
    'format', v_event.format,
    'primus', case when v_event.format = 'PRIMUS' and v_event.current_phase in ('PRESSURE', 'SATURATION')
                   then app.team_primus_facts(v_team, v_event, v_company) end,
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
