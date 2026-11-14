import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, format } from 'date-fns';
import { supabase, unwrap } from '@/lib/supabase';
import { useInvalidate } from '@/lib/data';
import { useProfile } from '@/lib/profile';
import { money } from '@/lib/format';
import { ErrorText, Group, Row, SaveBar, Segmented, Sheet, Switch } from '@/components/ui';
import { CURRENCIES, num, type Currency, type Transaction, type TxType } from '@/domain/types';
import { useAccounts, useCategories } from './hooks';
import { AmountInput, amountValue } from './AmountInput';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Only the date is entered. Today keeps the current time (so it lists above
 * earlier entries of the day), an edit on the same date keeps its original
 * time, and any other date is stored at local midnight. A future date is
 * therefore pending and gets applied as soon as that day starts.
 */
function timestampFor(date: string, original?: string): Date {
  if (original && format(new Date(original), 'yyyy-MM-dd') === date) return new Date(original);
  if (date === format(new Date(), 'yyyy-MM-dd')) return new Date();
  return new Date(`${date}T00:00`);
}

interface Form {
  type: TxType;
  occurred_at: string;
  account_id: string;
  to_account_id: string;
  amount: string;
  to_amount: string;
  currency: Currency;
  rate: string;
  category_id: string;
  subcategory_id: string;
  note: string;
  description: string;
  paid_for_others: boolean;
}

export function TransactionSheet({ open, onClose, tx, accountId }: { open: boolean; onClose: () => void; tx?: Transaction | null; /** Preselects this account for a new entry (opened from an account's page). */ accountId?: string }) {
  const { t } = useTranslation();
  const { rates } = useProfile();
  const accounts = (useAccounts().data ?? []).filter((a) => !a.archived || a.id === tx?.account_id);
  const cats = useCategories();
  const invalidate = useInvalidate();
  const [pair, setPair] = useState<Transaction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [f, setF] = useState<Form>(blank());

  function blank(): Form {
    return {
      type: 'expense',
      occurred_at: format(new Date(), 'yyyy-MM-dd'),
      account_id: '',
      to_account_id: '',
      amount: '',
      to_amount: '',
      currency: 'MXN',
      rate: '1',
      category_id: '',
      subcategory_id: '',
      note: '',
      description: '',
      paid_for_others: false,
    };
  }

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPair(null);
    if (!tx) {
      // No account is preselected (so nothing lands in the wrong one by accident), except when opened from an account's page.
      const chosen = accountId ? accounts.find((a) => a.id === accountId) : undefined;
      setF({ ...blank(), account_id: chosen?.id ?? '', currency: chosen?.currency ?? 'MXN', rate: String(chosen ? rateFor(chosen.currency) : 1) });
      return;
    }
    const base: Form = {
      type: tx.type,
      occurred_at: format(new Date(tx.occurred_at), 'yyyy-MM-dd'),
      account_id: tx.account_id,
      to_account_id: '',
      amount: String(num(tx.original_amount)),
      to_amount: '',
      currency: tx.currency,
      rate: String(num(tx.exchange_rate)),
      category_id: tx.category_id ?? '',
      subcategory_id: tx.subcategory_id ?? '',
      note: tx.note ?? '',
      description: tx.description ?? '',
      paid_for_others: tx.paid_for_others ?? false,
    };
    setF(base);
    if (tx.type === 'transfer' && tx.transfer_pair_id) {
      supabase
        .from('transactions')
        .select('*')
        .eq('transfer_pair_id', tx.transfer_pair_id)
        .neq('id', tx.id)
        .maybeSingle()
        .then(({ data }) => {
          const other = data as Transaction | null;
          setPair(other);
          if (!other) return;
          const [out, inn] = tx.direction === 'out' ? [tx, other] : [other, tx];
          setF({ ...base, account_id: out.account_id, to_account_id: inn.account_id, amount: String(num(out.original_amount)), to_amount: String(num(inn.original_amount)), currency: out.currency });
        });
    }
  }, [open, tx?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const rateFor = (c: Currency) => (c === 'MXN' ? 1 : rates[c] ?? 0);
  const acc = (id: string) => accounts.find((a) => a.id === id);
  const fromAcc = acc(f.account_id);
  const toAcc = acc(f.to_account_id);
  const crossCurrency = f.type === 'transfer' && fromAcc && toAcc && fromAcc.currency !== toAcc.currency;

  const setAccount = (id: string) => {
    const a = acc(id);
    setF({ ...f, account_id: id, ...(a ? { currency: a.currency, rate: String(rateFor(a.currency)) } : {}) });
  };
  const setCurrency = (c: Currency) => setF({ ...f, currency: c, rate: String(rateFor(c)) });

  // Suggest the destination amount from settings rates when currencies differ.
  useEffect(() => {
    if (!crossCurrency || !fromAcc || !toAcc || !(amountValue(f.amount) > 0) || f.to_amount) return;
    const fromRate = rateFor(fromAcc.currency);
    const toRate = rateFor(toAcc.currency);
    if (fromRate && toRate) setF((x) => ({ ...x, to_amount: String(round2((amountValue(x.amount) * fromRate) / toRate)) }));
  }, [crossCurrency, f.amount]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const when = timestampFor(f.occurred_at, tx?.occurred_at);
      const status = when > new Date() ? 'pending' : 'applied';
      const amount = amountValue(f.amount);
      if (!(amount > 0)) throw new Error(t('finance.amountRequired'));

      if (f.type === 'transfer') {
        if (!fromAcc || !toAcc || fromAcc.id === toAcc.id) throw new Error(t('finance.transferAccounts'));
        const toAmount = crossCurrency ? amountValue(f.to_amount) : amount;
        if (!(toAmount > 0)) throw new Error(t('finance.amountRequired'));
        // MXN value of the transfer: taken from whichever side is MXN, else from settings rates.
        const mxn = fromAcc.currency === 'MXN' ? amount : toAcc.currency === 'MXN' ? toAmount : round2(amount * rateFor(fromAcc.currency));
        if (!(mxn > 0)) throw new Error(t('finance.rateMissing'));
        const pairId = tx?.transfer_pair_id ?? crypto.randomUUID();
        const common = { type: 'transfer', occurred_at: when.toISOString(), note: f.note || null, description: f.description || null, status, transfer_pair_id: pairId, base_amount_mxn: mxn };
        const outRow = { ...common, direction: 'out', account_id: fromAcc.id, original_amount: amount, currency: fromAcc.currency, exchange_rate: mxn / amount };
        const inRow = { ...common, direction: 'in', account_id: toAcc.id, original_amount: toAmount, currency: toAcc.currency, exchange_rate: mxn / toAmount };
        if (tx && pair) {
          const [outId, inId] = tx.direction === 'out' ? [tx.id, pair.id] : [pair.id, tx.id];
          unwrap(await supabase.from('transactions').update(outRow).eq('id', outId));
          unwrap(await supabase.from('transactions').update(inRow).eq('id', inId));
        } else {
          if (tx) unwrap(await supabase.from('transactions').delete().eq('id', tx.id));
          unwrap(await supabase.from('transactions').insert([outRow, inRow]));
        }
      } else {
        const rate = f.currency === 'MXN' ? 1 : Number(f.rate);
        if (!(rate > 0)) throw new Error(t('finance.rateMissing'));
        const row = {
          type: f.type,
          direction: null,
          transfer_pair_id: null,
          occurred_at: when.toISOString(),
          account_id: f.account_id,
          category_id: f.category_id || null,
          subcategory_id: f.subcategory_id || null,
          note: f.note || null,
          description: f.description || null,
          original_amount: amount,
          currency: f.currency,
          exchange_rate: rate,
          base_amount_mxn: round2(amount * rate),
          status,
          paid_for_others: f.type === 'expense' && f.paid_for_others,
        };
        if (tx?.type === 'transfer') {
          // Converting a transfer into income/expense: drop both sides first.
          unwrap(await supabase.from('transactions').delete().eq('id', tx.id));
          unwrap(await supabase.from('transactions').insert(row));
        } else if (tx) unwrap(await supabase.from('transactions').update(row).eq('id', tx.id));
        else unwrap(await supabase.from('transactions').insert(row));
      }
      invalidate('transactions');
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!tx) return;
    try {
      unwrap(await supabase.from('transactions').delete().eq('id', tx.id));
      invalidate('transactions');
      onClose();
    } catch (err) {
      setError(err);
    }
  };

  const catType = f.type === 'income' ? 'income' : 'expense';
  const quickDates = [
    { label: t('finance.today'), value: format(new Date(), 'yyyy-MM-dd') },
    { label: t('finance.yesterday'), value: format(addDays(new Date(), -1), 'yyyy-MM-dd') },
  ];
  const accent = f.type === 'expense' ? 'text-expense' : f.type === 'income' ? 'text-income' : 'text-transfer';

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={tx ? t('finance.editTransaction') : t('finance.newTransaction')}
      footer={<SaveBar onCancel={onClose} saving={busy} onDelete={tx ? remove : undefined} />}
    >
      <form id="sheet-form" onSubmit={submit}>
        <ErrorText error={error} />
        {tx?.series_id && <p className="mb-3 rounded-2xl bg-surface px-3 py-2 text-xs text-muted">{t('finance.partOfSeries')}</p>}
        <Segmented
          className="mb-4 w-full"
          value={f.type}
          onChange={(type) => setF({ ...f, type, category_id: '', subcategory_id: '' })}
          options={(['expense', 'income', 'transfer'] as TxType[]).map((v) => ({ value: v, label: t(`finance.types.${v}`) }))}
        />
        {accounts.length === 0 && <p className="mb-3 text-sm text-expense">{t('finance.needAccount')}</p>}

        <div className="mb-4">
          <AmountInput hero className={accent} required autoFocus={!tx} currency={f.type === 'transfer' ? fromAcc?.currency : f.currency} value={f.amount} onChange={(amount) => setF((x) => ({ ...x, amount }))} />
          <div className="mt-1 flex justify-center">
            {f.type === 'transfer' ? (
              fromAcc && <span className="text-sm text-muted">{fromAcc.currency}</span>
            ) : (
              <select className="pill py-1 text-sm" aria-label={t('finance.currency')} value={f.currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        <Group>
          <div>
            <Row icon="calendar" label={t('finance.date')}>
              <input type="date" className="pill" required aria-label={t('finance.date')} value={f.occurred_at} onChange={(e) => setF({ ...f, occurred_at: e.target.value })} />
            </Row>
            <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 pb-3">
              {quickDates.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => setF({ ...f, occurred_at: q.value })}
                  className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-[13px] transition ${f.occurred_at === q.value ? 'bg-fg text-bg' : 'bg-surface text-muted hover:text-fg'}`}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          {f.type === 'transfer' ? (
            <>
              <Row icon="arrowUp" label={t('finance.from')}>
                <select className="pill max-w-[11rem]" required aria-label={t('finance.from')} value={f.account_id} onChange={(e) => setF({ ...f, account_id: e.target.value, to_amount: '' })}>
                  <option value="">{t('finance.chooseAccount')}</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Row>
              <Row icon="arrowDown" label={t('finance.to')}>
                <select className="pill max-w-[11rem]" required aria-label={t('finance.to')} value={f.to_account_id} onChange={(e) => setF({ ...f, to_account_id: e.target.value, to_amount: '' })}>
                  <option value="">{t('finance.chooseAccount')}</option>
                  {accounts
                    .filter((a) => a.id !== f.account_id)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </Row>
              {crossCurrency && (
                <div className="px-4 py-3">
                  <span className="label">
                    {t('finance.amountReceived')} ({toAcc?.currency})
                  </span>
                  <AmountInput required currency={toAcc?.currency} value={f.to_amount} onChange={(to_amount) => setF((x) => ({ ...x, to_amount }))} />
                  {amountValue(f.amount) > 0 && amountValue(f.to_amount) > 0 && (
                    <span className="mt-1 block text-xs text-muted">
                      1 {fromAcc?.currency} = {(amountValue(f.to_amount) / amountValue(f.amount)).toFixed(4)} {toAcc?.currency}
                    </span>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <Row icon="wallet" label={t('finance.account')}>
                <select className="pill max-w-[11rem]" required aria-label={t('finance.account')} value={f.account_id} onChange={(e) => setAccount(e.target.value)}>
                  <option value="" disabled>
                    {t('finance.chooseAccount')}
                  </option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.currency})
                    </option>
                  ))}
                </select>
              </Row>
              <Row icon="tag" label={t('finance.category')}>
                <select className="pill max-w-[11rem]" aria-label={t('finance.category')} value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value, subcategory_id: '' })}>
                  <option value="">{t('finance.uncategorized')}</option>
                  {cats.parents(catType).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Row>
              {f.category_id && cats.children(f.category_id).length > 0 && (
                <Row label={<span className="pl-[1.875rem]">{t('finance.subcategory')}</span>}>
                  <select className="pill max-w-[11rem]" aria-label={t('finance.subcategory')} value={f.subcategory_id} onChange={(e) => setF({ ...f, subcategory_id: e.target.value })}>
                    <option value="">—</option>
                    {cats.children(f.category_id).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Row>
              )}
              {f.currency !== 'MXN' && (
                <Row icon="swap" label={t('finance.rateTo', { currency: f.currency })} hint={`= ${money(round2((amountValue(f.amount) || 0) * Number(f.rate || 0)))}`}>
                  <input className="pill w-24" inputMode="decimal" required aria-label={t('finance.rateTo', { currency: f.currency })} value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value.replace(',', '.') })} />
                </Row>
              )}
            </>
          )}
        </Group>

        {f.type === 'expense' && (
          <Group>
            <Row icon="users" label={t('finance.paidForOthers')} hint={t('finance.paidForOthersHelp')}>
              <Switch checked={f.paid_for_others} onChange={(paid_for_others) => setF({ ...f, paid_for_others })} label={t('finance.paidForOthers')} />
            </Row>
          </Group>
        )}

        <Group className="mb-1">
          <Row icon="edit">
            <input className="w-full bg-transparent py-1 text-[15px] outline-none placeholder:text-muted" aria-label={t('finance.note')} placeholder={t('finance.notePlaceholder')} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </Row>
          <textarea
            rows={2}
            className="block w-full resize-y bg-transparent px-4 py-3 text-[15px] outline-none placeholder:text-muted"
            aria-label={t('finance.description')}
            placeholder={t('finance.description')}
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
        </Group>
        {f.occurred_at > format(new Date(), 'yyyy-MM-dd') && <p className="mt-2 text-xs text-muted">{t('finance.willBePending')}</p>}
      </form>
    </Sheet>
  );
}
