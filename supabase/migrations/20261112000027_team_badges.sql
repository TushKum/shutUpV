-- Badges: what a team has achieved so far tonight, for the badges on its Home (apps/web/lib/team/badges.ts decides
-- which badge each fact earns). Read-only, and only the calling team's own facts: its squad's submissions and
-- released scores, its fee and deal, its own calls, questions, answers, bids, trades, holdings and chat messages,
-- and its own squad company's prices. Nothing about other teams' standings (the rankings stay hidden until AWARDS).

create or replace function public.team_badge_facts()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_squad uuid;
  v_company public.companies;
begin
  select * into v_team from public.teams where id = app.my_team_id();
  if v_team.id is null then
    raise exception 'only a team can read its badges' using errcode = '42501';
  end if;
  v_squad := app.my_squad_id();
  select * into v_company from public.companies where squad_id = v_squad;
  return jsonb_build_object(
    'track', v_team.track,
    -- The squad's on-time submissions (a late one is never current), and its released scores.
    'submitted', coalesce((select jsonb_agg(distinct s.type) from public.submissions s
                            where s.squad_id = v_squad and s.superseded_at is null), '[]'::jsonb),
    'scores', coalesce((select jsonb_object_agg(sc.type, sc.final_score) from public.scores sc
                         where sc.company_id = v_company.id and sc.status = 'RELEASED' and sc.final_score is not null), '{}'::jsonb),
    'fee_agreed', exists (select 1 from public.fees f where f.squad_id = v_squad and f.executed_at is not null and not f.is_default),
    'deal_early', exists (select 1 from public.deals d
                           join public.deadlines dl on dl.event_id = d.event_id and dl.code = 'DEAL_BONUS'
                          where d.squad_id = v_squad and d.executed_at is not null and d.executed_at <= dl.at),
    'calls_correct', (select count(*) from public.calls c where c.consultant_team_id = v_team.id and c.correct),
    'questions_asked', (select count(*) from public.qa_questions q where q.asker_team_id = v_team.id and not q.hidden),
    'answers_given', case when v_company.id is null then 0
                          else (select count(*) from public.qa_answers a where a.company_id = v_company.id) end,
    'ipo_bids', (select count(*) from public.ipo_bids b where b.team_id = v_team.id and b.qty_requested > 0),
    'trades', (select count(*) from public.ledger_entries l where l.team_id = v_team.id and l.kind = 'TRADE'),
    'companies_held', (select count(distinct h.company_id) from public.holdings h
                        where h.team_id = v_team.id and h.qty > 0 and h.lot in ('EXCHANGE', 'SQUAD')),
    'messages', case when v_squad is null then 0
                     else (select count(*) from public.squad_messages m where m.squad_id = v_squad and m.team_id = v_team.id) end,
    'company', case when v_company.id is null then null else jsonb_build_object(
                 'ipo_price', v_company.ipo_price, 'market_price', v_company.market_price,
                 'post_crisis_price', v_company.post_crisis_price, 'closing_price', v_company.closing_price) end
  );
end
$$;

revoke all on function public.team_badge_facts() from public, anon;
grant execute on function public.team_badge_facts() to authenticated;
