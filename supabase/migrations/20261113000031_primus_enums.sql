-- PRIMUS Rounds 2 and 3 (docs/PRIMUS.md): the enum values the next migrations use. Added in a migration of their own
-- so they are committed before use. Mirrors PHASE_CODES, DEADLINE_CODES and SUBMISSION_TYPES in packages/engine.

alter type public.phase_code add value if not exists 'PRESSURE' after 'IPO';
alter type public.phase_code add value if not exists 'SATURATION' after 'PRESSURE';

alter type public.deadline_code add value if not exists 'REVEAL_1';
alter type public.deadline_code add value if not exists 'HIRE_1';
alter type public.deadline_code add value if not exists 'DUE_1';
alter type public.deadline_code add value if not exists 'RATE_1';
alter type public.deadline_code add value if not exists 'REVEAL_2';
alter type public.deadline_code add value if not exists 'HIRE_2';
alter type public.deadline_code add value if not exists 'DUE_2';
alter type public.deadline_code add value if not exists 'RATE_2';
alter type public.deadline_code add value if not exists 'REVEAL_3';
alter type public.deadline_code add value if not exists 'HIRE_3';
alter type public.deadline_code add value if not exists 'DUE_3';
alter type public.deadline_code add value if not exists 'RATE_3';
alter type public.deadline_code add value if not exists 'REVEAL_4';
alter type public.deadline_code add value if not exists 'HIRE_4';
alter type public.deadline_code add value if not exists 'DUE_4';
alter type public.deadline_code add value if not exists 'RATE_4';
alter type public.deadline_code add value if not exists 'DRAFT';
alter type public.deadline_code add value if not exists 'HIRE_5';
alter type public.deadline_code add value if not exists 'DUE_5';
alter type public.deadline_code add value if not exists 'RATE_5';

alter type public.submission_type add value if not exists 'CRISIS_1';
alter type public.submission_type add value if not exists 'CRISIS_2';
alter type public.submission_type add value if not exists 'CRISIS_3';
alter type public.submission_type add value if not exists 'CRISIS_4';
alter type public.submission_type add value if not exists 'SOLUTION';
alter type public.submission_type add value if not exists 'ADVICE_1';
alter type public.submission_type add value if not exists 'ADVICE_2';
alter type public.submission_type add value if not exists 'ADVICE_3';
alter type public.submission_type add value if not exists 'ADVICE_4';
alter type public.submission_type add value if not exists 'ADVICE_5';

alter type public.ledger_kind add value if not exists 'ESCROW_HOLD';
alter type public.ledger_kind add value if not exists 'ESCROW_RELEASE';
alter type public.ledger_kind add value if not exists 'ESCROW_REFUND';
alter type public.ledger_kind add value if not exists 'BONUS_ADVICE';
alter type public.ledger_kind add value if not exists 'INJECTION';

-- A sub-round's crisis shock and its plan tier (round_prices.subround says which sub-round; 5 = Round 3).
alter type public.price_kind add value if not exists 'SUB_SHOCK';
alter type public.price_kind add value if not exists 'SUB_TIER';
