-- "Neutro sereno" palette: muted default colors for new lists, habits and the
-- three lists created at signup.
alter table public.task_lists alter column color set default '#C08552';
alter table public.habits alter column color set default '#75639F';

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id) values (new.id);
  insert into public.currency_rates (user_id, currency, rate_to_mxn) values (new.id, 'MXN', 1);
  insert into public.task_lists (user_id, name, color, icon, position) values
    (new.id, 'Personal', '#C08552', 'user', 0),
    (new.id, 'School', '#9C6534', 'book', 1),
    (new.id, 'Work', '#96644F', 'briefcase', 2);
  return new;
end $$;
