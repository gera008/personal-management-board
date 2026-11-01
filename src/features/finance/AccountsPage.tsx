import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useRemove, useSave } from '@/lib/data';
import { useProfile } from '@/lib/profile';
import { money } from '@/lib/format';
import { Empty, ErrorText, Fab, Field, SaveBar, Sheet } from '@/components/ui';
import { ACCOUNT_TYPES, CURRENCIES, num, type Account, type AccountType, type Currency } from '@/domain/types';
import { totalBalanceMXN } from '@/domain/finance/totals';
import { useAccounts, useBalances } from './hooks';

export function AccountsPage() {
  const { t } = useTranslation();
  const { rates } = useProfile();
  const accounts = useAccounts();
  const balances = useBalances();
  const [sheet, setSheet] = useState<{ account?: Account | null } | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const list = (accounts.data ?? []).filter((a) => showArchived || !a.archived);
  const bal = balances.data ?? new Map();
  const total = totalBalanceMXN(accounts.data ?? [], bal, rates);
  const byType = ACCOUNT_TYPES.map((type) => ({ type, items: list.filter((a) => a.type === type) })).filter((g) => g.items.length);

  return (
    <div className="space-y-4">
      <div className="card flex items-center justify-between">
        <span className="text-sm text-muted">{t('finance.totalBalance')}</span>
        <span className={`text-xl font-bold ${total < 0 ? 'text-expense' : ''}`}>{money(total)}</span>
      </div>
      {list.length === 0 ? (
        <Empty action={<button className="btn-primary" onClick={() => setSheet({})}>{t('finance.newAccount')}</button>}>{t('finance.noAccounts')}</Empty>
      ) : (
        byType.map((g) => (
          <section key={g.type}>
            <h3 className="section-title">{t(`finance.accountTypes.${g.type}`)}</h3>
            <div className="card divide-y divide-border px-3 py-0">
              {g.items.map((a) => {
                const b = bal.get(a.id) ?? num(a.initial_balance);
                return (
                  <button key={a.id} onClick={() => setSheet({ account: a })} className="flex w-full items-center gap-3 py-3 text-left">
                    <div className="min-w-0 flex-1">
                      <div className={`truncate text-sm font-medium ${a.archived ? 'text-muted line-through' : ''}`}>{a.name}</div>
                      <div className="text-xs text-muted">
                        {a.currency}
                        {a.type === 'credit_card' && a.cutoff_day ? ` · ${t('finance.cutoff')} ${a.cutoff_day}` : ''}
                        {a.type === 'credit_card' && a.payment_day ? ` · ${t('finance.payment')} ${a.payment_day}` : ''}
                        {!a.include_in_total ? ` · ${t('finance.excluded')}` : ''}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-sm font-semibold ${b < 0 ? 'text-expense' : ''}`}>{money(b, a.currency)}</div>
                      {a.currency !== 'MXN' && <div className="text-[11px] text-muted">{money(b * (rates[a.currency] ?? 0))}</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ))
      )}
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        {t('common.showArchived')}
      </label>
      <Fab label={t('finance.newAccount')} onClick={() => setSheet({})} />
      <AccountSheet open={!!sheet} account={sheet?.account} onClose={() => setSheet(null)} position={(accounts.data ?? []).length} />
    </div>
  );
}

function AccountSheet({ open, account, onClose, position }: { open: boolean; account?: Account | null; onClose: () => void; position: number }) {
  const { t } = useTranslation();
  const save = useSave('accounts');
  const remove = useRemove('accounts');
  const [f, setF] = useState({ name: '', type: 'debit' as AccountType, currency: 'MXN' as Currency, initial_balance: '0', cutoff_day: '', payment_day: '', include_in_total: true, archived: false });

  useEffect(() => {
    if (!open) return;
    setF({
      name: account?.name ?? '',
      type: account?.type ?? 'debit',
      currency: account?.currency ?? 'MXN',
      initial_balance: String(num(account?.initial_balance ?? 0)),
      cutoff_day: account?.cutoff_day ? String(account.cutoff_day) : '',
      payment_day: account?.payment_day ? String(account.payment_day) : '',
      include_in_total: account?.include_in_total ?? true,
      archived: account?.archived ?? false,
    });
    save.reset();
    remove.reset();
  }, [open, account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await save.mutateAsync({
      id: account?.id,
      name: f.name.trim(),
      type: f.type,
      currency: f.currency,
      initial_balance: Number(f.initial_balance || 0),
      cutoff_day: f.type === 'credit_card' && f.cutoff_day ? Number(f.cutoff_day) : null,
      payment_day: f.type === 'credit_card' && f.payment_day ? Number(f.payment_day) : null,
      include_in_total: f.include_in_total,
      archived: f.archived,
      ...(account ? {} : { position }),
    });
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={account ? t('finance.editAccount') : t('finance.newAccount')}
      footer={<SaveBar onCancel={onClose} saving={save.isPending} onDelete={account ? () => remove.mutateAsync(account.id).then(onClose) : undefined} />}
    >
      <form id="sheet-form" onSubmit={submit}>
        <ErrorText error={save.error} />
        {remove.error && <ErrorText error={t('finance.accountInUse')} />}
        <Field label={t('common.name')}>
          <input className="input" required autoFocus={!account} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('finance.accountType')}>
            <select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as AccountType })}>
              {ACCOUNT_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(`finance.accountTypes.${x}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('finance.currency')}>
            <select className="input" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as Currency })}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label={t('finance.initialBalance')}>
          <input className="input" inputMode="decimal" value={f.initial_balance} onChange={(e) => setF({ ...f, initial_balance: e.target.value.replace(',', '.') })} />
        </Field>
        {f.type === 'credit_card' && (
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('finance.cutoffDay')}>
              <input className="input" type="number" min={1} max={31} value={f.cutoff_day} onChange={(e) => setF({ ...f, cutoff_day: e.target.value })} />
            </Field>
            <Field label={t('finance.paymentDay')}>
              <input className="input" type="number" min={1} max={31} value={f.payment_day} onChange={(e) => setF({ ...f, payment_day: e.target.value })} />
            </Field>
          </div>
        )}
        <label className="mb-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.include_in_total} onChange={(e) => setF({ ...f, include_in_total: e.target.checked })} />
          {t('finance.includeInTotal')}
        </label>
        {account && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.archived} onChange={(e) => setF({ ...f, archived: e.target.checked })} />
            {t('common.archived')}
          </label>
        )}
      </form>
    </Sheet>
  );
}
