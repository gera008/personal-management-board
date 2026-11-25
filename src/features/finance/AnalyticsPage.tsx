import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, addMonths, addWeeks, differenceInCalendarMonths, isSameDay, startOfDay, startOfMonth, startOfWeek, subMonths } from 'date-fns';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useProfile } from '@/lib/profile';
import { useThemeColors } from '@/lib/themeColors';
import { formatDate, money, pct } from '@/lib/format';
import { Empty, Icon, Segmented, Sheet } from '@/components/ui';
import { toDateKey } from '@/domain/dates';
import {
  balanceEvolution,
  categoryBreakdown,
  accountMovementsIn,
  dailySpending,
  expensesIn,
  monthlyTrend,
  movementsIn,
  monthProjection,
  periodRange,
  periodSummary,
  pctChange,
  previousPeriod,
  signedAmount,
  weekdaySpending,
  topCategoryId,
  weeklySpending,
  type CategoryBreakdown,
} from '@/domain/finance/totals';
import { num, type Account, type Category, type Transaction } from '@/domain/types';
import { categoryName, useAccounts, useCategories, useTransactions } from './hooks';
import { TxRow } from './FinanceHome';
import { TransactionSheet } from './TransactionSheet';

/**
 * What a tapped chart element stands for: a title and how to pick the
 * movements behind it. Picking from the live list keeps it current after an edit.
 * `total` says how they add up: spending, income, income minus spending, or an
 * account's own balance change.
 */
type Drill = {
  title: string;
  subtitle?: string;
  pick: (all: Transaction[]) => Transaction[];
  total: 'expense' | 'income' | 'net' | { account: Account };
};

type Range = 'week' | 'month' | 'year' | 'all' | 'custom';
const RANGES: Range[] = ['week', 'month', 'year', 'all', 'custom'];

/**
 * Everything follows the filter, ordered by three questions: how much, on what
 * and when. Year / All time / Custom share the same sections; This week and
 * This month swap the long-range charts for a day-by-day view.
 */
export function AnalyticsPage() {
  const { t } = useTranslation();
  const { rates, weekStartsOn } = useProfile();
  const colors = useThemeColors();
  const txs = useTransactions(); // all history: needed for balance evolution
  const accounts = useAccounts();
  const cats = useCategories();
  const [range, setRange] = useState<Range>('month');
  // Periods back from the current week, month or year (0 = current, -1 = the one before).
  const [offset, setOffset] = useState(0);
  const [custom, setCustom] = useState({ from: toDateKey(startOfMonth(subMonths(new Date(), 2))), to: toDateKey(new Date()) });
  const [accountId, setAccountId] = useState<string>('net');
  const [drill, setDrill] = useState<Drill | null>(null);

  const now = new Date();
  const tomorrow = addDays(startOfDay(now), 1);
  // Oldest transaction (the list is sorted newest first) anchors "All time".
  const firstDate = txs.data?.length ? startOfMonth(new Date(txs.data[txs.data.length - 1].occurred_at)) : startOfMonth(now);
  const [from, to] = useMemo(() => {
    switch (range) {
      case 'week':
      case 'month':
      case 'year':
        return periodRange(range, now, offset, weekStartsOn);
      case 'all':
        return [firstDate, tomorrow];
      case 'custom':
        return [new Date(`${custom.from}T00:00`), addDays(new Date(`${custom.to}T00:00`), 1)];
    }
  }, [range, offset, custom, weekStartsOn, firstDate.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  if (txs.isLoading || !txs.data) return <div className="h-64 animate-pulse rounded-3xl bg-surface" />;
  const all = txs.data;
  if (!all.length) return <Empty>{t('analytics.noData')}</Empty>;

  const short = range === 'week' || range === 'month';
  // Up to today: the rest of a running period has nothing applied yet.
  const end = to < tomorrow ? to : tomorrow;
  const prev = range === 'all' ? undefined : previousPeriod(range, from, to);

  // ¿Cuánto?
  const sum = periodSummary(all, from, to);
  const prevSum = prev ? periodSummary(all, prev.from, prev.to) : null;
  const monthsInPeriod = Math.max(1, differenceInCalendarMonths(addDays(end, -1), from) + 1);
  // A projection only makes sense for the month still running.
  const proj = range === 'month' && offset === 0 ? monthProjection(all, now) : null;

  // ¿En qué?
  const breakdown = categoryBreakdown(all, cats.byId, from, to, prev);

  // ¿Cuándo?
  const days = short ? dailySpending(all, from, to) : [];
  const elapsedDays = Math.max(1, days.filter((d) => d.day < tomorrow).length);
  const dayAvg = sum.expense / elapsedDays;
  const trend = monthlyTrend(all, addDays(end, -1), monthsInPeriod).map((p) => ({ ...p, label: formatDate(`${p.month}-01`, monthsInPeriod > 12 ? 'MMM yy' : 'MMM') }));
  const thisWeek = startOfWeek(now, { weekStartsOn });
  const weeks = short ? [] : weeklySpending(all, from > addWeeks(end, -104) ? from : addWeeks(end, -104), end, weekStartsOn).map((w) => ({ ...w, label: formatDate(w.start, 'd MMM') }));
  // The running week is still filling up, so it stays out of the average and the record.
  const fullWeeks = weeks.filter((w) => !isSameDay(w.start, thisWeek));
  const weekAvg = fullWeeks.length ? fullWeeks.reduce((s, w) => s + w.total, 0) / fullWeeks.length : 0;
  const topWeek = fullWeeks.reduce<(typeof weeks)[number] | null>((best, w) => (!best || w.total > best.total ? w : best), null);
  const weekday = range === 'week' ? [] : weekdaySpending(all, from, end);
  const maxWeekday = Math.max(...weekday.map((w) => w.average), 1);
  const weekdayOrder = Array.from({ length: 7 }, (_, i) => (i + weekStartsOn) % 7);
  const accs = accounts.data ?? [];
  const periodText = range === 'week' || range === 'month' || range === 'year' ? periodLabel(range, from, to) : `${formatDate(from, 'd MMM yyyy')} – ${formatDate(addDays(to, -1), 'd MMM yyyy')}`;
  const show = (title: string, pick: Drill['pick'], total: Drill['total'] = 'expense', subtitle?: string) =>
    setDrill({ title, pick, total, subtitle: subtitle ?? capitalize(periodText) });
  const expenses = (title: string, f: Date, tt: Date, match?: (x: Transaction) => boolean, subtitle?: string) => show(title, (a) => expensesIn(a, f, tt, match), 'expense', subtitle);
  const incomeAndExpenses = (f: Date, tt: Date) => (a: Transaction[]) =>
    [...movementsIn(a, 'income', f, tt), ...expensesIn(a, f, tt)].sort((x, y) => y.occurred_at.localeCompare(x.occurred_at));
  // A week as the chart counts it: clipped to the period.
  const weekDrill = (start: Date) => {
    const f = start < from ? from : start;
    const tt = addWeeks(start, 1) > end ? end : addWeeks(start, 1);
    expenses(t('analytics.weekOf', { date: formatDate(start, 'd MMM yyyy') }), f, tt, undefined, '');
  };
  const monthDrill = (month: string, kind: 'all' | 'net' | string) => {
    const f = new Date(`${month}-01T00:00`);
    const tt = addMonths(f, 1);
    const title = capitalize(formatDate(f, 'MMMM yyyy'));
    if (kind === 'all' || kind === 'net') return show(title, incomeAndExpenses(f, tt), 'net', t('analytics.incomeAndExpenses'));
    const acc = accs.find((x) => x.id === kind);
    if (acc) show(title, (a) => accountMovementsIn(a, acc.id, f, tt), { account: acc }, acc.name);
  };
  const evolution = short
    ? []
    : balanceEvolution(accs, all, rates, addDays(end, -1), monthsInPeriod).map((p) => ({
        label: formatDate(`${p.month}-01`, 'MMM yy'),
        month: p.month,
        value: accountId === 'net' ? p.netWorth : p.byAccount[accountId] ?? 0,
      }));
  const selectedAcc = accs.find((a) => a.id === accountId);

  const axis = { stroke: colors.muted, fontSize: 11, tickLine: false, axisLine: false };
  const tooltipStyle = { background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 8, fontSize: 12, color: colors.fg };
  const compact = (v: number) => money(v, 'MXN', { compact: true });
  const vsPrev = (cur: number, before: number | undefined, higherIsBad: boolean) => {
    if (before == null) return undefined;
    const p = pctChange(cur, before);
    if (p == null) return undefined;
    return { text: `${pct(p)} ${t(`analytics.vsPrevious.${range}`)}`, tone: p === 0 ? 'text-muted' : p > 0 === higherIsBad ? 'text-expense' : 'text-income' };
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="-mx-4 max-w-[100vw] overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <Segmented
            value={range}
            onChange={(r) => {
              setRange(r);
              setOffset(0);
            }}
            options={RANGES.map((v) => ({ value: v, label: t(`analytics.ranges.${v}`) }))}
          />
        </div>
        {range === 'custom' && (
          <div className="flex items-center gap-1">
            <input type="date" className="input py-1" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label={t('analytics.from')} />
            <span className="text-muted">–</span>
            <input type="date" className="input py-1" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label={t('analytics.to')} />
          </div>
        )}
        {range === 'week' || range === 'month' || range === 'year' ? (
          <PeriodNav label={periodLabel(range, from, to)} isCurrent={offset === 0} canGoBack={from > firstDate} onMove={(d) => setOffset(offset + d)} onReset={() => setOffset(0)} />
        ) : (
          <span className="ml-auto text-xs text-muted">
            {formatDate(from, 'd MMM yyyy')} – {formatDate(addDays(to, -1), 'd MMM yyyy')}
          </span>
        )}
      </div>

      {/* ¿Cuánto? */}
      <Question title={t('analytics.q.howMuch')}>
        <section className="card space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Tile label={t('analytics.expenses')} value={money(sum.expense)} delta={vsPrev(sum.expense, prevSum?.expense, true)} onClick={() => expenses(t('analytics.expenses'), from, to)} />
            <Tile label={t('analytics.income')} value={money(sum.income)} delta={vsPrev(sum.income, prevSum?.income, false)} onClick={() => show(t('analytics.income'), (a) => movementsIn(a, 'income', from, to), 'income')} />
            <div className="col-span-2 sm:col-span-1">
              <Tile label={t('analytics.net')} value={money(sum.net, 'MXN', { sign: true })} tone={sum.net < 0 ? 'text-expense' : 'text-income'} onClick={() => show(t('analytics.net'), incomeAndExpenses(from, to), 'net')} />
            </div>
          </div>
          <div className={`grid grid-cols-2 gap-2 ${proj ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
            {short ? (
              <Tile label={t('analytics.dailyAverage')} value={money(proj ? proj.dailyAverage : dayAvg)} />
            ) : (
              <Tile label={t('analytics.monthlyAverage')} value={money(sum.expense / monthsInPeriod)} />
            )}
            {proj && <Tile label={t('analytics.projected')} value={money(proj.projected)} />}
            <Tile label={t('analytics.savingsRate')} value={sum.savingsRate == null ? '—' : `${Math.round(sum.savingsRate)}%`} tone={sum.savingsRate != null && sum.savingsRate < 0 ? 'text-expense' : ''} />
            <Tile label={t('analytics.shared')} value={money(sum.paidForOthers)} onClick={() => expenses(t('analytics.shared'), from, to, (x) => x.paid_for_others)} />
          </div>
          <FixedVsVariable
            fixed={sum.fixed}
            variable={sum.variable}
            onFixed={() => expenses(t('analytics.fixed'), from, to, (x) => !!x.series_id)}
            onVariable={() => expenses(t('analytics.variable'), from, to, (x) => !x.series_id)}
          />
        </section>
      </Question>

      {/* ¿En qué? */}
      <Question title={t('analytics.q.onWhat')}>
        <section className="card">
          {breakdown.length === 0 ? (
            <p className="text-sm text-muted">{t('finance.noSpending')}</p>
          ) : (
            <CategoryList
              items={breakdown}
              name={(id) => categoryName(cats.byId, id, t('finance.uncategorized'))}
              subName={(id, parent) => (id === parent ? t('analytics.noSubcategory') : categoryName(cats.byId, id, t('finance.uncategorized')))}
              compareLabel={range === 'all' ? null : t(`analytics.vsPrevious.${range}`)}
              onSub={(parent, sub, title) =>
                // Same grouping as the breakdown: an expense without a subcategory sits under its category.
                expenses(title, from, to, (x) => topCategoryId(x, cats.byId) === parent && (x.subcategory_id ?? x.category_id) === sub, `${categoryName(cats.byId, parent, t('finance.uncategorized'))} · ${capitalize(periodText)}`)
              }
            />
          )}
        </section>
      </Question>

      {/* ¿Cuándo? */}
      <Question title={t('analytics.q.when')}>
        <div className="grid gap-4 md:grid-cols-2">
          {short ? (
            <ChartCard title={t('analytics.perDay')} className="md:col-span-2" help={`${t('analytics.perDayHelp')} ${t('analytics.tapToSee')}`}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={days.map((d) => ({ ...d, label: formatDate(d.day, range === 'week' ? 'EEE d' : 'd') }))}
                  margin={{ left: 0, right: 8 }}
                  // A tap anywhere in a day's column (even an empty one) lists that day's expenses.
                  onClick={(e) => {
                    const d = e?.activeTooltipIndex != null ? days[e.activeTooltipIndex] : undefined;
                    if (d) expenses(capitalize(formatDate(d.day, 'PPPP')), d.day, addDays(d.day, 1), undefined, '');
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <CartesianGrid vertical={false} stroke={colors.border} />
                  <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={8} />
                  <YAxis {...axis} tickFormatter={compact} width={52} />
                  <Tooltip formatter={(v: number) => money(v)} contentStyle={tooltipStyle} cursor={{ fill: colors.surface }} />
                  {dayAvg > 0 && <ReferenceLine y={dayAvg} stroke={colors.muted} strokeDasharray="4 4" />}
                  <Bar dataKey="total" name={t('finance.types.expense')} fill={colors.expense} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          ) : (
            <>
              <ChartCard title={t('analytics.trend')} className="md:col-span-2" help={t('analytics.tapMonth')}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={trend}
                    barGap={2}
                    margin={{ left: 0, right: 8 }}
                    onClick={(e) => {
                      const p = e?.activeTooltipIndex != null ? trend[e.activeTooltipIndex] : undefined;
                      if (p) monthDrill(p.month, 'all');
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <CartesianGrid vertical={false} stroke={colors.border} />
                    <XAxis dataKey="label" {...axis} />
                    <YAxis {...axis} tickFormatter={compact} width={52} />
                    <Tooltip formatter={(v: number) => money(v)} contentStyle={tooltipStyle} cursor={{ fill: colors.surface }} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: colors.muted }} />
                    <Bar dataKey="income" name={t('finance.types.income')} fill={colors.income} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expense" name={t('finance.types.expense')} fill={colors.expense} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title={t('analytics.weekly')} className="md:col-span-2" help={`${t('analytics.weeklyHelp')} ${t('analytics.tapWeek')}`}>
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <Tile label={t('analytics.weeklyAverage')} value={money(weekAvg)} />
                  <Tile
                    label={t('analytics.highestWeek')}
                    value={topWeek ? money(topWeek.total) : '—'}
                    sub={topWeek ? t('analytics.weekOf', { date: formatDate(topWeek.start, 'd MMM yy') }) : undefined}
                    onClick={topWeek ? () => weekDrill(topWeek.start) : undefined}
                  />
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart
                    data={weeks}
                    margin={{ left: 0, right: 8 }}
                    onClick={(e) => {
                      const w = e?.activeTooltipIndex != null ? weeks[e.activeTooltipIndex] : undefined;
                      if (w) weekDrill(w.start);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <CartesianGrid vertical={false} stroke={colors.border} />
                    <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={16} />
                    <YAxis {...axis} tickFormatter={compact} width={52} />
                    <Tooltip formatter={(v: number) => money(v)} labelFormatter={(l: string) => t('analytics.weekOf', { date: l })} contentStyle={tooltipStyle} cursor={{ fill: colors.surface }} />
                    {weekAvg > 0 && <ReferenceLine y={weekAvg} stroke={colors.muted} strokeDasharray="4 4" />}
                    <Bar dataKey="total" name={t('finance.types.expense')} fill={colors.expense} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </>
          )}

          {range !== 'week' && (
            <ChartCard title={t('analytics.weekday')} help={t('analytics.weekdayHelp')}>
              <div className="grid grid-cols-7 gap-1">
                {weekdayOrder.map((d) => {
                  const w = weekday[d];
                  const a = w.average / maxWeekday;
                  return (
                    <button
                      key={d}
                      className="rounded-md text-center hover:bg-surface"
                      title={`${money(w.average)} / ${t('analytics.day')}`}
                      // Every expense on that weekday in the period (the tile shows their daily average).
                      onClick={() => expenses(capitalize(formatDate(addDays(new Date(2026, 10, 1), d), 'EEEE')), from, end, (x) => new Date(x.occurred_at).getDay() === d)}
                    >
                      <div className="mb-1 aspect-square rounded-md" style={{ background: w.average ? `rgb(var(--expense) / ${0.15 + a * 0.85})` : 'rgb(var(--surface))' }} />
                      <div className="text-[11px] text-muted">{formatDate(addDays(new Date(2026, 10, 1), d), 'EEE')}</div>
                      <div className="text-[11px] font-medium">{money(w.average, 'MXN', { compact: true })}</div>
                    </button>
                  );
                })}
              </div>
            </ChartCard>
          )}

          {!short && (
            <ChartCard
              title={t('analytics.balance')}
              help={t('analytics.tapMonth')}
              right={
                <select className="input max-w-[11rem] py-1 text-sm" value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label={t('finance.account')}>
                  <option value="net">{t('analytics.netWorth')}</option>
                  {accs.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              }
            >
              <ResponsiveContainer width="100%" height={180}>
                <LineChart
                  data={evolution}
                  margin={{ left: 0, right: 8, top: 8 }}
                  onClick={(e) => {
                    const p = e?.activeTooltipIndex != null ? evolution[e.activeTooltipIndex] : undefined;
                    if (p) monthDrill(p.month, accountId);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <CartesianGrid vertical={false} stroke={colors.border} />
                  <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={16} />
                  <YAxis {...axis} tickFormatter={(v: number) => money(v, selectedAcc?.currency ?? 'MXN', { compact: true })} width={56} />
                  <Tooltip formatter={(v: number) => money(v, selectedAcc?.currency ?? 'MXN')} contentStyle={tooltipStyle} />
                  <Line type="monotone" dataKey="value" name={selectedAcc?.name ?? t('analytics.netWorth')} stroke={colors.fg} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: colors.fg }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
        </div>
      </Question>

      <DrillSheet drill={drill} onClose={() => setDrill(null)} all={all} accounts={accs} cats={cats.byId} />
    </div>
  );
}

/**
 * The movements behind a tapped tile, category or bar, with their total.
 * Tapping one opens it for editing; closing that returns here.
 */
function DrillSheet({ drill, onClose, all, accounts, cats }: { drill: Drill | null; onClose: () => void; all: Transaction[]; accounts: Account[]; cats: Map<string, Category> }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<Transaction | null>(null);
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const txs = drill ? drill.pick(all) : [];
  const kind = drill?.total;
  const mxn = (x: Transaction) => num(x.base_amount_mxn);
  const total =
    kind === 'expense'
      ? txs.reduce((s, x) => s + mxn(x), 0)
      : kind === 'income'
        ? txs.reduce((s, x) => s + mxn(x), 0)
        : kind === 'net'
          ? txs.reduce((s, x) => s + (x.type === 'income' ? mxn(x) : -mxn(x)), 0)
          : kind
            ? txs.reduce((s, x) => s + signedAmount(x, kind.account.currency), 0)
            : 0;
  const currency = kind && typeof kind === 'object' ? kind.account.currency : 'MXN';
  const signed = kind === 'net' || typeof kind === 'object';
  const tone = kind === 'expense' || (signed && total < 0) ? 'text-expense' : 'text-income';
  // Name of the other account of a transfer, for "From → To".
  const counterpart = (x: Transaction) => {
    const other = all.find((y) => y.transfer_pair_id === x.transfer_pair_id && y.id !== x.id);
    return other ? accById.get(other.account_id)?.name : undefined;
  };
  return (
    <>
      <Sheet open={!!drill && !editing} onClose={onClose} title={drill?.title ?? ''}>
        {drill && (
          <>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <span className="truncate text-xs text-muted">
                {drill.subtitle ? `${drill.subtitle} · ` : ''}
                {t('analytics.movements', { count: txs.length })}
              </span>
              <span className={`text-base font-semibold ${tone}`}>{money(total, currency, { sign: signed })}</span>
            </div>
            {txs.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">{t('analytics.noMovements')}</p>
            ) : (
              <div className="divide-y divide-border">
                {txs.map((x) => (
                  <TxRow key={x.id} tx={x} accById={accById} cats={cats} other={x.type === 'transfer' ? counterpart(x) : undefined} onOpen={() => setEditing(x)} showDate />
                ))}
              </div>
            )}
          </>
        )}
      </Sheet>
      <TransactionSheet open={!!editing} onClose={() => setEditing(null)} tx={editing} />
    </>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function periodLabel(range: 'week' | 'month' | 'year', from: Date, to: Date) {
  if (range === 'month') return formatDate(from, 'MMMM yyyy');
  if (range === 'year') return formatDate(from, 'yyyy');
  return `${formatDate(from, 'd MMM')} – ${formatDate(addDays(to, -1), 'd MMM yyyy')}`;
}

/** Arrows to the period before or after. Tapping the label returns to the current one. */
function PeriodNav({ label, isCurrent, canGoBack, onMove, onReset }: { label: string; isCurrent: boolean; canGoBack: boolean; onMove: (delta: number) => void; onReset: () => void }) {
  const { t } = useTranslation();
  const arrow = 'flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent';
  return (
    <div className="ml-auto inline-flex items-center gap-1 rounded-full border border-border p-0.5">
      <button className={arrow} disabled={!canGoBack} onClick={() => onMove(-1)} aria-label={t('common.previous')}>
        <Icon name="chevronLeft" size={16} />
      </button>
      <button className={`min-w-[7.5rem] px-1 text-center text-sm font-semibold capitalize ${isCurrent ? 'cursor-default' : 'hover:underline'}`} onClick={onReset}>
        {label}
      </button>
      <button className={arrow} disabled={isCurrent} onClick={() => onMove(1)} aria-label={t('common.next')}>
        <Icon name="chevronRight" size={16} />
      </button>
    </div>
  );
}

function Question({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="section-title">{title}</h2>
      {children}
    </div>
  );
}

/** Categories as a ranked list; tapping one shows its subcategories. */
function CategoryList({
  items,
  name,
  subName,
  compareLabel,
  onSub,
}: {
  items: CategoryBreakdown[];
  name: (id: string | null) => string;
  subName: (id: string | null, parent: string | null) => string;
  compareLabel: string | null;
  /** A subcategory was tapped: list the expenses behind it. */
  onSub: (parent: string | null, sub: string | null, title: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const max = Math.max(...items.map((c) => c.amount), 1);
  return (
    <ol className="divide-y divide-border">
      {compareLabel && <li className="pb-2 text-right text-[11px] text-muted">% {compareLabel}</li>}
      {items.map((c) => {
        const key = c.categoryId ?? 'none';
        const expanded = open === key;
        return (
          <li key={key} className="py-2">
            <button className="w-full text-left" onClick={() => setOpen(expanded ? null : key)} aria-expanded={expanded}>
              <div className="flex items-center gap-2 text-sm">
                <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={14} className="shrink-0 text-muted" />
                <span className="flex-1 truncate font-medium">{name(c.categoryId)}</span>
                <span className="font-semibold">{money(c.amount)}</span>
                {compareLabel && (
                  <span className={`w-14 text-right text-xs ${c.pct == null ? 'text-muted' : c.pct > 0 ? 'text-expense' : c.pct < 0 ? 'text-income' : 'text-muted'}`}>{c.pct == null ? '—' : pct(c.pct)}</span>
                )}
              </div>
              <div className="ml-5 mt-1 h-1 rounded-full bg-surface">
                <div className="h-full rounded-full bg-expense" style={{ width: `${(c.amount / max) * 100}%` }} />
              </div>
            </button>
            {expanded && (
              <ul className="ml-5 mt-2 space-y-1">
                {c.subs.map((s) => {
                  const label = subName(s.categoryId, c.categoryId);
                  return (
                    <li key={s.categoryId ?? 'none'}>
                      <button className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 py-1 text-left text-xs hover:bg-surface" onClick={() => onSub(c.categoryId, s.categoryId, s.categoryId === c.categoryId ? name(c.categoryId) : label)}>
                        <span className="flex-1 truncate">{label}</span>
                        <span className="text-muted">×{s.count}</span>
                        <span className="w-20 text-right font-medium">{money(s.amount)}</span>
                        <span className="w-10 text-right text-muted">{Math.round((s.amount / c.amount) * 100)}%</span>
                        <Icon name="chevronRight" size={12} className="shrink-0 text-muted" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Share of spending that is committed (recurring series) versus day-to-day. */
function FixedVsVariable({ fixed, variable, onFixed, onVariable }: { fixed: number; variable: number; onFixed: () => void; onVariable: () => void }) {
  const { t } = useTranslation();
  const total = fixed + variable;
  if (!total) return null;
  const share = (fixed / total) * 100;
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] text-muted">
        <button className="hover:text-fg" onClick={onFixed}>
          {t('analytics.fixed')} · {money(fixed)} ({Math.round(share)}%)
        </button>
        <button className="hover:text-fg" onClick={onVariable}>
          {t('analytics.variable')} · {money(variable)} ({Math.round(100 - share)}%)
        </button>
      </div>
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
        {fixed > 0 && <button className="h-full bg-muted/60" style={{ width: `${share}%` }} onClick={onFixed} aria-label={t('analytics.fixed')} />}
        {variable > 0 && <button className="h-full flex-1 bg-expense" onClick={onVariable} aria-label={t('analytics.variable')} />}
      </div>
    </div>
  );
}

function ChartCard({ title, children, className = '', right, help }: { title: string; children: ReactNode; className?: string; right?: ReactNode; help?: string }) {
  return (
    <section className={`card min-w-0 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {help && <p className="text-xs text-muted">{help}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function Tile({ label, value, sub, tone = '', delta, onClick }: { label: string; value: string; sub?: string; tone?: string; delta?: { text: string; tone: string }; onClick?: () => void }) {
  const Box = onClick ? 'button' : 'div';
  return (
    <Box className={`block w-full min-w-0 rounded-2xl bg-surface p-3 text-left ${onClick ? 'transition hover:bg-line' : ''}`} onClick={onClick}>
      <div className="truncate text-[11px] text-muted">{label}</div>
      <div className={`truncate text-base font-semibold ${tone}`}>{value}</div>
      {delta && <div className={`truncate text-[11px] ${delta.tone}`}>{delta.text}</div>}
      {sub && <div className="truncate text-[11px] text-muted">{sub}</div>}
    </Box>
  );
}
