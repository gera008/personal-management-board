-- Phase 2: recurring events and tasks.
--
-- Events: a recurring event is one row with a rule (`recurrence`, see
-- supabase/functions/_shared/recurrence.ts). Its occurrences are expanded on
-- read. Skipped dates live in `exdates`; an occurrence edited on its own is a
-- separate one-off row pointing at its series via `recurrence_parent_id` (and
-- its date is added to the series' exdates).
alter table public.events
  add column if not exists recurrence jsonb,
  add column if not exists exdates date[] not null default '{}',
  add column if not exists recurrence_parent_id uuid references public.events on delete cascade,
  -- Start of the last occurrence a push reminder was sent for (recurring events).
  add column if not exists reminder_sent_for timestamptz;

create index if not exists events_recurring_idx on public.events (user_id) where recurrence is not null;

-- Tasks: like Apple Reminders, only the current instance exists. Completing it
-- creates the next one (`recurrence_parent_id` = the completed task), counted
-- by `recurrence_index` for "after N times" rules. `recurrence.anchor` keeps
-- the first due date so monthly days don't drift.
alter table public.tasks
  add column if not exists recurrence jsonb,
  add column if not exists recurrence_index integer not null default 1,
  add column if not exists recurrence_parent_id uuid references public.tasks on delete set null;

alter table public.tasks
  add constraint tasks_recurrence_needs_due_date check (recurrence is null or due_date is not null);

-- One successor per completed task, even if it is completed twice.
create unique index if not exists tasks_recurrence_parent_uniq on public.tasks (recurrence_parent_id) where recurrence_parent_id is not null;
