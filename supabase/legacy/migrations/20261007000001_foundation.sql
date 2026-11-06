-- Foundation: schemas, extensions, enums.
-- Money is integer cents (bigint), prices are integer cents, tiers are basis points.

create schema if not exists app;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create type public.track as enum ('PRODUCT', 'CONSULTING', 'FINANCE');

create type public.account_role as enum ('TEAM', 'ORGANISER', 'FAIRNESS', 'DISPLAY');

-- Declaration order is the order of the night; enum comparison (<, >=) relies on it.
create type public.phase_code as enum (
  'SETUP',
  'CHECKIN',
  'BRIEFING',
  'SQUAD_DRAW',
  'BUILD',
  'READING',
  'IPO',
  'ROUNDS_1_4',
  'CRISIS',
  'RESCUE_1',
  'BREAK',
  'RESCUE_2',
  'PLANS_PUBLISHED',
  'VERDICTS',
  'ROUNDS_13_21',
  'CLOSE',
  'SETTLEMENT',
  'APPEALS',
  'AWARDS'
);

create type public.round_status as enum ('SCHEDULED', 'OPEN', 'CLOSED', 'CLEARED');

create type public.order_type as enum ('BUY', 'SELL', 'SHORT', 'COVER');

create type public.order_status as enum ('PENDING', 'FILLED', 'CANCELLED');

-- RETAINED: Product team's locked shares. SQUAD: fund's seed + rescue lot (outside the long limit).
-- EXCHANGE: fund's long position bought at the IPO or on the exchange. SHORT: fund's short quantity
-- (stored as a positive number). FEE: consultant's fee shares.
create type public.lot_type as enum ('RETAINED', 'SQUAD', 'EXCHANGE', 'SHORT', 'FEE');

create type public.submission_type as enum ('PITCH', 'PLAN', 'FLASH');

create type public.score_status as enum ('PENDING', 'SCORING', 'SEALED', 'RELEASED');

create type public.judge_run_status as enum ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

create type public.call_dir as enum ('BUY', 'SELL');

create type public.flag_status as enum ('OPEN', 'CLEARED', 'DISQUALIFIED');

create type public.price_kind as enum ('IPO', 'CLEARING', 'CRISIS', 'PLAN_TIER', 'FLASH_TIER', 'CLOSE');

create type public.deadline_code as enum (
  'PROBLEM_PICK',
  'PITCH',
  'CALL_1',
  'IPO_BIDS',
  'FEE',
  'DEAL_BONUS',
  'DEAL',
  'PLAN',
  'CALL_2',
  'FLASH_BULLETIN',
  'FLASH',
  'FLASH_TIER',
  'CALL_3'
);

create type public.bulletin_kind as enum ('GENERAL', 'CRISIS', 'FLASH', 'FAIRNESS', 'SYSTEM');

create type public.ledger_kind as enum (
  'STARTING_CASH',
  'ISSUE',
  'SEED',
  'IPO_ALLOCATION',
  'TRADE',
  'FEE',
  'FEE_DEFAULT',
  'DEAL',
  'SHORT_CLOSE',
  'BONUS_PLAN',
  'BONUS_DEAL',
  'CALL_EARNINGS',
  'CORRECTION'
);

create type public.correction_status as enum ('PENDING', 'APPROVED', 'REJECTED');
