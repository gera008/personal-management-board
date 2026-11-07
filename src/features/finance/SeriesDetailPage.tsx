import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase, unwrap } from '@/lib/supabase';
import { useRows } from '@/lib/data';
import { formatDate, money } from '@/lib/format';
import { Empty, Icon, Progress } from '@/components/ui';
import { installmentProgress, installmentTotal } from '@/domain/recurring/schedule';
import { num, type Transaction } from '@/domain/types';
import { categoryName, useAccounts, useCategories } from './hooks';
import { SeriesSheet } from './RecurringPage';
import { TransactionSheet } from './TransactionSheet';

/** One recurring series: what's been paid and what's still to come. */
export function SeriesDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const series = useRows('recurring_series', { key: [id], filter: (q) => q.eq('id', id) });
  const accounts = useAccounts();
  const cats = useCategories();
  const [editing, setEditing] = useState(false);
  const [txSheet, setTxSheet] = useState<Transaction | null>(null);

  const s = series.data?.[0];
  const payments = useQuery({
    queryKey: ['transactions', 'series', id],
    enabled: !!s,
    queryFn: async () => unwrap(await supabase.from('transactions').select('*').eq('series_id', id).order('occurred_at').order('series_index')) as Transaction[],
  });

  if (series.isSuccess && !s) return <Navigate to="/finance/recurring" replace />;
  if (!s) return <div className="h-40 animate-pulse rounded-3xl bg-surface" />;

  const rows = payments.data ?? [];
  const now = Date.now();
  const isPaid = (x: Transaction) => x.status === 'applied' || new Date(x.occurred_at).getTime() <= now;
  const paid = rows.filter(isPaid);
  const upcoming = rows.filter((x) => !isPaid(x));
  const sum = (list: Transaction[]) => list.reduce((acc, x) => acc + num(x.original_amount), 0);
  const payoff = rows.find((x) => x.series_index == null);
  const prog = s.total_count ? installmentProgress(paid.filter((x) => x.series_index != null).length, s.total_count) : null;
  const title = s.note || categoryName(cats.byId, s.category_id, t('finance.uncategorized'));
  const account = accounts.data?.find((a) => a.id === s.account_id);
  const tone = s.type === 'income' ? 'text-income' : 'text-expense';

  const list = (items: Transaction[], muted: boolean) => (
    <div className="card divide-y divide-border px-3 py-0">
      {items.map((x) => (
        <button key={x.id} onClick={() => setTxSheet(x)} className="flex w-full items-center gap-3 py-2.5 text-left">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${muted ? 'bg-surface text-muted' : `bg-surface ${tone}`}`}>
            {x.series_index ?? <Icon name="check" size={14} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm">{formatDate(x.occurred_at, 'd MMM yyyy')}</div>
            {x.series_index == null && <div className="text-xs text-muted">{t('finance.payoff')}</div>}
          </div>
          <span className={`text-sm font-semibold ${muted ? 'text-muted' : tone}`}>{money(num(x.original_amount), x.currency)}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/finance/recurring" className="rounded-lg p-1.5 text-muted hover:bg-surface" aria-label={t('finance.recurring')}>
          <Icon name="chevronLeft" size={20} />
        </Link>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">{title}</h2>
          <div className="truncate text-xs text-muted">
            {money(num(s.amount), s.currency)} · {t(`finance.freq.${s.frequency}`)}
            {account ? ` · ${account.name}` : ''}
            {s.status !== 'active' ? ` · ${payoff ? t('finance.seriesStatus.liquidated') : t(`finance.seriesStatus.${s.status}`)}` : ''}
          </div>
        </div>
        <button className="btn-ghost" onClick={() => setEditing(true)}>
          <Icon name="edit" size={16} /> {t('common.edit')}
        </button>
      </div>

      <div className="card space-y-3">
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="min-w-0">
            <div className="label">{t('finance.paidSoFar')}</div>
            <div className={`truncate text-lg font-semibold ${tone}`}>{money(sum(paid), s.currency)}</div>
            <div className="text-xs text-muted">{t('finance.paymentsCount', { count: paid.length })}</div>
          </div>
          <div className="min-w-0">
            <div className="label">{t('finance.stillToPay')}</div>
            <div className="truncate text-lg font-semibold">{money(sum(upcoming), s.currency)}</div>
            <div className="text-xs text-muted">{t('finance.paymentsCount', { count: upcoming.length })}</div>
          </div>
        </div>
        {prog && (
          <div className="flex items-center gap-2">
            <Progress ratio={prog.ratio} />
            <span className="shrink-0 text-xs font-medium">{prog.label}</span>
          </div>
        )}
        {s.total_count && (
          <div className="text-center text-xs text-muted">
            {t('finance.total')} {money(installmentTotal(num(s.amount), s.total_count, s.final_amount != null ? num(s.final_amount) : null), s.currency)}
            {s.final_amount != null && ` · ${t('finance.finalPayment')} ${money(num(s.final_amount), s.currency)}`}
          </div>
        )}
      </div>

      {payments.isLoading ? (
        <div className="h-40 animate-pulse rounded-3xl bg-surface" />
      ) : rows.length === 0 ? (
        <Empty>{t('finance.noPaymentsYet')}</Empty>
      ) : (
        <>
          {upcoming.length > 0 && (
            <section>
              <h3 className="section-title">{t('finance.upcomingPayments')}</h3>
              {list(upcoming, true)}
            </section>
          )}
          {paid.length > 0 && (
            <section>
              <h3 className="section-title">{t('finance.paidPayments')}</h3>
              {list([...paid].reverse(), false)}
            </section>
          )}
        </>
      )}

      <SeriesSheet open={editing} series={s} onClose={() => setEditing(false)} />
      <TransactionSheet open={!!txSheet} onClose={() => setTxSheet(null)} tx={txSheet} />
    </div>
  );
}
