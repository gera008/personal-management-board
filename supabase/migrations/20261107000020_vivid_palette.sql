-- Vivid module palette (events, task lists, habits): violet, blue, cyan, pink,
-- amber and silver. Saved colors move to the closest one.

create or replace function public.nearest_palette_color(hex text)
returns text
language sql
immutable
as $$
  select p.c
  from unnest(array['#A879FF', '#3D8BFF', '#22D3EE', '#FF57B2', '#FFC93D', '#E5E5EA']) as p(c)
  order by
    power(('x' || substr(hex, 2, 2))::bit(8)::int - ('x' || substr(p.c, 2, 2))::bit(8)::int, 2)
    + power(('x' || substr(hex, 4, 2))::bit(8)::int - ('x' || substr(p.c, 4, 2))::bit(8)::int, 2)
    + power(('x' || substr(hex, 6, 2))::bit(8)::int - ('x' || substr(p.c, 6, 2))::bit(8)::int, 2)
  limit 1
$$;

-- The previous palette maps one to one; anything else goes to the closest color.
create or replace function public.vivid_color(hex text)
returns text
language sql
immutable
as $$
  select case upper(hex)
    when '#A78BFA' then '#A879FF'
    when '#7CC4FF' then '#3D8BFF'
    when '#6EE7B7' then '#22D3EE'
    when '#F0A6CA' then '#FF57B2'
    when '#E8C468' then '#FFC93D'
    when '#F59E8B' then '#FF57B2'
    else public.nearest_palette_color(hex)
  end
$$;

update public.task_lists set color = public.vivid_color(color) where color ~ '^#[0-9A-Fa-f]{6}$';
update public.habits set color = public.vivid_color(color) where color ~ '^#[0-9A-Fa-f]{6}$';
update public.events set color = public.vivid_color(color) where color is not null;

alter table public.task_lists alter column color set default '#FFC93D';
alter table public.habits alter column color set default '#A879FF';

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id) values (new.id);
  insert into public.currency_rates (user_id, currency, rate_to_mxn) values (new.id, 'MXN', 1);
  insert into public.task_lists (user_id, name, color, icon, position) values
    (new.id, 'Personal', '#3D8BFF', 'user', 0),
    (new.id, 'School', '#FFC93D', 'book', 1),
    (new.id, 'Work', '#A879FF', 'briefcase', 2);
  return new;
end $$;
