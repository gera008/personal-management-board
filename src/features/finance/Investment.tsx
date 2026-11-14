import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { endOfDay, formatDistanceToNowStrict, isToday, subYears } from 'date-fns';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useRemove, useSave } from '@/lib/data';
import { useThemeColors } from '@/lib/themeColors';
import { dateLocale, formatDate, money } from '@/lib/format';
import { Empty, ErrorText, Group, Icon, Row, SaveBar, Segmented, Sheet } from '@/components/ui';
import { toDateKey } from '@/domain/dates';
import { currentValue, investmentHistory, isStale, periodGain, valuationChanges } from '@/domain/finance/investments';
import { num, type Account, type AccountValuation } from '@/domain/types';
import { useAccountFlows, useValuations } from './hooks';
import { AmountInput, amountValue } from './AmountInput';

const signed = (v: number, currency: Account['currency']) => money(v, currency, { sign: true });
const pctText = (p: number | null) => (p == null ? '' : `${p > 0 ? '+' : ''}${p.toFixed(1)}%`);
const tone = (v: number) => (v > 0.004 ? 'text-income' : v < -0.004 ? 'text-expense' : 'text-muted');

/**
 * Top of an investment account: value, contributed and gain, the "Update value"
 * button, a contributed-vs-value chart and the history of captured values.
 */
export function InvestmentOverview({ account }: { account: Account }) {
  const { t } = useTranslation();
  const flows = useAccountFlows(account.id);
  const valuations = useValuations(account.id);
  const [sheet, setSheet] = useState<{ valuation?: AccountValuation } | null>(null);
  const [range, setRange] = useState<'1y' | 'all'>('1y');

  const txs = flows.data ?? [];
  const vals = valuations.data ?? [];
  const now = new Date();
  const value = currentValue(account, txs, vals, now);
  const history = useMemo(() => investmentHistory(account, txs, vals, now), [account, txs, vals]); // eslint-disable-line react-hooks/exhaustive-deps
  const contributed = history.at(-1)?.contributed ?? value;
  const total = periodGain(history, null);
  const last = vals[0];
  const stale = isStale(last?.valued_at, now);

  if (flows.isLoading || valuations.isLoading) return <div className="h-56 animate-pulse rounded-3xl bg-surface" />;

  return (
    <>
      <div className="card">
        <div className="text-center">
          <div className="label">{t('invest.currentValue')}</div>
          <div className="text-display mt-1">
            {money(value, account.currency)}
            <span className="text-unit ml-1.5">{account.currency}</span>
          </div>
          <div className={`mt-1.5 text-xs ${stale ? 'text-tasks' : 'text-muted'}`}>
            {!last
              ? t('invest.neverUpdated')
              : isToday(new Date(last.valued_at))
                ? t('invest.updatedToday')
                : t('invest.updatedAgo', { when: formatDistanceToNowStrict(new Date(last.valued_at), { addSuffix: true, locale: dateLocale() }) })}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-4 text-center">
          <div className="min-w-0">
            <div className="label">{t('invest.contributed')}</div>
            <div className="truncate text-base font-semibold">{money(contributed, account.currency)}</div>
          </div>
          <div className="min-w-0">
            <div className="label">{t('invest.gain')}</div>
            {total ? (
              <div className={`truncate text-base font-semibold ${tone(total.gain)}`}>
                {signed(total.gain, account.currency)} <span className="text-sm font-medium">{pctText(total.pct)}</span>
              </div>
            ) : (
              <div className="text-base font-semibold text-muted">—</div>
            )}
          </div>
        </div>

        <button className="btn-primary mt-4 w-full" onClick={() => setSheet({})}>
          <Icon name="chart" size={18} /> {t('invest.updateValue')}
        </button>
      </div>

      <InvestmentChart account={account} history={history} range={range} onRange={setRange} />

      <section>
        <h3 className="section-title">{t('invest.history')}</h3>
        {vals.length === 0 ? (
          <Empty>{t('invest.noHistory')}</Empty>
        ) : (
          <div className="card divide-y divide-border px-3 py-0">
            {valuationChanges(account, txs, vals).map(({ valuation, change, pct }, i) => (
              <button key={valuation.id} onClick={() => setSheet({ valuation })} className="flex w-full items-center gap-3 py-3 text-left">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{formatDate(valuation.valued_at, 'd MMM yyyy')}</div>
                  <div className="truncate text-xs text-muted">{valuation.note || (i === vals.length - 1 ? t('invest.firstValue') : t('invest.sincePrevious'))}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold">{money(num(valuation.value), account.currency)}</div>
                  <div className={`text-[12px] ${tone(change)}`}>
                    {signed(change, account.currency)} {pctText(pct)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <ValuationSheet open={!!sheet} onClose={() => setSheet(null)} account={account} valuation={sheet?.valuation} currentValue={value} />
    </>
  );
}

function InvestmentChart({
  account,
  history,
  range,
  onRange,
}: {
  account: Account;
  history: ReturnType<typeof investmentHistory>;
  range: '1y' | 'all';
  onRange: (r: '1y' | 'all') => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const from = range === '1y' ? subYears(new Date(), 1) : null;
  // Keep the last point before the range so the lines start at its edge.
  const firstIn = from ? history.findIndex((p) => p.at >= from) : 0;
  const shown = firstIn === -1 ? history.slice(-1) : history.slice(Math.max(0, firstIn - (from ? 1 : 0)));
  const gain = periodGain(history, from);
  const spansYears = shown.length > 1 && shown[0].at.getFullYear() !== shown.at(-1)!.at.getFullYear();
  const data = shown.map((p) => ({ label: formatDate(p.at, spansYears ? 'MMM yy' : 'd MMM'), value: p.value, contributed: p.contributed }));
  const axis = { stroke: colors.muted, fontSize: 11, tickLine: false, axisLine: false };

  return (
    <section className="card">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t('invest.chartTitle')}</h3>
        <Segmented
          value={range}
          onChange={onRange}
          options={[
            { value: '1y', label: t('invest.range1y') },
            { value: 'all', label: t('invest.rangeAll') },
          ]}
        />
      </div>
      {history.length < 2 ? (
        <p className="py-8 text-center text-sm text-muted">{t('invest.chartEmpty')}</p>
      ) : (
        <>
          {gain && (
            <p className="mb-3 text-xs text-muted">
              {t(range === '1y' ? 'invest.gainLastYear' : 'invest.gainAllTime')}:{' '}
              <span className={`font-semibold ${tone(gain.gain)}`}>
                {signed(gain.gain, account.currency)} {pctText(gain.pct)}
              </span>
            </p>
          )}
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke={colors.border} />
              <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={16} />
              <YAxis {...axis} tickFormatter={(v: number) => money(v, account.currency, { compact: true })} width={56} domain={['auto', 'auto']} />
              <Tooltip
                formatter={(v: number) => money(v, account.currency)}
                contentStyle={{ background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 8, fontSize: 12, color: colors.fg }}
              />
              <Line type="monotone" dataKey="value" name={t('invest.value')} stroke={colors.accent} strokeWidth={2.5} dot={{ r: 3, strokeWidth: 0, fill: colors.accent }} activeDot={{ r: 5 }} />
              <Line type="stepAfter" dataKey="contributed" name={t('invest.contributed')} stroke={colors.muted} strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
            </LineChart>
          </ResponsiveContainer>
          <div className="mt-2 flex justify-center gap-4 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded bg-accent" /> {t('invest.value')}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 border-t border-dashed border-muted" /> {t('invest.contributed')}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

/** Capture what the account is worth on a date (today by default), or edit/delete a captured value. */
export function ValuationSheet({
  open,
  onClose,
  account,
  valuation,
  currentValue: before,
}: {
  open: boolean;
  onClose: () => void;
  account: Account;
  valuation?: AccountValuation;
  currentValue: number;
}) {
  const { t } = useTranslation();
  const save = useSave('account_valuations');
  const remove = useRemove('account_valuations');
  const [f, setF] = useState({ value: '', date: '', note: '' });
  const [error, setError] = useState<unknown>(null);
  const today = toDateKey(new Date());

  useEffect(() => {
    if (!open) return;
    setError(null);
    setF({
      value: valuation ? String(num(valuation.value)) : '',
      date: valuation ? toDateKey(new Date(valuation.valued_at)) : today,
      note: valuation?.note ?? '',
    });
  }, [open, valuation?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const after = amountValue(f.value);
  const reference = valuation ? num(valuation.value) : before;
  const diff = Number.isFinite(after) ? after - reference : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!Number.isFinite(after)) return;
    // Today means "now"; a past date counts at the end of that day. An edit keeps its moment unless the date changes.
    const sameDay = valuation && toDateKey(new Date(valuation.valued_at)) === f.date;
    const valued_at = sameDay ? valuation!.valued_at : f.date === today ? new Date().toISOString() : endOfDay(new Date(`${f.date}T00:00`)).toISOString();
    try {
      await save.mutateAsync({ id: valuation?.id, account_id: account.id, valued_at, value: Math.round(after * 100) / 100, note: f.note.trim() || null });
      onClose();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={valuation ? t('invest.editValue') : t('invest.updateValue')}
      footer={<SaveBar onCancel={onClose} saving={save.isPending} disabled={!Number.isFinite(after)} onDelete={valuation ? () => remove.mutateAsync(valuation.id).then(onClose) : undefined} />}
    >
      <form id="sheet-form" onSubmit={submit}>
        <ErrorText error={error ?? remove.error} />
        <p className="text-center text-[13px] text-muted">{t('invest.valueOn')}</p>
        <div className="mb-4">
          <AmountInput hero value={f.value} onChange={(value) => setF({ ...f, value })} currency={account.currency} autoFocus={!valuation} required />
        </div>
        <Group>
          <Row icon="calendar" label={t('finance.date')}>
            <input type="date" className="pill" required max={today} aria-label={t('finance.date')} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </Row>
          <Row icon="edit">
            <input className="w-full bg-transparent py-1 text-[15px] outline-none placeholder:text-muted" aria-label={t('common.notes')} placeholder={t('invest.notePlaceholder')} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </Row>
        </Group>
        {diff != null && (
          <div className="mb-3 flex items-center justify-between rounded-2xl bg-surface px-4 py-3 text-sm">
            <span className="text-muted">
              {money(reference, account.currency)} → <span className="font-semibold text-fg">{money(after, account.currency)}</span>
            </span>
            <span className={`font-semibold ${tone(diff)}`}>
              {signed(diff, account.currency)} {reference > 0 ? pctText((diff / reference) * 100) : ''}
            </span>
          </div>
        )}
        <p className="px-1 text-xs text-muted">{t('invest.updateHelp', { name: account.name })}</p>
      </form>
    </Sheet>
  );
}
