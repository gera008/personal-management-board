import { describe, expect, it } from 'vitest';
import { planSeriesDelete, planSeriesEdit, type EventFields } from '../src/domain/eventSeries';
import { expandEvents } from '../src/domain/events';
import type { CalendarEvent } from '../src/domain/types';

// Weekly class, Mondays 9:00–10:00 from Mon 2 Nov 2026.
const master: CalendarEvent = {
  id: 'm',
  title: 'Class',
  notes: null,
  location: null,
  start_at: new Date(2026, 10, 2, 9).toISOString(),
  end_at: new Date(2026, 10, 2, 10).toISOString(),
  all_day: false,
  reminder_minutes: null,
  recurrence: { freq: 'weekly', interval: 1, byweekday: [1] },
  exdates: [],
  recurrence_parent_id: null,
};
const fields: EventFields = { title: 'Class (room B)', notes: null, location: 'B', all_day: false, reminder_minutes: 10 };
const at = (d: number, h: number) => new Date(2026, 10, d, h);
const apply = (plan: ReturnType<typeof planSeriesEdit>) => {
  const events: CalendarEvent[] = [];
  if (!plan.deleteMaster) events.push({ ...master, ...plan.updateMaster } as CalendarEvent);
  if (plan.insert) events.push({ ...master, id: 'new', recurrence_parent_id: null, ...plan.insert } as CalendarEvent);
  return expandEvents(events, at(1, 0), at(30, 0)).map((i) => `${i.start.getDate()}@${i.start.getHours()} ${i.event.title}`);
};

describe('editing a recurring event', () => {
  it('"this" skips the date in the series and saves a one-off copy', () => {
    const plan = planSeriesEdit(master, '2026-11-16', at(16, 9), { fields, start: at(16, 11), end: at(16, 12), rule: master.recurrence }, 'this');
    expect(plan.insert).toMatchObject({ recurrence: null, recurrence_parent_id: 'm', location: 'B' });
    expect(apply(plan)).toEqual(['2@9 Class', '9@9 Class', '16@11 Class (room B)', '23@9 Class']);
  });

  it('"following" ends the series the day before and starts a new one', () => {
    const plan = planSeriesEdit(master, '2026-11-16', at(16, 9), { fields, start: at(16, 11), end: at(16, 12), rule: master.recurrence }, 'following');
    expect(plan.updateMaster?.recurrence).toEqual({ freq: 'weekly', interval: 1, byweekday: [1], until: '2026-11-15' });
    expect(apply(plan)).toEqual(['2@9 Class', '9@9 Class', '16@11 Class (room B)', '23@11 Class (room B)']);
  });

  it('"following" on the first occurrence edits the whole series', () => {
    const plan = planSeriesEdit(master, '2026-11-02', at(2, 9), { fields, start: at(2, 11), end: at(2, 12), rule: master.recurrence }, 'following');
    expect(plan.insert).toBeUndefined();
    expect(apply(plan)).toEqual(['2@11 Class (room B)', '9@11 Class (room B)', '16@11 Class (room B)', '23@11 Class (room B)']);
  });

  it('"all" shifts the whole series by the same amount, from any occurrence', () => {
    const plan = planSeriesEdit(master, '2026-11-16', at(16, 9), { fields, start: at(16, 8), end: at(16, 9), rule: master.recurrence }, 'all');
    expect(apply(plan)).toEqual(['2@8 Class (room B)', '9@8 Class (room B)', '16@8 Class (room B)', '23@8 Class (room B)']);
  });

  it('"following" splits a counted series without adding occurrences', () => {
    const counted = { ...master, recurrence: { freq: 'weekly' as const, interval: 1, byweekday: [1], count: 4 } };
    const plan = planSeriesEdit(counted, '2026-11-16', at(16, 9), { fields, start: at(16, 9), end: at(16, 10), rule: counted.recurrence }, 'following');
    expect(plan.updateMaster?.recurrence?.count).toBe(2);
    expect(plan.insert?.recurrence?.count).toBe(2);
  });
});

describe('deleting from a recurring event', () => {
  it('"this" only skips that date', () => {
    expect(planSeriesDelete(master, '2026-11-09', 'this')).toEqual({ updateMaster: { exdates: ['2026-11-09'] } });
  });

  it('"following" ends the series before that date', () => {
    expect(planSeriesDelete(master, '2026-11-09', 'following').updateMaster?.recurrence?.until).toBe('2026-11-08');
  });

  it('"following" from the first date, or "all", deletes the series', () => {
    expect(planSeriesDelete(master, '2026-11-02', 'following')).toEqual({ deleteMaster: true });
    expect(planSeriesDelete(master, '2026-11-09', 'all')).toEqual({ deleteMaster: true });
  });
});
