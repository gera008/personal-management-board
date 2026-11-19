-- Amounts added to or taken off an income/expense inside the same entry
-- (e.g. siblings paying back their share of a gift). Each item is
-- {"label": text, "amount": number}: negative lowers the entry, positive raises it.
-- original_amount / base_amount_mxn keep holding the net, so totals, budgets
-- and balances need no change; the full price is original_amount - sum(amounts).
alter table public.transactions add column if not exists adjustments jsonb not null default '[]'::jsonb;
