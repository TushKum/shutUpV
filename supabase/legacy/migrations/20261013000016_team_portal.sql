-- Phase 4 (team portal): a paused event freezes orders completely. place_order and edit_order already refuse while
-- paused (TRADING_PAUSED, through app.check_order); cancel_order now does too, so the book a pause freezes is exactly
-- the book that clears when the event resumes.

create or replace function public.cancel_order(p_order uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_order public.orders;
  v_round public.rounds;
begin
  if app.my_team_id() is null then
    raise exception 'only a team can cancel orders' using errcode = '42501';
  end if;
  if not app.rate_limit(app.my_team_id(), 'orders', 20, interval '10 seconds') then
    return app.fail('RATE_LIMITED', 'Too many order actions. Wait a few seconds.');
  end if;
  v_team := app.lock_caller_team();
  select * into v_order from public.orders where id = p_order and team_id = v_team.id for no key update;
  if v_order.id is null or v_order.status <> 'PENDING' then
    return app.reject(v_team.event_id, 'cancel_order', 'NOT_EDITABLE', 'That order can no longer be changed.',
                      jsonb_build_object('order_id', p_order));
  end if;
  if (select paused from public.events where id = v_team.event_id) then
    return app.reject(v_team.event_id, 'cancel_order', 'TRADING_PAUSED', app.order_message('TRADING_PAUSED'),
                      jsonb_build_object('order_id', p_order));
  end if;
  select * into v_round from public.rounds where id = v_order.round_id;
  if v_round.status <> 'OPEN' or now() >= v_round.closes_at then
    return app.reject(v_team.event_id, 'cancel_order', 'TRADING_HALTED', app.order_message('TRADING_HALTED'),
                      jsonb_build_object('order_id', p_order));
  end if;
  update public.orders set status = 'CANCELLED', cancelled_at = now(), updated_at = now() where id = v_order.id
  returning * into v_order;
  return app.ok(jsonb_build_object('order', to_jsonb(v_order)));
end
$$;

revoke all on function public.cancel_order(uuid) from public, anon;
grant execute on function public.cancel_order(uuid) to authenticated;
