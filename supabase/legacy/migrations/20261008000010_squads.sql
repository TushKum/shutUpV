-- Squad life: the 21:00 lottery, problem cards, drafts and submissions, the advisor's fee, the rescue deal,
-- consultant calls, the Q&A board and bulletins.

-- ───────────────────────────── Lottery ─────────────────────────────

create or replace function public.set_seed_commitment(p_event uuid, p_commitment text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.require_organiser();
  if lower(btrim(p_commitment)) !~ '^[0-9a-f]{64}$' then
    raise exception 'the commitment must be a SHA-256 hex digest (64 hex characters)';
  end if;
  -- The commitment is published the day before (the brief): once the event has started it is fixed, so the
  -- seed check on the projector proves the draw was not chosen on the night.
  update public.events set seed_commitment = lower(btrim(p_commitment))
   where id = p_event and drawn_at is null and current_phase = 'SETUP';
  if not found then
    raise exception 'the seed commitment is fixed once the event has started';
  end if;
  return app.ok();
end
$$;

-- The 21:00 draw: verifies the seed against the published commitment, forms the squads, deals the problem cards,
-- assigns coverage, pays the seed money and sets up every squad's workspace. One transaction.
create or replace function public.run_lottery(p_event uuid, p_seed text, p_dice text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_root text;
  v_draw jsonb;
  s jsonb;
  v_squad uuid;
  v_product uuid;
  v_consulting uuid;
  v_finance uuid;
  v_company uuid;
  v_txn uuid := gen_random_uuid();
  v_cover text;
  v_number int;
  v_pick timestamptz;
  v_need timestamptz;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.current_phase <> 'SQUAD_DRAW' then
    raise exception 'the lottery runs in the SQUAD_DRAW phase';
  end if;
  if v_event.drawn_at is not null then
    raise exception 'the lottery has already been drawn';
  end if;
  if v_event.seed_commitment is null then
    raise exception 'no seed commitment was published';
  end if;
  if btrim(coalesce(p_dice, '')) !~ '^[0-9]{1,6}$' then
    raise exception 'the dice roll must be a number';
  end if;
  -- A short or guessable seed could be found from its published hash, revealing the crisis draw early.
  if coalesce(p_seed, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'the seed must be 64 lower-case hex characters (32 random bytes: pnpm new-seed)';
  end if;
  if app.sha256_hex(p_seed) <> v_event.seed_commitment then
    return app.fail('COMMITMENT_MISMATCH', 'SHA-256 of that seed does not match the published commitment.');
  end if;

  v_root := app.sha256_hex(p_seed || btrim(p_dice));
  v_draw := app.lottery_draw(
    v_root,
    array(select code from public.teams where event_id = p_event and track = 'PRODUCT'),
    array(select code from public.teams where event_id = p_event and track = 'CONSULTING'),
    array(select code from public.teams where event_id = p_event and track = 'FINANCE'),
    array(select pc.number::text from public.problem_cards pc where pc.event_id = p_event order by pc.number));

  for s in select * from jsonb_array_elements(v_draw) loop
    select id into v_product from public.teams where event_id = p_event and code = s ->> 'product';
    select id into v_consulting from public.teams where event_id = p_event and code = s ->> 'consulting';
    select id into v_finance from public.teams where event_id = p_event and code = s ->> 'finance';
    v_number := (s ->> 'number')::int;
    insert into public.squads (event_id, number, product_team_id, consulting_team_id, finance_team_id, dealt_card_ids)
    values (p_event, v_number, v_product, v_consulting, v_finance,
            array(select pc.id from jsonb_array_elements_text(s -> 'cards') with ordinality as k(num, i)
                    join public.problem_cards pc on pc.event_id = p_event and pc.number = k.num::int order by k.i))
    returning id into v_squad;
    update public.companies set squad_id = v_squad, exchange_inventory = 35000 where product_team_id = v_product
    returning id into v_company;

    insert into public.fees (event_id, squad_id, company_id, consulting_team_id) values (p_event, v_squad, v_company, v_consulting);
    insert into public.deals (event_id, squad_id, company_id, finance_team_id) values (p_event, v_squad, v_company, v_finance);
    insert into public.submission_drafts (event_id, squad_id, company_id, type)
    select p_event, v_squad, v_company, t from unnest(enum_range(null::public.submission_type)) t;

    -- Shares: 60,000 retained by the company, 5,000 to the squad's fund at $10.00, 35,000 to the exchange for the IPO.
    insert into public.holdings (event_id, team_id, company_id, lot, qty, cost_cents) values
      (p_event, v_product, v_company, 'RETAINED', 60000, 0),
      (p_event, v_finance, v_company, 'SQUAD', 5000, 5000000);
    update public.teams set cash_cents = cash_cents + 5000000 where id = v_product;
    update public.teams set cash_cents = cash_cents - 5000000 where id = v_finance;
    insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, lot, cash_delta_cents, share_delta, price_cents, memo) values
      (p_event, v_txn, 'ISSUE', v_product, v_company, 'RETAINED', 0, 60000, null, 'Company shares held by the Product team'),
      (p_event, v_txn, 'ISSUE', null, v_company, null, 0, 35000, null, 'Shares offered at the IPO'),
      (p_event, v_txn, 'SEED', v_finance, v_company, 'SQUAD', -5000000, 5000, 1000, 'Seed money: 5,000 shares at $10.00'),
      (p_event, v_txn, 'SEED', v_product, v_company, null, 5000000, 0, 1000, 'Seed money received');
    insert into public.public_ledger (event_id, txn_id, kind, label, company_id, cash_cents, shares, price_cents, details)
    values (p_event, v_txn, 'SEED', app.event_label(v_number, 'Finance → company'), v_company, 5000000, 5000, 1000,
            jsonb_build_object('squad', v_number));
  end loop;

  -- Coverage and the empty call slots (3 calls per covered company).
  for s in select * from jsonb_array_elements(v_draw) loop
    select id into v_consulting from public.teams where event_id = p_event and code = s ->> 'consulting';
    for v_cover in select * from jsonb_array_elements_text(s -> 'covers') loop
      select c.id into v_company from public.companies c join public.teams t on t.id = c.product_team_id
       where t.event_id = p_event and t.code = v_cover;
      insert into public.coverage (event_id, consultant_team_id, company_id) values (p_event, v_consulting, v_company);
      insert into public.calls (event_id, consultant_team_id, company_id, call_no)
      select p_event, v_consulting, v_company, n from generate_series(1, 3) n;
    end loop;
  end loop;

  insert into public.event_secrets (event_id, seed, entered_by) values (p_event, p_seed, auth.uid())
  on conflict (event_id) do update set seed = excluded.seed, entered_at = now(), entered_by = excluded.entered_by;
  update public.events set dice = btrim(p_dice), drawn_at = now() where id = p_event;

  -- The Product team has 10 event minutes from the draw to pick its card, even when the draw runs late: the pick
  -- deadline (and the end of SQUAD_DRAW and everything after it) moves later if needed.
  v_pick := app.deadline(p_event, 'PROBLEM_PICK');
  v_need := now() + make_interval(secs => 600.0 / v_event.clock_speed);
  if v_pick is not null and v_pick < v_need then
    perform app.shift_schedule(p_event, v_pick, v_need - v_pick);
  end if;
  -- SQUAD_DRAW runs until BUILD is due (a pause while the draw was awaited moves BUILD but not the overdue
  -- SQUAD_DRAW end), so BUILD starts on time and keeps its 80 minutes.
  update public.phases sd set ends_at = b.starts_at
    from public.phases b
   where sd.event_id = p_event and sd.code = 'SQUAD_DRAW' and b.event_id = p_event and b.code = 'BUILD'
     and b.started_at is null and sd.ends_at < b.starts_at;

  perform app.broadcast(p_event, 'squad_draw', jsonb_build_object(
    'commitment', v_event.seed_commitment, 'dice', btrim(p_dice), 'verified', true,
    'squads', jsonb_array_length(v_draw)));
  return app.ok(jsonb_build_object('squads', jsonb_array_length(v_draw), 'root_sha256', app.sha256_hex(v_root)));
end
$$;

create or replace function public.pick_problem_card(p_card uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_squad public.squads;
begin
  -- Throttle first (it touches only the team's rate-limit row), then lock the team (PLAN §46).
  if app.my_team_id() is null then
    raise exception 'only a team can pick a problem card' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  v_team := app.lock_caller_team();
  v_squad := app.squad_of_team(v_team.id);
  if v_team.track <> 'PRODUCT' or v_squad.id is null then
    return app.reject(v_team.event_id, 'pick_problem_card', 'NOT_ALLOWED', 'The Product team picks the squad''s problem card.');
  end if;
  if app.deadline_passed(v_team.event_id, 'PROBLEM_PICK') then
    return app.reject(v_team.event_id, 'pick_problem_card', 'DEADLINE_PASSED', 'The problem card pick has closed.');
  end if;
  if not p_card = any (v_squad.dealt_card_ids) then
    return app.reject(v_team.event_id, 'pick_problem_card', 'NOT_DEALT', 'Pick one of the three cards dealt to your squad.');
  end if;
  update public.squads set chosen_card_id = p_card, chosen_at = now(), chosen_by_default = false where id = v_squad.id;
  return app.ok(jsonb_build_object('card_id', p_card));
end
$$;

-- At the pick deadline, squads that did not pick get their first dealt card. Idempotent.
create or replace function app.default_problem_cards(p_event uuid)
returns void
language sql
as $$
  update public.squads set chosen_card_id = dealt_card_ids[1], chosen_at = now(), chosen_by_default = true
   where event_id = p_event and chosen_card_id is null and cardinality(dealt_card_ids) = 3
$$;

-- At READING, a company without a ticker gets an unused one: Z + three letters. Idempotent.
create or replace function app.default_tickers(p_event uuid)
returns void
language plpgsql
as $$
declare
  c record;
  v_ticker text;
  n int;
begin
  for c in select co.id, s.number from public.companies co join public.squads s on s.id = co.squad_id
            where co.event_id = p_event and co.ticker is null order by s.number loop
    n := c.number;
    loop
      v_ticker := 'Z' || chr(65 + (n / 676) % 26) || chr(65 + (n / 26) % 26) || chr(65 + n % 26);
      exit when not exists (select 1 from public.companies where event_id = p_event and ticker = v_ticker);
      n := n + 1;
    end loop;
    -- A pitch that committed meanwhile keeps its own ticker.
    update public.companies set ticker = v_ticker, name = coalesce(name, 'Company ' || v_ticker) where id = c.id and ticker is null;
  end loop;
end
$$;

-- ───────────────────────────── Drafts and submissions ─────────────────────────────

-- Who may write which submission, and when its window is open.
create or replace function app.submission_window(p_team public.teams, p_type public.submission_type, out allowed boolean, out open boolean, out deadline_code public.deadline_code)
language plpgsql stable
as $$
declare
  v_event public.events;
begin
  select * into v_event from public.events where id = p_team.event_id;
  allowed := case p_type when 'PITCH' then p_team.track = 'PRODUCT' else p_team.track in ('PRODUCT', 'CONSULTING') end;
  deadline_code := case p_type when 'PITCH' then 'PITCH' when 'PLAN' then 'PLAN' else 'FLASH' end;
  -- Open from its start until its deadline, and never once the phase that publishes this work has begun
  -- (an early advance also pulls the deadline in; this is the second lock).
  open := v_event.drawn_at is not null and not app.deadline_passed(v_event.id, deadline_code) and case p_type
    when 'PITCH' then v_event.current_phase between 'SQUAD_DRAW' and 'BUILD'
    when 'PLAN' then v_event.current_phase between 'CRISIS' and 'RESCUE_2'
    else exists (select 1 from public.bulletins b where b.event_id = v_event.id and b.kind = 'FLASH'
                    and b.published_at is not null and b.published_at <= now())
         and not app.score_released(v_event.id, 'FLASH')
  end;
end
$$;

create or replace function public.save_draft(p_type public.submission_type, p_content jsonb, p_expected_version integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_squad public.squads;
  v_draft public.submission_drafts;
  w record;
begin
  -- Throttle first (it touches only the team's rate-limit row), then lock the team (PLAN §46).
  if app.my_team_id() is null then
    raise exception 'only a team can edit a draft' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  v_team := app.lock_caller_team();
  v_squad := app.squad_of_team(v_team.id);
  select * into w from app.submission_window(v_team, p_type);
  if v_squad.id is null or not w.allowed then
    return app.reject(v_team.event_id, 'save_draft', 'NOT_ALLOWED', 'Your team cannot edit this submission.');
  end if;
  if not w.open then
    return app.reject(v_team.event_id, 'save_draft', 'DEADLINE_PASSED', 'This submission is closed.',
                      jsonb_build_object('type', p_type));
  end if;
  if jsonb_typeof(p_content) <> 'object' or length(p_content::text) > 20000
     or exists (select 1 from jsonb_each(p_content) x
                 where (x.key in (select f.key from app.template_fields(p_type) f)
                        or (p_type = 'PITCH' and x.key in ('company_name', 'ticker')))
                   and jsonb_typeof(x.value) not in ('string', 'null')) then
    return app.reject(v_team.event_id, 'save_draft', 'BAD_CONTENT', 'The draft is not valid.');
  end if;
  -- Only the template's fields are kept (and the company name and ticker of a pitch).
  p_content := coalesce((select jsonb_object_agg(x.key, x.value) from jsonb_each(p_content) x
                          where x.key in (select f.key from app.template_fields(p_type) f)
                             or (p_type = 'PITCH' and x.key in ('company_name', 'ticker'))), '{}'::jsonb);
  select * into v_draft from public.submission_drafts where squad_id = v_squad.id and type = p_type for no key update;
  if v_draft.version <> p_expected_version then
    return app.fail('VERSION_CONFLICT', 'Someone else in your squad saved a newer version.',
                    jsonb_build_object('draft', to_jsonb(v_draft)));
  end if;
  update public.submission_drafts
     set content = p_content, version = version + 1, updated_at = now(), updated_by_team = v_team.id
   where id = v_draft.id
  returning * into v_draft;
  return app.ok(jsonb_build_object('draft', to_jsonb(v_draft),
                                   'words', app.submission_words(p_type, p_content)));
end
$$;

-- Submits the current draft. A submission after the deadline is refused (and logged); the last on-time
-- submission is the one judged. For a pitch, the company name and ticker are set from it.
create or replace function public.submit_submission(p_type public.submission_type)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_squad public.squads;
  v_draft public.submission_drafts;
  v_company public.companies;
  v_words int;
  v_limit int := case p_type when 'PITCH' then 400 when 'PLAN' then 500 else 100 end;
  v_ticker text;
  v_name text;
  v_sub public.submissions;
  w record;
begin
  -- Throttle first (it touches only the team's rate-limit row), then lock the team (PLAN §46).
  if app.my_team_id() is null then
    raise exception 'only a team can submit' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) or not app.rate_limit(app.my_team_id(), 'submit', 10, interval '1 minute') then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  v_team := app.lock_caller_team();
  v_squad := app.squad_of_team(v_team.id);
  select * into w from app.submission_window(v_team, p_type);
  if v_squad.id is null or not w.allowed then
    return app.reject(v_team.event_id, 'submit', 'NOT_ALLOWED', 'Your team cannot submit this.', jsonb_build_object('type', p_type));
  end if;
  -- The draft and the company are locked before the window is checked: an advance that publishes the work locks
  -- every company first, so a submission either commits before it or sees the window closed.
  select * into v_draft from public.submission_drafts where squad_id = v_squad.id and type = p_type for no key update;
  select * into v_company from public.companies where squad_id = v_squad.id for no key update;
  select * into w from app.submission_window(v_team, p_type);
  if not w.open then
    return app.reject(v_team.event_id, 'submit', 'DEADLINE_PASSED', 'The deadline has passed; this submission was not accepted.',
                      jsonb_build_object('type', p_type, 'at', now()));
  end if;
  -- Submitting the same text again changes nothing and stores nothing.
  select * into v_sub from public.submissions where company_id = v_company.id and type = p_type and superseded_at is null;
  if v_sub.id is not null and v_sub.content = v_draft.content then
    return app.ok(jsonb_build_object('submission', to_jsonb(v_sub), 'duplicate', true));
  end if;
  v_words := app.submission_words(p_type, v_draft.content);
  if v_words = 0 then
    return app.reject(v_team.event_id, 'submit', 'EMPTY', 'Write something before submitting.', jsonb_build_object('type', p_type));
  end if;
  if v_words > v_limit then
    return app.reject(v_team.event_id, 'submit', 'TOO_LONG', format('At most %s words (you have %s).', v_limit, v_words),
                      jsonb_build_object('type', p_type, 'words', v_words));
  end if;
  if p_type = 'PITCH' then
    v_name := app.content_field(v_draft.content, 'company_name');
    v_ticker := upper(app.content_field(v_draft.content, 'ticker'));
    if length(v_name) < 1 or length(v_name) > 60 then
      return app.reject(v_team.event_id, 'submit', 'MISSING_NAME', 'Enter the company name (up to 60 characters).');
    end if;
    if v_ticker !~ '^[A-Z]{3,4}$' then
      return app.reject(v_team.event_id, 'submit', 'BAD_TICKER', 'The ticker is 3 or 4 letters, e.g. AQS.');
    end if;
    if exists (select 1 from public.companies where event_id = v_team.event_id and ticker = v_ticker and id <> v_company.id) then
      return app.reject(v_team.event_id, 'submit', 'TICKER_TAKEN', 'Another company already uses that ticker.');
    end if;
    update public.companies set name = v_name, ticker = v_ticker where id = v_company.id;
  end if;

  update public.submissions set superseded_at = now()
   where company_id = v_company.id and type = p_type and superseded_at is null;
  insert into public.submissions (event_id, squad_id, company_id, type, content, body_text, word_count, submitted_by_team)
  values (v_team.event_id, v_squad.id, v_company.id, p_type, v_draft.content,
          app.submission_text(p_type, v_draft.content), v_words, v_team.id)
  returning * into v_sub;
  return app.ok(jsonb_build_object('submission', to_jsonb(v_sub)));
end
$$;

-- ───────────────────────────── The advisor's fee ─────────────────────────────

create or replace function app.fee_window_open(p_event uuid)
returns boolean
language sql stable
as $$
  select e.current_phase >= 'CRISIS' and e.crisis_applied_at is not null and not app.deadline_passed(e.id, 'FEE')
    from public.events e where e.id = p_event
$$;

create or replace function public.propose_fee(p_cash bigint, p_shares integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_squad public.squads;
  v_fee public.fees;
  v_company public.companies;
  v_product public.teams;
  v_retained int;
  v_code text;
  v_details jsonb := jsonb_build_object('cash', p_cash, 'shares', p_shares);
begin
  -- Throttle first (it touches only the team's rate-limit row), then lock the team (PLAN §46).
  if app.my_team_id() is null then
    raise exception 'only a team can propose a fee' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  select t.* into v_team from public.teams t where t.id = app.my_team_id();
  v_squad := app.squad_of_team(v_team.id);
  if v_squad.id is null or v_team.track not in ('PRODUCT', 'CONSULTING') then
    return app.reject(v_team.event_id, 'propose_fee', 'NOT_ALLOWED', 'The fee is agreed by the Product and Consulting teams.', v_details);
  end if;
  -- Lock order: the squad's fee row, then its teams in id order (PLAN §46); then check the window.
  select * into v_fee from public.fees where squad_id = v_squad.id for no key update;
  perform 1 from public.teams where id in (v_squad.product_team_id, v_squad.consulting_team_id) order by id for no key update;
  if not app.fee_window_open(v_team.event_id) then
    return app.reject(v_team.event_id, 'propose_fee', 'DEADLINE_PASSED', 'The fee can be agreed after the crisis and until 01:05.', v_details);
  end if;
  if v_fee.executed_at is not null then
    return app.reject(v_team.event_id, 'propose_fee', 'ALREADY_AGREED', 'The fee has already been agreed.', v_details);
  end if;
  select * into v_company from public.companies where id = v_fee.company_id;
  select * into v_product from public.teams where id = v_squad.product_team_id;
  select coalesce(sum(qty), 0) into v_retained from public.holdings where team_id = v_product.id and company_id = v_company.id and lot = 'RETAINED';
  v_code := app.check_fee(p_cash, p_shares, v_company.ipo_price, v_product.cash_cents, v_retained);
  if v_code is not null then
    return app.reject(v_team.event_id, 'propose_fee', v_code,
      case v_code
        when 'BAD_TERMS' then 'Cash and shares must be whole, non-negative amounts.'
        when 'TOO_MANY_SHARES' then 'At most 3,000 shares can be part of the fee.'
        when 'FEE_RANGE' then 'The fee must be worth $10,000 to $35,000 (shares at the IPO price).'
        when 'NOT_ENOUGH_CASH' then 'The company does not have that much cash.'
        else 'The company does not hold that many shares.' end,
      v_details);
  end if;
  update public.fees
     set cash_cents = p_cash, shares = p_shares, value_cents = app.fee_value(p_cash, p_shares, v_company.ipo_price),
         version = version + 1, product_confirmed_at = null, consulting_confirmed_at = null,
         updated_at = now(), updated_by_team = v_team.id
   where id = v_fee.id
  returning * into v_fee;
  return app.ok(jsonb_build_object('fee', to_jsonb(v_fee)));
end
$$;

-- Moves an agreed (or default) fee: cash and retained shares from the company to the consultant.
create or replace function app.execute_fee(p_fee uuid, p_default boolean)
returns void
language plpgsql
as $$
declare
  v_fee public.fees;
  v_squad public.squads;
  v_txn uuid := gen_random_uuid();
begin
  select * into v_fee from public.fees where id = p_fee for no key update;
  if v_fee.executed_at is not null then
    return;
  end if;
  select * into v_squad from public.squads where id = v_fee.squad_id;
  perform 1 from public.teams where id in (v_squad.product_team_id, v_squad.consulting_team_id) order by id for no key update;
  if p_default then
    update public.fees set cash_cents = 2250000, shares = 0, value_cents = 2250000, is_default = true where id = v_fee.id
    returning * into v_fee;
  end if;
  update public.teams set cash_cents = cash_cents - v_fee.cash_cents where id = v_squad.product_team_id;
  update public.teams set cash_cents = cash_cents + v_fee.cash_cents where id = v_squad.consulting_team_id;
  if v_fee.shares > 0 then
    update public.holdings set qty = qty - v_fee.shares, updated_at = now()
     where team_id = v_squad.product_team_id and company_id = v_fee.company_id and lot = 'RETAINED';
    insert into public.holdings (event_id, team_id, company_id, lot, qty, cost_cents)
    values (v_fee.event_id, v_squad.consulting_team_id, v_fee.company_id, 'FEE', v_fee.shares, 0)
    on conflict (team_id, company_id, lot) do update set qty = public.holdings.qty + excluded.qty, updated_at = now();
  end if;
  insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, lot, cash_delta_cents, share_delta, ref_table, ref_id, memo) values
    (v_fee.event_id, v_txn, case when p_default then 'FEE_DEFAULT' else 'FEE' end::public.ledger_kind, v_squad.product_team_id,
     v_fee.company_id, 'RETAINED', -v_fee.cash_cents, -v_fee.shares, 'fees', v_fee.id, 'Advisor fee paid'),
    (v_fee.event_id, v_txn, case when p_default then 'FEE_DEFAULT' else 'FEE' end::public.ledger_kind, v_squad.consulting_team_id,
     v_fee.company_id, 'FEE', v_fee.cash_cents, v_fee.shares, 'fees', v_fee.id, 'Advisor fee received');
  update public.fees set executed_at = now() where id = v_fee.id;
  insert into public.public_ledger (event_id, txn_id, kind, label, company_id, cash_cents, shares, details)
  values (v_fee.event_id, v_txn, case when p_default then 'FEE_DEFAULT' else 'FEE' end,
          app.event_label(v_squad.number, case when p_default then 'default advisor fee' else 'advisor fee' end),
          v_fee.company_id, v_fee.cash_cents, v_fee.shares, jsonb_build_object('squad', v_squad.number, 'value', v_fee.value_cents));
end
$$;

create or replace function public.confirm_fee(p_version integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_squad public.squads;
  v_fee public.fees;
  v_product public.teams;
  v_retained int;
  v_code text;
begin
  -- Throttle first (it touches only the team's rate-limit row), then lock the team (PLAN §46).
  if app.my_team_id() is null then
    raise exception 'only a team can confirm a fee' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  select t.* into v_team from public.teams t where t.id = app.my_team_id();
  v_squad := app.squad_of_team(v_team.id);
  if v_squad.id is null or v_team.track not in ('PRODUCT', 'CONSULTING') then
    return app.reject(v_team.event_id, 'confirm_fee', 'NOT_ALLOWED', 'The fee is agreed by the Product and Consulting teams.');
  end if;
  -- Lock order: the squad's fee row, then its teams in id order (PLAN §46); then check the window.
  select * into v_fee from public.fees where squad_id = v_squad.id for no key update;
  perform 1 from public.teams where id in (v_squad.product_team_id, v_squad.consulting_team_id) order by id for no key update;
  if not app.fee_window_open(v_team.event_id) then
    return app.reject(v_team.event_id, 'confirm_fee', 'DEADLINE_PASSED', 'The fee deadline (01:05) has passed.');
  end if;
  if v_fee.executed_at is not null then
    return app.reject(v_team.event_id, 'confirm_fee', 'ALREADY_AGREED', 'The fee has already been agreed.');
  end if;
  if v_fee.version <> p_version or v_fee.value_cents = 0 then
    return app.fail('VERSION_CONFLICT', 'The fee proposal has changed; review it before confirming.', jsonb_build_object('fee', to_jsonb(v_fee)));
  end if;
  if v_team.track = 'PRODUCT' then
    update public.fees set product_confirmed_at = now() where id = v_fee.id returning * into v_fee;
  else
    update public.fees set consulting_confirmed_at = now() where id = v_fee.id returning * into v_fee;
  end if;
  if v_fee.product_confirmed_at is not null and v_fee.consulting_confirmed_at is not null then
    -- Balances may have changed since the proposal: check again before moving anything.
    select * into v_product from public.teams where id = v_squad.product_team_id;
    select coalesce(sum(qty), 0) into v_retained from public.holdings where team_id = v_product.id and company_id = v_fee.company_id and lot = 'RETAINED';
    v_code := app.check_fee(v_fee.cash_cents, v_fee.shares, (select ipo_price from public.companies where id = v_fee.company_id),
                            v_product.cash_cents, v_retained);
    if v_code is not null then
      update public.fees set product_confirmed_at = null, consulting_confirmed_at = null where id = v_fee.id;
      return app.reject(v_team.event_id, 'confirm_fee', v_code, 'The company can no longer pay this fee; propose new terms.');
    end if;
    perform app.execute_fee(v_fee.id, false);
    select * into v_fee from public.fees where id = v_fee.id;
  end if;
  return app.ok(jsonb_build_object('fee', to_jsonb(v_fee)));
end
$$;

-- At 01:05, every squad without an agreed fee pays the default $22,500 cash. Idempotent.
create or replace function app.apply_default_fees(p_event uuid)
returns integer
language plpgsql
as $$
declare
  f record;
  n int := 0;
begin
  for f in select id from public.fees where event_id = p_event and executed_at is null loop
    perform app.execute_fee(f.id, true);
    n := n + 1;
  end loop;
  return n;
end
$$;

-- ───────────────────────────── The rescue deal ─────────────────────────────

create or replace function app.deal_window_open(p_event uuid)
returns boolean
language sql stable
as $$
  select e.current_phase between 'CRISIS' and 'RESCUE_2' and e.crisis_applied_at is not null
     and not app.deadline_passed(e.id, 'DEAL')
    from public.events e where e.id = p_event
$$;

-- Consulting proposes the price; Finance sets the amount. Any edit resets all signatures.
create or replace function public.edit_deal(p_amount bigint default null, p_price integer default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_squad public.squads;
  v_deal public.deals;
  v_post bigint;
  v_details jsonb := jsonb_build_object('amount', p_amount, 'price', p_price);
begin
  -- Throttle first (it touches only the team's rate-limit row), then lock the team (PLAN §46).
  if app.my_team_id() is null then
    raise exception 'only a team can edit the deal' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  select t.* into v_team from public.teams t where t.id = app.my_team_id();
  v_squad := app.squad_of_team(v_team.id);
  if v_squad.id is null
     or (p_price is not null and v_team.track <> 'CONSULTING')
     or (p_amount is not null and v_team.track <> 'FINANCE')
     or (p_price is null and p_amount is null) then
    return app.reject(v_team.event_id, 'edit_deal', 'NOT_ALLOWED',
                      'The Consulting team proposes the price and the Finance team sets the amount.', v_details);
  end if;
  -- The squad's deal row first (PLAN §46); the window is checked under it, so an advance that publishes the
  -- plans (and locks every deal) is seen.
  select * into v_deal from public.deals where squad_id = v_squad.id for no key update;
  if not app.deal_window_open(v_team.event_id) then
    return app.reject(v_team.event_id, 'edit_deal', 'DEADLINE_PASSED', 'The deal can be agreed after the crisis and until 03:00.', v_details);
  end if;
  if v_deal.executed_at is not null then
    return app.reject(v_team.event_id, 'edit_deal', 'ALREADY_SIGNED', 'The deal has been signed by all three teams.', v_details);
  end if;
  select post_crisis_price into v_post from public.companies where id = v_deal.company_id;
  if p_amount is not null and (p_amount < 4000000 or p_amount > 8000000) then
    return app.reject(v_team.event_id, 'edit_deal', 'AMOUNT_RANGE', 'The rescue amount must be $40,000 to $80,000.', v_details);
  end if;
  if p_price is not null and (p_price::bigint * 2 < v_post or p_price > v_post) then
    return app.reject(v_team.event_id, 'edit_deal', 'PRICE_RANGE', 'The price must be 50%–100% of the post-crisis price.', v_details);
  end if;
  update public.deals
     set amount_cents = coalesce(p_amount, amount_cents), price_cents = coalesce(p_price, price_cents),
         version = version + 1, signed_product_at = null, signed_consulting_at = null, signed_finance_at = null,
         updated_at = now(), updated_by_team = v_team.id
   where id = v_deal.id
  returning * into v_deal;
  if v_deal.amount_cents is not null and v_deal.price_cents is not null then
    update public.deals
       set shares = app.floor_div(amount_cents, price_cents), cash_moved_cents = app.floor_div(amount_cents, price_cents) * price_cents
     where id = v_deal.id
    returning * into v_deal;
  end if;
  return app.ok(jsonb_build_object('deal', to_jsonb(v_deal)));
end
$$;

-- All three squad teams sign the same version. The third signature executes the deal at once.
create or replace function public.sign_deal(p_version integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_squad public.squads;
  v_deal public.deals;
  v_post bigint;
  v_fund public.teams;
  v_reserved bigint;
  v_retained int;
  v_code text;
  v_txn uuid := gen_random_uuid();
begin
  -- Throttle first (it touches only the team's rate-limit row), then lock the team (PLAN §46).
  if app.my_team_id() is null then
    raise exception 'only a team can sign the deal' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  select t.* into v_team from public.teams t where t.id = app.my_team_id();
  v_squad := app.squad_of_team(v_team.id);
  if v_squad.id is null then
    return app.reject(v_team.event_id, 'sign_deal', 'NOT_ALLOWED', 'Only the squad''s teams sign its deal.');
  end if;
  -- Lock order: the squad's deal row, then the two balances in id order (PLAN §46); the window is checked under
  -- the deal lock, so an advance that publishes the plans (and locks every deal) is seen.
  select * into v_deal from public.deals where squad_id = v_squad.id for no key update;
  perform 1 from public.teams where id in (v_squad.product_team_id, v_squad.finance_team_id) order by id for no key update;
  if not app.deal_window_open(v_team.event_id) then
    return app.reject(v_team.event_id, 'sign_deal', 'DEADLINE_PASSED', 'The deal deadline (03:00) has passed.');
  end if;
  if v_deal.executed_at is not null then
    return app.reject(v_team.event_id, 'sign_deal', 'ALREADY_SIGNED', 'The deal has already been signed by all three teams.');
  end if;
  if v_deal.version <> p_version or v_deal.amount_cents is null or v_deal.price_cents is null then
    return app.fail('VERSION_CONFLICT', 'The deal terms have changed or are incomplete; review them before signing.',
                    jsonb_build_object('deal', to_jsonb(v_deal)));
  end if;
  select post_crisis_price into v_post from public.companies where id = v_deal.company_id;
  v_code := app.check_deal_terms(v_deal.amount_cents, v_deal.price_cents, v_post);
  if v_code is not null then
    return app.reject(v_team.event_id, 'sign_deal', v_code, 'The deal terms are outside the allowed limits.');
  end if;

  update public.deals
     set signed_product_at = case when v_team.track = 'PRODUCT' then now() else signed_product_at end,
         signed_consulting_at = case when v_team.track = 'CONSULTING' then now() else signed_consulting_at end,
         signed_finance_at = case when v_team.track = 'FINANCE' then now() else signed_finance_at end
   where id = v_deal.id
  returning * into v_deal;

  if v_deal.signed_product_at is not null and v_deal.signed_consulting_at is not null and v_deal.signed_finance_at is not null then
    -- Check both balances again before moving anything.
    select * into v_fund from public.teams where id = v_squad.finance_team_id;
    select coalesce(sum(o.reserve_cents), 0) into v_reserved
      from public.orders o join public.rounds r on r.id = o.round_id
     where o.team_id = v_fund.id and o.status = 'PENDING' and r.status = 'OPEN';
    select coalesce(sum(qty), 0) into v_retained from public.holdings
     where team_id = v_squad.product_team_id and company_id = v_deal.company_id and lot = 'RETAINED';
    v_code := app.check_deal(v_deal.amount_cents, v_deal.price_cents, v_post,
                             v_fund.cash_cents - v_fund.collateral_cents - v_reserved, v_retained);
    if v_code is not null then
      update public.deals set signed_product_at = null, signed_consulting_at = null, signed_finance_at = null where id = v_deal.id;
      return app.reject(v_team.event_id, 'sign_deal', v_code,
        case v_code when 'FUND_CASH' then 'The fund does not have that much available cash; the signatures were reset.'
                    else 'The company does not hold that many shares; the signatures were reset.' end);
    end if;
    update public.teams set cash_cents = cash_cents - v_deal.cash_moved_cents where id = v_squad.finance_team_id;
    update public.teams set cash_cents = cash_cents + v_deal.cash_moved_cents where id = v_squad.product_team_id;
    update public.holdings set qty = qty - v_deal.shares, updated_at = now()
     where team_id = v_squad.product_team_id and company_id = v_deal.company_id and lot = 'RETAINED';
    update public.holdings set qty = qty + v_deal.shares, cost_cents = cost_cents + v_deal.cash_moved_cents, updated_at = now()
     where team_id = v_squad.finance_team_id and company_id = v_deal.company_id and lot = 'SQUAD';
    insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, lot, cash_delta_cents, share_delta, price_cents, ref_table, ref_id, memo) values
      (v_deal.event_id, v_txn, 'DEAL', v_squad.finance_team_id, v_deal.company_id, 'SQUAD', -v_deal.cash_moved_cents, v_deal.shares,
       v_deal.price_cents, 'deals', v_deal.id, 'Rescue investment'),
      (v_deal.event_id, v_txn, 'DEAL', v_squad.product_team_id, v_deal.company_id, 'RETAINED', v_deal.cash_moved_cents, -v_deal.shares,
       v_deal.price_cents, 'deals', v_deal.id, 'Rescue money received');
    update public.deals set executed_at = now() where id = v_deal.id returning * into v_deal;
    insert into public.public_ledger (event_id, txn_id, kind, label, company_id, cash_cents, shares, price_cents, details)
    values (v_deal.event_id, v_txn, 'DEAL', app.event_label(v_squad.number, 'rescue deal'), v_deal.company_id,
            v_deal.cash_moved_cents, v_deal.shares, v_deal.price_cents,
            jsonb_build_object('squad', v_squad.number, 'post_crisis_price', v_post));
  end if;
  return app.ok(jsonb_build_object('deal', to_jsonb(v_deal)));
end
$$;

-- ───────────────────────────── Consultant calls ─────────────────────────────

create or replace function public.make_call(p_company uuid, p_call_no integer, p_direction public.call_dir)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_event public.events;
  v_open boolean;
  v_call public.calls;
begin
  -- Throttle first (it touches only the team's rate-limit row), then lock the team (PLAN §46).
  if app.my_team_id() is null then
    raise exception 'only a team can make a call' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  v_team := app.lock_caller_team();
  select * into v_call from public.calls
   where consultant_team_id = v_team.id and company_id = p_company and call_no = p_call_no for no key update;
  if v_call.id is null then
    return app.reject(v_team.event_id, 'make_call', 'NOT_ASSIGNED', 'You can only call your two assigned companies.');
  end if;
  select * into v_event from public.events where id = v_team.event_id;
  -- Each window closes at its due time, and in any case before the price it is judged at becomes known.
  v_open := case p_call_no
    when 1 then v_event.drawn_at is not null and not app.deadline_passed(v_event.id, 'CALL_1')
                and not app.score_released(v_event.id, 'PITCH')
    when 2 then app.score_released(v_event.id, 'PLAN') and not app.deadline_passed(v_event.id, 'CALL_2')
                and not app.score_released(v_event.id, 'FLASH')
    else app.score_released(v_event.id, 'FLASH') and not app.deadline_passed(v_event.id, 'CALL_3')
         and v_event.market_closed_at is null
  end;
  if not v_open or v_call.judged_price is not null then
    return app.reject(v_team.event_id, 'make_call', 'CALL_CLOSED', 'This call is not open.',
                      jsonb_build_object('call_no', p_call_no, 'company_id', p_company));
  end if;
  update public.calls set direction = p_direction, made_at = now() where id = v_call.id returning * into v_call;
  return app.ok(jsonb_build_object('call', to_jsonb(v_call)));
end
$$;

-- ───────────────────────────── Q&A and bulletins ─────────────────────────────

create or replace function public.post_question(p_company uuid, p_body text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_event public.events;
  v_q public.qa_questions;
begin
  -- Throttle first (it touches only the team's rate-limit row), then lock the team (PLAN §46).
  if app.my_team_id() is null then
    raise exception 'only a team can ask a question' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  v_team := app.lock_caller_team();
  if v_team.track <> 'FINANCE' then
    return app.reject(v_team.event_id, 'post_question', 'NOT_ALLOWED', 'Finance teams post questions on the Q&A board.');
  end if;
  select * into v_event from public.events where id = v_team.event_id;
  if v_event.current_phase < 'READING' or v_event.current_phase >= 'CLOSE' then
    return app.reject(v_team.event_id, 'post_question', 'QA_CLOSED', 'The Q&A board is open from 22:30 until the close.');
  end if;
  if not exists (select 1 from public.companies where id = p_company and event_id = v_team.event_id and squad_id is not null) then
    return app.reject(v_team.event_id, 'post_question', 'NOT_LISTED', 'No such company.');
  end if;
  if length(btrim(coalesce(p_body, ''))) = 0 or length(p_body) > 1000 then
    return app.reject(v_team.event_id, 'post_question', 'BAD_LENGTH', 'Questions are 1 to 1,000 characters.');
  end if;
  if not app.rate_limit(v_team.id, 'qa', 10, interval '1 minute') then
    return app.fail('RATE_LIMITED', 'Too many questions in a minute.');
  end if;
  insert into public.qa_questions (event_id, company_id, asker_team_id, body)
  values (v_team.event_id, p_company, v_team.id, btrim(p_body))
  returning * into v_q;
  perform app.broadcast(v_team.event_id, 'qa', jsonb_build_object('company_id', p_company));
  return app.ok(jsonb_build_object('question_id', v_q.id));
end
$$;

create or replace function public.answer_question(p_question uuid, p_body text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_q public.qa_questions;
  v_words int;
  v_a public.qa_answers;
begin
  -- Throttle first (it touches only the team's rate-limit row), then lock the team (PLAN §46).
  if app.my_team_id() is null then
    raise exception 'only a team can answer' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  v_team := app.lock_caller_team();
  select q.* into v_q from public.qa_questions q join public.companies c on c.id = q.company_id
   where q.id = p_question and c.product_team_id = v_team.id;
  if v_q.id is null then
    return app.reject(v_team.event_id, 'answer_question', 'NOT_ALLOWED', 'Only the company that was asked can answer.');
  end if;
  if (select current_phase from public.events where id = v_team.event_id) >= 'CLOSE' then
    return app.reject(v_team.event_id, 'answer_question', 'QA_CLOSED', 'The Q&A board has closed.');
  end if;
  v_words := app.word_count(coalesce(p_body, ''));
  if v_words < 1 or v_words > 100 or length(p_body) > 1500 then
    return app.reject(v_team.event_id, 'answer_question', 'BAD_LENGTH', 'Answers are 1 to 100 words.');
  end if;
  -- Every answer is broadcast to every screen, so answers are throttled like questions.
  if not app.rate_limit(v_team.id, 'qa_answer', 10, interval '1 minute') then
    return app.fail('RATE_LIMITED', 'Too many answers in a minute.');
  end if;
  insert into public.qa_answers (event_id, question_id, company_id, body, word_count)
  values (v_team.event_id, v_q.id, v_q.company_id, btrim(p_body), v_words)
  returning * into v_a;
  perform app.broadcast(v_team.event_id, 'qa', jsonb_build_object('company_id', v_q.company_id));
  return app.ok(jsonb_build_object('answer_id', v_a.id));
end
$$;

create or replace function public.publish_bulletin(p_event uuid, p_kind public.bulletin_kind, p_title text, p_body text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.bulletins;
begin
  perform app.require_organiser();
  insert into public.bulletins (event_id, kind, title, body, published_at, created_by)
  values (p_event, p_kind, btrim(p_title), coalesce(p_body, ''), now(), auth.uid())
  returning * into v_b;
  perform app.broadcast(p_event, 'bulletin', jsonb_build_object('id', v_b.id, 'bulletin_kind', v_b.kind, 'title', v_b.title, 'body', v_b.body));
  return app.ok(jsonb_build_object('bulletin', to_jsonb(v_b)));
end
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.pick_problem_card(uuid)', 'public.save_draft(public.submission_type, jsonb, integer)',
    'public.submit_submission(public.submission_type)', 'public.propose_fee(bigint, integer)', 'public.confirm_fee(integer)',
    'public.edit_deal(bigint, integer)', 'public.sign_deal(integer)', 'public.make_call(uuid, integer, public.call_dir)',
    'public.post_question(uuid, text)', 'public.answer_question(uuid, text)',
    'public.set_seed_commitment(uuid, text)', 'public.run_lottery(uuid, text, text)',
    'public.publish_bulletin(uuid, public.bulletin_kind, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
