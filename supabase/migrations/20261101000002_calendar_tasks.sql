-- Calendar events, task lists, tasks and subtasks.

create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null check (length(title) > 0),
  notes text,
  location text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default false,
  reminder_minutes integer check (reminder_minutes >= 0),
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at >= start_at)
);
select public.apply_owner_rls('public.events');
create index events_user_start_idx on public.events (user_id, start_at);

create table public.task_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (length(name) > 0),
  color text not null default '#f97316',
  icon text not null default 'list',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
select public.apply_owner_rls('public.task_lists');

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  list_id uuid not null references public.task_lists on delete cascade,
  title text not null check (length(title) > 0),
  notes text,
  due_date date,
  due_time time,
  priority smallint not null default 0 check (priority between 0 and 3),
  tags text[] not null default '{}',
  position integer not null default 0,
  completed_at timestamptz,
  reminder_at timestamptz,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_time is null or due_date is not null)
);
select public.apply_owner_rls('public.tasks');
create index tasks_user_due_idx on public.tasks (user_id, due_date);

create table public.subtasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  task_id uuid not null references public.tasks on delete cascade,
  title text not null check (length(title) > 0),
  position integer not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
select public.apply_owner_rls('public.subtasks');
