-- Pay off an installment plan early ("Liquidar ahora"), in one transaction:
--  1. future pending payments are removed (applied history stays),
--  2. one expense for the amount actually paid is recorded at p_at, linked to
--     the series with series_index null (that marks it as the liquidation),
--  3. the series ends.
-- Runs as the caller, so RLS keeps it to the user's own series.
create or replace function public.liquidate_series(p_series uuid, p_amount numeric, p_at timestamptz, p_note text)
returns uuid language plpgsql as $$
declare
  s public.recurring_series;
  new_id uuid;
begin
  select * into s from public.recurring_series where id = p_series for update;
  if not found then
    raise exception 'Series not found';
  end if;
  if s.status <> 'active' or s.kind <> 'installment' then
    raise exception 'Only active installment plans can be paid off';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than 0';
  end if;

  delete from public.transactions
  where series_id = s.id and status = 'pending' and occurred_at > p_at;

  insert into public.transactions (
    user_id, type, occurred_at, account_id, category_id, subcategory_id, note, description,
    original_amount, currency, exchange_rate, base_amount_mxn, status, series_id, series_index
  ) values (
    s.user_id, s.type, p_at, s.account_id, s.category_id, s.subcategory_id, p_note, s.description,
    p_amount, s.currency, s.exchange_rate, round(p_amount * s.exchange_rate, 2),
    case when p_at <= now() then 'applied' else 'pending' end, s.id, null
  ) returning id into new_id;

  update public.recurring_series set status = 'ended', next_run_date = null where id = s.id;
  return new_id;
end $$;
