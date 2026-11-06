-- Access control.
--   • Clients (anon, authenticated) get SELECT only, filtered by Row Level Security.
--   • Every write goes through a SECURITY DEFINER game function (added in later migrations).
--   • Helpers live in schema app, which PostgREST does not expose.
--
-- What a team may read, and from when (the brief's timing rules):
--   always       its own team row, members, holdings, orders, ledger, drafts; every company's public row; rounds,
--                prices, published bulletins, Q&A, the public ledger
--   own card     the problem card dealt to its own company (21:15)
--   23:30        every PRD and every problem card (REVEAL_1); revealed PRD scores
--   23:45        every crisis card (CRISIS_QA); the rescue circle and crisis cards are only written then
--   02:15        every crisis solution (MARKET_BLIND)
--   02:45        revealed crisis-solution scores
--   AWARDS       results and awards
-- Staff (organisers, fairness officer) read everything; the display account reads public data.

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

-- The company the calling team founded (Round 1).
create or replace function app.my_company_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select c.id from public.companies c where c.founder_team_id = app.my_team_id()
$$;

-- The company the calling team rescues (Round 2; NULL until the 23:45 circle).
create or replace function app.my_rescue_company_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select c.id from public.companies c where c.rescuer_team_id = app.my_team_id()
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

-- Public data of this event: staff and the display see all events, a team its own.
create or replace function app.in_my_event(p_event uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.sees_all_events() or p_event = app.my_event_id()
$$;

create or replace function app.phase_reached(p_event uuid, p_phase public.phase_code)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select e.current_phase >= p_phase from public.events e where e.id = p_event), false)
$$;

-- May the caller receive messages on this topic? 'event:<id>' of the caller's own event (staff and the display hear
-- every event); 'staff:<id>' for staff only (drafts, requests and settings that teams must not learn of).
create or replace function app.can_hear(p_topic text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (p_topic like 'event:%' and exists (
       select 1 from public.events e
        where 'event:' || e.id::text = p_topic and (app.sees_all_events() or e.id = app.my_event_id())))
    or (p_topic like 'staff:%' and app.is_staff() and exists (
       select 1 from public.events e where 'staff:' || e.id::text = p_topic)),
    false)
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
revoke all on all functions in schema app from public, anon, authenticated, service_role;

-- Policy expressions run as the querying role, so it needs the helpers (and nothing else in app).
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;
grant execute on function
  app.my_role(),
  app.my_team_id(),
  app.my_event_id(),
  app.my_company_id(),
  app.my_rescue_company_id(),
  app.is_staff(),
  app.is_organiser(),
  app.is_fairness(),
  app.sees_all_events(),
  app.in_my_event(uuid),
  app.phase_reached(uuid, public.phase_code),
  app.can_hear(text)
to authenticated;

grant select on
  public.events,
  public.event_secrets,
  public.phases,
  public.deadlines,
  public.rounds,
  public.teams,
  public.members,
  public.accounts,
  public.problem_cards,
  public.crisis_cards,
  public.companies,
  public.holdings,
  public.orders,
  public.round_prices,
  public.drafts,
  public.submissions,
  public.judge_runs,
  public.scores,
  public.injection_logs,
  public.judge_injection_checks,
  public.appeals,
  public.calibration_samples,
  public.calibration_runs,
  public.qa_questions,
  public.qa_answers,
  public.bulletins,
  public.ledger_entries,
  public.public_ledger,
  public.corrections,
  public.flags,
  public.results,
  public.leaderboard_frozen,
  public.awards,
  public.audit_log,
  public.error_log,
  public.client_pings
to authenticated;

-- rate_limits: no client access at all.

-- ───────────────────────────── Row Level Security ─────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'events', 'event_secrets', 'phases', 'deadlines', 'rounds', 'teams', 'members', 'accounts',
    'problem_cards', 'crisis_cards', 'companies', 'holdings', 'orders', 'round_prices', 'drafts', 'submissions',
    'judge_runs', 'scores', 'injection_logs', 'judge_injection_checks', 'appeals', 'calibration_samples',
    'calibration_runs', 'qa_questions', 'qa_answers', 'bulletins', 'ledger_entries', 'public_ledger',
    'corrections', 'flags', 'results', 'leaderboard_frozen', 'awards', 'audit_log', 'rate_limits', 'error_log',
    'client_pings'
  ] loop
    -- Not FORCE: the owner (postgres) runs the SECURITY DEFINER game functions and must bypass RLS.
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Helpers are wrapped in (select …) so Postgres evaluates them once per statement.

-- Public to the event
create policy events_read on public.events for select to authenticated
  using ((select app.sees_all_events()) or id = (select app.my_event_id()));

create policy phases_read on public.phases for select to authenticated
  using ((select app.in_my_event(event_id)));

create policy deadlines_read on public.deadlines for select to authenticated
  using ((select app.in_my_event(event_id)));

create policy rounds_read on public.rounds for select to authenticated
  using ((select app.in_my_event(event_id)));

create policy round_prices_read on public.round_prices for select to authenticated
  using ((select app.in_my_event(event_id)));

create policy companies_read on public.companies for select to authenticated
  using ((select app.in_my_event(event_id)));

create policy public_ledger_read on public.public_ledger for select to authenticated
  using ((select app.in_my_event(event_id)));

create policy qa_questions_read on public.qa_questions for select to authenticated
  using ((select app.is_staff()) or (not hidden and (select app.in_my_event(event_id))));

create policy qa_answers_read on public.qa_answers for select to authenticated
  using ((select app.in_my_event(event_id)));

create policy bulletins_read on public.bulletins for select to authenticated
  using ((select app.is_staff())
     or (published_at is not null and published_at <= now() and (select app.in_my_event(event_id))));

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

create policy ledger_entries_read on public.ledger_entries for select to authenticated
  using ((select app.is_staff()) or team_id = (select app.my_team_id()));

create policy drafts_read on public.drafts for select to authenticated
  using ((select app.is_staff()) or team_id = (select app.my_team_id()));

-- Unlocked by phase
create policy problem_cards_read on public.problem_cards for select to authenticated
  using ((select app.is_staff())
     or ((select app.in_my_event(event_id))
         and (id = (select c.problem_card_id from public.companies c where c.id = (select app.my_company_id()))
              or app.phase_reached(event_id, 'REVEAL_1'))));

create policy crisis_cards_read on public.crisis_cards for select to authenticated
  using ((select app.is_staff())
     or ((select app.in_my_event(event_id)) and app.phase_reached(event_id, 'CRISIS_QA')));

create policy submissions_read on public.submissions for select to authenticated
  using ((select app.is_staff())
     or team_id = (select app.my_team_id())
     or ((select app.in_my_event(event_id))
         and ((type = 'PRD' and app.phase_reached(event_id, 'REVEAL_1'))
           or (type = 'SOLUTION' and app.phase_reached(event_id, 'MARKET_BLIND')))));

create policy scores_read on public.scores for select to authenticated
  using ((select app.is_staff())
     or (status = 'REVEALED' and (select app.in_my_event(event_id))));

create policy results_read on public.results for select to authenticated
  using ((select app.is_staff())
     or ((select app.in_my_event(event_id)) and app.phase_reached(event_id, 'AWARDS')));

create policy awards_read on public.awards for select to authenticated
  using ((select app.is_staff())
     or ((select app.in_my_event(event_id)) and app.phase_reached(event_id, 'AWARDS')));

-- Staff only
create policy event_secrets_read on public.event_secrets for select to authenticated using ((select app.is_staff()));
create policy judge_runs_read on public.judge_runs for select to authenticated using ((select app.is_staff()));
create policy injection_logs_read on public.injection_logs for select to authenticated using ((select app.is_staff()));
create policy judge_injection_checks_read on public.judge_injection_checks for select to authenticated using ((select app.is_staff()));
create policy appeals_read on public.appeals for select to authenticated using ((select app.is_staff()));
create policy calibration_samples_read on public.calibration_samples for select to authenticated using ((select app.is_staff()));
create policy calibration_runs_read on public.calibration_runs for select to authenticated using ((select app.is_staff()));
create policy corrections_read on public.corrections for select to authenticated using ((select app.is_staff()));
create policy leaderboard_frozen_read on public.leaderboard_frozen for select to authenticated using ((select app.is_staff()));
create policy error_log_read on public.error_log for select to authenticated using ((select app.is_staff()));
create policy client_pings_read on public.client_pings for select to authenticated using ((select app.is_staff()));

-- Collusion flags are for the fairness officer only, including their history in the audit log.
create policy flags_read on public.flags for select to authenticated using ((select app.is_fairness()));
create policy audit_log_read on public.audit_log for select to authenticated
  using ((select app.is_staff()) and (entity <> 'flags' or (select app.is_fairness())));

-- rate_limits: RLS on, no policy → no rows for any client role.

-- ───────────────────────────── Realtime ─────────────────────────────

-- Receive only (there is no INSERT policy, so no client can send on a channel). Turn off "Allow public access" in
-- the project's Realtime settings so only private channels exist (docs/DEPLOY.md).
drop policy if exists event_broadcast_read on realtime.messages;
create policy event_broadcast_read on realtime.messages for select to authenticated
  using (realtime.messages.extension = 'broadcast' and (select app.can_hear((select realtime.topic()))));
