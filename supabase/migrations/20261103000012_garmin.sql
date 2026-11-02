-- Garmin Connect Personal API (read-only). The `garmin` Edge Function exchanges
-- the API key (function secret GARMIN_API_KEY) for a short-lived token, calls
-- the endpoints and stores each response as-is, one row per endpoint + window.
-- The app reads these rows (RLS: owner only); only the function writes them.

create table public.garmin_raw (
  user_id uuid not null references auth.users on delete cascade,
  endpoint text not null,          -- e.g. 'sleep_summaries'
  window_key text not null,        -- e.g. '2026-10-27..2026-11-02' or '2026-11-02'
  status integer not null,         -- HTTP status from Garmin
  data jsonb,
  fetched_at timestamptz not null default now(),
  primary key (user_id, endpoint, window_key)
);
alter table public.garmin_raw enable row level security;
create policy "owner_select" on public.garmin_raw for select using (user_id = auth.uid());

create table public.garmin_sync_status (
  user_id uuid primary key references auth.users on delete cascade,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  endpoints_ok integer not null default 0,
  endpoints_failed integer not null default 0
);
alter table public.garmin_sync_status enable row level security;
create policy "owner_select" on public.garmin_sync_status for select using (user_id = auth.uid());
