-- Phase 5 (big screen): what the display and the public may read that Row Level Security alone cannot give them.
--
-- 1. public.rankings(event): the final values, ranks and awards with each team's code and name. Teams may read only
--    their own row of `teams`, so the rankings endpoint's embedded team names came back empty for teams and the
--    display at AWARDS. Same rule as the endpoint: staff from SETTLEMENT, the event's teams and the display from
--    AWARDS; otherwise null.
-- 2. public.lottery_record_rows(slug): everything `pnpm verify-lottery` needs to redo the draw, for anyone (signed in
--    or not), only once the seed has been revealed (00:30, with the crisis draw). Before that: null.
-- 3. public.draw_summary(event): how many squads the 21:00 draw formed, for the display's draw screen (the display may
--    not read squads). The commitment, dice and time are in `events` already.

create or replace function public.rankings(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_phase public.phase_code;
begin
  select current_phase into v_phase from public.events where id = p_event;
  if v_phase is null then
    return null;
  end if;
  if not ((app.is_staff() and v_phase >= 'SETTLEMENT')
          or ((app.sees_all_events() or app.my_event_id() = p_event) and v_phase >= 'AWARDS')) then
    return null;
  end if;
  return jsonb_build_object(
    'results', coalesce((
      select jsonb_agg(jsonb_build_object(
               'track', r.track, 'final_value_cents', r.final_value_cents, 'start_value_cents', r.start_value_cents,
               'return_bp', r.return_bp, 'rank', r.rank, 'eligible', r.eligible,
               'teams', jsonb_build_object('code', t.code, 'name', t.name))
             order by r.track, r.rank nulls last, t.code collate "C")
        from public.results r join public.teams t on t.id = r.team_id
       where r.event_id = p_event), '[]'::jsonb),
    'awards', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', a.code, 'place', a.place, 'metric', a.metric,
               'teams', case when t.id is null then null else jsonb_build_object('code', t.code, 'name', t.name) end,
               'companies', case when c.id is null then null else jsonb_build_object('ticker', c.ticker, 'name', c.name) end)
             order by a.code collate "C", a.place)
        from public.awards a
        left join public.teams t on t.id = a.team_id
        left join public.companies c on c.id = a.company_id
       where a.event_id = p_event), '[]'::jsonb));
end
$$;

create or replace function public.lottery_record_rows(p_slug text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_event public.events;
begin
  select * into v_event from public.events where slug = p_slug;
  if v_event.id is null or v_event.seed_revealed is null or v_event.drawn_at is null then
    return null;
  end if;
  return jsonb_build_object(
    'commitment', v_event.seed_commitment,
    'seed', v_event.seed_revealed,
    'dice', v_event.dice,
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'track', track) order by code collate "C")
                         from public.teams where event_id = v_event.id), '[]'::jsonb),
    -- Only the card numbers go into the record; the cards' text stays with the squads it was dealt to.
    'problemCards', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'number', number) order by number)
                                from public.problem_cards where event_id = v_event.id), '[]'::jsonb),
    'squads', coalesce((select jsonb_agg(jsonb_build_object(
                                 'number', number, 'product_team_id', product_team_id,
                                 'consulting_team_id', consulting_team_id, 'finance_team_id', finance_team_id,
                                 'dealt_card_ids', to_jsonb(dealt_card_ids)) order by number)
                          from public.squads where event_id = v_event.id), '[]'::jsonb),
    'coverage', coalesce((select jsonb_agg(jsonb_build_object('consultant_team_id', consultant_team_id, 'company_id', company_id))
                            from public.coverage where event_id = v_event.id), '[]'::jsonb),
    'companies', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'product_team_id', product_team_id,
                                                               'ticker', ticker, 'crisis_card_id', crisis_card_id))
                             from public.companies where event_id = v_event.id), '[]'::jsonb),
    'crisisCards', case when v_event.crisis_applied_at is null then null else coalesce((
                     select jsonb_agg(jsonb_build_object('id', id, 'category', category, 'number', number))
                       from public.crisis_cards where event_id = v_event.id), '[]'::jsonb) end);
end
$$;

create or replace function public.draw_summary(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_event public.events;
begin
  if not (app.sees_all_events() or app.my_event_id() = p_event) then
    raise exception 'no such event' using errcode = '42501';
  end if;
  select * into v_event from public.events where id = p_event;
  if v_event.id is null or v_event.drawn_at is null then
    return null;
  end if;
  return jsonb_build_object(
    'drawn_at', v_event.drawn_at,
    'commitment', v_event.seed_commitment,
    'dice', v_event.dice,
    'squads', (select count(*) from public.squads where event_id = p_event));
end
$$;

revoke all on function public.rankings(uuid) from public, anon;
grant execute on function public.rankings(uuid) to authenticated;
revoke all on function public.draw_summary(uuid) from public, anon;
grant execute on function public.draw_summary(uuid) to authenticated;
revoke all on function public.lottery_record_rows(text) from public;
grant execute on function public.lottery_record_rows(text) to anon, authenticated;
