-- PRIMUS Round 1: the Consulting team's crisis memo is a submission type of its own, and its reputation bonus a
-- ledger kind. Enum values are added in a migration of their own so the next one can use them.

alter type public.submission_type add value if not exists 'MEMO';
alter type public.ledger_kind add value if not exists 'BONUS_MEMO';
