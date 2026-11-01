import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { startOfMonth, subMonths } from 'date-fns';
import { money, formatDate } from '@/lib/format';
import { Empty, Fab, Icon } from '@/components/ui';
import { isoToDateKey } from '@/domain/dates';
import { num, type Account, type Category, type Transaction } from '@/domain/types';
import { categoryName, useAccounts, useCategories, useTransactions } from './hooks';
import { Indicators } from './Indicators';
import { TransactionSheet } from './TransactionSheet';

export function FinanceHome() {
  const { t } = useTranslation();
  const [monthsBack, setMonthsBack] = useState(0);
  const [showUpcoming, setShowUpcoming] = useState(false);
  const [sheet, setSheet] = useState<{ tx?: Transaction | null } | null>(null);
  const from = useMemo(() => startOfMonth(subMonths(new Date(), monthsBack)), [monthsBack]);
  const txs = useTransactions(from);
  const accounts = useAccounts();
  const cats = useCategories();
  const accById = new Map((accounts.data ?? []).map((a) => [a.id, a]));

  const now = Date.now();
  const all = txs.data ?? [];
  const upcoming = all.filter((x) => x.status === 'pending' && new Date(x.occurred_at).getTime() > now).reverse();
  const past = all.filter((x) => !upcoming.includes(x));
  const groups = groupByDay(dedupeTransfers(past));
  // Name of the other account of each transfer, for "From → To" labels.
  const counterpart = (x: Transaction) => {
    const other = all.find((y) => y.transfer_pair_id === x.transfer_pair_id && y.id !== x.id);
    return other ? accById.get(other.account_id)?.name : undefined;
  };

  return (
    <div className="space-y-4">
      <Indicators />

      {upcoming.length > 0 && (
        <section className="card">
          <button className="flex w-full items-center gap-1 text-sm font-semibold" onClick={() => setShowUpcoming(!showUpcoming)} aria-expanded={showUpcoming}>
            <Icon name={showUpcoming ? 'chevronDown' : 'chevronRight'} size={16} className="text-muted" />
            {t('finance.upcoming', { count: upcoming.length })}
          </button>
          {showUpcoming && (
            <div className="mt-2 divide-y divide-border">
              {dedupeTransfers(upcoming)
                .slice(0, 50)
                .map((x) => (
                  <TxRow key={x.id} tx={x} accById={accById} cats={cats.byId} other={counterpart(x)} showDate onOpen={() => setSheet({ tx: x })} />
                ))}
            </div>
          )}
        </section>
      )}

      {txs.isLoading ? (
        <div className="h-40 animate-pulse rounded-xl bg-surface" />
      ) : groups.length === 0 ? (
        <Empty>{(accounts.data ?? []).length === 0 ? t('finance.startWithAccount') : t('finance.noTransactions')}</Empty>
      ) : (
        groups.map(([day, list]) => {
          const net = list.reduce((s, x) => s + (x.type === 'expense' ? -num(x.base_amount_mxn) : x.type === 'income' ? num(x.base_amount_mxn) : 0), 0);
          return (
            <section key={day}>
              <div className="mb-1 flex items-baseline justify-between">
                <h3 className="section-title mb-0 capitalize">{formatDate(day, 'EEEE d MMM yyyy')}</h3>
                <span className={`text-xs ${net < 0 ? 'text-expense' : net > 0 ? 'text-income' : 'text-muted'}`}>{money(net, 'MXN', { sign: true })}</span>
              </div>
              <div className="card divide-y divide-border px-3 py-0">
                {list.map((x) => (
                  <TxRow key={x.id} tx={x} accById={accById} cats={cats.byId} other={x.type === 'transfer' ? counterpart(x) : undefined} onOpen={() => setSheet({ tx: x })} />
                ))}
              </div>
            </section>
          );
        })
      )}

      <button className="btn-ghost w-full" onClick={() => setMonthsBack(monthsBack + 1)} disabled={txs.isFetching}>
        {t('finance.loadEarlier', { month: formatDate(subMonths(from, 1), 'MMMM yyyy') })}
      </button>

      <Fab label={t('finance.newTransaction')} onClick={() => setSheet({})} />
      <TransactionSheet open={!!sheet} onClose={() => setSheet(null)} tx={sheet?.tx} />
    </div>
  );
}

/** Shows each transfer once (its outgoing side). */
function dedupeTransfers(list: Transaction[]) {
  const seen = new Set<string>();
  return list.filter((x) => {
    if (x.type !== 'transfer' || !x.transfer_pair_id) return true;
    if (seen.has(x.transfer_pair_id)) return false;
    seen.add(x.transfer_pair_id);
    return true;
  });
}

function groupByDay(list: Transaction[]): [string, Transaction[]][] {
  const m = new Map<string, Transaction[]>();
  for (const x of list) {
    const k = isoToDateKey(x.occurred_at);
    m.set(k, [...(m.get(k) ?? []), x]);
  }
  return [...m.entries()];
}

export function TxRow({ tx, accById, cats, onOpen, showDate, other }: { tx: Transaction; accById: Map<string, Account>; cats: Map<string, Category>; onOpen: () => void; showDate?: boolean; other?: string }) {
  const { t } = useTranslation();
  const isTransfer = tx.type === 'transfer';
  const acc = accById.get(tx.account_id);
  const title = isTransfer ? t('finance.types.transfer') : tx.note || categoryName(cats, tx.subcategory_id ?? tx.category_id, t('finance.uncategorized'));
  const subtitle = isTransfer
    ? tx.direction === 'out'
      ? `${acc?.name ?? ''} → ${other ?? '?'}`
      : `${other ?? '?'} → ${acc?.name ?? ''}`
    : [categoryName(cats, tx.category_id, ''), tx.subcategory_id ? categoryName(cats, tx.subcategory_id, '') : '', acc?.name].filter(Boolean).join(' · ');
  const tone = tx.type === 'expense' ? 'text-expense' : tx.type === 'income' ? 'text-income' : 'text-transfer';
  const amount = num(tx.original_amount);
  return (
    <button onClick={onOpen} className="flex w-full items-center gap-3 py-2.5 text-left">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface ${tone}`}>
        <Icon name={isTransfer ? 'swap' : tx.type === 'income' ? 'arrowDown' : 'arrowUp'} size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {title}
          {tx.series_index != null && <span className="ml-1 text-xs text-muted">#{tx.series_index}</span>}
        </div>
        <div className="truncate text-xs text-muted">
          {showDate && `${formatDate(tx.occurred_at, 'd MMM')} · `}
          {subtitle}
        </div>
      </div>
      <div className="text-right">
        <div className={`text-sm font-semibold ${tone}`}>
          {tx.type === 'expense' ? '−' : tx.type === 'income' ? '+' : ''}
          {money(amount, tx.currency)}
        </div>
        {tx.currency !== 'MXN' && <div className="text-[11px] text-muted">{money(num(tx.base_amount_mxn))}</div>}
        {tx.status === 'pending' && <div className="text-[11px] text-muted">{t('finance.pending')}</div>}
      </div>
    </button>
  );
}
