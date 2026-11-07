import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, addMonths, addWeeks, addYears, differenceInCalendarMonths, isSameDay, startOfDay, startOfMonth, startOfWeek, startOfYear, subMonths } from 'date-fns';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useProfile } from '@/lib/profile';
import { useThemeColors } from '@/lib/themeColors';
import { formatDate, money, pct } from '@/lib/format';
import { Empty, Icon, Segmented } from '@/components/ui';
import { toDateKey } from '@/domain/dates';
import {
  balanceEvolution,
  categoryBreakdown,
  dailySpending,
  monthlyTrend,
  monthProjection,
  periodSummary,
  pctChange,
  previousPeriod,
  weekdaySpending,
  weeklySpending,
  type CategoryBreakdown,
} from '@/domain/finance/totals';
import { categoryName, useAccounts, useCategories, useTransactions } from './hooks';

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
  const [custom, setCustom] = useState({ from: toDateKey(startOfMonth(subMonths(new Date(), 2))), to: toDateKey(new Date()) });
  const [accountId, setAccountId] = useState<string>('net');

  const now = new Date();
  const tomorrow = addDays(startOfDay(now), 1);
  // Oldest transaction (the list is sorted newest first) anchors "All time".
  const firstDate = txs.data?.length ? startOfMonth(new Date(txs.data[txs.data.length - 1].occurred_at)) : startOfMonth(now);
  const [from, to] = useMemo(() => {
    switch (range) {
      case 'week': {
        const s = startOfWeek(now, { weekStartsOn });
        return [s, addDays(s, 7)];
      }
      case 'month':
        return [startOfMonth(now), addMonths(startOfMonth(now), 1)];
      case 'year':
        return [startOfYear(now), addYears(startOfYear(now), 1)];
      case 'all':
        return [firstDate, tomorrow];
      case 'custom':
        return [new Date(`${custom.from}T00:00`), addDays(new Date(`${custom.to}T00:00`), 1)];
    }
  }, [range, custom, weekStartsOn, firstDate.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const proj = range === 'month' ? monthProjection(all, now) : null;

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
  const evolution = short
    ? []
    : balanceEvolution(accs, all, rates, addDays(end, -1), monthsInPeriod).map((p) => ({
        label: formatDate(`${p.month}-01`, 'MMM yy'),
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
          <Segmented value={range} onChange={setRange} options={RANGES.map((v) => ({ value: v, label: t(`analytics.ranges.${v}`) }))} />
        </div>
        {range === 'custom' && (
          <div className="flex items-center gap-1">
            <input type="date" className="input py-1" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label={t('analytics.from')} />
            <span className="text-muted">–</span>
            <input type="date" className="input py-1" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label={t('analytics.to')} />
          </div>
        )}
        <span className="text-xs text-muted">
          {formatDate(from, 'd MMM yyyy')} – {formatDate(addDays(to, -1), 'd MMM yyyy')}
        </span>
      </div>

      {/* ¿Cuánto? */}
      <Question title={t('analytics.q.howMuch')}>
        <section className="card space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Tile label={t('analytics.expenses')} value={money(sum.expense)} delta={vsPrev(sum.expense, prevSum?.expense, true)} />
            <Tile label={t('analytics.income')} value={money(sum.income)} delta={vsPrev(sum.income, prevSum?.income, false)} />
            <div className="col-span-2 sm:col-span-1">
              <Tile label={t('analytics.net')} value={money(sum.net, 'MXN', { sign: true })} tone={sum.net < 0 ? 'text-expense' : 'text-income'} />
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
            <Tile label={t('analytics.shared')} value={money(sum.paidForOthers)} />
          </div>
          <FixedVsVariable fixed={sum.fixed} variable={sum.variable} />
        </section>
      </Question>

      {/* ¿En qué? */}
      <Question title={t('analytics.q.onWhat')}>
        <section className="card">
          {breakdown.length === 0 ? (
            <p className="text-sm text-muted">{t('finance.noSpending')}</p>
          ) : (
            <CategoryList items={breakdown} name={(id) => categoryName(cats.byId, id, t('finance.uncategorized'))} subName={(id, parent) => (id === parent ? t('analytics.noSubcategory') : categoryName(cats.byId, id, t('finance.uncategorized')))} compareLabel={range === 'all' ? null : t(`analytics.vsPrevious.${range}`)} />
          )}
        </section>
      </Question>

      {/* ¿Cuándo? */}
      <Question title={t('analytics.q.when')}>
        <div className="grid gap-4 md:grid-cols-2">
          {short ? (
            <ChartCard title={t('analytics.perDay')} className="md:col-span-2" help={t('analytics.perDayHelp')}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={days.map((d) => ({ ...d, label: formatDate(d.day, range === 'week' ? 'EEE d' : 'd') }))} margin={{ left: 0, right: 8 }}>
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
              <ChartCard title={t('analytics.trend')} className="md:col-span-2">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={trend} barGap={2} margin={{ left: 0, right: 8 }}>
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

              <ChartCard title={t('analytics.weekly')} className="md:col-span-2" help={t('analytics.weeklyHelp')}>
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <Tile label={t('analytics.weeklyAverage')} value={money(weekAvg)} />
                  <Tile label={t('analytics.highestWeek')} value={topWeek ? money(topWeek.total) : '—'} sub={topWeek ? t('analytics.weekOf', { date: formatDate(topWeek.start, 'd MMM yy') }) : undefined} />
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={weeks} margin={{ left: 0, right: 8 }}>
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
                    <div key={d} className="text-center" title={`${money(w.average)} / ${t('analytics.day')}`}>
                      <div className="mb-1 aspect-square rounded-md" style={{ background: w.average ? `rgb(var(--expense) / ${0.15 + a * 0.85})` : 'rgb(var(--surface))' }} />
                      <div className="text-[11px] text-muted">{formatDate(addDays(new Date(2026, 10, 1), d), 'EEE')}</div>
                      <div className="text-[11px] font-medium">{money(w.average, 'MXN', { compact: true })}</div>
                    </div>
                  );
                })}
              </div>
            </ChartCard>
          )}

          {!short && (
            <ChartCard
              title={t('analytics.balance')}
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
                <LineChart data={evolution} margin={{ left: 0, right: 8, top: 8 }}>
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
}: {
  items: CategoryBreakdown[];
  name: (id: string | null) => string;
  subName: (id: string | null, parent: string | null) => string;
  compareLabel: string | null;
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
                {c.subs.map((s) => (
                  <li key={s.categoryId ?? 'none'} className="flex items-center gap-2 text-xs">
                    <span className="flex-1 truncate">{subName(s.categoryId, c.categoryId)}</span>
                    <span className="text-muted">×{s.count}</span>
                    <span className="w-20 text-right font-medium">{money(s.amount)}</span>
                    <span className="w-10 text-right text-muted">{Math.round((s.amount / c.amount) * 100)}%</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Share of spending that is committed (recurring series) versus day-to-day. */
function FixedVsVariable({ fixed, variable }: { fixed: number; variable: number }) {
  const { t } = useTranslation();
  const total = fixed + variable;
  if (!total) return null;
  const share = (fixed / total) * 100;
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] text-muted">
        <span>
          {t('analytics.fixed')} · {money(fixed)} ({Math.round(share)}%)
        </span>
        <span>
          {t('analytics.variable')} · {money(variable)} ({Math.round(100 - share)}%)
        </span>
      </div>
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
        {fixed > 0 && <div className="h-full bg-muted/60" style={{ width: `${share}%` }} />}
        {variable > 0 && <div className="h-full flex-1 bg-expense" />}
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

function Tile({ label, value, sub, tone = '', delta }: { label: string; value: string; sub?: string; tone?: string; delta?: { text: string; tone: string } }) {
  return (
    <div className="min-w-0 rounded-2xl bg-surface p-3">
      <div className="truncate text-[11px] text-muted">{label}</div>
      <div className={`truncate text-base font-semibold ${tone}`}>{value}</div>
      {delta && <div className={`truncate text-[11px] ${delta.tone}`}>{delta.text}</div>}
      {sub && <div className="truncate text-[11px] text-muted">{sub}</div>}
    </div>
  );
}
