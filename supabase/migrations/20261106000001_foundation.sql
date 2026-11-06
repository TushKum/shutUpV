-- PRIMUS foundation: schemas, extensions, enums.
-- Money is integer cents (bigint); prices are integer cents. The enums mirror packages/engine/src/types.ts.

create schema if not exists app;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create type public.account_role as enum ('TEAM', 'ORGANISER', 'FAIRNESS', 'DISPLAY');

-- Declaration order is the order of the night; enum comparison (<, >=) relies on it.
create type public.phase_code as enum (
  'SETUP',
  'CHECKIN',
  'BRIEFING',
  'BUILD',          -- 21:15 problem cards; 22:15 the twist; 23:00 the PRD lock
  'JUDGING_1',      -- 23:00 the PRDs are judged
  'REVEAL_1',       -- 23:30 starting prices
  'CRISIS_QA',      -- 23:45 the crisis, the rescue circle, the Q&A board
  'RESCUE',         -- 00:15 crisis solutions; 01:45 the lock
  'JUDGING_2',      -- 01:45 the solutions are judged (scores secret)
  'MARKET_BLIND',   -- 02:15 solutions published; trading rounds 1–2
  'MARKET',         -- 02:45 the score reveal; rounds 3–9; 03:30 the leaderboard freezes
  'SETTLEMENT',     -- 04:30 the closing bell
  'AWARDS'          -- 05:15
);

create type public.round_status as enum ('SCHEDULED', 'OPEN', 'CLOSED', 'CLEARED');

create type public.order_type as enum ('BUY', 'SELL');

create type public.order_status as enum ('PENDING', 'FILLED', 'CANCELLED');

-- PRD: Round 1, by the founding team. SOLUTION: Round 2, by the rescuing team, about the company it rescues.
create type public.submission_type as enum ('PRD', 'SOLUTION');

-- SEALED: the median is known (staff only). REVEALED: shown to teams (23:30 for PRDs, 02:45 for solutions).
create type public.score_status as enum ('PENDING', 'SCORING', 'SEALED', 'REVEALED');

create type public.judge_run_status as enum ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

create type public.flag_status as enum ('OPEN', 'CLEARED', 'DISQUALIFIED');

create type public.price_kind as enum ('START', 'CRISIS', 'REVEAL', 'CLEARING', 'CLOSE', 'APPEAL');

create type public.deadline_code as enum (
  'PROBLEM_DRAW',
  'TWIST',
  'PRD_LOCK',
  'QA_CLOSE',
  'SOLUTION_LOCK',
  'LEADERBOARD_FREEZE',
  'MARKET_CLOSE'
);

create type public.bulletin_kind as enum ('GENERAL', 'TWIST', 'CRISIS', 'RUMOUR', 'FAIRNESS', 'SYSTEM');

create type public.ledger_kind as enum ('START_CASH', 'TRADE', 'CORRECTION');

create type public.correction_status as enum ('PENDING', 'APPROVED', 'REJECTED');
