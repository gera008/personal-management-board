import { useState, type ReactNode } from 'react';
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
import { CombinedHeatmap, HabitTodayRow, todaysHabits, useHabitLogs, useHabits } from '../habits/shared';

export function DashboardPage() {
  const { t } = useTranslation();
  const { profile } = useProfile();
  const widgets = profile.dashboard_layout.filter((w) => w.visible);
  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-2">
        <div>
          <p className="text-sm capitalize text-muted">{formatDate(new Date(), 'EEEE d MMMM')}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('dashboard.title')}</h1>
        </div>
        <Link to="/settings" className="text-xs text-muted underline-offset-2 hover:underline">
          {t('dashboard.customize')}
        </Link>
      </div>
      {widgets.length === 0 ? (
        <Empty>{t('dashboard.allHidden')}</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {widgets.map((w) => (
            <Widget key={w.id} id={w.id} />
          ))}
        </div>
      )}
    </div>
  );
}

function Widget({ id }: { id: WidgetId }) {
  switch (id) {
    case 'month_calendar':
      return <MonthWidget />;
    case 'week_detail':
      return <WeekWidget />;
    case 'tasks':
      return <TasksWidget />;
    case 'finance_summary':
      return (
        <div className="min-w-0 md:col-span-2">
          <FinanceWidget />
        </div>
      );
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

function MonthWidget() {
  const { t } = useTranslation();
  const { weekStartsOn } = useProfile();
  const today = startOfDay(new Date());
  const { from, to } = monthRange(today, weekStartsOn);
  const { items } = useCalendarItems(from, to);
  const navigate = useNavigate();
  return (
    <Card title={formatDate(today, 'MMMM yyyy')} to="/calendar">
      <MonthGrid month={today} items={items} weekStartsOn={weekStartsOn} compact onSelect={() => navigate('/calendar')} />
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
    <div className="relative">
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
    <Card title={t('dashboard.habitsToday')} to="/habits">
      {due.length === 0 ? (
        <p className="py-3 text-sm text-muted">{t('habits.nothingToday')}</p>
      ) : (
        <div className="divide-y divide-border">
          {due.map((h) => (
            <HabitTodayRow key={h.id} habit={h} logs={logs.data ?? []} today={today} />
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
    <Card title={t('dashboard.habitHeatmap')} to="/habits" className="md:col-span-2">
      {(habits.data ?? []).length === 0 ? <p className="text-sm text-muted">{t('habits.empty')}</p> : <CombinedHeatmap habits={habits.data ?? []} logs={logs.data ?? []} />}
    </Card>
  );
}
