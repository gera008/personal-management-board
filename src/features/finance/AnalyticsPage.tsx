import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, addMonths, addYears, differenceInCalendarMonths, startOfDay, startOfMonth, startOfWeek, startOfYear, subMonths } from 'date-fns';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useProfile } from '@/lib/profile';
import { useThemeColors } from '@/lib/themeColors';
import { formatDate, money, pct } from '@/lib/format';
import { Empty, Segmented } from '@/components/ui';
import { toDateKey } from '@/domain/dates';
import { balanceEvolution, monthlyTrend, monthOverMonth, monthProjection, spendingByCategory, topNotes, weekdaySpending } from '@/domain/finance/totals';
import { categoryName, useAccounts, useCategories, useTransactions } from './hooks';
import { BudgetList } from './BudgetsPage';

type Range = 'week' | 'month' | 'year' | 'all' | 'custom';
const RANGES: Range[] = ['week', 'month', 'year', 'all', 'custom'];

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

  if (txs.isLoading || !txs.data) return <div className="h-64 animate-pulse rounded-xl bg-surface" />;
  const all = txs.data;
  if (!all.length) return <Empty>{t('analytics.noData')}</Empty>;

  // Monthly charts: the last 12 months for week/month, otherwise every month of the selected period.
  const lastDay = addDays(to < tomorrow ? to : tomorrow, -1);
  const monthsEnd = range === 'week' || range === 'month' ? now : lastDay;
  const months = range === 'week' || range === 'month' ? 12 : Math.max(1, differenceInCalendarMonths(lastDay, from) + 1);

  const byCat = spendingByCategory(all, cats.byId, from, to).map((c) => ({ name: categoryName(cats.byId, c.categoryId, t('finance.uncategorized')), amount: c.amount }));
  const trend = monthlyTrend(all, monthsEnd, months).map((p) => ({ ...p, label: formatDate(`${p.month}-01`, months > 12 ? 'MMM yy' : 'MMM') }));
  const mom = monthOverMonth(all, cats.byId, now);
  const proj = monthProjection(all, now);
  const notes = topNotes(all, from, to);
  const accs = accounts.data ?? [];
  const evolution = balanceEvolution(accs, all, rates, monthsEnd, months).map((p) => ({
    label: formatDate(`${p.month}-01`, 'MMM yy'),
    value: accountId === 'net' ? p.netWorth : p.byAccount[accountId] ?? 0,
  }));
  const selectedAcc = accs.find((a) => a.id === accountId);
  // Fixed window, independent of the filter: the 3 months up to the latest applied
  // transaction (today at most), so future pending rows never shift it.
  const lastApplied = all.find((x) => x.status === 'applied' && new Date(x.occurred_at) < tomorrow);
  const weekdayEnd = lastApplied ? addDays(startOfDay(new Date(lastApplied.occurred_at)), 1) : tomorrow;
  const weekday = weekdaySpending(all, subMonths(weekdayEnd, 3), weekdayEnd);
  const maxWeekday = Math.max(...weekday.map((w) => w.average), 1);
  const weekdayOrder = Array.from({ length: 7 }, (_, i) => (i + weekStartsOn) % 7);

  const axis = { stroke: colors.muted, fontSize: 11, tickLine: false, axisLine: false };
  const tooltipStyle = { background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 8, fontSize: 12, color: colors.fg };
  const compact = (v: number) => money(v, 'MXN', { compact: true });

  return (
    <div className="space-y-4">
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

      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard title={t('analytics.byCategory')}>
          {byCat.length === 0 ? (
            <p className="text-sm text-muted">{t('finance.noSpending')}</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(160, byCat.length * 30)}>
              <BarChart data={byCat} layout="vertical" margin={{ left: 0, right: 8 }}>
                <XAxis type="number" {...axis} tickFormatter={compact} />
                <YAxis type="category" dataKey="name" {...axis} width={96} />
                <Tooltip formatter={(v: number) => money(v)} contentStyle={tooltipStyle} cursor={{ fill: colors.surface }} />
                <Bar dataKey="amount" name={t('finance.types.expense')} fill={colors.expense} radius={[0, 4, 4, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title={t('analytics.projection')}>
          <div className="grid grid-cols-3 gap-2">
            <Tile label={t('analytics.spentSoFar')} value={money(proj.spent)} />
            <Tile label={t('analytics.dailyAverage')} value={money(proj.dailyAverage)} />
            <Tile label={t('analytics.projected')} value={money(proj.projected)} />
          </div>
        </ChartCard>

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

        <ChartCard title={t('analytics.mom')}>
          {mom.length === 0 ? (
            <p className="text-sm text-muted">{t('finance.noSpending')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-1 font-medium">{t('finance.category')}</th>
                  <th className="pb-1 text-right font-medium">{t('analytics.thisMonth')}</th>
                  <th className="pb-1 text-right font-medium">{t('finance.lastMonth')}</th>
                  <th className="pb-1 text-right font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {mom.map((m) => (
                  <tr key={m.categoryId ?? 'none'} className="border-t border-border">
                    <td className="max-w-[8rem] truncate py-1.5">{categoryName(cats.byId, m.categoryId, t('finance.uncategorized'))}</td>
                    <td className="py-1.5 text-right">{money(m.current, 'MXN', { compact: true })}</td>
                    <td className="py-1.5 text-right text-muted">{money(m.previous, 'MXN', { compact: true })}</td>
                    <td className={`py-1.5 text-right text-xs ${m.pct == null ? 'text-muted' : m.pct > 0 ? 'text-expense' : 'text-income'}`}>{pct(m.pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ChartCard>

        <ChartCard title={t('analytics.topNotes')}>
          {notes.length === 0 ? (
            <p className="text-sm text-muted">{t('analytics.noNotes')}</p>
          ) : (
            <ol className="space-y-1.5 text-sm">
              {notes.map((n, i) => (
                <li key={n.note} className="flex items-center gap-2">
                  <span className="w-5 text-xs text-muted">{i + 1}</span>
                  <span className="flex-1 truncate">{n.note}</span>
                  <span className="text-xs text-muted">×{n.count}</span>
                  <span className="w-24 text-right font-medium">{money(n.amount)}</span>
                </li>
              ))}
            </ol>
          )}
        </ChartCard>

        <ChartCard
          title={t('analytics.balance')}
          className="md:col-span-2"
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
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={evolution} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke={colors.border} />
              <XAxis dataKey="label" {...axis} />
              <YAxis {...axis} tickFormatter={(v: number) => money(v, selectedAcc?.currency ?? 'MXN', { compact: true })} width={56} />
              <Tooltip formatter={(v: number) => money(v, selectedAcc?.currency ?? 'MXN')} contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="value" name={selectedAcc?.name ?? t('analytics.netWorth')} stroke={colors.fg} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: colors.fg }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title={t('analytics.budgets')}>
          <BudgetList />
        </ChartCard>

        <ChartCard title={t('analytics.weekday')}>
          <p className="mb-2 text-xs text-muted">{t('analytics.weekdayHelp')}</p>
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
      </div>
    </div>
  );
}

function ChartCard({ title, children, className = '', right }: { title: string; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={`card min-w-0 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface p-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="truncate text-base font-semibold">{value}</div>
    </div>
  );
}
