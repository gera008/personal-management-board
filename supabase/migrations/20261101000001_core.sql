-- Core helpers, profiles and signup bootstrap.

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Adds the standard owner-only RLS policies to a table that has a user_id column.
create or replace function public.apply_owner_rls(tbl regclass)
returns void language plpgsql as $$
begin
  execute format('alter table %s enable row level security', tbl);
  execute format('create policy "owner_select" on %s for select using (user_id = auth.uid())', tbl);
  execute format('create policy "owner_insert" on %s for insert with check (user_id = auth.uid())', tbl);
  execute format('create policy "owner_update" on %s for update using (user_id = auth.uid()) with check (user_id = auth.uid())', tbl);
  execute format('create policy "owner_delete" on %s for delete using (user_id = auth.uid())', tbl);
  execute format('create trigger set_updated_at before update on %s for each row execute function public.set_updated_at()', tbl);
end $$;

create table public.profiles (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  language text not null default 'en' check (language in ('en', 'es')),
  default_currency text not null default 'MXN',
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  timezone text not null default 'America/Monterrey',
  week_start smallint not null default 0 check (week_start in (0, 1)), -- 0 = Sunday
  digest_time time not null default '08:00',
  dashboard_layout jsonb not null default '[
    {"id":"month_calendar","visible":true},
    {"id":"week_detail","visible":true},
    {"id":"tasks","visible":true},
    {"id":"finance_summary","visible":true},
    {"id":"habits_today","visible":true},
    {"id":"habit_heatmap","visible":true}
  ]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
select public.apply_owner_rls('public.profiles');

create table public.currency_rates (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  currency text not null check (currency in ('MXN', 'USD', 'CAD')),
  rate_to_mxn numeric(14, 6) not null check (rate_to_mxn > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, currency)
);
select public.apply_owner_rls('public.currency_rates');
