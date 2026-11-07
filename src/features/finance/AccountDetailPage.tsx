import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { endOfMonth, startOfMonth } from 'date-fns';
import { supabase, unwrap } from '@/lib/supabase';
import { useProfile } from '@/lib/profile';
import { formatDate, money } from '@/lib/format';
import { Empty, Fab, Icon, MonthPicker } from '@/components/ui';
import { isoToDateKey } from '@/domain/dates';
import { num, type Transaction } from '@/domain/types';
import { useAccounts, useBalances, useCategories, usePendingByAccount } from './hooks';
import { AccountSheet } from './AccountsPage';
import { TxRow } from './FinanceHome';
import { TransactionSheet } from './TransactionSheet';

/** One account's movements, a month at a time. */
export function AccountDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { rates } = useProfile();
  const accounts = useAccounts();
  const balances = useBalances();
  const pending = usePendingByAccount().data;
  const cats = useCategories();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [txSheet, setTxSheet] = useState<{ tx?: Transaction | null } | null>(null);
  const [editing, setEditing] = useState(false);

  const all = accounts.data ?? [];
  const account = all.find((a) => a.id === id);
  const accById = new Map(all.map((a) => [a.id, a]));

  const txs = useQuery({
    queryKey: ['transactions', 'account', id, month.toISOString()],
    enabled: !!account,
    queryFn: async () => {
      const rows = unwrap(
        await supabase
          .from('transactions')
          .select('*')
          .eq('account_id', id)
          .gte('occurred_at', month.toISOString())
          .lte('occurred_at', endOfMonth(month).toISOString())
          .order('occurred_at', { ascending: false })
          .order('id'),
      ) as Transaction[];
      // The other side of each transfer, to label "From → To".
      const pairs = rows.filter((r) => r.transfer_pair_id).map((r) => r.transfer_pair_id!);
      const others = pairs.length
        ? (unwrap(await supabase.from('transactions').select('transfer_pair_id,account_id').in('transfer_pair_id', pairs).neq('account_id', id)) as Pick<Transaction, 'transfer_pair_id' | 'account_id'>[])
        : [];
      return { rows, otherAccount: new Map(others.map((o) => [o.transfer_pair_id!, o.account_id])) };
    },
  });

  const rows = txs.data?.rows ?? [];
  const groups = useMemo(() => {
    const m = new Map<string, Transaction[]>();
    for (const x of rows) m.set(isoToDateKey(x.occurred_at), [...(m.get(isoToDateKey(x.occurred_at)) ?? []), x]);
    return [...m.entries()];
  }, [rows]);

  if (accounts.isSuccess && !account) return <Navigate to="/finance/accounts" replace />;
  if (!account) return <div className="h-40 animate-pulse rounded-3xl bg-surface" />;

  const today = balances.data?.get(id) ?? num(account.initial_balance);
  const withPending = today + (pending?.get(id) ?? 0);
  // Money in and out of this account during the month, in its own currency (transfers included).
  const isIn = (x: Transaction) => x.type === 'income' || (x.type === 'transfer' && x.direction === 'in');
  const moneyIn = rows.filter(isIn).reduce((s, x) => s + num(x.original_amount), 0);
  const moneyOut = rows.filter((x) => !isIn(x)).reduce((s, x) => s + num(x.original_amount), 0);
  const otherName = (x: Transaction) => {
    const other = x.transfer_pair_id ? txs.data?.otherAccount.get(x.transfer_pair_id) : undefined;
    return other ? accById.get(other)?.name : undefined;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/finance/accounts" className="rounded-lg p-1.5 text-muted hover:bg-surface" aria-label={t('finance.accounts')}>
          <Icon name="chevronLeft" size={20} />
        </Link>
        <div className="min-w-0 flex-1">
          <h2 className={`truncate text-lg font-semibold ${account.archived ? 'text-muted line-through' : ''}`}>{account.name}</h2>
          <div className="text-xs text-muted">
            {t(`finance.accountTypes.${account.type}`)} · {account.currency}
          </div>
        </div>
        <button className="btn-ghost" onClick={() => setEditing(true)}>
          <Icon name="edit" size={16} /> {t('common.edit')}
        </button>
      </div>

      <div className="card text-center">
        <div className="label">{t('finance.balance')}</div>
        <div className={`text-display mt-1 ${withPending < 0 ? 'text-expense' : ''}`}>
          {money(withPending, account.currency)}
          <span className="text-unit ml-1.5">{account.currency}</span>
        </div>
        {account.currency !== 'MXN' && <div className="text-xs text-muted">{money(withPending * (rates[account.currency] ?? 0))}</div>}
        {Math.abs(withPending - today) >= 0.005 && (
          <div className="text-xs text-muted">
            {t('finance.today')}: {money(today, account.currency)}
          </div>
        )}
      </div>

      <MonthPicker month={month} onChange={setMonth} />

      <div className="card grid grid-cols-3 gap-2 text-center">
        <div className="min-w-0">
          <div className="label">{t('finance.moneyIn')}</div>
          <div className="truncate text-sm font-semibold text-income">{money(moneyIn, account.currency)}</div>
        </div>
        <div className="min-w-0">
          <div className="label">{t('finance.moneyOut')}</div>
          <div className="truncate text-sm font-semibold text-expense">{money(moneyOut, account.currency)}</div>
        </div>
        <div className="min-w-0">
          <div className="label">{t('finance.net')}</div>
          <div className={`truncate text-sm font-semibold ${moneyIn - moneyOut < 0 ? 'text-expense' : ''}`}>{money(moneyIn - moneyOut, account.currency, { sign: true })}</div>
        </div>
      </div>

      {txs.isLoading ? (
        <div className="h-40 animate-pulse rounded-3xl bg-surface" />
      ) : groups.length === 0 ? (
        <Empty>{t('finance.noTransactionsMonth')}</Empty>
      ) : (
        groups.map(([day, list]) => (
          <section key={day}>
            <h3 className="section-title mb-1 capitalize">{formatDate(day, 'EEEE d MMM')}</h3>
            <div className="card divide-y divide-border px-3 py-0">
              {list.map((x) => (
                <TxRow key={x.id} tx={x} accById={accById} cats={cats.byId} other={otherName(x)} onOpen={() => setTxSheet({ tx: x })} />
              ))}
            </div>
          </section>
        ))
      )}

      <Fab label={t('finance.newTransaction')} onClick={() => setTxSheet({})} />
      <TransactionSheet open={!!txSheet} onClose={() => setTxSheet(null)} tx={txSheet?.tx} accountId={id} />
      <AccountSheet open={editing} account={account} onClose={() => setEditing(false)} position={all.length} />
    </div>
  );
}
