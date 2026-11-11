-- PRIMUS: a hired firm works with its client, who is usually in another squad. The squad policies keep a squad's
-- drafts and submissions to the squad, so a firm could not read the client's response plan it advises on, nor the
-- advice memo it writes. These policies add, for a firm, the drafts and submissions of the sub-round it was hired for
-- (CRISIS_k and ADVICE_k for k, the SOLUTION for Round 3), and only those. app.firm_engaged is an RLS helper, so
-- signed-in users may call it (like app.my_team_id).

create or replace function app.firm_engaged(p_company uuid, p_type public.submission_type)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.engagements e
     where e.firm_team_id = app.my_team_id() and e.company_id = p_company
       and app.subround_of(p_type) is not null and e.k = app.subround_of(p_type))
$$;
revoke all on function app.firm_engaged(uuid, public.submission_type) from public, anon, authenticated;
grant execute on function app.firm_engaged(uuid, public.submission_type) to authenticated;

create policy submission_drafts_firm_read on public.submission_drafts for select to authenticated
  using ((select app.my_team_id()) is not null and app.firm_engaged(company_id, type));

create policy submissions_firm_read on public.submissions for select to authenticated
  using ((select app.my_team_id()) is not null and app.firm_engaged(company_id, type));

-- The PRIMUS tables are read by the team portals through RLS (each has its policy); like every other table, clients
-- get SELECT only, and write through the game functions.
grant select on public.subrounds, public.subround_crises, public.firm_profiles, public.offers, public.engagements,
  public.problem_statements, public.draft_picks to authenticated;

-- A PRIMUS event never reaches the classic CRISIS phase (it goes IPO → PRESSURE → SATURATION), so the crisis cards'
-- phase rule would hide them all night: a card is public once a sub-round has dealt it.
create policy crisis_cards_subround_read on public.crisis_cards for select to authenticated
  using (exists (select 1 from public.subround_crises x where x.crisis_card_id = crisis_cards.id and x.event_id = (select app.my_event_id())));
