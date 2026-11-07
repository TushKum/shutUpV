-- Phase 5 (projector): the display account may read the leaderboard (live until the 03:30 freeze, then refused until
-- AWARDS, exactly as for teams) and the lottery record (after the crisis). Both checked only staff or a team of the
-- event before; app.in_my_event also admits the display account. And the public download of the lottery record, for
-- anyone, by event slug, once the seed is revealed.

create or replace function public.leaderboard(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_event public.events;
begin
  select * into v_event from public.events where id = p_event;
  if v_event.id is null or not app.in_my_event(p_event) then
    raise exception 'no such event' using errcode = '42501';
  end if;
  if not app.is_organiser() and not app.is_fairness() and v_event.current_phase < 'AWARDS'
     and v_event.leaderboard_frozen_at is not null then
    raise exception 'the leaderboard is frozen until the awards' using errcode = '42501';
  end if;
  if v_event.settled_at is not null and (v_event.current_phase >= 'AWARDS' or app.is_organiser() or app.is_fairness()) then
    return app.ok(jsonb_build_object('final', true, 'rows', coalesce((
      select jsonb_agg(jsonb_build_object('team_id', r.team_id, 'code', t.code, 'name', t.name, 'r1', r.r1_points,
                                          'r2', r.r2_points, 'r3', r.r3_points, 'total', r.total, 'rank', r.rank,
                                          'return_bp', r.return_bp, 'eligible', r.eligible)
                       order by r.rank nulls last, t.code)
        from public.results r join public.teams t on t.id = r.team_id where r.event_id = p_event), '[]'::jsonb)));
  end if;
  return app.ok(jsonb_build_object('final', false, 'frozen', v_event.leaderboard_frozen_at is not null, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object('team_id', l.team_id, 'code', l.code, 'r1', l.r1, 'r2', l.r2, 'r3', l.r3,
                                        'total', l.total, 'rank', l.rank) order by l.rank nulls last, l.code)
      from app.live_leaderboard(p_event) l), '[]'::jsonb)));
end
$$;

-- The public lottery record of an event (the JSON `pnpm verify-lottery` checks), built in one place for the signed-in
-- function and the public download.
create or replace function app.lottery_record_json(p_event uuid)
returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'seed', e.seed_revealed,
    'dice', e.dice,
    'commitment', e.seed_commitment,
    'teams', (select jsonb_agg(code order by code) from public.teams where event_id = p_event),
    'problemCards', (select jsonb_agg(number::text order by number) from public.problem_cards where event_id = p_event),
    'crisisCards', (select jsonb_agg(number::text order by number) from public.crisis_cards where event_id = p_event),
    'draws', (select jsonb_agg(jsonb_build_object('team', t.code, 'problem', pc.number::text, 'crisis', cc.number::text,
                                                  'rescues', ft.code) order by t.code)
                from public.teams t
                join public.companies own on own.founder_team_id = t.id
                left join public.problem_cards pc on pc.id = own.problem_card_id
                left join public.crisis_cards cc on cc.id = own.crisis_card_id
                left join public.companies res on res.rescuer_team_id = t.id
                left join public.teams ft on ft.id = res.founder_team_id
               where t.event_id = p_event))
    from public.events e where e.id = p_event
$$;

create or replace function public.lottery_record(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_event public.events;
begin
  select * into v_event from public.events where id = p_event;
  if v_event.id is null or not app.in_my_event(p_event) then
    raise exception 'no such event' using errcode = '42501';
  end if;
  if v_event.seed_revealed is null then
    return app.fail('NOT_YET', 'The lottery record is published after the crisis (23:45).');
  end if;
  return app.ok(jsonb_build_object('record', app.lottery_record_json(p_event)));
end
$$;

-- For anyone, signed in or not (GET /api/lottery-record?event=<slug>): the record once the seed is revealed at the
-- crisis, null before (and for an unknown slug).
create or replace function public.public_lottery_record(p_slug text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select app.lottery_record_json(e.id) from public.events e where e.slug = p_slug and e.seed_revealed is not null
$$;

revoke all on function public.public_lottery_record(text) from public;
grant execute on function public.public_lottery_record(text) to anon, authenticated, service_role;
revoke all on function app.lottery_record_json(uuid) from public, anon, authenticated;
