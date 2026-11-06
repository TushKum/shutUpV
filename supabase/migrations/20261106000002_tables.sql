-- All tables. Every game table carries event_id so a rehearsal event can live beside the real one.
-- Hard limits from the rules are repeated here as CHECK constraints (defence in depth); the game functions validate
-- them first and return friendly errors.

-- ───────────────────────────── Event and schedule ─────────────────────────────

create table public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name text not null,
  is_rehearsal boolean not null default false,
  clock_speed integer not null default 1 check (clock_speed between 1 and 60),
  timezone text not null default 'Asia/Kolkata',
  starts_at timestamptz not null,                       -- real time of event 20:00
  seed_commitment text check (seed_commitment ~ '^[0-9a-f]{64}$'),
  seed_revealed text,
  dice text,
  current_phase public.phase_code not null default 'SETUP',
  phase_started_at timestamptz,
  paused boolean not null default false,
  paused_at timestamptz,
  auto_advance boolean not null default false,
  -- Which model each round's judge uses: the round's primary or its backup (env JUDGE_*_MODEL / *_BACKUP_MODEL).
  prd_model_slot text not null default 'PRIMARY' check (prd_model_slot in ('PRIMARY', 'BACKUP')),
  solution_model_slot text not null default 'PRIMARY' check (solution_model_slot in ('PRIMARY', 'BACKUP')),
  -- When each one-off step of the night happened (null until then).
  drawn_at timestamptz,                                 -- 21:15 problem cards dealt (and crises, circle fixed)
  twist_published_at timestamptz,                       -- 22:15
  prds_locked_at timestamptz,                           -- 23:00
  prices_started_at timestamptz,                        -- 23:30 starting prices revealed
  crisis_applied_at timestamptz,                        -- 23:45
  solutions_locked_at timestamptz,                      -- 01:45
  solutions_published_at timestamptz,                   -- 02:15
  scores_revealed_at timestamptz,                       -- 02:45
  leaderboard_frozen_at timestamptz,                    -- 03:30
  market_closed_at timestamptz,                         -- 04:30
  settled_at timestamptz,
  exchange_cash_cents bigint not null default 0,        -- the exchange's side of every cash movement
  created_at timestamptz not null default now(),
  check ((paused and paused_at is not null) or (not paused and paused_at is null))
);

-- The secret lottery seed between its entry (21:15) and its reveal (23:45). Staff only.
create table public.event_secrets (
  event_id uuid primary key references public.events (id) on delete cascade,
  seed text not null,
  entered_at timestamptz not null default now(),
  entered_by uuid
);

create table public.phases (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  seq smallint not null,
  code public.phase_code not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  started_at timestamptz,
  ended_at timestamptz,
  unique (event_id, code),
  unique (event_id, seq),
  check (ends_at >= starts_at)
);

create table public.deadlines (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  code public.deadline_code not null,
  at timestamptz not null,
  unique (event_id, code)
);

create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  number smallint not null check (number between 1 and 9),
  phase public.phase_code not null check (phase in ('MARKET_BLIND', 'MARKET')),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  status public.round_status not null default 'SCHEDULED',
  opened_at timestamptz,
  closed_at timestamptz,
  cleared_at timestamptz,
  unique (event_id, number),
  check (closes_at > opens_at)
);

-- ───────────────────────────── People and accounts ─────────────────────────────

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z][0-9]{3}$'),
  name text not null check (length(name) between 1 and 80),
  cash_cents bigint not null default 0,
  disqualified boolean not null default false,
  disqualified_reason text,
  created_at timestamptz not null default now()
);
create index teams_event_idx on public.teams (event_id);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  full_name text not null check (length(full_name) between 1 and 120),
  roll_number text,
  unique (event_id, roll_number)
);
create index members_team_idx on public.members (team_id);

-- One row per login. A staff account can never belong to a team.
create table public.accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.account_role not null,
  team_id uuid unique references public.teams (id) on delete cascade,
  display_name text not null,
  roll_number text,
  created_at timestamptz not null default now(),
  constraint staff_never_in_team check ((role = 'TEAM') = (team_id is not null))
);

-- ───────────────────────────── Content decks ─────────────────────────────

create table public.problem_cards (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  number smallint not null check (number between 1 and 999),
  sector text not null,
  title text not null,
  body text not null,
  unique (event_id, number)
);

-- Ten crisis types; the lottery gives each type to exactly 15 companies (with 150 teams).
create table public.crisis_cards (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  number smallint not null check (number between 1 and 99),
  category text not null,
  title text not null,
  body text not null,
  unique (event_id, number)
);

-- ───────────────────────────── Companies ─────────────────────────────

-- One company per team, built by that team (its founder) in Round 1 and rescued by one other team in Round 2. Prices
-- may only change through the game functions (see the price guard trigger).
--   start_price          set at 23:30 from the PRD score
--   market_price         moved by the crisis, the 02:45 reveal and every clearing
--   score_price          the score-based price: moved only by the judges (start × 0.85 × reveal factor)
--   post_crisis_price    start × 0.85 (the base of the "best company" award)
--   closing_market_price average of the round 8 and 9 clearing prices
--   closing_price        ½ closing market price + ½ score-based price
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  founder_team_id uuid not null unique references public.teams (id) on delete cascade,
  rescuer_team_id uuid unique references public.teams (id) on delete cascade,
  problem_card_id uuid references public.problem_cards (id),
  crisis_card_id uuid references public.crisis_cards (id),
  name text check (length(name) between 1 and 60),
  ticker text check (ticker ~ '^[A-Z]{4}$'),
  start_price integer check (start_price > 0),
  market_price integer check (market_price > 0),
  score_price integer check (score_price > 0),
  post_crisis_price integer check (post_crisis_price > 0),
  closing_market_price integer check (closing_market_price > 0),
  closing_price integer check (closing_price > 0),
  created_at timestamptz not null default now(),
  unique (event_id, ticker),
  check (rescuer_team_id is distinct from founder_team_id)
);
create index companies_event_idx on public.companies (event_id);

-- ───────────────────────────── Positions and trading ─────────────────────────────

-- One position per team per company. Shares are whole numbers, never negative (no short selling), at most 5,000.
create table public.holdings (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  qty integer not null default 0 check (qty between 0 and 5000),
  cost_cents bigint not null default 0 check (cost_cents >= 0),   -- what the shares held cost (average cost basis)
  updated_at timestamptz not null default now(),
  unique (team_id, company_id)
);
create index holdings_company_idx on public.holdings (company_id);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  round_id uuid not null references public.rounds (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  type public.order_type not null,
  qty integer not null check (qty between 1 and 5000),
  status public.order_status not null default 'PENDING',
  entry_price integer not null check (entry_price > 0),
  reserve_cents bigint not null default 0 check (reserve_cents >= 0),   -- a buy reserves qty × price × 1.10
  fill_price integer check (fill_price > 0),
  filled_at timestamptz,
  cancelled_at timestamptz,
  client_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, client_ref)
);
create index orders_round_status_idx on public.orders (round_id, status);
create index orders_team_status_idx on public.orders (team_id, status);

-- Every price change: one CLEARING row per company per round (even with no trades), plus one row per one-off
-- change (START, CRISIS, REVEAL, CLOSE) and per applied appeal.
create table public.round_prices (
  id bigserial primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  round_id uuid references public.rounds (id) on delete cascade,
  kind public.price_kind not null,
  market_before integer,
  market_after integer not null check (market_after > 0),
  score_before integer,
  score_after integer,
  buy_qty integer not null default 0,
  sell_qty integer not null default 0,
  net_qty integer not null default 0,
  capped_net integer not null default 0 check (capped_net between -10000 and 10000),
  factor_bp integer,                    -- REVEAL: 10,000 + 50 × (score − 50)
  created_at timestamptz not null default now(),
  check ((kind = 'CLEARING') = (round_id is not null))
);
create unique index round_prices_clearing_uq on public.round_prices (round_id, company_id) where kind = 'CLEARING';
create unique index round_prices_once_uq on public.round_prices (company_id, kind) where kind in ('START', 'CRISIS', 'REVEAL', 'CLOSE');
create index round_prices_event_idx on public.round_prices (event_id, created_at);

-- ───────────────────────────── Writing and the AI judges ─────────────────────────────

-- A team's working draft: its PRD (for the company it founded) and its crisis solution (for the company it
-- rescues). Autosaved; version-locked so two members typing at once never overwrite each other unseen.
create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  type public.submission_type not null,
  content jsonb not null default '{}',
  version integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (team_id, type),
  unique (company_id, type)
);

-- The draft as it stood at the lock (23:00 for PRDs, 01:45 for solutions): exactly one per company per type, never
-- changed afterwards. A company with no saved draft gets no submission and scores 0.
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,      -- the author
  company_id uuid not null references public.companies (id) on delete cascade,
  type public.submission_type not null,
  content jsonb not null,
  body_text text not null,
  word_count integer not null check (word_count >= 0),
  draft_version integer not null,
  saved_at timestamptz not null,       -- when the draft was last saved (before the lock)
  locked_at timestamptz not null default now(),
  unique (company_id, type)
);

create table public.judge_runs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  submission_id uuid not null references public.submissions (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  type public.submission_type not null,
  generation smallint not null default 1,            -- increases on a technical re-run
  run_no smallint not null check (run_no between 1 and 3),
  model text,
  slot text check (slot in ('PRIMARY', 'BACKUP')),   -- the model slot of its last claim
  prompt_sha text,
  status public.judge_run_status not null default 'QUEUED',
  attempts smallint not null default 0,              -- resettable retry count
  claim_token bigint not null default 0 check (claim_token between 0 and 9007199254740991),   -- lifetime claims
  locked_at timestamptz,
  not_before timestamptz,                            -- sent back to the queue: not claimed before
  request_text text,
  raw_response text,
  breakdown jsonb,
  total smallint check (total between 0 and 100),
  rationale text,
  error text,
  latency_ms integer,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (submission_id, generation, run_no)
);
create index judge_runs_status_idx on public.judge_runs (event_id, status);

-- One score per company per type. PRD points go to the founding team; SOLUTION points to the rescuing team (and the
-- SOLUTION score moves the rescued company's price).
create table public.scores (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,   -- the team that earns the points
  type public.submission_type not null,
  submission_id uuid references public.submissions (id),
  generation smallint not null default 1,
  status public.score_status not null default 'PENDING',
  run_totals smallint[] not null default '{}',
  median smallint check (median between 0 and 100),
  missing boolean not null default false,
  penalty smallint not null default 0 check (penalty between 0 and 100),
  final_score smallint check (final_score between 0 and 100),
  breakdown jsonb,
  rationale text,
  revealed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (company_id, type)
);

create table public.injection_logs (
  id bigserial primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  submission_id uuid not null references public.submissions (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  type public.submission_type not null,
  line text not null,
  pattern text not null,
  created_at timestamptz not null default now()
);

-- One row per submission once a worker has stripped and logged its lines aimed at the judge (also when there were
-- none), so they are logged once however many runs of it are in flight.
create table public.judge_injection_checks (
  submission_id uuid primary key references public.submissions (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  hits integer not null check (hits >= 0),
  checked_at timestamptz not null default now()
);

-- A technical re-run of one submission: a new generation of runs 1–3. Before its round's reveal the new score is
-- sealed as soon as its runs are done (APPLIED). After the reveal it waits (READY) until an organiser applies or
-- dismisses it.
create table public.appeals (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  type public.submission_type not null,
  submission_id uuid not null references public.submissions (id) on delete cascade,
  generation smallint not null,
  after_reveal boolean not null,
  reason text not null check (length(reason) between 5 and 1000),
  status text not null default 'JUDGING' check (status in ('JUDGING', 'READY', 'APPLIED', 'DISMISSED')),
  requested_by uuid,
  requested_at timestamptz not null default now(),
  old_score jsonb,
  new_score jsonb,
  ready_at timestamptz,
  decided_by uuid,
  decided_at timestamptz,
  note text,
  effects jsonb
);
create unique index appeals_open_uq on public.appeals (company_id, type) where status in ('JUDGING', 'READY');
create index appeals_event_idx on public.appeals (event_id, requested_at desc);

-- Calibration (before the event): sample PRDs and crisis solutions judged like real ones, never sealed. Each start is
-- a new batch.
create table public.calibration_samples (
  event_id uuid not null references public.events (id) on delete cascade,
  batch smallint not null check (batch > 0),
  sample_no smallint not null check (sample_no between 1 and 40),
  type public.submission_type not null,
  title text not null,
  expected_min smallint not null check (expected_min between 0 and 100),
  expected_max smallint not null check (expected_max between 0 and 100),
  company_name text not null,
  ticker text not null,
  context_text text not null default '',
  body_text text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (event_id, batch, sample_no),
  check (expected_min <= expected_max)
);

create table public.calibration_runs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  batch smallint not null,
  sample_no smallint not null,
  run_no smallint not null check (run_no between 1 and 3),
  status public.judge_run_status not null default 'QUEUED',
  attempts smallint not null default 0,
  claim_token bigint not null default 0 check (claim_token between 0 and 9007199254740991),
  locked_at timestamptz,
  not_before timestamptz,
  slot text check (slot in ('PRIMARY', 'BACKUP')),
  model text,
  prompt_sha text,
  request_text text,
  raw_response text,
  breakdown jsonb,
  total smallint check (total between 0 and 100),
  rationale text,
  error text,
  latency_ms integer,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (event_id, batch, sample_no, run_no),
  foreign key (event_id, batch, sample_no) references public.calibration_samples (event_id, batch, sample_no) on delete cascade
);
create index calibration_runs_status_idx on public.calibration_runs (event_id, status);

-- ───────────────────────────── Q&A and bulletins ─────────────────────────────

-- 23:45–00:15: a rescuing team asks the founding team of the company it rescues. Every question and answer is public.
create table public.qa_questions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  asker_team_id uuid not null references public.teams (id) on delete cascade,
  body text not null check (length(body) between 1 and 300),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index qa_questions_company_idx on public.qa_questions (company_id, created_at);

create table public.qa_answers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  question_id uuid not null references public.qa_questions (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  body text not null check (length(body) between 1 and 1500),
  word_count integer not null check (word_count between 1 and 150),
  created_at timestamptz not null default now()
);
create index qa_answers_question_idx on public.qa_answers (question_id);

-- The twist (prepared before the event, published at 22:15), rumours (from 00:30), general and fairness notices.
-- An unpublished bulletin is a draft (staff only).
create table public.bulletins (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  kind public.bulletin_kind not null default 'GENERAL',
  title text not null check (length(title) between 1 and 140),
  body text not null default '',
  published_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index bulletins_event_idx on public.bulletins (event_id, published_at desc);
create unique index bulletins_one_twist_uq on public.bulletins (event_id) where kind = 'TWIST';

-- ───────────────────────────── Ledger ─────────────────────────────

-- Append-only. One row per party per leg; team_id NULL means the exchange.
-- Invariant: teams.cash_cents = sum(cash_delta_cents) and holdings.qty = sum(share_delta) per team and company.
create table public.ledger_entries (
  id bigserial primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  txn_id uuid not null,
  kind public.ledger_kind not null,
  team_id uuid references public.teams (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  cash_delta_cents bigint not null default 0,
  share_delta integer not null default 0,
  price_cents integer,
  round_id uuid references public.rounds (id) on delete cascade,
  ref_table text,
  ref_id uuid,
  memo text,
  created_at timestamptz not null default now(),
  created_by uuid,
  check (share_delta = 0 or company_id is not null)
);
create index ledger_team_idx on public.ledger_entries (team_id, id);
create index ledger_event_idx on public.ledger_entries (event_id, id);
create index ledger_txn_idx on public.ledger_entries (txn_id);

-- What every team may see: every filled trade (team code, company, side, quantity, price) once its round clears,
-- per-round market totals, price changes and published corrections.
create table public.public_ledger (
  id bigserial primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  txn_id uuid,
  kind text not null,
  label text not null,
  team_code text,
  company_id uuid references public.companies (id) on delete cascade,
  ticker text,
  side text check (side in ('BUY', 'SELL')),
  cash_cents bigint,
  shares integer,
  price_cents integer,
  round_number smallint,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index public_ledger_event_idx on public.public_ledger (event_id, id);

create table public.corrections (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  reason text not null check (length(reason) >= 10),
  entries jsonb not null,
  status public.correction_status not null default 'PENDING',
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  applied_txn_id uuid,
  published_at timestamptz,
  check (decided_by is null or decided_by <> requested_by)
);

-- ───────────────────────────── Fairness and results ─────────────────────────────

-- Collusion flags, generated at settlement (fairness officer only):
--   1 reciprocal buying (two teams each buying the other's company),
--   2 a large position (≥ 4,000 shares) in a company that closed below its average cost,
--   3 five or more teams reaching the 5,000-share limit on one company in the same round.
create table public.flags (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  kind smallint not null check (kind between 1 and 3),
  company_id uuid references public.companies (id) on delete cascade,
  team_ids uuid[] not null default '{}',
  details jsonb not null default '{}',
  status public.flag_status not null default 'OPEN',
  decided_by uuid,
  decided_at timestamptz,
  reason text,
  created_at timestamptz not null default now(),
  check (status = 'OPEN' or (decided_by is not null and length(coalesce(reason, '')) >= 5))
);

-- One row per team, computed at settlement (and re-computed when a decision changes eligibility).
create table public.results (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  team_id uuid not null unique references public.teams (id) on delete cascade,
  r1_points smallint not null check (r1_points between 0 and 100),
  r2_points smallint not null check (r2_points between 0 and 100),
  r3_points smallint not null check (r3_points between 0 and 100),
  portfolio_cents bigint not null,
  return_bp bigint not null,           -- return in basis points (10.78% = 1078)
  total smallint not null check (total between 0 and 300),
  rank integer,
  eligible boolean not null default true,
  details jsonb not null default '{}',
  computed_at timestamptz not null default now()
);

-- The leaderboard as it stood at 03:30, kept for the record; the live leaderboard stops there.
create table public.leaderboard_frozen (
  event_id uuid not null references public.events (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  rank integer not null,
  r1_points smallint not null,
  r2_points smallint not null,
  r3_points smallint not null,
  total smallint not null,
  frozen_at timestamptz not null default now(),
  primary key (event_id, team_id)
);

-- Winner, runner-up, third; best PRD; best crisis solution; best investor; best company (shared by the founding and
-- the rescuing team, so one award can have two rows with the same place).
create table public.awards (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  code text not null check (code in ('WINNER', 'RUNNER_UP', 'THIRD', 'BEST_PRD', 'BEST_SOLUTION', 'BEST_INVESTOR', 'BEST_COMPANY')),
  place smallint not null default 1,
  team_id uuid not null references public.teams (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  metric jsonb not null default '{}',
  unique (event_id, code, team_id)
);

-- ───────────────────────────── Operations ─────────────────────────────

-- Append-only record of every change: who, what, before, after, when.
create table public.audit_log (
  id bigserial primary key,
  event_id uuid,
  at timestamptz not null default clock_timestamp(),
  actor_user_id uuid,
  actor_role text,
  actor_team_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb
);
create index audit_log_event_idx on public.audit_log (event_id, id);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);

create table public.rate_limits (
  team_id uuid not null references public.teams (id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (team_id, bucket)
);

create table public.error_log (
  id bigserial primary key,
  event_id uuid references public.events (id) on delete cascade,
  at timestamptz not null default now(),
  source text not null,
  message text not null,
  context jsonb not null default '{}'
);

-- One row per open screen (a browser tab), refreshed by its heartbeat: which account, which area, and whether its
-- realtime channel is connected. Staff read it in the health view; nobody writes it directly.
create table public.client_pings (
  client_id uuid primary key,
  event_id uuid references public.events (id) on delete cascade,
  user_id uuid not null,
  role public.account_role not null,
  team_id uuid references public.teams (id) on delete cascade,
  area text not null check (area in ('team', 'admin', 'display')),
  realtime text not null check (realtime in ('SUBSCRIBED', 'CONNECTING', 'CLOSED', 'CHANNEL_ERROR', 'TIMED_OUT')),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index client_pings_event_idx on public.client_pings (event_id, last_seen desc);
create index client_pings_user_idx on public.client_pings (user_id, last_seen desc);
