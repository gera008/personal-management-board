-- Calendar and tasks share categories (the task lists): an event can belong to
-- one, and both are drawn in that category's color.
alter table public.events
  add column if not exists list_id uuid references public.task_lists on delete set null;
create index if not exists events_list_idx on public.events (list_id);
