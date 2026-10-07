-- Access control.
--   • Clients (anon, authenticated) get SELECT only, filtered by Row Level Security.
--   • Every write goes through a SECURITY DEFINER game function (added in later migrations).
--   • Helpers live in schema app, which PostgREST does not expose.

-- ───────────────────────────── Identity helpers ─────────────────────────────

create or replace function app.my_role()
returns public.account_role
language sql stable security definer set search_path = ''
as $$
  select a.role from public.accounts a where a.user_id = auth.uid()
$$;

create or replace function app.my_team_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select a.team_id from public.accounts a where a.user_id = auth.uid()
$$;

-- Event of the calling team; NULL for staff and display accounts.
create or replace function app.my_event_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select t.event_id
  from public.accounts a
  join public.teams t on t.id = a.team_id
  where a.user_id = auth.uid()
$$;

create or replace function app.my_squad_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select s.id
  from public.accounts a
  join public.squads s
    on a.team_id in (s.product_team_id, s.consulting_team_id, s.finance_team_id)
  where a.user_id = auth.uid()
$$;

create or replace function app.my_dealt_cards()
returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(s.dealt_card_ids, '{}')
  from public.squads s
  where s.id = app.my_squad_id()
$$;

create or replace function app.is_staff()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select a.role in ('ORGANISER', 'FAIRNESS') from public.accounts a where a.user_id = auth.uid()),
    false)
$$;

create or replace function app.is_organiser()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select a.role = 'ORGANISER' from public.accounts a where a.user_id = auth.uid()),
    false)
$$;

create or replace function app.is_fairness()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select a.role = 'FAIRNESS' from public.accounts a where a.user_id = auth.uid()),
    false)
$$;

-- Staff and the projector see every event's public data; a team sees only its own event.
create or replace function app.sees_all_events()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select a.role in ('ORGANISER', 'FAIRNESS', 'DISPLAY') from public.accounts a where a.user_id = auth.uid()),
    false)
$$;

create or replace function app.phase_reached(p_event uuid, p_phase public.phase_code)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select e.current_phase >= p_phase from public.events e where e.id = p_event), false)
$$;

create or replace function app.score_released(p_event uuid, p_type public.submission_type)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.scores s
    where s.event_id = p_event and s.type = p_type and s.status = 'RELEASED'
  )
$$;

-- ───────────────────────────── Grants ─────────────────────────────

-- Supabase grants ALL on new objects to anon/authenticated by default. Undo that for this schema.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema app revoke execute on functions from public, anon, authenticated;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema app from public, anon, authenticated;

-- Policy expressions run as the querying role, so it needs the helpers.
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;

grant select on
  public.events,
  public.phases,
  public.deadlines,
  public.rounds,
  public.teams,
  public.members,
  public.accounts,
  public.problem_cards,
  public.crisis_cards,
  public.squads,
  public.companies,
  public.coverage,
  public.holdings,
  public.orders,
  public.ipo_bids,
  public.round_prices,
  public.fees,
  public.deals,
  public.submission_drafts,
  public.submissions,
  public.judge_runs,
  public.scores,
  public.injection_logs,
  public.calls,
  public.qa_answers,
  public.bulletins,
  public.ledger_entries,
  public.public_ledger,
  public.corrections,
  public.flags,
  public.results,
  public.awards,
  public.audit_log,
  public.error_log,
  public.event_secrets
to authenticated;

-- The asker of a question is never shown to teams.
grant select (id, event_id, company_id, body, hidden, created_at) on public.qa_questions to authenticated;

-- rate_limits: no client access at all.

-- ───────────────────────────── Row Level Security ─────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'events', 'event_secrets', 'phases', 'deadlines', 'rounds', 'teams', 'members', 'accounts',
    'problem_cards', 'crisis_cards', 'squads', 'companies', 'coverage', 'holdings', 'orders',
    'ipo_bids', 'round_prices', 'fees', 'deals', 'submission_drafts', 'submissions', 'judge_runs',
    'scores', 'injection_logs', 'calls', 'qa_questions', 'qa_answers', 'bulletins',
    'ledger_entries', 'public_ledger', 'corrections', 'flags', 'results', 'awards', 'audit_log',
    'rate_limits', 'error_log'
  ] loop
    -- Not FORCE: the owner (postgres) runs the SECURITY DEFINER game functions and must bypass RLS.
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- "Public" below means: any signed-in account of this event (or staff/display, who see all events).
-- Helpers are wrapped in (select …) so Postgres evaluates them once per statement.

-- Public to the event
create policy events_read on public.events for select to authenticated
  using ((select app.sees_all_events()) or id = (select app.my_event_id()));

create policy phases_read on public.phases for select to authenticated
  using ((select app.sees_all_events()) or event_id = (select app.my_event_id()));

create policy deadlines_read on public.deadlines for select to authenticated
  using ((select app.sees_all_events()) or event_id = (select app.my_event_id()));

create policy rounds_read on public.rounds for select to authenticated
  using ((select app.sees_all_events()) or event_id = (select app.my_event_id()));

create policy round_prices_read on public.round_prices for select to authenticated
  using ((select app.sees_all_events()) or event_id = (select app.my_event_id()));

create policy public_ledger_read on public.public_ledger for select to authenticated
  using ((select app.sees_all_events()) or event_id = (select app.my_event_id()));

create policy qa_questions_read on public.qa_questions for select to authenticated
  using ((select app.is_staff())
     or (not hidden and ((select app.sees_all_events()) or event_id = (select app.my_event_id()))));

create policy qa_answers_read on public.qa_answers for select to authenticated
  using ((select app.sees_all_events()) or event_id = (select app.my_event_id()));

create policy bulletins_read on public.bulletins for select to authenticated
  using ((select app.is_staff())
     or (published_at is not null and published_at <= now()
         and ((select app.sees_all_events()) or event_id = (select app.my_event_id()))));

-- Own team
create policy teams_read on public.teams for select to authenticated
  using ((select app.is_staff()) or id = (select app.my_team_id()));

create policy members_read on public.members for select to authenticated
  using ((select app.is_staff()) or team_id = (select app.my_team_id()));

create policy accounts_read on public.accounts for select to authenticated
  using ((select app.is_staff()) or user_id = (select auth.uid()));

create policy holdings_read on public.holdings for select to authenticated
  using ((select app.is_staff()) or team_id = (select app.my_team_id()));

create policy orders_read on public.orders for select to authenticated
  using ((select app.is_staff()) or team_id = (select app.my_team_id()));

create policy ipo_bids_read on public.ipo_bids for select to authenticated
  using ((select app.is_staff()) or team_id = (select app.my_team_id()));

create policy ledger_entries_read on public.ledger_entries for select to authenticated
  using ((select app.is_staff()) or team_id = (select app.my_team_id()));

create policy calls_read on public.calls for select to authenticated
  using ((select app.is_staff()) or consultant_team_id = (select app.my_team_id()));

create policy coverage_read on public.coverage for select to authenticated
  using ((select app.is_staff()) or consultant_team_id = (select app.my_team_id()));

-- Own squad
create policy squads_read on public.squads for select to authenticated
  using ((select app.is_staff()) or id = (select app.my_squad_id()));

create policy fees_read on public.fees for select to authenticated
  using ((select app.is_staff()) or squad_id = (select app.my_squad_id()));

create policy deals_read on public.deals for select to authenticated
  using ((select app.is_staff()) or squad_id = (select app.my_squad_id()));

create policy submission_drafts_read on public.submission_drafts for select to authenticated
  using ((select app.is_staff()) or squad_id = (select app.my_squad_id()));

create policy problem_cards_read on public.problem_cards for select to authenticated
  using ((select app.is_staff()) or id = any (app.my_dealt_cards()));

-- Unlocked by phase or release
create policy companies_read on public.companies for select to authenticated
  using ((select app.is_staff())
     or squad_id = (select app.my_squad_id())
     or (((select app.sees_all_events()) or event_id = (select app.my_event_id()))
         and app.phase_reached(event_id, 'READING')));

create policy submissions_read on public.submissions for select to authenticated
  using ((select app.is_staff())
     or squad_id = (select app.my_squad_id())
     or (superseded_at is null
         and ((select app.sees_all_events()) or event_id = (select app.my_event_id()))
         and ((type = 'PITCH' and app.phase_reached(event_id, 'READING'))
           or (type = 'PLAN' and app.phase_reached(event_id, 'PLANS_PUBLISHED'))
           or (type = 'FLASH' and app.score_released(event_id, 'FLASH')))));

create policy crisis_cards_read on public.crisis_cards for select to authenticated
  using ((select app.is_staff())
     or (((select app.sees_all_events()) or event_id = (select app.my_event_id()))
         and app.phase_reached(event_id, 'CRISIS')));

create policy scores_read on public.scores for select to authenticated
  using ((select app.is_staff())
     or (status = 'RELEASED'
         and ((select app.sees_all_events()) or event_id = (select app.my_event_id()))));

create policy results_read on public.results for select to authenticated
  using ((select app.is_staff())
     or (((select app.sees_all_events()) or event_id = (select app.my_event_id()))
         and app.phase_reached(event_id, 'AWARDS')));

create policy awards_read on public.awards for select to authenticated
  using ((select app.is_staff())
     or (((select app.sees_all_events()) or event_id = (select app.my_event_id()))
         and app.phase_reached(event_id, 'AWARDS')));

-- Staff only
create policy event_secrets_read on public.event_secrets for select to authenticated
  using ((select app.is_staff()));

create policy judge_runs_read on public.judge_runs for select to authenticated
  using ((select app.is_staff()));

create policy injection_logs_read on public.injection_logs for select to authenticated
  using ((select app.is_staff()));

create policy corrections_read on public.corrections for select to authenticated
  using ((select app.is_staff()));

create policy audit_log_read on public.audit_log for select to authenticated
  using ((select app.is_staff()));

create policy error_log_read on public.error_log for select to authenticated
  using ((select app.is_staff()));

-- Fairness officer only
create policy flags_read on public.flags for select to authenticated
  using ((select app.is_fairness()));

-- rate_limits: RLS on, no policy → no rows for any client role.
