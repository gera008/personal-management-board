import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase, unwrap } from '@/lib/supabase';
import { formatDate } from '@/lib/format';
import { useThemeColors } from '@/lib/themeColors';
import { ErrorText, Icon, Progress, Segmented } from '@/components/ui';
import { avg, localClock, parseGarminDays, type GarminRawRow } from '@/domain/garmin';

interface SyncStatus {
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  endpoints_ok: number;
  endpoints_failed: number;
}

const hours = (s: number | null) => (s == null ? null : Math.round((s / 3600) * 10) / 10);
const hm = (s: number) => `${Math.floor(s / 3600)}h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')}m`;
const fmtInt = (v: number | null) => (v == null ? '—' : Math.round(v).toLocaleString());

/** Health › Garmin: today's numbers, last night's sleep and 7/28-day trends. */
export function GarminPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const colors = useThemeColors();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [range, setRange] = useState<'7' | '28'>('7');

  const status = useQuery({
    queryKey: ['garmin', 'status'],
    queryFn: async () => unwrap(await supabase.from('garmin_sync_status').select('*').maybeSingle()) as SyncStatus | null,
  });
  const raw = useQuery({
    queryKey: ['garmin', 'raw'],
    queryFn: async () => unwrap(await supabase.from('garmin_raw').select('endpoint,window_key,status,fetched_at,data')) as GarminRawRow[],
  });
  const days = useMemo(() => parseGarminDays(raw.data ?? []), [raw.data]);

  const syncNow = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke('garmin', { body: { mode: 'sync', days: 7 } });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      qc.invalidateQueries({ queryKey: ['garmin'] });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const s = status.data;
  const today = days.at(-1);
  const lastSleep = [...days].reverse().find((d) => d.sleepSeconds != null);
  const shown = days.slice(-Number(range));
  const chartData = shown.map((d) => ({
    label: formatDate(d.date, 'd MMM'),
    steps: d.steps,
    goal: d.stepGoal,
    deep: hours(d.deepSeconds),
    light: hours(d.lightSeconds),
    rem: hours(d.remSeconds),
    awake: hours(d.awakeSeconds),
    stress: d.stressAvg,
    rhr: d.restingHr,
  }));
  // Garmin's intensity goal is weekly; count the last 7 days.
  const weekIntensity = days.slice(-7).reduce((a, d) => a + (d.intensityMinutes ?? 0), 0);
  const intensityGoal = today?.intensityGoal ?? 150;

  const axis = { stroke: colors.muted, fontSize: 11, tickLine: false, axisLine: false };
  const tooltipStyle = { background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 8, fontSize: 12, color: colors.fg };

  return (
    <div className="space-y-4">
      <section className="card flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Icon name="target" size={16} className="text-habit" />
            {s?.last_success_at ? t('garmin.connected') : t('garmin.notConnected')}
          </div>
          <div className="text-xs text-muted">
            {s?.last_success_at ? `${t('garmin.lastSync')}: ${formatDate(s.last_success_at, 'd MMM HH:mm')}` : t('garmin.comingSoon')}
            {s?.last_error && <span className="text-expense"> · {s.last_error}</span>}
          </div>
        </div>
        <button className="btn-ghost" onClick={syncNow} disabled={busy}>
          <Icon name="repeat" size={16} /> {busy ? t('garmin.syncing') : t('garmin.syncNow')}
        </button>
        <div className="w-full">
          <ErrorText error={error} />
        </div>
      </section>

      {today && (
        <>
          <section className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Metric label={t('garmin.metrics.steps')} value={fmtInt(today.steps)} sub={today.stepGoal ? `${t('garmin.goal')} ${fmtInt(today.stepGoal)}` : undefined}>
              {today.stepGoal && today.steps != null && <Progress ratio={today.steps / today.stepGoal} color="bg-habit" className="mt-2 h-1.5" />}
            </Metric>
            <Metric
              label={t('garmin.metrics.sleep')}
              value={lastSleep?.sleepSeconds != null ? hm(lastSleep.sleepSeconds) : '—'}
              sub={lastSleep?.sleepStart != null && lastSleep.sleepEnd != null ? `${localClock(lastSleep.sleepStart)} – ${localClock(lastSleep.sleepEnd)}` : undefined}
            />
            <Metric label={t('garmin.metrics.stress')} value={fmtInt(today.stressAvg)} sub={today.stressMax != null ? `${t('garmin.max')} ${today.stressMax}` : undefined} />
            <Metric
              label={t('garmin.metrics.bodyBattery')}
              value={fmtInt(today.bodyBatteryLatest)}
              sub={today.bodyBatteryMax != null ? `${t('garmin.range')} ${today.bodyBatteryMin}–${today.bodyBatteryMax}` : undefined}
            />
            <Metric label={t('garmin.metrics.heartRate')} value={today.restingHr != null ? `${today.restingHr} lpm` : '—'} sub={`${t('garmin.avg7')} ${fmtInt(avg(days.slice(-7).map((d) => d.restingHr)))}`} />
            <Metric label={t('garmin.metrics.intensity')} value={`${weekIntensity}`} sub={`${t('garmin.weekGoal')} ${intensityGoal}`}>
              <Progress ratio={weekIntensity / intensityGoal} color="bg-habit" className="mt-2 h-1.5" />
            </Metric>
          </section>
          <p className="text-xs text-muted">{t('garmin.todayNote', { date: formatDate(today.date, 'd MMM') })}</p>

          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t('garmin.trends')}</h2>
            <Segmented
              value={range}
              onChange={setRange}
              options={[
                { value: '7', label: t('garmin.days', { count: 7 }) },
                { value: '28', label: t('garmin.days', { count: 28 }) },
              ]}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Chart title={t('garmin.metrics.steps')}>
              <BarChart data={chartData} margin={{ left: 0, right: 8 }}>
                <CartesianGrid vertical={false} stroke={colors.border} />
                <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
                <YAxis {...axis} width={44} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: colors.surface }} formatter={(v: number) => Math.round(v).toLocaleString()} />
                <Bar dataKey="steps" name={t('garmin.metrics.steps')} fill={colors.habit} radius={[4, 4, 0, 0]} />
              </BarChart>
            </Chart>

            <Chart title={t('garmin.sleepStages')}>
              <BarChart data={chartData} margin={{ left: 0, right: 8 }}>
                <CartesianGrid vertical={false} stroke={colors.border} />
                <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
                <YAxis {...axis} width={32} unit="h" />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: colors.surface }} formatter={(v: number) => `${v} h`} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: colors.muted }} />
                <Bar dataKey="deep" stackId="s" name={t('garmin.stages.deep')} fill={colors.habit} />
                <Bar dataKey="light" stackId="s" name={t('garmin.stages.light')} fill={colors.calendar} />
                <Bar dataKey="rem" stackId="s" name={t('garmin.stages.rem')} fill={colors.tasks} />
                <Bar dataKey="awake" stackId="s" name={t('garmin.stages.awake')} fill={colors.muted} radius={[4, 4, 0, 0]} />
              </BarChart>
            </Chart>

            <Chart title={t('garmin.stressAvg')}>
              <LineChart data={chartData} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} stroke={colors.border} />
                <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
                <YAxis {...axis} width={32} domain={[0, 100]} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="stress" name={t('garmin.metrics.stress')} stroke={colors.slip} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: colors.slip }} connectNulls />
              </LineChart>
            </Chart>

            <Chart title={t('garmin.metrics.heartRate')}>
              <LineChart data={chartData} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} stroke={colors.border} />
                <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
                <YAxis {...axis} width={32} domain={['dataMin - 3', 'dataMax + 3']} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v} lpm`} />
                <Line type="monotone" dataKey="rhr" name={t('garmin.metrics.heartRate')} stroke={colors.expense} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: colors.expense }} connectNulls />
              </LineChart>
            </Chart>
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, sub, children }: { label: string; value: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-bg p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 truncate text-lg font-semibold">{value}</div>
      {sub && <div className="truncate text-[11px] text-muted">{sub}</div>}
      {children}
    </div>
  );
}

function Chart({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card min-w-0">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <ResponsiveContainer width="100%" height={200}>
        {children as React.ReactElement}
      </ResponsiveContainer>
    </section>
  );
}

