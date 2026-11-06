-- Demo account: fills (or resets) one account with sample data to show the app.
-- Run from the SQL editor:  select public.seed_demo('demo@example.com');
-- It only accepts emails starting with "demo" and isn't callable from the app.
-- Dates are relative to today, so the demo always looks current.

create or replace function public.seed_demo(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  tz text := 'America/Monterrey';
  today date := (now() at time zone 'America/Monterrey')::date;
  d date;
  i integer;
  -- accounts
  a_debit uuid; a_cash uuid; a_card uuid; a_save uuid;
  -- categories
  c_food uuid; c_super uuid; c_rest uuid; c_coffee uuid;
  c_move uuid; c_gas uuid; c_uber uuid;
  c_home uuid; c_rent uuid; c_bills uuid;
  c_fun uuid; c_movies uuid; c_trips uuid;
  c_health uuid; c_pharmacy uuid; c_gym uuid;
  c_tech uuid; c_subs uuid;
  c_salary uuid; c_freelance uuid;
  s_netflix uuid; s_laptop uuid;
  l_personal uuid; l_work uuid; l_school uuid;
  h_gym uuid; h_read uuid; h_water uuid; h_soda uuid;
  pair uuid;
  n_tx integer;
begin
  if p_email is null or p_email not ilike 'demo%' then
    raise exception 'seed_demo only works on demo accounts (email must start with "demo")';
  end if;
  select id into uid from auth.users where email = p_email;
  if uid is null then
    raise exception 'No user with email %. Create it first in Authentication › Users.', p_email;
  end if;
  perform setseed(0.42);

  -- Start clean (a reset wipes whatever visitors changed).
  delete from transactions where user_id = uid;
  delete from recurring_series where user_id = uid;
  delete from budgets where user_id = uid;
  delete from categories where user_id = uid;
  delete from accounts where user_id = uid;
  delete from events where user_id = uid;
  delete from tasks where user_id = uid;
  delete from habits where user_id = uid;
  delete from currency_rates where user_id = uid and currency <> 'MXN';

  insert into profiles (user_id) values (uid) on conflict (user_id) do nothing;
  update profiles set language = 'es', timezone = tz, week_start = 0 where user_id = uid;
  insert into currency_rates (user_id, currency, rate_to_mxn) values (uid, 'MXN', 1), (uid, 'USD', 18.5)
  on conflict (user_id, currency) do update set rate_to_mxn = excluded.rate_to_mxn;

  -- Accounts
  insert into accounts (user_id, name, type, initial_balance, position) values (uid, 'Nómina BBVA', 'debit', 12000, 0) returning id into a_debit;
  insert into accounts (user_id, name, type, initial_balance, position) values (uid, 'Efectivo', 'cash', 1500, 1) returning id into a_cash;
  insert into accounts (user_id, name, type, cutoff_day, payment_day, position) values (uid, 'Tarjeta de crédito', 'credit_card', 20, 10, 2) returning id into a_card;
  insert into accounts (user_id, name, type, initial_balance, position) values (uid, 'Ahorro', 'savings', 30000, 3) returning id into a_save;

  -- Categories (two levels)
  insert into categories (user_id, name, type, position) values (uid, 'Comida', 'expense', 0) returning id into c_food;
  insert into categories (user_id, name, type, parent_id) values (uid, 'Súper', 'expense', c_food) returning id into c_super;
  insert into categories (user_id, name, type, parent_id) values (uid, 'Restaurantes', 'expense', c_food) returning id into c_rest;
  insert into categories (user_id, name, type, parent_id) values (uid, 'Café', 'expense', c_food) returning id into c_coffee;
  insert into categories (user_id, name, type, position) values (uid, 'Transporte', 'expense', 1) returning id into c_move;
  insert into categories (user_id, name, type, parent_id) values (uid, 'Gasolina', 'expense', c_move) returning id into c_gas;
  insert into categories (user_id, name, type, parent_id) values (uid, 'Uber', 'expense', c_move) returning id into c_uber;
  insert into categories (user_id, name, type, position) values (uid, 'Hogar', 'expense', 2) returning id into c_home;
  insert into categories (user_id, name, type, parent_id) values (uid, 'Renta', 'expense', c_home) returning id into c_rent;
  insert into categories (user_id, name, type, parent_id) values (uid, 'Servicios', 'expense', c_home) returning id into c_bills;
  insert into categories (user_id, name, type, position) values (uid, 'Ocio', 'expense', 3) returning id into c_fun;
  insert into categories (user_id, name, type, parent_id) values (uid, 'Cine', 'expense', c_fun) returning id into c_movies;
  insert into categories (user_id, name, type, parent_id) values (uid, 'Viajes', 'expense', c_fun) returning id into c_trips;
  insert into categories (user_id, name, type, position) values (uid, 'Salud', 'expense', 4) returning id into c_health;
  insert into categories (user_id, name, type, parent_id) values (uid, 'Farmacia', 'expense', c_health) returning id into c_pharmacy;
  insert into categories (user_id, name, type, parent_id) values (uid, 'Gimnasio', 'expense', c_health) returning id into c_gym;
  insert into categories (user_id, name, type, position) values (uid, 'Tecnología', 'expense', 5) returning id into c_tech;
  insert into categories (user_id, name, type, parent_id) values (uid, 'Suscripciones', 'expense', c_tech) returning id into c_subs;
  insert into categories (user_id, name, type, position) values (uid, 'Sueldo', 'income', 0) returning id into c_salary;
  insert into categories (user_id, name, type, position) values (uid, 'Freelance', 'income', 1) returning id into c_freelance;

  insert into budgets (user_id, category_id, monthly_limit_mxn) values (uid, c_food, 8000), (uid, c_fun, 2500);

  -- 120 days of everyday life
  for i in 0..120 loop
    d := today - 120 + i;
    -- Pay day: 1st and 15th
    if extract(day from d) in (1, 15) then
      insert into transactions (user_id, type, occurred_at, account_id, category_id, note, original_amount, currency, base_amount_mxn)
      values (uid, 'income', (d + time '09:00') at time zone tz, a_debit, c_salary, 'Quincena', 15000, 'MXN', 15000);
      -- Cash from the ATM
      pair := gen_random_uuid();
      insert into transactions (user_id, type, direction, occurred_at, account_id, note, original_amount, currency, base_amount_mxn, transfer_pair_id) values
        (uid, 'transfer', 'out', (d + time '13:00') at time zone tz, a_debit, 'Retiro cajero', 1000, 'MXN', 1000, pair),
        (uid, 'transfer', 'in', (d + time '13:00') at time zone tz, a_cash, 'Retiro cajero', 1000, 'MXN', 1000, pair);
    end if;
    if extract(day from d) = 1 then
      insert into transactions (user_id, type, occurred_at, account_id, category_id, subcategory_id, note, original_amount, currency, base_amount_mxn)
      values (uid, 'expense', (d + time '10:00') at time zone tz, a_debit, c_home, c_rent, 'Renta', 9500, 'MXN', 9500);
      -- Monthly savings transfer
      pair := gen_random_uuid();
      insert into transactions (user_id, type, direction, occurred_at, account_id, note, original_amount, currency, base_amount_mxn, transfer_pair_id) values
        (uid, 'transfer', 'out', (d + time '11:00') at time zone tz, a_debit, 'Ahorro del mes', 3000, 'MXN', 3000, pair),
        (uid, 'transfer', 'in', (d + time '11:00') at time zone tz, a_save, 'Ahorro del mes', 3000, 'MXN', 3000, pair);
    end if;
    if extract(day from d) = 10 then
      insert into transactions (user_id, type, occurred_at, account_id, category_id, subcategory_id, note, original_amount, currency, base_amount_mxn)
      values (uid, 'expense', (d + time '12:00') at time zone tz, a_debit, c_home, c_bills, 'Luz, agua e internet', round((1100 + random() * 400)::numeric, 2), 'MXN', 0);
      -- Card payment
      pair := gen_random_uuid();
      insert into transactions (user_id, type, direction, occurred_at, account_id, note, original_amount, currency, base_amount_mxn, transfer_pair_id) values
        (uid, 'transfer', 'out', (d + time '12:30') at time zone tz, a_debit, 'Pago tarjeta', 15000, 'MXN', 15000, pair),
        (uid, 'transfer', 'in', (d + time '12:30') at time zone tz, a_card, 'Pago tarjeta', 15000, 'MXN', 15000, pair);
    end if;
    if extract(day from d) = 20 then
      insert into transactions (user_id, type, occurred_at, account_id, category_id, note, original_amount, currency, base_amount_mxn)
      values (uid, 'income', (d + time '17:00') at time zone tz, a_debit, c_freelance, 'Proyecto de diseño', round((3500 + random() * 2500)::numeric, 0), 'MXN', 0);
    end if;
    -- Groceries every Saturday
    if extract(dow from d) = 6 then
      insert into transactions (user_id, type, occurred_at, account_id, category_id, subcategory_id, note, original_amount, currency, base_amount_mxn)
      values (uid, 'expense', (d + time '11:30') at time zone tz, a_card, c_food, c_super, 'Súper', round((900 + random() * 800)::numeric, 2), 'MXN', 0);
    end if;
    -- Gas every Monday
    if extract(dow from d) = 1 then
      insert into transactions (user_id, type, occurred_at, account_id, category_id, subcategory_id, note, original_amount, currency, base_amount_mxn)
      values (uid, 'expense', (d + time '08:15') at time zone tz, a_card, c_move, c_gas, 'Gasolina', round((650 + random() * 300)::numeric, 2), 'MXN', 0);
    end if;
    -- Coffee most weekdays
    if extract(dow from d) between 1 and 5 and random() < 0.6 then
      insert into transactions (user_id, type, occurred_at, account_id, category_id, subcategory_id, note, original_amount, currency, base_amount_mxn)
      values (uid, 'expense', (d + time '08:45') at time zone tz, a_cash, c_food, c_coffee, 'Café', round((55 + random() * 35)::numeric, 0), 'MXN', 0);
    end if;
    -- Eating out, sometimes with friends (shared)
    if random() < 0.28 then
      insert into transactions (user_id, type, occurred_at, account_id, category_id, subcategory_id, note, original_amount, currency, base_amount_mxn, paid_for_others)
      values (uid, 'expense', (d + time '14:30') at time zone tz, a_card, c_food, c_rest,
        (array['Tacos', 'Sushi', 'Pizza', 'Comida corrida', 'Hamburguesas'])[1 + floor(random() * 5)::int],
        round((220 + random() * 480)::numeric, 2), 'MXN', 0, random() < 0.3);
    end if;
    if random() < 0.18 then
      insert into transactions (user_id, type, occurred_at, account_id, category_id, subcategory_id, note, original_amount, currency, base_amount_mxn)
      values (uid, 'expense', (d + time '21:10') at time zone tz, a_card, c_move, c_uber, 'Uber', round((85 + random() * 160)::numeric, 2), 'MXN', 0);
    end if;
    if extract(dow from d) = 5 and random() < 0.5 then
      insert into transactions (user_id, type, occurred_at, account_id, category_id, subcategory_id, note, original_amount, currency, base_amount_mxn, paid_for_others)
      values (uid, 'expense', (d + time '19:30') at time zone tz, a_card, c_fun, c_movies, 'Cine', round((280 + random() * 220)::numeric, 0), 'MXN', 0, true);
    end if;
    if random() < 0.05 then
      insert into transactions (user_id, type, occurred_at, account_id, category_id, subcategory_id, note, original_amount, currency, base_amount_mxn)
      values (uid, 'expense', (d + time '18:00') at time zone tz, a_debit, c_health, c_pharmacy, 'Farmacia', round((150 + random() * 350)::numeric, 2), 'MXN', 0);
    end if;
  end loop;
  -- A trip a month and a half ago
  insert into transactions (user_id, type, occurred_at, account_id, category_id, subcategory_id, note, original_amount, currency, base_amount_mxn)
  values (uid, 'expense', ((today - 45) + time '07:00') at time zone tz, a_card, c_fun, c_trips, 'Vuelo a Cancún', 4890, 'MXN', 4890);
  -- MXN expenses: the base amount is the amount itself.
  update transactions set base_amount_mxn = original_amount where user_id = uid and currency = 'MXN' and base_amount_mxn = 0;

  -- Recurring: a subscription and an installment plan, with the past ones already applied
  insert into recurring_series (user_id, kind, amount, account_id, category_id, subcategory_id, note, frequency, start_date)
  values (uid, 'subscription', 219, a_card, c_tech, c_subs, 'Netflix', 'monthly', (date_trunc('month', today) - interval '5 months')::date + 4)
  returning id into s_netflix;
  insert into recurring_series (user_id, kind, amount, account_id, category_id, note, frequency, start_date, total_count)
  values (uid, 'installment', 2083.33, a_card, c_tech, 'Laptop (12 MSI)', 'monthly', (date_trunc('month', today) - interval '3 months')::date + 14, 12)
  returning id into s_laptop;
  insert into recurring_series (user_id, kind, amount, account_id, category_id, subcategory_id, note, frequency, start_date)
  values (uid, 'subscription', 599, a_debit, c_health, c_gym, 'Gimnasio', 'monthly', (date_trunc('month', today) - interval '4 months')::date + 2);
  perform materialize_series(id) from recurring_series where user_id = uid;
  update transactions set status = 'applied' where user_id = uid and status = 'pending' and occurred_at <= now();

  -- Calendar (local times)
  insert into events (user_id, title, location, start_at, end_at, recurrence) values
    (uid, 'Junta semanal del equipo', 'Zoom', ((today - extract(dow from today)::int + 1) + time '10:00') at time zone tz, ((today - extract(dow from today)::int + 1) + time '11:00') at time zone tz, '{"freq":"weekly","interval":1,"byweekday":[1]}'::jsonb);
  insert into events (user_id, title, location, start_at, end_at, reminder_minutes) values
    (uid, 'Dentista', 'Clínica Dental Valle', ((today + 2) + time '16:00') at time zone tz, ((today + 2) + time '17:00') at time zone tz, 60),
    (uid, 'Cena con amigos', 'La Nacional', ((today + 3) + time '20:30') at time zone tz, ((today + 3) + time '23:00') at time zone tz, null),
    (uid, 'Entrega de proyecto', null, ((today + 6) + time '09:00') at time zone tz, ((today + 6) + time '12:00') at time zone tz, 30),
    (uid, 'Clase de inglés', 'Online', ((today + 1) + time '18:00') at time zone tz, ((today + 1) + time '19:30') at time zone tz, 15),
    (uid, 'Comida familiar', 'Casa de mis papás', ((today - 3) + time '14:00') at time zone tz, ((today - 3) + time '17:00') at time zone tz, null);
  insert into events (user_id, title, start_at, end_at, all_day) values
    (uid, 'Cumpleaños de Ana', (today + 9)::timestamp at time zone tz, ((today + 9) + time '23:59') at time zone tz, true);

  -- Tasks (lists come from the new-user trigger; recreate them if missing)
  if not exists (select 1 from task_lists where user_id = uid) then
    insert into task_lists (user_id, name, color, icon, position) values
      (uid, 'Personal', '#f97316', 'user', 0), (uid, 'School', '#f59e0b', 'book', 1), (uid, 'Work', '#ea580c', 'briefcase', 2);
  end if;
  select id into l_personal from task_lists where user_id = uid order by position limit 1;
  select id into l_school from task_lists where user_id = uid order by position offset 1 limit 1;
  select id into l_work from task_lists where user_id = uid order by position offset 2 limit 1;
  insert into tasks (user_id, list_id, title, due_date, due_time, priority, completed_at) values
    (uid, l_personal, 'Pagar la tarjeta', today + 3, null, 2, null),
    (uid, l_personal, 'Comprar regalo para Ana', today + 7, null, 1, null),
    (uid, l_personal, 'Llamar al plomero', today, '12:00', 1, null),
    (uid, l_personal, 'Renovar licencia de manejo', today + 20, null, 0, null),
    (uid, l_personal, 'Recoger paquete', today - 1, null, 0, now() - interval '20 hours'),
    (uid, l_work, 'Preparar presentación de resultados', today + 1, '09:00', 3, null),
    (uid, l_work, 'Responder correos pendientes', today, null, 1, null),
    (uid, l_work, 'Revisar propuesta del cliente', today - 2, null, 2, now() - interval '2 days'),
    (uid, l_school, 'Tarea de inglés', today + 1, null, 1, null),
    (uid, l_school, 'Leer capítulo 4', today + 4, null, 0, null);

  -- Habits with about two months of history
  insert into habits (user_id, name, kind, type, color, start_date, goal_days, tags, position) values (uid, 'Ejercicio', 'good', 'boolean', '#75639F', today - 60, 66, '{salud}', 0) returning id into h_gym;
  insert into habits (user_id, name, kind, type, color, start_date, frequency, tags, position) values (uid, 'Leer 20 minutos', 'good', 'boolean', '#4E7299', today - 60, '{"type":"weekdays","days":[1,2,3,4,5]}', '{mente}', 1) returning id into h_read;
  insert into habits (user_id, name, kind, type, unit, target_value, color, start_date, tags, position) values (uid, 'Tomar agua', 'good', 'numeric', 'vasos', 8, '#9A8CC4', today - 60, '{salud}', 2) returning id into h_water;
  insert into habits (user_id, name, kind, type, color, start_date, position) values (uid, 'Sin refresco', 'bad', 'boolean', '#6B7280', today - 60, 3) returning id into h_soda;
  for i in 0..59 loop
    d := today - 60 + i;
    if random() < 0.72 then
      insert into habit_logs (user_id, habit_id, date, value) values (uid, h_gym, d, 1);
    elsif random() < 0.4 then
      insert into habit_logs (user_id, habit_id, date, value, is_slip) values (uid, h_gym, d, 0, true);
    end if;
    if extract(dow from d) between 1 and 5 and random() < 0.8 then
      insert into habit_logs (user_id, habit_id, date, value) values (uid, h_read, d, 1);
    end if;
    insert into habit_logs (user_id, habit_id, date, value) values (uid, h_water, d, 4 + floor(random() * 6));
    if random() < 0.06 then
      insert into habit_logs (user_id, habit_id, date, value, is_slip) values (uid, h_soda, d, 1, true);
    end if;
  end loop;

  select count(*) into n_tx from transactions where user_id = uid;
  return jsonb_build_object('user', uid, 'transactions', n_tx);
end;
$$;

-- Never callable from the app (it bypasses row-level security); only from the SQL editor or cron.
revoke execute on function public.seed_demo(text) from public, anon, authenticated;
