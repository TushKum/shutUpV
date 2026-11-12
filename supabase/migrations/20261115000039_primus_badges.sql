-- Badges for a PRIMUS event: team_badge_facts also says the event's format and, about the calling team only, how many
-- firms its company hired (Product) and its own clients and the stars they gave (Consulting). apps/web/lib/team/badges.ts
-- shows each format its own badges (a PRIMUS night has no rescue deal or flash answer to earn a badge with).

do $$
declare
  d text;
begin
  d := pg_get_functiondef('public.team_badge_facts()'::regprocedure);
  if strpos(d, '''hires''') = 0 then
    d := replace(d, '    ''track'', v_team.track,',
      '    ''track'', v_team.track,
    ''format'', (select e.format from public.events e where e.id = v_team.event_id),
    ''hires'', case when v_company.id is null or v_team.track <> ''PRODUCT'' then 0
                    else (select count(*) from public.engagements e where e.company_id = v_company.id) end,
    ''clients'', (select count(*) from public.engagements e where e.firm_team_id = v_team.id),
    ''five_stars'', (select count(*) from public.engagements e where e.firm_team_id = v_team.id and e.rating = 5 and not e.rating_default),
    ''ratings'', (select count(*) from public.engagements e where e.firm_team_id = v_team.id and e.rating is not null),
    ''rating_avg'', (select round(avg(e.rating), 2) from public.engagements e where e.firm_team_id = v_team.id and e.rating is not null),');
    execute d;
  end if;
end $$;
