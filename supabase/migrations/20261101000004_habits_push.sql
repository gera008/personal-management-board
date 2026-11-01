-- Habits, habit logs, push subscriptions and the signup bootstrap.

create table public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (length(name) > 0),
  kind text not null default 'good' check (kind in ('good', 'bad')),
  type text not null default 'boolean' check (type in ('boolean', 'numeric')),
  unit text,
  target_value numeric(10, 2) check (target_value > 0),
  -- {"type":"daily"} | {"type":"weekdays","days":[0..6]} | {"type":"times_per_week","n":3} | {"type":"every_n_days","n":2}
  frequency jsonb not null default '{"type":"daily"}'::jsonb,
  goal_days integer check (goal_days > 0),
  color text not null default '#8b5cf6',
  tags text[] not null default '{}',
  reminder_time time,
  last_reminded_on date,
  start_date date not null default current_date,
  position integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (type = 'boolean' or target_value is not null),
  check (kind = 'good' or type = 'boolean')
);
select public.apply_owner_rls('public.habits');

-- Good habits: a row with value >= target (1 for yes/no) means done.
-- Bad habits: a row with is_slip = true marks a failed day; no row = success.
create table public.habit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  habit_id uuid not null references public.habits on delete cascade,
  date date not null,
  value numeric(10, 2) not null default 1,
  note text,
  is_slip boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (habit_id, date)
);
select public.apply_owner_rls('public.habit_logs');
create index habit_logs_user_date_idx on public.habit_logs (user_id, date);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text not null,
  keys jsonb not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);
select public.apply_owner_rls('public.push_subscriptions');

-- New user: profile, MXN rate and the three default task lists. No other data.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id) values (new.id);
  insert into public.currency_rates (user_id, currency, rate_to_mxn) values (new.id, 'MXN', 1);
  insert into public.task_lists (user_id, name, color, icon, position) values
    (new.id, 'Personal', '#f97316', 'user', 0),
    (new.id, 'School', '#f59e0b', 'book', 1),
    (new.id, 'Work', '#ea580c', 'briefcase', 2);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
