import { describe, expect, it } from 'vitest';
import { layoutDay, type CalItem } from '@/features/calendar/items';

const day = new Date('2026-11-02T00:00');
const ev = (id: string, start: string, end: string): CalItem => ({
  kind: 'event',
  id,
  title: id,
  allDay: false,
  start: new Date(`2026-11-02T${start}`),
  end: new Date(`2026-11-02T${end}`),
  color: '#3D8BFF',
});
const byId = (slots: ReturnType<typeof layoutDay>) => Object.fromEntries(slots.map((s) => [s.item.id, s]));

describe('layoutDay', () => {
  it('spans an event across its hours', () => {
    const [s] = layoutDay([ev('hike', '09:00', '12:00')], day);
    expect([s.top, s.bottom, s.col, s.cols]).toEqual([540, 720, 0, 1]);
  });

  it('gives short items a minimum height', () => {
    const [s] = layoutDay([ev('call', '10:00', '10:00')], day);
    expect(s.bottom - s.top).toBe(30);
  });

  it('puts overlapping items side by side and leaves others full width', () => {
    const s = byId(layoutDay([ev('a', '09:00', '12:00'), ev('b', '10:00', '11:00'), ev('c', '11:00', '13:00'), ev('d', '15:00', '16:00')], day));
    expect([s.a.col, s.b.col, s.c.col]).toEqual([0, 1, 1]);
    expect([s.a.cols, s.b.cols, s.c.cols, s.d.cols]).toEqual([2, 2, 2, 1]);
  });

  it('clips events that cross midnight', () => {
    const late: CalItem = { ...ev('late', '22:00', '23:00'), end: new Date('2026-11-03T02:00') };
    const early: CalItem = { ...ev('early', '00:00', '00:00'), start: new Date('2026-11-01T23:00'), end: new Date('2026-11-02T01:30') };
    const s = byId(layoutDay([late, early], day));
    expect([s.late.top, s.late.bottom]).toEqual([1320, 1440]);
    expect([s.early.top, s.early.bottom]).toEqual([0, 90]);
  });
});
