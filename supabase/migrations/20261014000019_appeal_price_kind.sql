-- A technical appeal applied after release (Phase 6, PLAN decision 19) records the price change it makes as its own
-- kind of price row. A new enum value cannot be used in the transaction that adds it, so it has a migration of its own.

alter type public.price_kind add value if not exists 'APPEAL';
