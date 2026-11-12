-- The clock never skips a round that is waiting for scores.
--
-- Some rounds open only once scores are released: in a PRIMUS event the last round of each crisis (for that crisis's
-- plan scores) and Round 3's last round (for the solution scores), on the classic night round 18 (for the flash
-- scores). When the scores come out late, the round opens late with its full length and the rest of the night moves
-- later with it. But auto-advance ended a phase on time whenever no round of it had a closing time still ahead, so a
-- round held past its planned close was skipped: in the PRIMUS bot rehearsal the solution scores came out after
-- Round 3's planned end, the market closed without the last round, and the solutions never moved a price. Now
-- auto-advance also waits while a round of the phase is held for scores (the organiser console says which, and an
-- organiser can still advance by hand, which skips it).

create or replace function app.round_waits(p_event uuid, p_number integer, p_waits_for public.submission_type)
returns boolean
language sql
stable
as $$
  select (p_waits_for is not null and not app.score_released(p_event, p_waits_for))
      or (p_waits_for is null and p_number = 18 and not app.score_released(p_event, 'FLASH')
          and exists (select 1 from public.events e where e.id = p_event and e.format = 'CLASSIC'))
$$;
revoke all on function app.round_waits(uuid, integer, public.submission_type) from public, anon, authenticated;

select app.patch_functions(
  '    if now() >= v_phase.ends_at
       and not exists (select 1 from public.rounds where event_id = p_event and phase = v_event.current_phase
                          and status <> ''CLEARED'' and closes_at > now()) then',
  '    if now() >= v_phase.ends_at
       and not exists (select 1 from public.rounds where event_id = p_event and phase = v_event.current_phase
                          and status <> ''CLEARED'' and closes_at > now())
       and not exists (select 1 from public.rounds where event_id = p_event and phase = v_event.current_phase
                          and status = ''SCHEDULED'' and app.round_waits(p_event, number, waits_for)) then');
