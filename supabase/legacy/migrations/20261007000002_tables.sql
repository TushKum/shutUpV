-- All tables. Every game table carries event_id so a rehearsal event can live beside the real one.
-- Hard limits from the rules are repeated here as CHECK constraints (defence in depth);
-- the game functions validate them first and return friendly errors.

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
  drawn_at timestamptz,
  current_phase public.phase_code not null default 'SETUP',
  phase_started_at timestamptz,
  paused boolean not null default false,
  paused_at timestamptz,
  auto_advance boolean not null default false,
  judge_model_slot text not null default 'PRIMARY' check (judge_model_slot in ('PRIMARY', 'BACKUP')),
  exchange_cash_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  check ((paused and paused_at is not null) or (not paused and paused_at is null))
);

-- The secret lottery seed between its entry (21:00) and its reveal. Staff only.
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
  number smallint not null check (number between 1 and 21),
  phase public.phase_code not null check (phase in ('ROUNDS_1_4', 'RESCUE_1', 'RESCUE_2', 'ROUNDS_13_21')),
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
  code text not null unique check (code ~ '^[A-Z]{1,3}[0-9]{2,3}$'),
  track public.track not null,
  name text not null check (length(name) between 1 and 80),
  cash_cents bigint not null default 0,
  collateral_cents bigint not null default 0 check (collateral_cents >= 0),
  disqualified boolean not null default false,
  disqualified_reason text,
  created_at timestamptz not null default now(),
  unique (id, track)
);
create index teams_event_track_idx on public.teams (event_id, track);

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

create table public.crisis_cards (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  category text not null,
  number smallint not null default 1,
  title text not null,
  body text not null,
  unique (event_id, category, number)
);

-- ───────────────────────────── Squads and companies ─────────────────────────────

create table public.squads (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  number smallint not null check (number between 1 and 50),
  product_team_id uuid not null unique,
  product_track public.track not null default 'PRODUCT' check (product_track = 'PRODUCT'),
  consulting_team_id uuid not null unique,
  consulting_track public.track not null default 'CONSULTING' check (consulting_track = 'CONSULTING'),
  finance_team_id uuid not null unique,
  finance_track public.track not null default 'FINANCE' check (finance_track = 'FINANCE'),
  dealt_card_ids uuid[] not null default '{}' check (cardinality(dealt_card_ids) in (0, 3)),
  chosen_card_id uuid references public.problem_cards (id),
  chosen_at timestamptz,
  chosen_by_default boolean not null default false,
  unique (event_id, number),
  foreign key (product_team_id, product_track) references public.teams (id, track) on delete cascade,
  foreign key (consulting_team_id, consulting_track) references public.teams (id, track) on delete cascade,
  foreign key (finance_team_id, finance_track) references public.teams (id, track) on delete cascade
);

-- One company per Product team. Prices may only change through the game functions
-- (see the price guard trigger).
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  product_team_id uuid not null unique,
  product_track public.track not null default 'PRODUCT' check (product_track = 'PRODUCT'),
  squad_id uuid unique references public.squads (id) on delete set null,
  name text check (length(name) between 1 and 60),
  ticker text check (ticker ~ '^[A-Z]{3,4}$'),
  ipo_price integer check (ipo_price > 0),
  market_price integer check (market_price > 0),
  ai_price integer check (ai_price > 0),
  post_crisis_price integer check (post_crisis_price > 0),
  closing_market_price integer check (closing_market_price > 0),
  closing_price integer check (closing_price > 0),
  crisis_card_id uuid references public.crisis_cards (id),
  exchange_inventory integer not null default 0,
  created_at timestamptz not null default now(),
  unique (event_id, ticker),
  foreign key (product_team_id, product_track) references public.teams (id, track) on delete cascade
);

-- Which two companies each consultant covers (set by the lottery).
create table public.coverage (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  consultant_team_id uuid not null,
  consultant_track public.track not null default 'CONSULTING' check (consultant_track = 'CONSULTING'),
  company_id uuid not null references public.companies (id) on delete cascade,
  unique (consultant_team_id, company_id),
  foreign key (consultant_team_id, consultant_track) references public.teams (id, track) on delete cascade
);

-- ───────────────────────────── Positions and trading ─────────────────────────────

create table public.holdings (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  lot public.lot_type not null,
  qty integer not null default 0 check (qty >= 0),
  cost_cents bigint not null default 0,          -- cost basis (long lots) or proceeds (SHORT lot)
  updated_at timestamptz not null default now(),
  unique (team_id, company_id, lot)
);
create index holdings_company_idx on public.holdings (company_id, lot);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  round_id uuid not null references public.rounds (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  type public.order_type not null,
  qty integer not null check (qty > 0 and qty <= 100000),
  status public.order_status not null default 'PENDING',
  entry_price integer not null check (entry_price > 0),
  reserve_cents bigint not null default 0 check (reserve_cents >= 0),
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

create table public.ipo_bids (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  qty_requested integer not null check (qty_requested between 0 and 4000),
  qty_allocated integer check (qty_allocated >= 0 and qty_allocated <= qty_requested),
  price integer not null check (price > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, company_id)
);

-- Every price change: one CLEARING row per company per round (even with no trades),
-- plus one row per one-off adjustment (IPO, CRISIS, PLAN_TIER, FLASH_TIER, CLOSE).
create table public.round_prices (
  id bigserial primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  round_id uuid references public.rounds (id) on delete cascade,
  kind public.price_kind not null,
  market_before integer,
  market_after integer not null check (market_after > 0),
  ai_before integer,
  ai_after integer,
  buy_qty integer not null default 0,
  sell_qty integer not null default 0,
  short_qty integer not null default 0,
  cover_qty integer not null default 0,
  net_qty integer not null default 0,
  capped_net integer not null default 0 check (capped_net between -10000 and 10000),
  tier_bp integer,
  created_at timestamptz not null default now(),
  check ((kind = 'CLEARING') = (round_id is not null))
);
create unique index round_prices_clearing_uq on public.round_prices (round_id, company_id) where kind = 'CLEARING';
create unique index round_prices_once_uq on public.round_prices (company_id, kind) where kind <> 'CLEARING';
create index round_prices_event_idx on public.round_prices (event_id, created_at);

-- ───────────────────────────── Rescue agreements ─────────────────────────────

create table public.fees (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  squad_id uuid not null unique references public.squads (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  consulting_team_id uuid not null references public.teams (id) on delete cascade,
  cash_cents bigint not null default 0 check (cash_cents between 0 and 3500000),
  shares integer not null default 0 check (shares between 0 and 3000),
  value_cents bigint not null default 0 check (value_cents between 0 and 3500000),
  version integer not null default 1,
  product_confirmed_at timestamptz,
  consulting_confirmed_at timestamptz,
  executed_at timestamptz,
  is_default boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by_team uuid
);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  squad_id uuid not null unique references public.squads (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  finance_team_id uuid not null references public.teams (id) on delete cascade,
  amount_cents bigint check (amount_cents between 4000000 and 8000000),
  price_cents integer check (price_cents > 0),
  shares integer check (shares > 0),
  cash_moved_cents bigint check (cash_moved_cents > 0),
  version integer not null default 1,
  signed_product_at timestamptz,
  signed_consulting_at timestamptz,
  signed_finance_at timestamptz,
  executed_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by_team uuid
);

-- ───────────────────────────── Submissions and the AI judge ─────────────────────────────

-- Working drafts, private to the squad. Optimistic locking through version.
create table public.submission_drafts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  squad_id uuid not null references public.squads (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  type public.submission_type not null,
  content jsonb not null default '{}',
  version integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by_team uuid,
  unique (squad_id, type)
);

-- Submitted versions. Immutable except that a newer on-time submission marks the older one superseded.
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  squad_id uuid not null references public.squads (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  type public.submission_type not null,
  content jsonb not null,
  body_text text not null,
  word_count integer not null check (word_count >= 0),
  submitted_at timestamptz not null default now(),
  submitted_by_team uuid not null,
  superseded_at timestamptz
);
create index submissions_company_type_idx on public.submissions (company_id, type, submitted_at desc);
create unique index submissions_current_uq on public.submissions (company_id, type) where superseded_at is null;

create table public.judge_runs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  submission_id uuid not null references public.submissions (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  type public.submission_type not null,
  generation smallint not null default 1,            -- increases on a technical-appeal re-run
  run_no smallint not null check (run_no between 1 and 5),
  model text,
  prompt_sha text,
  status public.judge_run_status not null default 'QUEUED',
  attempts smallint not null default 0,
  locked_at timestamptz,
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

create table public.scores (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  type public.submission_type not null,
  submission_id uuid references public.submissions (id),
  generation smallint not null default 1,
  status public.score_status not null default 'PENDING',
  run_totals smallint[] not null default '{}',
  median smallint check (median between 0 and 100),
  missing boolean not null default false,
  late boolean not null default false,
  capped boolean not null default false,
  penalty smallint not null default 0,
  final_score smallint check (final_score between 0 and 100),
  tier_bp integer,
  breakdown jsonb,
  rationale text,
  released_at timestamptz,
  released_by uuid,
  updated_at timestamptz not null default now(),
  unique (company_id, type)
);

create table public.injection_logs (
  id bigserial primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  submission_id uuid not null references public.submissions (id) on delete cascade,
  squad_id uuid not null references public.squads (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  type public.submission_type not null,
  line text not null,
  pattern text not null,
  created_at timestamptz not null default now()
);

-- ───────────────────────────── Consultant calls ─────────────────────────────

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  consultant_team_id uuid not null references public.teams (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  call_no smallint not null check (call_no between 1 and 3),
  direction public.call_dir,
  made_at timestamptz,
  baseline_price integer,
  judged_price integer,
  correct boolean,
  earnings_cents bigint not null default 0,
  unique (consultant_team_id, company_id, call_no)
);

-- ───────────────────────────── Q&A and bulletins ─────────────────────────────

create table public.qa_questions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  asker_team_id uuid not null references public.teams (id) on delete cascade,  -- hidden from teams
  body text not null check (length(body) between 1 and 2000),
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
  word_count integer not null check (word_count between 1 and 100),
  created_at timestamptz not null default now()
);
create index qa_answers_question_idx on public.qa_answers (question_id);

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

-- ───────────────────────────── Ledger ─────────────────────────────

-- Append-only. One row per party per leg; team_id NULL means the exchange.
-- Invariant: teams.cash_cents = sum(cash_delta_cents) and holdings.qty = sum(share_delta) per lot.
create table public.ledger_entries (
  id bigserial primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  txn_id uuid not null,
  kind public.ledger_kind not null,
  team_id uuid references public.teams (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  lot public.lot_type,
  cash_delta_cents bigint not null default 0,
  share_delta integer not null default 0,
  price_cents integer,
  round_id uuid references public.rounds (id) on delete cascade,
  ref_table text,
  ref_id uuid,
  memo text,
  created_at timestamptz not null default now(),
  created_by uuid,
  check (share_delta = 0 or (company_id is not null and lot is not null))
);
create index ledger_team_idx on public.ledger_entries (team_id, id);
create index ledger_event_idx on public.ledger_entries (event_id, id);
create index ledger_txn_idx on public.ledger_entries (txn_id);

-- What every team may see: transfers labelled by squad and role (never team names),
-- per-round market totals, price adjustments and published corrections.
create table public.public_ledger (
  id bigserial primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  txn_id uuid,
  kind text not null,
  label text not null,
  company_id uuid references public.companies (id) on delete cascade,
  ticker text,
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

create table public.results (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  team_id uuid not null unique references public.teams (id) on delete cascade,
  track public.track not null,
  final_value_cents bigint not null,
  start_value_cents bigint not null,
  return_bp bigint,
  tiebreak jsonb not null default '{}',
  rank integer,
  eligible boolean not null default true,
  details jsonb not null default '{}',
  computed_at timestamptz not null default now()
);

create table public.awards (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  code text not null,
  place smallint not null default 1,
  team_id uuid references public.teams (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  metric jsonb not null default '{}',
  unique (event_id, code, place)
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
