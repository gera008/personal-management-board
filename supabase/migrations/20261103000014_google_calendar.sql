-- Two-way sync with Google Calendar (see supabase/functions/google).

-- Refresh token: server only. RLS on with no policies = the app can't read it.
create table public.google_tokens (
  user_id uuid primary key references auth.users on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);
alter table public.google_tokens enable row level security;

-- Connection info the app shows and edits (default calendar for new events).
create table public.google_accounts (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  email text,
  default_calendar_id text,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.google_accounts enable row level security;
create policy "owner_select" on public.google_accounts for select using (user_id = auth.uid());
create policy "owner_update" on public.google_accounts for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner_delete" on public.google_accounts for delete using (user_id = auth.uid());

-- Calendars of the connected account; the user picks which ones sync.
create table public.google_calendars (
  user_id uuid not null references auth.users on delete cascade,
  calendar_id text not null,
  summary text not null,
  color text,
  access_role text,
  sync_enabled boolean not null default false,
  sync_token text,
  primary key (user_id, calendar_id)
);
alter table public.google_calendars enable row level security;
create policy "owner_select" on public.google_calendars for select using (user_id = auth.uid());
create policy "owner_update" on public.google_calendars for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Link each app event to its Google counterpart.
alter table public.events
  add column if not exists google_calendar_id text,
  add column if not exists google_event_id text,
  add column if not exists google_etag text,
  -- Instances of a Google series the app can't represent (read-only copies).
  add column if not exists google_recurring_id text,
  add column if not exists google_readonly boolean not null default false,
  add column if not exists google_synced_at timestamptz,
  add column if not exists needs_push boolean not null default false;

create unique index if not exists events_google_uniq on public.events (user_id, google_calendar_id, google_event_id) where google_event_id is not null;

-- Any change made by the app marks the event for pushing. The sync function
-- always bumps google_synced_at, which is how its own writes are told apart.
create or replace function public.events_mark_push()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.google_synced_at is null then new.needs_push := true; end if;
  elsif new.google_synced_at is not distinct from old.google_synced_at then
    new.needs_push := true;
  end if;
  return new;
end $$;
create trigger events_mark_push before insert or update on public.events
  for each row execute function public.events_mark_push();

-- Deleting a linked event in the app deletes it in Google on the next sync.
create table public.google_deletions (
  user_id uuid not null references auth.users on delete cascade,
  calendar_id text not null,
  event_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, calendar_id, event_id)
);
alter table public.google_deletions enable row level security;

create or replace function public.events_track_deletion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.google_event_id is not null and not old.google_readonly then
    insert into public.google_deletions (user_id, calendar_id, event_id)
    values (old.user_id, old.google_calendar_id, old.google_event_id)
    on conflict do nothing;
  end if;
  return old;
end $$;
create trigger events_track_deletion after delete on public.events
  for each row execute function public.events_track_deletion();
