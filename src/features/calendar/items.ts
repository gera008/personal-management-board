import { addDays, endOfDay, startOfDay } from 'date-fns';
import { useRows } from '@/lib/data';
import { toDateKey } from '@/domain/dates';
import type { CalendarEvent, Task } from '@/domain/types';

export interface CalItem {
  kind: 'event' | 'task';
  id: string;
  title: string;
  allDay: boolean;
  start: Date;
  end: Date;
  done?: boolean;
  event?: CalendarEvent;
  task?: Task;
}

/** Events overlapping [from, to) and tasks due in that range, as calendar items. */
export function useCalendarItems(from: Date, to: Date) {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const events = useRows('events', {
    key: [fromIso, toIso],
    filter: (q) => q.lt('start_at', toIso).gte('end_at', fromIso).order('start_at'),
  });
  const tasks = useRows('tasks', {
    key: ['due', toDateKey(from), toDateKey(to)],
    filter: (q) => q.gte('due_date', toDateKey(from)).lt('due_date', toDateKey(to)).order('due_date'),
  });

  const items: CalItem[] = [
    ...(events.data ?? []).map((e) => ({
      kind: 'event' as const,
      id: e.id,
      title: e.title,
      allDay: e.all_day,
      start: new Date(e.start_at),
      end: new Date(e.end_at),
      event: e,
    })),
    ...(tasks.data ?? []).map((t) => {
      const start = new Date(`${t.due_date}T${t.due_time ?? '00:00'}`);
      return { kind: 'task' as const, id: t.id, title: t.title, allDay: !t.due_time, start, end: start, done: !!t.completed_at, task: t };
    }),
  ];
  return { items, isLoading: events.isLoading || tasks.isLoading };
}

/** Items touching a given day, all-day first then by start time. */
export function itemsForDay(items: CalItem[], day: Date): CalItem[] {
  const s = startOfDay(day).getTime();
  const e = endOfDay(day).getTime();
  return items
    .filter((i) => i.start.getTime() <= e && Math.max(i.end.getTime(), i.start.getTime()) >= s)
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime());
}

export function daysBetween(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  for (let d = startOfDay(from); d < to; d = addDays(d, 1)) out.push(d);
  return out;
}
