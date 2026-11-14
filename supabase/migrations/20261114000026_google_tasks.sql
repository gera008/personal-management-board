-- Two-way sync between the app's tasks and Google Tasks (the `google` Edge Function).
--   task categories (task_lists) <-> Google task lists (matched by name the first time)
--   tasks                         <-> Google tasks
--   subtasks                      <-> Google subtasks (tasks with a parent)
-- Google Tasks has no time, priority, tags, reminder or repetition: those stay in
-- the app. The due time travels as the last line of the notes in Google.

alter table public.google_accounts
  -- Tasks sync is opt-in (it needs the Google Tasks permission).
  add column if not exists tasks_enabled boolean not null default false,
  -- Permissions the user granted Google, to know when a reconnect is needed.
  add column if not exists scopes text;

alter table public.task_lists
  add column if not exists google_tasklist_id text,
  add column if not exists google_etag text,
  add column if not exists google_synced_at timestamptz,
  -- Changes in Google since this time are pulled next (Google Tasks has no sync token).
  add column if not exists google_pulled_at timestamptz,
  add column if not exists needs_push boolean not null default false;
create unique index if not exists task_lists_google_uniq on public.task_lists (user_id, google_tasklist_id) where google_tasklist_id is not null;

alter table public.tasks
  add column if not exists google_task_id text,
  add column if not exists google_tasklist_id text,
  add column if not exists google_etag text,
  add column if not exists google_synced_at timestamptz,
  add column if not exists needs_push boolean not null default false;
create unique index if not exists tasks_google_uniq on public.tasks (user_id, google_task_id) where google_task_id is not null;

alter table public.subtasks
  add column if not exists google_task_id text,
  add column if not exists google_etag text,
  add column if not exists google_synced_at timestamptz,
  add column if not exists needs_push boolean not null default false;
create unique index if not exists subtasks_google_uniq on public.subtasks (user_id, google_task_id) where google_task_id is not null;

-- Changes made by the app to what Google Tasks stores mark the row for pushing.
-- The sync function always bumps google_synced_at, which is how its own writes
-- are told apart. Other columns (priority, tags, reminders...) don't push.
create or replace function public.task_lists_mark_push()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.google_synced_at is null then new.needs_push := true; end if;
  elsif new.google_synced_at is not distinct from old.google_synced_at and new.name is distinct from old.name then
    new.needs_push := true;
  end if;
  return new;
end $$;
drop trigger if exists task_lists_mark_push on public.task_lists;
create trigger task_lists_mark_push before insert or update on public.task_lists
  for each row execute function public.task_lists_mark_push();

create or replace function public.tasks_mark_push()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.google_synced_at is null then new.needs_push := true; end if;
  elsif new.google_synced_at is not distinct from old.google_synced_at and (
    new.title is distinct from old.title or new.notes is distinct from old.notes
    or new.due_date is distinct from old.due_date or new.due_time is distinct from old.due_time
    or new.completed_at is distinct from old.completed_at or new.list_id is distinct from old.list_id
  ) then
    new.needs_push := true;
  end if;
  return new;
end $$;
drop trigger if exists tasks_mark_push on public.tasks;
create trigger tasks_mark_push before insert or update on public.tasks
  for each row execute function public.tasks_mark_push();

create or replace function public.subtasks_mark_push()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.google_synced_at is null then new.needs_push := true; end if;
  elsif new.google_synced_at is not distinct from old.google_synced_at and (
    new.title is distinct from old.title or new.completed_at is distinct from old.completed_at
  ) then
    new.needs_push := true;
  end if;
  return new;
end $$;
drop trigger if exists subtasks_mark_push on public.subtasks;
create trigger subtasks_mark_push before insert or update on public.subtasks
  for each row execute function public.subtasks_mark_push();

-- Deleting a linked list, task or subtask in the app deletes it in Google on the next sync.
-- task_id null means the whole list.
create table if not exists public.google_task_deletions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  tasklist_id text not null,
  task_id text,
  created_at timestamptz not null default now()
);
alter table public.google_task_deletions enable row level security;

create or replace function public.google_task_track_deletion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'task_lists' then
    if old.google_tasklist_id is not null then
      insert into public.google_task_deletions (user_id, tasklist_id) values (old.user_id, old.google_tasklist_id);
    end if;
  elsif tg_table_name = 'tasks' then
    -- A list deleted with its tasks: deleting the Google list is enough.
    if old.google_task_id is not null and old.google_tasklist_id is not null
       and exists (select 1 from public.task_lists l where l.id = old.list_id) then
      insert into public.google_task_deletions (user_id, tasklist_id, task_id) values (old.user_id, old.google_tasklist_id, old.google_task_id);
    end if;
  elsif tg_table_name = 'subtasks' then
    -- A task deleted with its subtasks: Google deletes the subtasks with their parent.
    if old.google_task_id is not null then
      insert into public.google_task_deletions (user_id, tasklist_id, task_id)
      select old.user_id, t.google_tasklist_id, old.google_task_id
      from public.tasks t where t.id = old.task_id and t.google_tasklist_id is not null;
    end if;
  end if;
  return old;
end $$;
drop trigger if exists task_lists_track_deletion on public.task_lists;
create trigger task_lists_track_deletion after delete on public.task_lists
  for each row execute function public.google_task_track_deletion();
drop trigger if exists tasks_track_deletion on public.tasks;
create trigger tasks_track_deletion after delete on public.tasks
  for each row execute function public.google_task_track_deletion();
drop trigger if exists subtasks_track_deletion on public.subtasks;
create trigger subtasks_track_deletion after delete on public.subtasks
  for each row execute function public.google_task_track_deletion();
