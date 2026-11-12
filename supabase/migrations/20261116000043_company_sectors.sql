-- Every listed company's sector, for the sector race on the big screen and the Market page. Public data only: a
-- company's ticker is public from READING, and its sector is the problem card its squad drew (the same for everyone
-- watching). Companies without a ticker (before the PRD) are left out.

create or replace function public.company_sectors(p_event uuid)
returns table (company_id uuid, ticker text, sector text)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.ticker, coalesce(nullif(btrim(pc.sector), ''), '')
    from public.companies c
    join public.squads s on s.id = c.squad_id
    left join public.problem_cards pc on pc.id = s.chosen_card_id
   where c.event_id = p_event and c.ticker is not null
     and (app.sees_all_events() or p_event = app.my_event_id())
     and (select current_phase from public.events e where e.id = p_event) >= 'READING'
$$;
revoke all on function public.company_sectors(uuid) from public, anon;
grant execute on function public.company_sectors(uuid) to authenticated;
