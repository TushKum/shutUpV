-- Round 3's draft tells the screens whose pick it is. Each draft broadcast names the Product team now on the clock
-- (so its screen can sound "Your pick!"), and a pick given by default (20 seconds ran out) is broadcast too: before,
-- screens only heard of picks made by hand, so the next team could miss the start of its own 20 seconds.

create or replace function app.on_the_clock(p_event uuid)
returns uuid
language sql stable
as $$
  select c.product_team_id from public.companies c where c.id = (app.current_pick(p_event)).company_id
$$;
revoke all on function app.on_the_clock(uuid) from public, anon, authenticated;

select app.patch_functions(
  'perform app.broadcast(v_team.event_id, ''draft'', jsonb_build_object(''step'', ''pick'', ''pick_no'', v_pick.pick_no));',
  'perform app.broadcast(v_team.event_id, ''draft'', jsonb_build_object(''step'', ''pick'', ''pick_no'', v_pick.pick_no, ''next_product'', app.on_the_clock(v_team.event_id)));');

select app.patch_functions(
  '  perform app.broadcast(p_event, ''draft'', jsonb_build_object(''step'', ''start''));
  return true;',
  '  perform app.broadcast(p_event, ''draft'', jsonb_build_object(''step'', ''start'', ''next_product'', app.on_the_clock(p_event)));
  return true;');

create or replace function app.draft_tick(p_event uuid)
returns int
language plpgsql
as $$
declare
  v_pick public.draft_picks;
  n int := 0;
begin
  loop
    v_pick := app.current_pick(p_event);
    exit when v_pick.company_id is null;
    exit when v_pick.closes_at > now() and not app.deadline_passed(p_event, 'DRAFT');
    update public.draft_picks set statement_id = app.open_statement(p_event), picked_at = now(), by_default = true
     where company_id = v_pick.company_id;
    exit when (select statement_id from public.draft_picks where company_id = v_pick.company_id) is null; -- no room left
    perform app.advance_draft(p_event);
    n := n + 1;
  end loop;
  if n > 0 then
    perform app.broadcast(p_event, 'draft', jsonb_build_object('step', 'pick', 'by_default', true, 'next_product', app.on_the_clock(p_event)));
  end if;
  return n;
end
$$;
revoke all on function app.draft_tick(uuid) from public, anon, authenticated;
