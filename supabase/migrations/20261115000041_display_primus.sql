-- The big screen (the DISPLAY account) reads every event's public data through app.sees_all_events(), but the PRIMUS
-- tables only let teams of the event and staff read them, so the projector could show no crisis card, no hire and
-- nothing of the Round 3 draft. It may now read what is public to every team anyway: the sub-rounds, the crisis cards
-- dealt, who hired whom, the draft, and the problem statements from Round 3 on.

create policy subrounds_display on public.subrounds for select to authenticated using (app.sees_all_events());
create policy subround_crises_display on public.subround_crises for select to authenticated using (app.sees_all_events());
create policy engagements_display on public.engagements for select to authenticated using (app.sees_all_events());
create policy draft_picks_display on public.draft_picks for select to authenticated using (app.sees_all_events());
create policy problem_statements_display on public.problem_statements for select to authenticated
  using (app.sees_all_events() and (select current_phase from public.events e where e.id = event_id) >= 'SATURATION');
