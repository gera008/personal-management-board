-- Redesign: accent color preference and a color per calendar event.
alter table public.profiles
  add column if not exists accent text not null default 'lime' check (accent in ('lime', 'orange', 'ice', 'mint'));

-- One of the event palette colors (hex); null shows the default event color.
alter table public.events
  add column if not exists color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');
