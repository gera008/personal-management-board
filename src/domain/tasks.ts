import { countBefore, nextOccurrence } from '@shared/recurrence';
import type { Task } from './types';

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/**
 * The next instance of a repeating task, created when the current one is
 * completed (Apple Reminders style). Dates follow the rule's first due date
 * (`anchor`) so a monthly task on the 31st stays on month ends. Returns null
 * when the task doesn't repeat or its rule has ended.
 */
export function nextTaskInstance(task: Task): Pick<Task, 'due_date' | 'recurrence_index' | 'reminder_at'> | null {
  if (!task.recurrence || !task.due_date) return null;
  const anchor = task.recurrence.anchor ?? task.due_date;
  const due = nextOccurrence(anchor, task.recurrence, task.due_date);
  if (!due) return null;
  // The reminder keeps its time and offset from the due date.
  const reminder_at = task.reminder_at ? new Date(new Date(task.reminder_at).getTime() + dayDiff(due, task.due_date) * 86_400_000).toISOString() : null;
  return { due_date: due, recurrence_index: countBefore(anchor, task.recurrence, due) + 1, reminder_at };
}

/** Open and without a due date: never shown in Today or the calendar on their own. */
export const isUndatedTask = (t: Task) => !t.completed_at && !t.due_date;

/** Undated tasks untouched for this many days get a "stale" marker. */
export const STALE_DAYS = 14;

/** Whole days since an undated task was last edited, or null when it isn't stale. */
export function staleDays(t: Task, now = Date.now()): number | null {
  if (!isUndatedTask(t) || !t.updated_at) return null;
  const days = Math.floor((now - Date.parse(t.updated_at)) / 86_400_000);
  return days >= STALE_DAYS ? days : null;
}
