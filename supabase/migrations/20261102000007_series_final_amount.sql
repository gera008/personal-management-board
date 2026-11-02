-- Installments can end with a different last payment (e.g. "Pago Final iPhone").
alter table public.recurring_series
  add column if not exists final_amount numeric(14, 2) check (final_amount > 0);
alter table public.recurring_series
  add constraint recurring_series_final_amount_installment check (final_amount is null or kind = 'installment');

create or replace function public.materialize_series(p_series uuid)
returns integer language plpgsql as $$
declare
  s public.recurring_series;
  tz text;
  n integer;
  d date;
  horizon date;
  created integer := 0;
  amt numeric(14, 2);
begin
  select * into s from public.recurring_series where id = p_series for update;
  if not found or s.status <> 'active' then
    return 0;
  end if;
  select coalesce(p.timezone, 'America/Monterrey') into tz from public.profiles p where p.user_id = s.user_id;
  tz := coalesce(tz, 'America/Monterrey');
  horizon := (now() at time zone tz)::date + 366;
  if s.end_date is not null and s.end_date < horizon then
    horizon := s.end_date;
  end if;

  n := s.occurrences_created;
  loop
    exit when s.total_count is not null and n >= s.total_count;
    d := public.series_occurrence_date(s.start_date, s.frequency, n);
    -- Installments may end with a different amount (e.g. a balloon payment).
    amt := case when s.final_amount is not null and n = s.total_count - 1 then s.final_amount else s.amount end;
    exit when s.total_count is null and d > horizon;
    insert into public.transactions (
      user_id, type, occurred_at, account_id, category_id, subcategory_id, note, description,
      original_amount, currency, exchange_rate, base_amount_mxn, status, series_id, series_index
    ) values (
      s.user_id, s.type, d::timestamp at time zone tz, s.account_id, s.category_id, s.subcategory_id,
      s.note, s.description, amt, s.currency, s.exchange_rate, round(amt * s.exchange_rate, 2),
      'pending', s.id, n + 1
    );
    n := n + 1;
    created := created + 1;
  end loop;

  update public.recurring_series
  set occurrences_created = n,
      next_run_date = (
        select min((t.occurred_at at time zone tz)::date) from public.transactions t
        where t.series_id = s.id and t.status = 'pending'
      )
  where id = s.id;
  return created;
end $$;
