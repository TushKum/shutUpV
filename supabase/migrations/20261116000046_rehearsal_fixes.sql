-- Two fixes from the 150-team PRIMUS bot rehearsal.

-- 1. A PRIMUS night has one consultant call (Call 1, from the squad draw until the IPO prices are known, judged when
--    round 4 clears). Calls 2 and 3 open on the classic night's plan and flash releases, which PRIMUS does not have,
--    so their slots could never open: the Calls page showed them as "not open yet" all night and they were judged as
--    missed at the close. The draw now creates them only for a classic night, and a PRIMUS night already drawn loses
--    its unused ones.
select app.patch_functions(
  'select p_event, v_consulting, v_company, n from generate_series(1, 3) n;',
  'select p_event, v_consulting, v_company, n from generate_series(1, case when v_event.format = ''PRIMUS'' then 1 else 3 end) n;');

delete from public.calls k
 using public.events e
 where e.id = k.event_id and e.format = 'PRIMUS' and k.call_no > 1 and k.judged_price is null;

-- 2. Round 3 keeps its order when the draft starts late. A draft that needs more time than planned moves the rest of
--    Round 3 later with it (hiring, the due time, the rating and the rounds keep their planned gaps); the older rule
--    on top of that, "hiring closes at least 10 minutes after the draft", counted real minutes, so on a fast rehearsal
--    clock it moved hiring past the due time and the rating. It is dropped: at the real speed hiring already runs
--    15 minutes after the draft.
select app.patch_functions(
  '  -- Every company gets its 20 seconds: the draft''s deadline moves later if the schedule left too little time, and
  -- hiring for Round 3 keeps at least 10 minutes after it.',
  '  -- Every company gets its 20 seconds: if the schedule left too little time, the draft''s deadline moves later and
  -- the rest of Round 3 with it (hiring, the due time and the rating keep their planned gaps).');
select app.patch_functions(
  '  update public.deadlines set at = v_end + interval ''10 minutes''
   where event_id = p_event and code = ''HIRE_5'' and at < v_end + interval ''10 minutes'';
',
  '');
