-- Hiring, part two. A firm's profile gains an "about" text (who the firm is, what it has done), shown on its profile
-- page in the firm directory. And once a Product team has hired a Consulting firm (an engagement exists between its
-- company and the firm, in any sub-round), the two can chat one on one: a private thread per company–firm pair.
-- Only the two teams and the staff (organisers, fairness officer) read it; a team writes through post_hire_message
-- only, until the awards. Screens re-read the thread every few seconds (no realtime topic: the text never leaves RLS).

alter table public.firm_profiles add column about text not null default '' check (length(about) <= 1000);

drop function if exists public.save_firm_profile(text, text[], text, bigint);

create or replace function public.save_firm_profile(p_headline text, p_specialities text[], p_rate_card text, p_asking_cents bigint,
                                                    p_about text default '')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
begin
  if app.my_team_id() is null then
    raise exception 'only a team can edit its firm profile' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  v_team := app.lock_caller_team();
  if v_team.track <> 'CONSULTING' then
    return app.fail('NOT_ALLOWED', 'Only Consulting firms have a profile.');
  end if;
  if length(coalesce(p_headline, '')) > 140 or length(coalesce(p_rate_card, '')) > 600 or length(coalesce(p_about, '')) > 1000
     or cardinality(coalesce(p_specialities, '{}')) > 8 or coalesce(p_asking_cents, 0) not between 0 and 100000000 then
    return app.fail('BAD_CONTENT', 'Keep the headline to 140 characters, the rate card to 600, the about text to 1,000 and at most 8 specialities.');
  end if;
  insert into public.firm_profiles (team_id, event_id, headline, specialities, rate_card, asking_cents, about, updated_at)
  values (v_team.id, v_team.event_id, btrim(coalesce(p_headline, '')),
          coalesce((select array_agg(btrim(s)) from unnest(p_specialities) s where btrim(s) <> ''), '{}'),
          btrim(coalesce(p_rate_card, '')), coalesce(p_asking_cents, 0), btrim(coalesce(p_about, '')), now())
  on conflict (team_id) do update set headline = excluded.headline, specialities = excluded.specialities,
    rate_card = excluded.rate_card, asking_cents = excluded.asking_cents, about = excluded.about, updated_at = now();
  return app.ok();
end
$$;

revoke all on function public.save_firm_profile(text, text[], text, bigint, text) from public, anon;
grant execute on function public.save_firm_profile(text, text[], text, bigint, text) to authenticated;

-- ───────────────────────────── The hire chat ─────────────────────────────

create table public.hire_messages (
  id bigserial primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  firm_team_id uuid not null references public.teams (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  body text not null check (length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index hire_messages_pair_idx on public.hire_messages (company_id, firm_team_id, id);

-- Is the caller one side of a company–firm pair that has an engagement? (SECURITY DEFINER: the policy reads companies
-- and engagements without the caller's own policies in the way.)
create or replace function app.in_hire_pair(p_company uuid, p_firm uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.engagements e where e.company_id = p_company and e.firm_team_id = p_firm)
     and (p_firm = app.my_team_id()
          or exists (select 1 from public.companies c where c.id = p_company and c.product_team_id = app.my_team_id()))
$$;

revoke all on function app.in_hire_pair(uuid, uuid) from public, anon;
grant execute on function app.in_hire_pair(uuid, uuid) to authenticated;

alter table public.hire_messages enable row level security;

create policy hire_messages_read on public.hire_messages for select to authenticated
  using ((select app.is_staff()) or app.in_hire_pair(company_id, firm_team_id));

grant select on public.hire_messages to authenticated;

create trigger audit after insert or update or delete on public.hire_messages for each row execute function app.audit_row();

-- A message from one side of a hired pair to the other. The caller is the company's Product team or the firm.
create or replace function public.post_hire_message(p_company uuid, p_firm uuid, p_body text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_phase public.phase_code;
  v_m public.hire_messages;
begin
  if app.my_team_id() is null then
    raise exception 'only a team can post in a hire chat' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  v_team := app.lock_caller_team();
  if not app.in_hire_pair(p_company, p_firm) then
    return app.reject(v_team.event_id, 'post_hire_message', 'NOT_HIRED', 'The chat opens once the company has hired the firm.');
  end if;
  select current_phase into v_phase from public.events where id = v_team.event_id;
  if v_phase >= 'AWARDS' then
    return app.reject(v_team.event_id, 'post_hire_message', 'CHAT_CLOSED', 'The chat has closed.');
  end if;
  if length(btrim(coalesce(p_body, ''))) = 0 or length(btrim(p_body)) > 500 then
    return app.reject(v_team.event_id, 'post_hire_message', 'BAD_LENGTH', 'Messages are 1 to 500 characters.');
  end if;
  if not app.rate_limit(v_team.id, 'chat', 20, interval '1 minute') then
    return app.fail('RATE_LIMITED', 'Too many messages in a minute.');
  end if;
  insert into public.hire_messages (event_id, company_id, firm_team_id, team_id, body)
  values (v_team.event_id, p_company, p_firm, v_team.id, btrim(p_body))
  returning * into v_m;
  return app.ok(jsonb_build_object('message_id', v_m.id));
end
$$;

revoke all on function public.post_hire_message(uuid, uuid, text) from public, anon;
grant execute on function public.post_hire_message(uuid, uuid, text) to authenticated;
