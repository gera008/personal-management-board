import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase, unwrap } from '@/lib/supabase';
import { rpc, useInvalidate, useRows } from '@/lib/data';
import { useProfile } from '@/lib/profile';
import { formatDate, money } from '@/lib/format';
import { Empty, ErrorText, Fab, Field, Progress, SaveBar, Segmented, Sheet } from '@/components/ui';
import { installmentProgress, installmentTotal, lastInstallmentDate, remainingPayments, scheduleDates } from '@/domain/recurring/schedule';
import { toDateKey } from '@/domain/dates';
import { CURRENCIES, num, type Currency, type Frequency, type RecurringSeries } from '@/domain/types';
import { categoryName, useAccounts, useCategories } from './hooks';

const FREQS: Frequency[] = ['weekly', 'monthly', 'yearly'];

/** Applied payments per series, plus the payoff amount of series that were liquidated (series_index null). */
function useSeriesCounts() {
  return useQuery({
    queryKey: ['transactions', 'series-counts'],
    queryFn: async () => {
      const rows = unwrap(await supabase.from('transactions').select('series_id,status,series_index,original_amount').not('series_id', 'is', null)) as {
        series_id: string;
        status: string;
        series_index: number | null;
        original_amount: string;
      }[];
      const applied = new Map<string, number>();
      const liquidated = new Map<string, number>();
      for (const r of rows) {
        if (r.series_index == null) liquidated.set(r.series_id, Number(r.original_amount));
        else if (r.status === 'applied') applied.set(r.series_id, (applied.get(r.series_id) ?? 0) + 1);
      }
      return { applied, liquidated };
    },
  });
}

export function RecurringPage() {
  const { t } = useTranslation();
  const series = useRows('recurring_series', { filter: (q) => q.order('status').order('next_run_date', { nullsFirst: false }) });
  const counts = useSeriesCounts();
  const accounts = useAccounts();
  const cats = useCategories();
  const [sheet, setSheet] = useState<{ series?: RecurringSeries | null } | null>(null);
  const accName = (id: string) => accounts.data?.find((a) => a.id === id)?.name ?? '';
  const all = series.data ?? [];
  const groups = [
    { key: 'installment', items: all.filter((s) => s.kind === 'installment' && s.status === 'active') },
    { key: 'subscription', items: all.filter((s) => s.kind === 'subscription' && s.status === 'active') },
    { key: 'finished', items: all.filter((s) => s.status !== 'active') },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t('finance.recurringHelp')}</p>
      {all.length === 0 && <Empty>{t('finance.noSeries')}</Empty>}
      {groups
        .filter((g) => g.items.length)
        .map((g) => (
          <section key={g.key}>
            <h3 className="section-title">{t(`finance.seriesGroups.${g.key}`)}</h3>
            <div className="card divide-y divide-border px-3 py-0">
              {g.items.map((s) => {
                const applied = counts.data?.applied.get(s.id) ?? 0;
                const payoff = counts.data?.liquidated.get(s.id);
                const prog = s.total_count ? installmentProgress(applied, s.total_count) : null;
                return (
                  <button key={s.id} onClick={() => setSheet({ series: s })} className="block w-full py-3 text-left">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium">{s.note || categoryName(cats.byId, s.category_id, t('finance.uncategorized'))}</span>
                      <span className={`shrink-0 text-sm font-semibold ${s.type === 'income' ? 'text-income' : 'text-expense'}`}>{money(num(s.amount), s.currency)}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {t(`finance.freq.${s.frequency}`)} · {accName(s.account_id)}
                      {s.status === 'active' && s.next_run_date ? ` · ${t('finance.next')} ${formatDate(s.next_run_date, 'd MMM yyyy')}` : ''}
                      {s.status !== 'active' ? ` · ${payoff != null ? t('finance.seriesStatus.liquidated') : t(`finance.seriesStatus.${s.status}`)}` : ''}
                    </div>
                    {s.total_count && (
                      <div className="text-xs text-muted">
                        {s.final_amount != null && `${t('finance.finalPayment')} ${money(num(s.final_amount), s.currency)} · `}
                        {t('finance.total')} {money(installmentTotal(num(s.amount), s.total_count, s.final_amount != null ? num(s.final_amount) : null), s.currency)}
                      </div>
                    )}
                    {prog && (
                      <div className="mt-2 flex items-center gap-2">
                        <Progress ratio={prog.ratio} />
                        <span className="shrink-0 text-xs font-medium">
                          {prog.label}
                          {payoff != null && ` + ${t('finance.payoff')} ${money(payoff, s.currency)}`}
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      <Fab label={t('finance.newSeries')} onClick={() => setSheet({})} />
      <SeriesSheet open={!!sheet} series={sheet?.series} onClose={() => setSheet(null)} />
    </div>
  );
}

function SeriesSheet({ open, series, onClose }: { open: boolean; series?: RecurringSeries | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { rates } = useProfile();
  const accounts = (useAccounts().data ?? []).filter((a) => !a.archived);
  const cats = useCategories();
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [f, setF] = useState({
    kind: 'installment' as RecurringSeries['kind'],
    type: 'expense' as RecurringSeries['type'],
    amount: '',
    currency: 'MXN' as Currency,
    rate: '1',
    account_id: '',
    category_id: '',
    subcategory_id: '',
    note: '',
    frequency: 'monthly' as Frequency,
    start_date: toDateKey(new Date()),
    total_count: '12',
    final_amount: '',
    end_date: '',
  });

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (series) {
      setF({
        kind: series.kind,
        type: series.type,
        amount: String(num(series.amount)),
        currency: series.currency,
        rate: String(num(series.exchange_rate)),
        account_id: series.account_id,
        category_id: series.category_id ?? '',
        subcategory_id: series.subcategory_id ?? '',
        note: series.note ?? '',
        frequency: series.frequency,
        start_date: series.start_date,
        total_count: String(series.total_count ?? ''),
        final_amount: series.final_amount != null ? String(num(series.final_amount)) : '',
        end_date: series.end_date ?? '',
      });
    } else {
      const a = accounts[0];
      setF((x) => ({ ...x, amount: '', note: '', category_id: '', subcategory_id: '', account_id: a?.id ?? '', final_amount: '', currency: a?.currency ?? 'MXN', rate: String(a && a.currency !== 'MXN' ? rates[a.currency] ?? '' : 1), start_date: toDateKey(new Date()), end_date: '' }));
    }
  }, [open, series?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const editing = !!series;
  const active = !series || series.status === 'active';
  const preview = scheduleDates({
    startDate: f.start_date,
    frequency: f.frequency,
    totalCount: f.kind === 'installment' ? Number(f.total_count) || 1 : null,
    endDate: f.kind === 'subscription' ? f.end_date || null : null,
    limit: 3,
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const amount = Number(f.amount);
      const rate = f.currency === 'MXN' ? 1 : Number(f.rate);
      if (!(amount > 0)) throw new Error(t('finance.amountRequired'));
      if (!(rate > 0)) throw new Error(t('finance.rateMissing'));
      const row = {
        type: f.type,
        amount,
        currency: f.currency,
        exchange_rate: rate,
        account_id: f.account_id,
        category_id: f.category_id || null,
        subcategory_id: f.subcategory_id || null,
        note: f.note || null,
        total_count: f.kind === 'installment' ? Number(f.total_count) : null,
        final_amount: f.kind === 'installment' && Number(f.final_amount) > 0 ? Number(f.final_amount) : null,
        end_date: f.kind === 'subscription' && f.end_date ? f.end_date : null,
      };
      if (series) {
        unwrap(await supabase.from('recurring_series').update(row).eq('id', series.id));
        await rpc('reschedule_series', { p_series: series.id });
      } else {
        const created = unwrap(await supabase.from('recurring_series').insert({ ...row, kind: f.kind, frequency: f.frequency, start_date: f.start_date }).select('id').single()) as { id: string };
        await rpc('materialize_series', { p_series: created.id });
        // Past-dated occurrences become applied right away instead of waiting for the job.
        unwrap(await supabase.from('transactions').update({ status: 'applied' }).eq('series_id', created.id).eq('status', 'pending').lte('occurred_at', new Date().toISOString()));
      }
      invalidate('recurring_series');
      invalidate('transactions');
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  // "Liquidar ahora": what's left (future pending payments) and the payoff form.
  const pendingRows = useQuery({
    queryKey: ['transactions', 'series-pending', series?.id],
    enabled: open && !!series && series.kind === 'installment' && series.status === 'active',
    queryFn: async () =>
      unwrap(await supabase.from('transactions').select('status,occurred_at,original_amount').eq('series_id', series!.id).eq('status', 'pending')) as {
        status: string;
        occurred_at: string;
        original_amount: string;
      }[],
  });
  const left = remainingPayments(pendingRows.data ?? [], new Date());
  const [payoff, setPayoff] = useState<{ amount: string; date: string } | null>(null);
  useEffect(() => setPayoff(null), [open, series?.id]);

  const liquidate = async () => {
    if (!series || !payoff) return;
    const amount = Number(payoff.amount);
    if (!(amount > 0)) return setError(new Error(t('finance.amountRequired')));
    setBusy(true);
    setError(null);
    try {
      // Today keeps the current time; another date is recorded at its local midnight.
      const at = payoff.date === toDateKey(new Date()) ? new Date() : new Date(`${payoff.date}T00:00`);
      const label = series.note || categoryName(cats.byId, series.category_id, t('finance.uncategorized'));
      await rpc('liquidate_series', { p_series: series.id, p_amount: amount, p_at: at.toISOString(), p_note: `${label} (${t('finance.payoffNote')})` });
      invalidate('recurring_series');
      invalidate('transactions');
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const cancelSeries = async () => {
    if (!series || !confirm(t('finance.cancelSeriesConfirm'))) return;
    try {
      await rpc('cancel_series', { p_series: series.id });
      invalidate('recurring_series');
      invalidate('transactions');
      onClose();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? t('finance.editSeries') : t('finance.newSeries')}
      footer={
        payoff ? (
          <>
            <button type="button" className="btn-ghost ml-auto" onClick={() => setPayoff(null)} disabled={busy}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn-primary" onClick={liquidate} disabled={busy}>
              {busy ? t('common.saving') : t('finance.payoffConfirm')}
            </button>
          </>
        ) : active ? (
          <>
            {editing && (
              // Series actions get their own row on phones; save/cancel stay on the right.
              <div className="flex w-full gap-2 sm:w-auto">
                <button type="button" className="btn-danger flex-1 sm:flex-none" onClick={cancelSeries}>
                  {t('finance.cancelSeries')}
                </button>
                {series?.kind === 'installment' && left.count > 0 && (
                  <button type="button" className="btn-ghost flex-1 sm:flex-none" onClick={() => setPayoff({ amount: String(left.total), date: toDateKey(new Date()) })}>
                    {t('finance.payoffButton')}
                  </button>
                )}
              </div>
            )}
            <SaveBar onCancel={onClose} saving={busy} />
          </>
        ) : (
          <button className="btn-ghost ml-auto" onClick={onClose}>
            {t('common.close')}
          </button>
        )
      }
    >
      {payoff && series && (
        <div className="mb-4 space-y-3 rounded-lg border border-border p-3">
          <p className="text-sm font-medium">{t('finance.payoffTitle')}</p>
          <p className="text-sm text-muted">{t('finance.payoffLeft', { count: left.count, amount: money(left.total, series.currency) })}</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('finance.payoffAmount')}>
              <input className="input" inputMode="decimal" value={payoff.amount} onChange={(e) => setPayoff({ ...payoff, amount: e.target.value.replace(',', '.') })} />
            </Field>
            <Field label={t('finance.date')}>
              <input type="date" className="input" value={payoff.date} onChange={(e) => e.target.value && setPayoff({ ...payoff, date: e.target.value })} />
            </Field>
          </div>
          <p className="text-xs text-muted">{t('finance.payoffHelp')}</p>
        </div>
      )}
      <form id="sheet-form" onSubmit={submit} hidden={!!payoff}>
        <fieldset disabled={!active}>
          <ErrorText error={error} />
          {editing && <p className="mb-3 rounded-lg bg-surface px-3 py-2 text-xs text-muted">{t('finance.editSeriesHelp')}</p>}
          <Segmented
            className="mb-3 w-full"
            value={f.kind}
            onChange={(kind) => !editing && setF({ ...f, kind })}
            options={[
              { value: 'installment', label: t('finance.installment') },
              { value: 'subscription', label: t('finance.subscription') },
            ]}
          />
          <Segmented
            className="mb-3 w-full"
            value={f.type}
            onChange={(type) => setF({ ...f, type, category_id: '', subcategory_id: '' })}
            options={[
              { value: 'expense', label: t('finance.types.expense') },
              { value: 'income', label: t('finance.types.income') },
            ]}
          />
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Field label={t('finance.amountEach')}>
              <input className="input" inputMode="decimal" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(',', '.') })} />
            </Field>
            <Field label={t('finance.currency')}>
              <select className="input" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as Currency, rate: String(e.target.value === 'MXN' ? 1 : rates[e.target.value as Currency] ?? '') })}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
          </div>
          {f.currency !== 'MXN' && (
            <Field label={t('finance.rateTo', { currency: f.currency })}>
              <input className="input" inputMode="decimal" required value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value.replace(',', '.') })} />
            </Field>
          )}
          <Field label={t('finance.account')}>
            <select className="input" required value={f.account_id} onChange={(e) => setF({ ...f, account_id: e.target.value })}>
              <option value="" />
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('finance.category')}>
              <select className="input" value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value, subcategory_id: '' })}>
                <option value="">—</option>
                {cats.parents(f.type).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('finance.subcategory')}>
              <select className="input" value={f.subcategory_id} disabled={!f.category_id} onChange={(e) => setF({ ...f, subcategory_id: e.target.value })}>
                <option value="">—</option>
                {f.category_id &&
                  cats.children(f.category_id).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
          <Field label={t('finance.note')}>
            <input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={t('finance.seriesNotePlaceholder')} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('finance.frequency')}>
              <select className="input" disabled={editing} value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value as Frequency })}>
                {FREQS.map((x) => (
                  <option key={x} value={x}>
                    {t(`finance.freq.${x}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('finance.startDate')}>
              <input type="date" className="input" required disabled={editing} value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} />
            </Field>
          </div>
          {f.kind === 'installment' ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('finance.totalPayments')}>
                <input type="number" min={1} max={600} className="input" required value={f.total_count} onChange={(e) => setF({ ...f, total_count: e.target.value })} />
              </Field>
              <Field label={t('finance.finalAmount')}>
                <input className="input" inputMode="decimal" placeholder={t('finance.optional')} value={f.final_amount} onChange={(e) => setF({ ...f, final_amount: e.target.value.replace(',', '.') })} />
              </Field>
            </div>
          ) : (
            <Field label={t('finance.endDateOptional')}>
              <input type="date" className="input" value={f.end_date} min={f.start_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} />
            </Field>
          )}
          <div className="rounded-lg bg-surface px-3 py-2 text-xs text-muted">
            {t('finance.firstDates')}: {preview.map((d) => formatDate(d, 'd MMM yyyy')).join(', ')}
            {f.kind === 'installment' && Number(f.total_count) > 0 && (
              <>
                <br />
                {t('finance.lastPayment')}: {formatDate(lastInstallmentDate(f.start_date, f.frequency, Number(f.total_count)), 'd MMM yyyy')}
                {Number(f.final_amount) > 0 && ` (${money(Number(f.final_amount), f.currency)})`} · {t('finance.total')}:{' '}
                {money(installmentTotal(Number(f.amount || 0), Number(f.total_count), Number(f.final_amount) > 0 ? Number(f.final_amount) : null), f.currency)}
              </>
            )}
          </div>
        </fieldset>
      </form>
    </Sheet>
  );
}
