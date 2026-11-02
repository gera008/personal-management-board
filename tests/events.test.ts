import { describe, expect, it } from 'vitest';
import { expandEvents } from '../src/domain/events';
import type { CalendarEvent } from '../src/domain/types';

const ev = (p: Partial<CalendarEvent>): CalendarEvent => ({
  id: 'e1',
  title: 'Class',
  notes: null,
  location: null,
  start_at: new Date(2026, 10, 2, 9, 0).toISOString(),
  end_at: new Date(2026, 10, 2, 10, 30).toISOString(),
  all_day: false,
  reminder_minutes: null,
  recurrence: null,
  exdates: [],
  recurrence_parent_id: null,
  ...p,
});

const nov = (d: number) => new Date(2026, 10, d);

describe('expandEvents', () => {
  it('keeps one-off events that overlap the window', () => {
    expect(expandEvents([ev({})], nov(1), nov(8))).toHaveLength(1);
    expect(expandEvents([ev({})], nov(3), nov(8))).toHaveLength(0);
  });

  it('expands a weekly class on Mon/Wed with its time and duration', () => {
    const list = expandEvents([ev({ recurrence: { freq: 'weekly', interval: 1, byweekday: [1, 3] } })], nov(1), nov(15));
    expect(list.map((i) => i.occurrence)).toEqual(['2026-11-02', '2026-11-04', '2026-11-09', '2026-11-11']);
    expect(list[1].start).toEqual(new Date(2026, 10, 4, 9, 0));
    expect(list[1].end).toEqual(new Date(2026, 10, 4, 10, 30));
  });

  it('skips excluded dates', () => {
    const list = expandEvents([ev({ recurrence: { freq: 'daily', interval: 1 }, exdates: ['2026-11-03'] })], nov(2), nov(5));
    expect(list.map((i) => i.occurrence)).toEqual(['2026-11-02', '2026-11-04']);
  });

  it('includes a multi-day occurrence that started before the window', () => {
    const trip = ev({
      start_at: new Date(2026, 0, 30, 0, 0).toISOString(),
      end_at: new Date(2026, 1, 2, 23, 59).toISOString(),
      all_day: true,
      recurrence: { freq: 'monthly', interval: 1 },
    });
    // The Oct 30 – Nov 2 occurrence overlaps a window starting Nov 1.
    expect(expandEvents([trip], nov(1), nov(3)).map((i) => i.occurrence)).toEqual(['2026-10-30']);
  });

  it('does not show occurrences before the series starts', () => {
    expect(expandEvents([ev({ recurrence: { freq: 'daily', interval: 1 } })], new Date(2026, 9, 1), nov(2))).toHaveLength(0);
  });
});
