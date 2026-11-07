import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { addDays, startOfDay } from 'date-fns';
import { useProfile } from '@/lib/profile';
import { formatDate } from '@/lib/format';
import { Empty, Icon } from '@/components/ui';
import { toDateKey } from '@/domain/dates';
import type { WidgetId } from '@/domain/types';
import { useCalendarItems, type CalItem } from '../calendar/items';
import { MonthGrid, WeekList, monthRange, weekRange } from '../calendar/views';
import { TaskRow, isTodayTask, useLists, useTasks } from '../tasks/shared';
import { Indicators } from '../finance/Indicators';
import { LayoutEditor } from './LayoutEditor';
import { CombinedHeatmap, HabitTodayRow, todaysHabits, useHabitLogs, useHabits } from '../habits/shared';

export function DashboardPage() {
  const { t } = useTranslation();
  const { profile, update } = useProfile();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const widgets = profile.dashboard_layout.filter((w) => w.visible);
  const saveLayout = async (dashboard_layout: typeof profile.dashboard_layout) => {
    setSaving(true);
    try {
      await update({ dashboard_layout });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-2">
        <div>
          <p className="text-eyebrow capitalize">{formatDate(new Date(), 'EEEE d MMMM')}</p>
          <h1 className="text-title">{t('dashboard.title')}</h1>
        </div>
        {!editing && (
          <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setEditing(true)}>
            <Icon name="edit" size={14} /> {t('dashboard.customize')}
          </button>
        )}
      </div>
      {editing ? (
        <LayoutEditor layout={profile.dashboard_layout} onSave={saveLayout} onCancel={() => setEditing(false)} saving={saving} />
      ) : widgets.length === 0 ? (
        <Empty>{t('dashboard.allHidden')}</Empty>
      ) : (
        <Widgets ids={widgets.map((w) => w.id)} />
      )}
    </div>
  );
}

/**
 * Wide screens arrange the widgets in rows of equal-sized cards: the month
 * calendar on its own (large), This week beside Tasks, then finance, today's
 * habits and the heatmap side by side. Rows follow the order picked in
 * Customize. Phones and tablets keep one column in that order.
 */
const ROWS: WidgetId[][] = [['month_calendar'], ['week_detail', 'tasks'], ['finance_summary', 'habits_today', 'habit_heatmap']];
const COLS = ['', 'grid-cols-1', 'grid-cols-2', 'grid-cols-3'];

function Widgets({ ids }: { ids: WidgetId[] }) {
  const wide = useMediaQuery('(min-width: 1024px)');
  if (!wide) {
    return (
      <div className="space-y-4">
        {ids.map((id) => (
          <Widget key={id} id={id} />
        ))}
      </div>
    );
  }
  const rows = ROWS.map((row) => ids.filter((id) => row.includes(id)))
    .filter((row) => row.length)
    .sort((x, y) => ids.indexOf(x[0]) - ids.indexOf(y[0]));
  return (
    <div className="space-y-4">
      {rows.map((row) => (
        // Cards in a row stretch to the tallest one, so they read as one size.
        <div key={row.join()} className={`grid gap-4 ${COLS[row.length]}`}>
          {row.map((id) => (
            <div key={id} className="min-w-0 [&>*]:h-full">
              <Widget id={id} big={wide} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatches(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return matches;
}

function Widget({ id, big }: { id: WidgetId; big?: boolean }) {
  switch (id) {
    case 'month_calendar':
      return <MonthWidget big={big} />;
    case 'week_detail':
      return <WeekWidget />;
    case 'tasks':
      return <TasksWidget />;
    case 'finance_summary':
      return <FinanceWidget />;
    case 'habits_today':
      return <HabitsWidget />;
    case 'habit_heatmap':
      return <HeatmapWidget />;
  }
}

function Card({ title, to, children, className = '' }: { title: string; to: string; children: ReactNode; className?: string }) {
  return (
    <section className={`card min-w-0 ${className}`}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Link to={to} className="text-muted" aria-label={title}>
          <Icon name="chevronRight" size={18} />
        </Link>
      </div>
      {children}
    </section>
  );
}

function useOpenItem() {
  const navigate = useNavigate();
  return (i: CalItem) => navigate(i.kind === 'task' ? `/tasks?task=${i.id}` : '/calendar');
}

/** Large on wide screens: event titles inside the days instead of dots. */
function MonthWidget({ big }: { big?: boolean }) {
  const { t } = useTranslation();
  const { weekStartsOn } = useProfile();
  const today = startOfDay(new Date());
  const { from, to } = monthRange(today, weekStartsOn);
  const { items } = useCalendarItems(from, to);
  const navigate = useNavigate();
  const open = useOpenItem();
  return (
    <Card title={formatDate(today, 'MMMM yyyy')} to="/calendar">
      <MonthGrid month={today} items={items} weekStartsOn={weekStartsOn} compact={!big} onSelect={() => navigate('/calendar')} onItem={open} />
      <div className="mt-2 flex gap-3 text-[11px] text-muted">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-calendar" /> {t('dashboard.events')}
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-tasks" /> {t('dashboard.tasksDue')}
        </span>
      </div>
    </Card>
  );
}

function WeekWidget() {
  const { t } = useTranslation();
  const { weekStartsOn } = useProfile();
  const { from, to } = weekRange(new Date(), weekStartsOn);
  const { items } = useCalendarItems(from, to);
  const open = useOpenItem();
  return (
    <Card title={`${t('dashboard.thisWeek')} · ${formatDate(from, 'd MMM')} – ${formatDate(addDays(to, -1), 'd MMM')}`} to="/calendar">
      <WeekList start={from} items={items} onItem={open} />
    </Card>
  );
}

function TasksWidget() {
  const { t } = useTranslation();
  const lists = useLists();
  const tasks = useTasks();
  const [filter, setFilter] = useState<string>('today');
  const navigate = useNavigate();
  const listById = new Map((lists.data ?? []).map((l) => [l.id, l]));
  const today = toDateKey(new Date());
  const visible = (tasks.data ?? []).filter((x) => !x.completed_at && (filter === 'today' ? isTodayTask(x, today) : filter === 'all' || x.list_id === filter)).slice(0, 8);
  return (
    <Card title={t('nav.tasks')} to="/tasks">
      <div className="-mx-1 mb-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {[{ id: 'today', name: t('tasks.today') }, { id: 'all', name: t('tasks.all') }, ...(lists.data ?? [])].map((l) => (
          <button key={l.id} onClick={() => setFilter(l.id)} className={`chip shrink-0 ${filter === l.id ? 'border-tasks bg-tasks/10 text-tasks' : ''}`}>
            {l.name}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="py-3 text-sm text-muted">{filter === 'today' ? t('tasks.todayEmpty') : t('tasks.empty')}</p>
      ) : (
        <div className="divide-y divide-border">
          {visible.map((x) => (
            <TaskRow key={x.id} task={x} list={listById.get(x.list_id)} onOpen={() => navigate(`/tasks?task=${x.id}`)} />
          ))}
        </div>
      )}
    </Card>
  );
}

function FinanceWidget() {
  const { t } = useTranslation();
  return (
    <div className="relative [&>*]:h-full">
      <Indicators storageKey="dashboard-finance" title={t('dashboard.finance')} />
      <Link to="/finance" className="absolute right-4 top-4 text-muted" aria-label={t('nav.finance')}>
        <Icon name="chevronRight" size={18} />
      </Link>
    </div>
  );
}

function HabitsWidget() {
  const { t } = useTranslation();
  const habits = useHabits();
  const logs = useHabitLogs();
  const today = toDateKey(new Date());
  const due = todaysHabits(habits.data ?? [], today);
  return (
    <Card title={t('dashboard.habitsToday')} to="/health/habits">
      {due.length === 0 ? (
        <p className="py-3 text-sm text-muted">{t('habits.nothingToday')}</p>
      ) : (
        <div className="divide-y divide-border">
          {due.map((h) => (
            <HabitTodayRow key={h.id} habit={h} logs={logs.data ?? []} />
          ))}
        </div>
      )}
    </Card>
  );
}

function HeatmapWidget() {
  const { t } = useTranslation();
  const habits = useHabits();
  const logs = useHabitLogs();
  return (
    <Card title={t('dashboard.habitHeatmap')} to="/health/habits">
      {(habits.data ?? []).length === 0 ? <p className="text-sm text-muted">{t('habits.empty')}</p> : <CombinedHeatmap habits={habits.data ?? []} logs={logs.data ?? []} />}
    </Card>
  );
}
