-- Investment accounts: what an account is worth at a moment, captured by hand.
-- A valuation is not a transaction, so market gains and losses never count as
-- income or spending. Contributions and withdrawals stay transactions.

create table public.account_valuations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  account_id uuid not null references public.accounts on delete cascade,
  valued_at timestamptz not null,
  value numeric(14, 2) not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
select public.apply_owner_rls('public.account_valuations');
create index account_valuations_account_idx on public.account_valuations (account_id, valued_at desc);

-- balance: what the account is worth now. With a valuation, that is the latest
-- value plus the money moved in or out after it; without one, the book balance.
-- book_balance: initial balance + applied transactions (for an investment
-- account, the net amount contributed). New columns go at the end so the view
-- can be replaced in place.
create or replace view public.account_balances with (security_invoker = true) as
with flows as (
  select
    t.account_id,
    t.occurred_at,
    (case when t.type = 'income' or t.direction = 'in' then 1 else -1 end)
      * (case when t.currency <> a.currency and a.currency = 'MXN' then t.base_amount_mxn else t.original_amount end) as amount
  from public.transactions t
  join public.accounts a on a.id = t.account_id
  where t.status = 'applied'
),
latest as (
  select distinct on (v.account_id) v.account_id, v.value, v.valued_at
  from public.account_valuations v
  order by v.account_id, v.valued_at desc, v.created_at desc
)
select
  a.id as account_id,
  a.user_id,
  a.currency,
  case
    when l.account_id is null then a.initial_balance + coalesce((select sum(f.amount) from flows f where f.account_id = a.id), 0)
    else l.value + coalesce((select sum(f.amount) from flows f where f.account_id = a.id and f.occurred_at > l.valued_at), 0)
  end as balance,
  a.initial_balance + coalesce((select sum(f.amount) from flows f where f.account_id = a.id), 0) as book_balance,
  l.value as last_value,
  l.valued_at as last_valued_at
from public.accounts a
left join latest l on l.account_id = a.id;
