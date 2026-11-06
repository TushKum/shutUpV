-- The staff's view of the squad chats: per squad, how many messages and when the latest was posted. Staff only (the
-- messages themselves are read through squad_messages' RLS, which already lets the staff read every squad's chat).

create or replace function public.chat_summary(p_event uuid)
returns table (squad_id uuid, messages integer, last_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not app.is_staff() then
    raise exception 'only staff can read the chat summary' using errcode = '42501';
  end if;
  return query
    select m.squad_id, count(*)::integer, max(m.created_at)
      from public.squad_messages m
     where m.event_id = p_event
     group by m.squad_id;
end
$$;

revoke all on function public.chat_summary(uuid) from public, anon;
grant execute on function public.chat_summary(uuid) to authenticated;
