import { addDays, endOfDay, startOfDay } from 'date-fns';
import { useRows } from '@/lib/data';
import { toDateKey } from '@/domain/dates';
import { expandEvents } from '@/domain/events';
import { DEFAULT_EVENT_COLOR, type CalendarEvent, type Task } from '@/domain/types';

export interface CalItem {
  kind: 'event' | 'task';
  id: string;
  title: string;
  allDay: boolean;
  start: Date;
  end: Date;
  done?: boolean;
  /** The category's color (tasks and events alike), or the default event color. */
  color: string;
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
  const lists = useRows('task_lists', { filter: (q) => q.order('position') });
  const listColor = new Map((lists.data ?? []).map((l) => [l.id, l.color]));
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
      // No category = silver, so it never looks like a category's color.
      color: (i.event.list_id && listColor.get(i.event.list_id)) || DEFAULT_EVENT_COLOR,
      event: i.event,
      occurrence: i.occurrence,
    })),
    ...(tasks.data ?? []).map((t) => {
      const start = new Date(`${t.due_date}T${t.due_time ?? '00:00'}`);
      return { kind: 'task' as const, id: t.id, title: t.title, allDay: !t.due_time, start, end: start, done: !!t.completed_at, color: listColor.get(t.list_id) ?? DEFAULT_EVENT_COLOR, task: t };
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

export interface DaySlot {
  item: CalItem;
  /** Minutes from midnight, clipped to the day. */
  top: number;
  bottom: number;
  col: number;
  cols: number;
}

/** Shortest block drawn, so tasks and quick events stay tappable. */
export const MIN_SLOT_MINUTES = 30;

/**
 * Places timed items on a day's time grid: each spans its start–end minutes,
 * and items that overlap share the width in side-by-side columns.
 */
export function layoutDay(items: CalItem[], day: Date): DaySlot[] {
  const dayStart = startOfDay(day).getTime();
  const minutes = (d: Date) => Math.min(1440, Math.max(0, (d.getTime() - dayStart) / 60000));
  const slots = items
    .map((item) => {
      const top = minutes(item.start);
      return { item, top, bottom: Math.min(1440, Math.max(minutes(item.end), top + MIN_SLOT_MINUTES)), col: 0, cols: 1 };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);

  // Walk clusters of transitively overlapping items; each takes the first free column.
  let cluster: DaySlot[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;
  const close = () => cluster.forEach((s) => (s.cols = colEnds.length));
  for (const s of slots) {
    if (s.top >= clusterEnd) {
      close();
      cluster = [];
      colEnds = [];
    }
    let col = colEnds.findIndex((end) => end <= s.top);
    if (col === -1) col = colEnds.push(s.bottom) - 1;
    else colEnds[col] = s.bottom;
    s.col = col;
    cluster.push(s);
    clusterEnd = Math.max(clusterEnd, s.bottom);
  }
  close();
  return slots;
}
