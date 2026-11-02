import { addDaysKey, occurrencesBetween } from '@shared/recurrence';
import { toDateKey } from './dates';
import type { CalendarEvent } from './types';

export interface EventInstance {
  event: CalendarEvent;
  start: Date;
  end: Date;
  /** Date key of this occurrence for recurring events, null for one-off events. */
  occurrence: string | null;
}

/**
 * One-off events plus every occurrence of recurring ones that overlaps
 * [from, to). Occurrences keep the series' local start time and duration.
 */
export function expandEvents(events: CalendarEvent[], from: Date, to: Date): EventInstance[] {
  const out: EventInstance[] = [];
  for (const e of events) {
    const start = new Date(e.start_at);
    const end = new Date(e.end_at);
    if (!e.recurrence) {
      if (start < to && end >= from) out.push({ event: e, start, end, occurrence: null });
      continue;
    }
    const duration = end.getTime() - start.getTime();
    const spanDays = Math.ceil(duration / 86_400_000);
    // Look back far enough to catch multi-day occurrences that started before `from`.
    const keys = occurrencesBetween(toDateKey(start), e.recurrence, addDaysKey(toDateKey(from), -spanDays), toDateKey(to), e.exdates ?? []);
    for (const key of keys) {
      const [y, m, d] = key.split('-').map(Number);
      const s = new Date(y, m - 1, d, start.getHours(), start.getMinutes(), start.getSeconds());
      const en = new Date(s.getTime() + duration);
      if (s < to && en >= from) out.push({ event: e, start: s, end: en, occurrence: key });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}
