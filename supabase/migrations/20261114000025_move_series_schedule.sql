-- Editing an active series' first payment date (or frequency) moves every
-- payment of the series: each one keeps its number and gets its new date.
-- Payments that now fall in the past count as paid; the ones that move into
-- the future go back to pending. Future payments are then rebuilt from the
-- series (amount, count, end date) like any other edit.
create or replace function public.move_series_schedule(p_series uuid, p_start date, p_frequency text)
returns integer language plpgsql as $$
declare
  s public.recurring_series;
  tz text;
begin
  select * into s from public.recurring_series where id = p_series for update;
  if not found then
    raise exception 'Series not found';
  end if;
  if s.status <> 'active' then
    raise exception 'Only active series can be rescheduled';
  end if;
  if p_frequency not in ('weekly', 'monthly', 'yearly') then
    raise exception 'Invalid frequency';
  end if;
  if s.end_date is not null and s.end_date < p_start then
    raise exception 'The end date is before the first payment';
  end if;

  select coalesce(p.timezone, 'America/Monterrey') into tz from public.profiles p where p.user_id = s.user_id;
  tz := coalesce(tz, 'America/Monterrey');

  update public.recurring_series set start_date = p_start, frequency = p_frequency where id = s.id;

  update public.transactions t
  set occurred_at = public.series_occurrence_date(p_start, p_frequency, t.series_index - 1)::timestamp at time zone tz,
      status = case
        when (public.series_occurrence_date(p_start, p_frequency, t.series_index - 1)::timestamp at time zone tz) <= now() then 'applied'
        else 'pending'
      end
  where t.series_id = s.id and t.series_index is not null;

  return public.reschedule_series(s.id);
end $$;
