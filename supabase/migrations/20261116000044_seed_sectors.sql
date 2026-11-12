-- Seeding an event with sector crisis cards (pnpm seed --crises seed/sectors/crisis-cards.csv) keeps each card's
-- sector: seed_event wrote only the category, number, title and body.
select app.patch_functions(
  '  insert into public.crisis_cards (event_id, category, number, title, body)
  select v_event, x ->> ''category'', coalesce((x ->> ''number'')::smallint, 1), x ->> ''title'', x ->> ''body''',
  '  insert into public.crisis_cards (event_id, category, number, title, body, sector)
  select v_event, x ->> ''category'', coalesce((x ->> ''number'')::smallint, 1), x ->> ''title'', x ->> ''body'',
         nullif(btrim(coalesce(x ->> ''sector'', '''')), '''')');

-- A draft longer than planned pushes the rest of Round 3 (hiring, the solution's due time, ratings, its trading
-- rounds and the phase's end) later by the same amount, so every step keeps its planned length. Before, only the
-- draft's and hiring's deadlines moved, and in a fast rehearsal the solution could fall due before hiring closed.
select app.patch_functions(
  '  v_end timestamptz;
begin
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.format <> ''PRIMUS'' or v_event.current_phase <> ''SATURATION''',
  '  v_end timestamptz;
  v_draft timestamptz;
begin
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.format <> ''PRIMUS'' or v_event.current_phase <> ''SATURATION''');
select app.patch_functions(
  '  update public.deadlines set at = v_end where event_id = p_event and code = ''DRAFT'' and at < v_end;',
  '  select at into v_draft from public.deadlines where event_id = p_event and code = ''DRAFT'';
  if v_draft is not null and v_draft < v_end then
    perform app.shift_schedule(p_event, v_draft, v_end - v_draft);
  end if;');
