-- Finance: accounts, categories, transactions, recurring series, budgets.

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (length(name) > 0),
  type text not null check (type in ('debit', 'credit_card', 'cash', 'savings', 'investment', 'other')),
  currency text not null default 'MXN' check (currency in ('MXN', 'USD', 'CAD')),
  initial_balance numeric(14, 2) not null default 0,
  cutoff_day smallint check (cutoff_day between 1 and 31),
  payment_day smallint check (payment_day between 1 and 31),
  include_in_total boolean not null default true,
  position integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
select public.apply_owner_rls('public.accounts');
create unique index accounts_user_name_uniq on public.accounts (user_id, lower(name));

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (length(name) > 0),
  type text not null check (type in ('expense', 'income')),
  parent_id uuid references public.categories on delete cascade,
  position integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
select public.apply_owner_rls('public.categories');
-- Case-insensitive uniqueness per level, so "Reposición de gastos" and "Reposición de Gastos" collapse.
create unique index categories_user_name_uniq on public.categories
  (user_id, type, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));

-- Only two levels, and a subcategory has the same type as its parent.
create or replace function public.check_category_parent()
returns trigger language plpgsql as $$
declare p record;
begin
  if new.parent_id is null then
    return new;
  end if;
  select parent_id, type into p from public.categories where id = new.parent_id;
  if p.parent_id is not null then
    raise exception 'Categories can only have two levels';
  end if;
  if p.type <> new.type then
    raise exception 'Subcategory type must match its parent';
  end if;
  return new;
end $$;
create trigger categories_check_parent before insert or update on public.categories
  for each row execute function public.check_category_parent();

create table public.recurring_series (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (kind in ('installment', 'subscription')),
  type text not null default 'expense' check (type in ('expense', 'income')),
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null default 'MXN' check (currency in ('MXN', 'USD', 'CAD')),
  exchange_rate numeric(14, 6) not null default 1 check (exchange_rate > 0),
  account_id uuid not null references public.accounts on delete restrict,
  category_id uuid references public.categories on delete set null,
  subcategory_id uuid references public.categories on delete set null,
  note text,
  description text,
  frequency text not null default 'monthly' check (frequency in ('weekly', 'monthly', 'yearly')),
  start_date date not null,
  total_count integer check (total_count > 0),
  end_date date,
  occurrences_created integer not null default 0,
  next_run_date date,
  status text not null default 'active' check (status in ('active', 'ended', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind = 'subscription' or total_count is not null)
);
select public.apply_owner_rls('public.recurring_series');

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  type text not null check (type in ('expense', 'income', 'transfer')),
  direction text check (direction in ('in', 'out')),
  occurred_at timestamptz not null,
  account_id uuid not null references public.accounts on delete restrict,
  category_id uuid references public.categories on delete set null,
  subcategory_id uuid references public.categories on delete set null,
  note text,
  description text,
  original_amount numeric(14, 2) not null check (original_amount > 0),
  currency text not null check (currency in ('MXN', 'USD', 'CAD')),
  exchange_rate numeric(14, 6) not null default 1 check (exchange_rate > 0),
  base_amount_mxn numeric(14, 2) not null check (base_amount_mxn >= 0),
  status text not null default 'applied' check (status in ('applied', 'pending')),
  series_id uuid references public.recurring_series on delete set null,
  series_index integer,
  transfer_pair_id uuid,
  import_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (type = 'transfer' and direction is not null and transfer_pair_id is not null and category_id is null)
    or (type <> 'transfer' and direction is null and transfer_pair_id is null)
  ),
  unique (user_id, import_hash)
);
select public.apply_owner_rls('public.transactions');
create index transactions_user_date_idx on public.transactions (user_id, occurred_at desc);
create index transactions_account_idx on public.transactions (account_id);
create index transactions_pair_idx on public.transactions (transfer_pair_id) where transfer_pair_id is not null;
create index transactions_series_idx on public.transactions (series_id) where series_id is not null;

-- Deleting one side of a transfer removes the other side too.
create or replace function public.delete_transfer_pair()
returns trigger language plpgsql as $$
begin
  if old.transfer_pair_id is not null then
    delete from public.transactions where transfer_pair_id = old.transfer_pair_id and id <> old.id;
  end if;
  return old;
end $$;
create trigger transactions_delete_pair after delete on public.transactions
  for each row execute function public.delete_transfer_pair();

-- Signed amount in the account's own currency (applied only).
create or replace view public.account_balances with (security_invoker = true) as
select
  a.id as account_id,
  a.user_id,
  a.currency,
  a.initial_balance + coalesce(sum(
    case
      when t.type = 'income' or t.direction = 'in' then t.original_amount
      else -t.original_amount
    end
  ) filter (where t.status = 'applied'), 0) as balance
from public.accounts a
left join public.transactions t on t.account_id = a.id
group by a.id;

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  category_id uuid not null references public.categories on delete cascade,
  monthly_limit_mxn numeric(14, 2) not null check (monthly_limit_mxn > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category_id)
);
select public.apply_owner_rls('public.budgets');

-- ---------------------------------------------------------------------------
-- Recurring series. Occurrence n (0-based) falls on start_date + n * step.
-- Adding n steps to the anchor (instead of stepping from the previous date)
-- keeps month-end dates stable: Jan 31 -> Feb 28 -> Mar 31.
-- Mirrors src/domain/recurring/schedule.ts.
-- ---------------------------------------------------------------------------
create or replace function public.series_occurrence_date(p_start date, p_frequency text, p_n integer)
returns date language sql immutable as $$
  select (p_start + case p_frequency
    when 'weekly' then make_interval(weeks => p_n)
    when 'monthly' then make_interval(months => p_n)
    when 'yearly' then make_interval(years => p_n)
  end)::date
$$;

-- Creates the pending transactions of a series: every payment of an
-- installment, or the next 12 months of a subscription (topped up daily).
create or replace function public.materialize_series(p_series uuid)
returns integer language plpgsql as $$
declare
  s public.recurring_series;
  tz text;
  n integer;
  d date;
  horizon date;
  created integer := 0;
begin
  select * into s from public.recurring_series where id = p_series for update;
  if not found or s.status <> 'active' then
    return 0;
  end if;
  select coalesce(p.timezone, 'America/Monterrey') into tz from public.profiles p where p.user_id = s.user_id;
  tz := coalesce(tz, 'America/Monterrey');
  horizon := (now() at time zone tz)::date + 366;
  if s.end_date is not null and s.end_date < horizon then
    horizon := s.end_date;
  end if;

  n := s.occurrences_created;
  loop
    exit when s.total_count is not null and n >= s.total_count;
    d := public.series_occurrence_date(s.start_date, s.frequency, n);
    exit when s.total_count is null and d > horizon;
    insert into public.transactions (
      user_id, type, occurred_at, account_id, category_id, subcategory_id, note, description,
      original_amount, currency, exchange_rate, base_amount_mxn, status, series_id, series_index
    ) values (
      s.user_id, s.type, d::timestamp at time zone tz, s.account_id, s.category_id, s.subcategory_id,
      s.note, s.description, s.amount, s.currency, s.exchange_rate, round(s.amount * s.exchange_rate, 2),
      'pending', s.id, n + 1
    );
    n := n + 1;
    created := created + 1;
  end loop;

  update public.recurring_series
  set occurrences_created = n,
      next_run_date = (
        select min((t.occurred_at at time zone tz)::date) from public.transactions t
        where t.series_id = s.id and t.status = 'pending'
      )
  where id = s.id;
  return created;
end $$;

-- After editing a series "going forward": future pending rows are rebuilt
-- from the new amount/category/account. Applied history is untouched.
create or replace function public.reschedule_series(p_series uuid)
returns integer language plpgsql as $$
begin
  delete from public.transactions
  where series_id = p_series and status = 'pending' and occurred_at > now();
  update public.recurring_series
  set occurrences_created = coalesce((select max(series_index) from public.transactions where series_id = p_series), 0)
  where id = p_series;
  return public.materialize_series(p_series);
end $$;

create or replace function public.cancel_series(p_series uuid)
returns void language plpgsql as $$
begin
  delete from public.transactions
  where series_id = p_series and status = 'pending' and occurred_at > now();
  update public.recurring_series set status = 'cancelled', next_run_date = null where id = p_series;
end $$;

-- Scheduled job: apply everything that is due, top up subscriptions and
-- close finished series. Safe to run as often as needed.
create or replace function public.run_finance_jobs()
returns jsonb language plpgsql as $$
declare
  applied integer;
  s record;
begin
  update public.transactions set status = 'applied'
  where status = 'pending' and occurred_at <= now();
  get diagnostics applied = row_count;

  for s in select id from public.recurring_series where status = 'active' loop
    perform public.materialize_series(s.id);
  end loop;

  update public.recurring_series rs set status = 'ended', next_run_date = null
  where rs.status = 'active'
    and not exists (select 1 from public.transactions t where t.series_id = rs.id and t.status = 'pending')
    and (
      (rs.total_count is not null and rs.occurrences_created >= rs.total_count)
      or (rs.end_date is not null and rs.end_date < current_date)
    );

  return jsonb_build_object('applied', applied);
end $$;
