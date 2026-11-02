import { addDays, endOfDay, startOfDay } from 'date-fns';
import { useRows } from '@/lib/data';
import { toDateKey } from '@/domain/dates';
import { expandEvents } from '@/domain/events';
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
  /** Date key of the occurrence when the event repeats. */
  occurrence?: string | null;
  task?: Task;
}

/** Events overlapping [from, to) and tasks due in that range, as calendar items. */
export function useCalendarItems(from: Date, to: Date) {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const oneOff = useRows('events', {
    key: [fromIso, toIso],
    filter: (q) => q.is('recurrence', null).lt('start_at', toIso).gte('end_at', fromIso).order('start_at'),
  });
  // Recurring series that started before the window ends; expanded below.
  const recurring = useRows('events', {
    key: ['recurring', toIso],
    filter: (q) => q.not('recurrence', 'is', null).lt('start_at', toIso),
  });
  const tasks = useRows('tasks', {
    key: ['due', toDateKey(from), toDateKey(to)],
    filter: (q) => q.gte('due_date', toDateKey(from)).lt('due_date', toDateKey(to)).order('due_date'),
  });

  const items: CalItem[] = [
    ...expandEvents([...(oneOff.data ?? []), ...(recurring.data ?? [])], from, to).map((i) => ({
      kind: 'event' as const,
      id: i.occurrence ? `${i.event.id}:${i.occurrence}` : i.event.id,
      title: i.event.title,
      allDay: i.event.all_day,
      start: i.start,
      end: i.end,
      event: i.event,
      occurrence: i.occurrence,
    })),
    ...(tasks.data ?? []).map((t) => {
      const start = new Date(`${t.due_date}T${t.due_time ?? '00:00'}`);
      return { kind: 'task' as const, id: t.id, title: t.title, allDay: !t.due_time, start, end: start, done: !!t.completed_at, task: t };
    }),
  ];
  return { items, isLoading: oneOff.isLoading || recurring.isLoading || tasks.isLoading };
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
