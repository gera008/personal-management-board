import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { startOfMonth, subDays } from 'date-fns';
import { addDaysKey } from '@shared/recurrence';
import { formatDate } from '@/lib/format';
import { useRemove, useSave } from '@/lib/data';
import { useProfile } from '@/lib/profile';
import { Heatmap } from '@/components/Heatmap';
import { Empty, ErrorText, Fab, Field, Icon, MonthPicker, Progress, SaveBar, Segmented, Sheet, TagInput } from '@/components/ui';
import { toDateKey } from '@/domain/dates';
import { canLogOn, computeStreaks, habitHeatmap, isSuccess, logMap, monthlyCompletion, weeklyCompletion } from '@/domain/habits/streaks';
import { PALETTE, num, type Habit, type HabitFrequency } from '@/domain/types';
import { CombinedHeatmap, HabitTodayRow, todaysHabits, useHabitLogs, useHabits, useLogHabit } from './shared';
import { HabitMonth } from './HabitMonth';


export function HabitsPage() {
  const { t } = useTranslation();
  const habits = useHabits();
  const logs = useHabitLogs();
  const [tab, setTab] = useState<'today' | 'heatmap'>('today');
  // Heatmap tab: every habit's month (tappable calendar) or the year at a glance.
  const [span, setSpan] = useState<Span>('month');
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [tag, setTag] = useState<string | null>(null);
  const [detail, setDetail] = useState<Habit | null>(null);
  const [form, setForm] = useState<{ habit?: Habit | null } | null>(null);
  const today = toDateKey(new Date());
  // Day shown in the "Today" tab; arrows move it back to log a forgotten day.
  const [day, setDay] = useState(today);
  const viewDay = day > today ? today : day;

  const active = (habits.data ?? []).filter((h) => !h.archived && (!tag || h.tags.includes(tag)));
  const allLogs = logs.data ?? [];
  const due = todaysHabits(active, viewDay);
  const notDue = active.filter((h) => !due.includes(h));
  const tags = [...new Set((habits.data ?? []).flatMap((h) => h.tags))].sort();
  const archived = (habits.data ?? []).filter((h) => h.archived);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t('nav.habits')}</h2>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'today', label: t('habits.today') },
            { value: 'heatmap', label: t('habits.heatmap') },
          ]}
        />
      </div>
      {tags.length > 0 && (
        <div className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4">
          {tags.map((x) => (
            <button key={x} onClick={() => setTag(tag === x ? null : x)} className={`chip shrink-0 ${tag === x ? 'border-habit bg-habit/10 text-habit' : ''}`}>
              #{x}
            </button>
          ))}
        </div>
      )}

      {active.length === 0 ? (
        <Empty action={<button className="btn-primary" onClick={() => setForm({})}>{t('habits.newHabit')}</button>}>{t('habits.empty')}</Empty>
      ) : tab === 'today' ? (
        <div className="space-y-4">
          <DayNav day={viewDay} today={today} onChange={setDay} />
          <section className="card divide-y divide-border py-1">
            {due.map((h) => (
              <HabitTodayRow key={h.id} habit={h} logs={allLogs} date={viewDay} onOpen={() => setDetail(h)} />
            ))}
            {due.length === 0 && <p className="py-3 text-sm text-muted">{viewDay === today ? t('habits.nothingToday') : t('habits.nothingOnDay')}</p>}
          </section>
          {notDue.length > 0 && (
            <section>
              <h3 className="section-title">{viewDay === today ? t('habits.notToday') : t('habits.notOnDay')}</h3>
              <div className="card divide-y divide-border py-1">
                {notDue.map((h) => (
                  <button key={h.id} onClick={() => setDetail(h)} className="flex w-full items-center gap-3 py-2.5 text-left text-sm text-muted">
                    <span className="h-6 w-1 rounded-full" style={{ background: h.color }} />
                    {h.name}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SpanSwitch value={span} onChange={setSpan} />
            {span === 'month' && <MonthPicker month={month} onChange={setMonth} />}
          </div>
          {span === 'year' && (
            <section className="card">
              <h2 className="mb-2 text-sm font-semibold">{t('habits.combined')}</h2>
              <CombinedHeatmap habits={active} logs={allLogs} />
            </section>
          )}
          <div className={span === 'month' ? 'grid gap-4 md:grid-cols-2' : 'space-y-4'}>
            {active.map((h) => (
              <section key={h.id} className="card">
                <button className="mb-2 text-sm font-semibold" onClick={() => setDetail(h)}>
                  {h.name}
                </button>
                {span === 'month' ? <HabitMonth habit={h} month={month} /> : <HabitHeatmap habit={h} interactive />}
              </section>
            ))}
          </div>
          {span === 'year' && <p className="text-xs text-muted">{t('habits.tapDayHint')}</p>}
        </div>
      )}

      {archived.length > 0 && (
        <details className="mt-6 text-sm text-muted">
          <summary className="cursor-pointer">{t('habits.archivedCount', { count: archived.length })}</summary>
          <ul className="mt-2 space-y-1">
            {archived.map((h) => (
              <li key={h.id}>
                <button onClick={() => setForm({ habit: h })}>{h.name}</button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <Fab accent="ring-habit" label={t('habits.newHabit')} onClick={() => setForm({})} />
      <HabitDetail
        habit={detail}
        onClose={() => setDetail(null)}
        onEdit={(h) => {
          setDetail(null);
          setForm({ habit: h });
        }}
      />
      <HabitForm open={!!form} habit={form?.habit} onClose={() => setForm(null)} position={(habits.data ?? []).length} />
    </div>
  );
}

type Span = 'month' | 'year';

function SpanSwitch({ value, onChange }: { value: Span; onChange: (s: Span) => void }) {
  const { t } = useTranslation();
  return (
    <Segmented
      value={value}
      onChange={onChange}
      options={[
        { value: 'month', label: t('habits.monthView') },
        { value: 'year', label: t('habits.yearView') },
      ]}
    />
  );
}

function DayNav({ day, today, onChange }: { day: string; today: string; onChange: (d: string) => void }) {
  const { t } = useTranslation();
  const label = day === today ? t('habits.today') : day === addDaysKey(today, -1) ? t('habits.yesterday') : formatDate(day, 'EEEE');
  return (
    <div className="flex items-center gap-2">
      <button className="btn-ghost px-2" onClick={() => onChange(addDaysKey(day, -1))} aria-label={t('habits.prevDay')}>
        <Icon name="chevronLeft" size={18} />
      </button>
      <div className="flex-1 text-center">
        <div className={`text-sm font-semibold capitalize ${day === today ? '' : 'text-habit'}`}>{label}</div>
        <div className="text-xs capitalize text-muted">{formatDate(day, 'd MMMM yyyy')}</div>
      </div>
      <button className="btn-ghost px-2" disabled={day >= today} onClick={() => onChange(addDaysKey(day, 1))} aria-label={t('habits.nextDay')}>
        <Icon name="chevronRight" size={18} />
      </button>
      {day !== today && (
        <button className="btn-ghost px-3 text-xs" onClick={() => onChange(today)}>
          {t('habits.backToToday')}
        </button>
      )}
    </div>
  );
}

/**
 * Year heatmap of one habit. When interactive, tapping a day logs or undoes it:
 * done/undone for yes-no, asks the amount for numeric, slip/clean for bad habits.
 */
function HabitHeatmap({ habit, interactive }: { habit: Habit; interactive?: boolean }) {
  const { t } = useTranslation();
  const logs = useHabitLogs();
  const log = useLogHabit();
  const { weekStartsOn } = useProfile();
  const now = new Date();
  const today = toDateKey(now);
  const map = logMap(logs.data ?? [], habit.id);
  const values = habitHeatmap(habit, map, toDateKey(subDays(now, 371)), today);

  const toggle = (date: string) => {
    if (!canLogOn(habit, date, today)) return;
    const entry = map.get(date);
    if (habit.kind === 'bad') return log.mutate(entry?.is_slip ? { habit, date, remove: true } : { habit, date, isSlip: true });
    if (habit.type === 'numeric') {
      const answer = prompt(t('habits.valuePrompt', { unit: habit.unit ?? '', date: formatDate(date, 'd MMM') }), entry ? String(num(entry.value)) : '');
      if (answer === null) return;
      const value = Number(answer.replace(',', '.'));
      return log.mutate(answer.trim() === '' || !(value > 0) ? { habit, date, remove: true } : { habit, date, value });
    }
    log.mutate(isSuccess(habit, map, date) ? { habit, date, remove: true } : { habit, date, value: 1 });
  };

  return <Heatmap values={values} weekStartsOn={weekStartsOn} color={habit.kind === 'bad' ? 'var(--slip)' : 'var(--habit)'} onSelect={interactive ? toggle : undefined} />;
}

function HabitDetail({ habit, onClose, onEdit }: { habit: Habit | null; onClose: () => void; onEdit: (h: Habit) => void }) {
  const { t } = useTranslation();
  const logs = useHabitLogs();
  const { weekStartsOn } = useProfile();
  const [span, setSpan] = useState<Span>('month');
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  if (!habit) return null;
  const today = toDateKey(new Date());
  const map = logMap(logs.data ?? [], habit.id);
  const s = computeStreaks(habit, map, today, weekStartsOn);
  const week = weeklyCompletion(habit, map, today, weekStartsOn);
  const monthRate = monthlyCompletion(habit, map, today);
  const recentNotes = [...map.values()].filter((l) => l.note).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const unit = s.unit === 'weeks' ? t('habits.weeks') : t('habits.days');

  return (
    <Sheet
      open
      onClose={onClose}
      title={habit.name}
      footer={
        <button className="btn-ghost ml-auto" onClick={() => onEdit(habit)}>
          {t('common.edit')}
        </button>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={habit.kind === 'bad' ? t('habits.currentDaysWithout') : t('habits.current')} value={`${s.current} ${unit}`} />
        <Stat label={t('habits.best')} value={`${s.best} ${unit}`} />
        <Stat label={t('habits.thisWeek')} value={`${Math.round(week * 100)}%`} />
        <Stat label={t('habits.thisMonth')} value={`${Math.round(monthRate * 100)}%`} />
      </div>
      {habit.goal_days && (
        <div className="mb-4">
          <div className="mb-1 flex justify-between text-xs text-muted">
            <span>{t('habits.goal')}</span>
            <span>
              {Math.min(s.current, habit.goal_days)}/{habit.goal_days} {unit}
            </span>
          </div>
          <Progress ratio={s.current / habit.goal_days} color={habit.kind === 'bad' ? 'bg-slip' : 'bg-habit'} />
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SpanSwitch value={span} onChange={setSpan} />
        {span === 'month' && <MonthPicker month={month} onChange={setMonth} />}
      </div>
      {span === 'month' ? (
        <HabitMonth habit={habit} month={month} />
      ) : (
        <>
          <HabitHeatmap habit={habit} interactive />
          <p className="mt-1 text-xs text-muted">{t('habits.tapDayHint')}</p>
        </>
      )}
      {recentNotes.length > 0 && (
        <div className="mt-4">
          <h3 className="section-title">{t('habits.notes')}</h3>
          <ul className="space-y-1 text-sm">
            {recentNotes.map((l) => (
              <li key={l.id}>
                <span className="text-muted">{l.date}</span> {l.is_slip && <span className="text-slip">✕</span>} {l.note}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface p-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

type FreqType = HabitFrequency['type'];

function HabitForm({ open, habit, onClose, position }: { open: boolean; habit?: Habit | null; onClose: () => void; position: number }) {
  const { t } = useTranslation();
  const save = useSave('habits');
  const remove = useRemove('habits');
  const [f, setF] = useState({
    name: '',
    kind: 'good' as Habit['kind'],
    type: 'boolean' as Habit['type'],
    unit: '',
    target_value: '',
    freq: 'daily' as FreqType,
    days: [1, 2, 3, 4, 5] as number[],
    n: '3',
    goal_days: '',
    color: PALETTE[0],
    tags: [] as string[],
    reminder_time: '',
    start_date: toDateKey(new Date()),
    archived: false,
  });

  useEffect(() => {
    if (!open) return;
    save.reset();
    const fr = habit?.frequency ?? { type: 'daily' };
    setF({
      name: habit?.name ?? '',
      kind: habit?.kind ?? 'good',
      type: habit?.type ?? 'boolean',
      unit: habit?.unit ?? '',
      target_value: habit?.target_value != null ? String(num(habit.target_value)) : '',
      freq: fr.type,
      days: fr.type === 'weekdays' ? fr.days : [1, 2, 3, 4, 5],
      n: fr.type === 'times_per_week' || fr.type === 'every_n_days' ? String(fr.n) : '3',
      goal_days: habit?.goal_days ? String(habit.goal_days) : '',
      color: habit?.color ?? PALETTE[0],
      tags: habit?.tags ?? [],
      reminder_time: habit?.reminder_time?.slice(0, 5) ?? '',
      start_date: habit?.start_date ?? toDateKey(new Date()),
      archived: habit?.archived ?? false,
    });
  }, [open, habit?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const isBad = f.kind === 'bad';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = Math.max(1, Number(f.n) || 1);
    const frequency: HabitFrequency = isBad
      ? { type: 'daily' }
      : f.freq === 'weekdays'
        ? { type: 'weekdays', days: [...f.days].sort() }
        : f.freq === 'times_per_week'
          ? { type: 'times_per_week', n: Math.min(7, n) }
          : f.freq === 'every_n_days'
            ? { type: 'every_n_days', n }
            : { type: 'daily' };
    const numeric = !isBad && f.type === 'numeric';
    await save.mutateAsync({
      id: habit?.id,
      name: f.name.trim(),
      kind: f.kind,
      type: numeric ? 'numeric' : 'boolean',
      unit: numeric ? f.unit || null : null,
      target_value: numeric ? Number(f.target_value) : null,
      frequency,
      goal_days: f.goal_days ? Number(f.goal_days) : null,
      color: f.color,
      tags: f.tags,
      reminder_time: f.reminder_time || null,
      start_date: f.start_date,
      archived: f.archived,
      ...(habit ? {} : { position }),
    } as Partial<Habit>);
    onClose();
  };

  const weekdayLabels = Array.from({ length: 7 }, (_, i) => new Date(2026, 10, 1 + i).toLocaleDateString(undefined, { weekday: 'narrow' }));

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={habit ? t('habits.editHabit') : t('habits.newHabit')}
      footer={<SaveBar onCancel={onClose} saving={save.isPending} onDelete={habit ? () => remove.mutateAsync(habit.id).then(onClose) : undefined} />}
    >
      <form id="sheet-form" onSubmit={submit}>
        <ErrorText error={save.error} />
        <Field label={t('common.name')}>
          <input className="input" required autoFocus={!habit} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Segmented
          className="mb-1 w-full"
          value={f.kind}
          onChange={(kind) => setF({ ...f, kind })}
          options={[
            { value: 'good', label: t('habits.good') },
            { value: 'bad', label: t('habits.bad') },
          ]}
        />
        <p className="mb-3 text-xs text-muted">{isBad ? t('habits.badHelp') : t('habits.goodHelp')}</p>

        {!isBad && (
          <>
            <Segmented
              className="mb-3 w-full"
              value={f.type}
              onChange={(type) => setF({ ...f, type })}
              options={[
                { value: 'boolean', label: t('habits.yesNo') },
                { value: 'numeric', label: t('habits.numeric') },
              ]}
            />
            {f.type === 'numeric' && (
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('habits.target')}>
                  <input className="input" inputMode="decimal" required value={f.target_value} onChange={(e) => setF({ ...f, target_value: e.target.value })} />
                </Field>
                <Field label={t('habits.unit')}>
                  <input className="input" placeholder={t('habits.unitPlaceholder')} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} />
                </Field>
              </div>
            )}
            <Field label={t('habits.frequency')}>
              <select className="input" value={f.freq} onChange={(e) => setF({ ...f, freq: e.target.value as FreqType })}>
                {(['daily', 'weekdays', 'times_per_week', 'every_n_days'] as FreqType[]).map((x) => (
                  <option key={x} value={x}>
                    {t(`habits.freq.${x}`)}
                  </option>
                ))}
              </select>
            </Field>
            {f.freq === 'weekdays' && (
              <div className="mb-3 grid grid-cols-7 gap-1">
                {weekdayLabels.map((label, d) => (
                  <button
                    type="button"
                    key={d}
                    onClick={() => setF({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d] })}
                    className={`rounded-lg border py-1.5 text-sm ${f.days.includes(d) ? 'border-habit bg-habit/10 text-habit' : 'border-border'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {(f.freq === 'times_per_week' || f.freq === 'every_n_days') && (
              <Field label={f.freq === 'times_per_week' ? t('habits.timesPerWeek') : t('habits.everyNDays')}>
                <input type="number" min={1} max={f.freq === 'times_per_week' ? 7 : 365} className="input" value={f.n} onChange={(e) => setF({ ...f, n: e.target.value })} />
              </Field>
            )}
            <Field label={t('common.color')}>
              <div className="flex gap-2">
                {PALETTE.map((c) => (
                  <button type="button" key={c} onClick={() => setF({ ...f, color: c })} className={`h-8 w-8 rounded-full ${f.color === c ? 'ring-2 ring-fg ring-offset-2 ring-offset-bg' : ''}`} style={{ background: c }} aria-label={c} />
                ))}
              </div>
            </Field>
          </>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Field label={t('habits.goalDays')}>
            <input type="number" min={1} className="input" placeholder="66" value={f.goal_days} onChange={(e) => setF({ ...f, goal_days: e.target.value })} />
          </Field>
          <Field label={t('habits.startDate')}>
            <input type="date" className="input" required value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} />
          </Field>
        </div>
        <Field label={t('habits.reminder')}>
          <input type="time" className="input" value={f.reminder_time} onChange={(e) => setF({ ...f, reminder_time: e.target.value })} />
        </Field>
        <Field label={t('common.tags')}>
          <TagInput value={f.tags} onChange={(tags) => setF({ ...f, tags })} placeholder={t('common.addTag')} />
        </Field>
        {habit && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.archived} onChange={(e) => setF({ ...f, archived: e.target.checked })} />
            {t('common.archived')}
          </label>
        )}
      </form>
    </Sheet>
  );
}
