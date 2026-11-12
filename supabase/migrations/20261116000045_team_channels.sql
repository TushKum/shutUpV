-- Hiring offers go only to the screens of the two teams they are between, and to the organisers' consoles.
--
-- Realtime counts every message once per screen that receives it, against the project's messages-per-second limit
-- (averaged over a minute; when it is reached, Realtime drops broadcasts until the average falls). An offer sent on
-- the event channel reaches every screen of the night: with 600 screens, the first minute of hiring (100 or more
-- offers) is over 1,000 messages a second, and a round's clearing sent in that minute could be dropped for everyone.
-- The other teams' screens ignored those messages anyway (lib/live/channel.tsx). So each team now also hears its own
-- private topic, 'team:<team id>', and an offer is sent there, to the firm and the Product team, and to the staff.

-- 1. A team hears its own topic (and no one else's).
create or replace function app.can_hear(p_topic text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (p_topic like 'event:%' and exists (
       select 1 from public.events e
        where 'event:' || e.id::text = p_topic and (app.sees_all_events() or e.id = app.my_event_id())))
    or (p_topic like 'staff:%' and app.is_staff() and exists (
       select 1 from public.events e where 'staff:' || e.id::text = p_topic))
    or (p_topic like 'squad:%' and (
       (app.is_staff() and exists (select 1 from public.squads s where 'squad:' || s.id::text = p_topic))
       or 'squad:' || app.my_squad_id()::text = p_topic))
    or (p_topic like 'team:%' and 'team:' || app.my_team_id()::text = p_topic),
    false)
$$;

-- 2. An offer's message: the same payload as before (with the firm and the Product team named), on three topics.
create or replace function app.broadcast_offer(p_event uuid, p_payload jsonb, p_firm uuid, p_product uuid)
returns void
language plpgsql
as $$
declare
  v_msg jsonb := coalesce(p_payload, '{}'::jsonb)
                 || jsonb_build_object('firm', p_firm, 'product', p_product, 'kind', 'offers', 'event_id', p_event, 'at', now());
begin
  perform realtime.send(v_msg, 'offers', 'team:' || p_firm::text, true);
  perform realtime.send(v_msg, 'offers', 'team:' || p_product::text, true);
  perform realtime.send(v_msg, 'offers', 'staff:' || p_event::text, true);
end
$$;
revoke all on function app.broadcast_offer(uuid, jsonb, uuid, uuid) from public, anon, authenticated;

-- 3. make_offer and respond_offer send through it instead of the event channel.
select app.patch_functions(
  'perform app.broadcast(v_team.event_id, ''offers'', jsonb_build_object(''firm'', p_firm, ''product'', v_company.product_team_id));',
  'perform app.broadcast_offer(v_team.event_id, ''{}''::jsonb, p_firm, v_company.product_team_id);');
select app.patch_functions(
  'perform app.broadcast(v_team.event_id, ''offers'', jsonb_build_object(''offer'', p_offer, ''firm'', v_offer.firm_team_id, ''product'', v_company.product_team_id));',
  'perform app.broadcast_offer(v_team.event_id, jsonb_build_object(''offer'', p_offer), v_offer.firm_team_id, v_company.product_team_id);');
select app.patch_functions(
  'perform app.broadcast(v_team.event_id, ''offers'', jsonb_build_object(''offer'', p_offer, ''accepted'', true, ''firm'', v_offer.firm_team_id, ''product'', v_company.product_team_id));',
  'perform app.broadcast_offer(v_team.event_id, jsonb_build_object(''offer'', p_offer, ''accepted'', true), v_offer.firm_team_id, v_company.product_team_id);');

-- Nothing sends offers on the event channel any more.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
              where s.nspname in ('app', 'public') and strpos(p.prosrc, 'app.broadcast(v_team.event_id, ''offers''') > 0) then
    raise exception 'an offer is still broadcast on the event channel';
  end if;
end
$$;
