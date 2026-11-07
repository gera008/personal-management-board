import { addDaysKey, cleanRule, countBefore, type Recurrence } from '@shared/recurrence';
import { toDateKey } from './dates';
import type { CalendarEvent } from './types';

export type SeriesScope = 'this' | 'following' | 'all';

export interface EventFields {
  title: string;
  notes: string | null;
  location: string | null;
  all_day: boolean;
  reminder_minutes: number | null;
  color?: string | null;
}

/** Database writes needed to apply an edit or delete to a recurring series. */
export interface SeriesPlan {
  updateMaster?: Partial<CalendarEvent> & { reminder_sent_for?: null };
  insert?: Partial<CalendarEvent>;
  deleteMaster?: boolean;
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/** The series rule cut so it ends right before `occurrence` (count or until, matching the original). */
function truncatedRule(master: CalendarEvent, occurrence: string): Recurrence | null {
  const rule = master.recurrence!;
  const anchor = toDateKey(new Date(master.start_at));
  const before = countBefore(anchor, rule, occurrence);
  return cleanRule(rule.count != null ? { ...rule, count: before, until: null } : { ...rule, count: null, until: addDaysKey(occurrence, -1) });
}

/**
 * Editing one occurrence (`occurrence`, shown at `instanceStart`) of a series:
 *  - this:      the date is skipped in the series and a one-off copy is saved;
 *  - following: the series ends the day before and a new series starts here;
 *  - all:       the series moves by the same time shift and takes the new fields.
 */
export function planSeriesEdit(
  master: CalendarEvent,
  occurrence: string,
  instanceStart: Date,
  edit: { fields: EventFields; start: Date; end: Date; rule: Recurrence | null },
  scope: SeriesScope,
): SeriesPlan {
  const anchor = toDateKey(new Date(master.start_at));
  const times = { start_at: edit.start.toISOString(), end_at: edit.end.toISOString() };
  if (scope === 'following' && occurrence === anchor) scope = 'all';

  if (scope === 'this') {
    return {
      updateMaster: { exdates: [...new Set([...(master.exdates ?? []), occurrence])] },
      insert: { ...edit.fields, ...times, recurrence: null, exdates: [], recurrence_parent_id: master.id },
    };
  }

  if (scope === 'all') {
    const shift = edit.start.getTime() - instanceStart.getTime();
    const start = new Date(new Date(master.start_at).getTime() + shift);
    const end = new Date(start.getTime() + (edit.end.getTime() - edit.start.getTime()));
    const days = dayDiff(toDateKey(edit.start), occurrence);
    return {
      updateMaster: {
        ...edit.fields,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        recurrence: cleanRule(edit.rule),
        exdates: (master.exdates ?? []).map((d) => addDaysKey(d, days)),
        reminder_sent_for: null,
      },
    };
  }

  // following
  const rule = master.recurrence!;
  let newRule = cleanRule(edit.rule);
  // "After N times" keeps counting: the new series gets the occurrences that were left.
  if (newRule && rule.count != null && newRule.count === rule.count) newRule = { ...newRule, count: rule.count - countBefore(anchor, rule, occurrence) };
  return {
    updateMaster: { recurrence: truncatedRule(master, occurrence), exdates: (master.exdates ?? []).filter((d) => d < occurrence) },
    insert: { ...edit.fields, ...times, recurrence: newRule, exdates: (master.exdates ?? []).filter((d) => d > occurrence) },
  };
}

export function planSeriesDelete(master: CalendarEvent, occurrence: string, scope: SeriesScope): SeriesPlan {
  const anchor = toDateKey(new Date(master.start_at));
  if (scope === 'all' || (scope === 'following' && occurrence === anchor)) return { deleteMaster: true };
  if (scope === 'this') return { updateMaster: { exdates: [...new Set([...(master.exdates ?? []), occurrence])] } };
  return { updateMaster: { recurrence: truncatedRule(master, occurrence), exdates: (master.exdates ?? []).filter((d) => d < occurrence) } };
}
