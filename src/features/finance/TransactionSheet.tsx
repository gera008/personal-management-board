import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { supabase, unwrap } from '@/lib/supabase';
import { useInvalidate } from '@/lib/data';
import { useProfile } from '@/lib/profile';
import { money } from '@/lib/format';
import { ErrorText, Field, SaveBar, Segmented, Sheet } from '@/components/ui';
import { CURRENCIES, num, type Currency, type Transaction, type TxType } from '@/domain/types';
import { useAccounts, useCategories } from './hooks';

const round2 = (n: number) => Math.round(n * 100) / 100;

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

export function TransactionSheet({ open, onClose, tx }: { open: boolean; onClose: () => void; tx?: Transaction | null }) {
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
      occurred_at: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
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
      const first = accounts[0];
      setF({ ...blank(), account_id: first?.id ?? '', currency: first?.currency ?? 'MXN', rate: String(first ? rateFor(first.currency) : 1) });
      return;
    }
    const base: Form = {
      type: tx.type,
      occurred_at: format(new Date(tx.occurred_at), "yyyy-MM-dd'T'HH:mm"),
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
    if (!crossCurrency || !fromAcc || !toAcc || !f.amount || f.to_amount) return;
    const fromRate = rateFor(fromAcc.currency);
    const toRate = rateFor(toAcc.currency);
    if (fromRate && toRate) setF((x) => ({ ...x, to_amount: String(round2((Number(x.amount) * fromRate) / toRate)) }));
  }, [crossCurrency, f.amount]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const when = new Date(f.occurred_at);
      const status = when > new Date() ? 'pending' : 'applied';
      const amount = Number(f.amount);
      if (!(amount > 0)) throw new Error(t('finance.amountRequired'));

      if (f.type === 'transfer') {
        if (!fromAcc || !toAcc || fromAcc.id === toAcc.id) throw new Error(t('finance.transferAccounts'));
        const toAmount = crossCurrency ? Number(f.to_amount) : amount;
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
        {tx?.series_id && <p className="mb-3 rounded-lg bg-surface px-3 py-2 text-xs text-muted">{t('finance.partOfSeries')}</p>}
        <Segmented
          className="mb-4 w-full"
          value={f.type}
          onChange={(type) => setF({ ...f, type, category_id: '', subcategory_id: '' })}
          options={(['expense', 'income', 'transfer'] as TxType[]).map((v) => ({ value: v, label: t(`finance.types.${v}`) }))}
        />
        {accounts.length === 0 && <p className="mb-3 text-sm text-expense">{t('finance.needAccount')}</p>}

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field label={f.type === 'transfer' && crossCurrency ? `${t('finance.amount')} (${fromAcc?.currency})` : t('finance.amount')}>
            <input className={`input text-lg font-semibold ${accent}`} inputMode="decimal" required autoFocus={!tx} placeholder="0.00" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(',', '.') })} />
          </Field>
          {f.type !== 'transfer' && (
            <Field label={t('finance.currency')}>
              <select className="input" value={f.currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
          )}
        </div>
        {f.type !== 'transfer' && f.currency !== 'MXN' && (
          <Field label={t('finance.rateTo', { currency: f.currency })}>
            <div className="flex items-center gap-2">
              <input className="input" inputMode="decimal" required value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value.replace(',', '.') })} />
              <span className="shrink-0 text-sm text-muted">= {money(round2(Number(f.amount || 0) * Number(f.rate || 0)))}</span>
            </div>
          </Field>
        )}

        <Field label={t('finance.dateTime')}>
          <input type="datetime-local" className="input" required value={f.occurred_at} onChange={(e) => setF({ ...f, occurred_at: e.target.value })} />
        </Field>

        {f.type === 'transfer' ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('finance.from')}>
                <select className="input" required value={f.account_id} onChange={(e) => setF({ ...f, account_id: e.target.value, to_amount: '' })}>
                  <option value="" />
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('finance.to')}>
                <select className="input" required value={f.to_account_id} onChange={(e) => setF({ ...f, to_account_id: e.target.value, to_amount: '' })}>
                  <option value="" />
                  {accounts
                    .filter((a) => a.id !== f.account_id)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </Field>
            </div>
            {crossCurrency && (
              <Field label={`${t('finance.amountReceived')} (${toAcc?.currency})`}>
                <input className="input" inputMode="decimal" required value={f.to_amount} onChange={(e) => setF({ ...f, to_amount: e.target.value.replace(',', '.') })} />
                {Number(f.amount) > 0 && Number(f.to_amount) > 0 && (
                  <span className="mt-1 block text-xs text-muted">
                    1 {fromAcc?.currency} = {(Number(f.to_amount) / Number(f.amount)).toFixed(4)} {toAcc?.currency}
                  </span>
                )}
              </Field>
            )}
          </>
        ) : (
          <>
            <Field label={t('finance.account')}>
              <select className="input" required value={f.account_id} onChange={(e) => setAccount(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('finance.category')}>
                <select className="input" value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value, subcategory_id: '' })}>
                  <option value="">—</option>
                  {cats.parents(catType).map((c) => (
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
          </>
        )}

        {f.type === 'expense' && (
          <label className="mb-3 flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={f.paid_for_others} onChange={(e) => setF({ ...f, paid_for_others: e.target.checked })} />
            <span>
              <span className="font-medium">{t('finance.paidForOthers')}</span>
              <span className="block text-xs text-muted">{t('finance.paidForOthersHelp')}</span>
            </span>
          </label>
        )}
        <Field label={t('finance.note')}>
          <input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={t('finance.notePlaceholder')} />
        </Field>
        <Field label={t('finance.description')}>
          <textarea className="input min-h-[4rem]" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        {new Date(f.occurred_at) > new Date() && <p className="text-xs text-muted">{t('finance.willBePending')}</p>}
      </form>
    </Sheet>
  );
}
