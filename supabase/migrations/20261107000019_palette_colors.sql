-- Redesign palette for task lists and habits (same six colors as events).
-- Existing colors move to the closest palette color; new rows start in it.

create or replace function public.nearest_palette_color(hex text)
returns text
language sql
immutable
as $$
  select p.c
  from unnest(array['#6EE7B7', '#7CC4FF', '#A78BFA', '#F0A6CA', '#E8C468', '#F59E8B']) as p(c)
  order by
    power(('x' || substr(hex, 2, 2))::bit(8)::int - ('x' || substr(p.c, 2, 2))::bit(8)::int, 2)
    + power(('x' || substr(hex, 4, 2))::bit(8)::int - ('x' || substr(p.c, 4, 2))::bit(8)::int, 2)
    + power(('x' || substr(hex, 6, 2))::bit(8)::int - ('x' || substr(p.c, 6, 2))::bit(8)::int, 2)
  limit 1
$$;

update public.task_lists set color = public.nearest_palette_color(color)
where color ~ '^#[0-9A-Fa-f]{6}$' and upper(color) not in ('#6EE7B7', '#7CC4FF', '#A78BFA', '#F0A6CA', '#E8C468', '#F59E8B');
update public.habits set color = public.nearest_palette_color(color)
where color ~ '^#[0-9A-Fa-f]{6}$' and upper(color) not in ('#6EE7B7', '#7CC4FF', '#A78BFA', '#F0A6CA', '#E8C468', '#F59E8B');

alter table public.task_lists alter column color set default '#E8C468';
alter table public.habits alter column color set default '#A78BFA';

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id) values (new.id);
  insert into public.currency_rates (user_id, currency, rate_to_mxn) values (new.id, 'MXN', 1);
  insert into public.task_lists (user_id, name, color, icon, position) values
    (new.id, 'Personal', '#7CC4FF', 'user', 0),
    (new.id, 'School', '#E8C468', 'book', 1),
    (new.id, 'Work', '#F59E8B', 'briefcase', 2);
  return new;
end $$;
