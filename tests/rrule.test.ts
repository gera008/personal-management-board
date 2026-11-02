import { describe, expect, it } from 'vitest';
import { fromGoogleRecurrence, toGoogleRecurrence } from '../supabase/functions/_shared/rrule';

const timed = { allDay: false, timeZone: 'America/Monterrey', localTime: '090000' };

describe('toGoogleRecurrence', () => {
  it('writes a weekly class on Mon/Wed with skipped dates', () => {
    expect(toGoogleRecurrence({ freq: 'weekly', interval: 1, byweekday: [1, 3] }, ['2026-11-09'], timed)).toEqual([
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE',
      'EXDATE;TZID=America/Monterrey:20261109T090000',
    ]);
  });

  it('writes interval, count and until', () => {
    expect(toGoogleRecurrence({ freq: 'monthly', interval: 2, count: 6 }, [], timed)).toEqual(['RRULE:FREQ=MONTHLY;INTERVAL=2;COUNT=6']);
    expect(toGoogleRecurrence({ freq: 'daily', interval: 1, until: '2026-12-31' }, [], timed)).toEqual(['RRULE:FREQ=DAILY;UNTIL=20261231T235959Z']);
  });

  it('uses date values for all-day events', () => {
    expect(toGoogleRecurrence({ freq: 'yearly', interval: 1, until: '2030-01-01' }, ['2027-05-03'], { ...timed, allDay: true })).toEqual([
      'RRULE:FREQ=YEARLY;UNTIL=20300101',
      'EXDATE;VALUE=DATE:20270503',
    ]);
  });
});

describe('fromGoogleRecurrence', () => {
  it('reads what the app writes (round trip)', () => {
    const rule = { freq: 'weekly' as const, interval: 2, byweekday: [2, 4], count: 10 };
    expect(fromGoogleRecurrence(toGoogleRecurrence(rule, ['2026-11-12'], timed))).toEqual({ rule, exdates: ['2026-11-12'] });
  });

  it('reads Google-style rules with WKST and UTC UNTIL', () => {
    expect(fromGoogleRecurrence(['RRULE:FREQ=WEEKLY;WKST=SU;UNTIL=20270115T055959Z;BYDAY=TU,TH'])).toEqual({
      rule: { freq: 'weekly', interval: 1, byweekday: [2, 4], until: '2027-01-15' },
      exdates: [],
    });
  });

  it('collects several EXDATE lines and values', () => {
    const out = fromGoogleRecurrence(['RRULE:FREQ=DAILY', 'EXDATE;TZID=America/Monterrey:20261103T090000,20261105T090000', 'EXDATE;VALUE=DATE:20261104']);
    expect(out?.exdates).toEqual(['2026-11-03', '2026-11-04', '2026-11-05']);
  });

  it('rejects rules the app cannot represent', () => {
    expect(fromGoogleRecurrence(['RRULE:FREQ=MONTHLY;BYDAY=2TU'])).toBeNull();
    expect(fromGoogleRecurrence(['RRULE:FREQ=MONTHLY;BYSETPOS=-1;BYDAY=FR'])).toBeNull();
    expect(fromGoogleRecurrence(['RRULE:FREQ=YEARLY;BYMONTH=3'])).toBeNull();
    expect(fromGoogleRecurrence(['RRULE:FREQ=HOURLY'])).toBeNull();
    expect(fromGoogleRecurrence(['RRULE:FREQ=DAILY', 'RDATE:20261201'])).toBeNull();
    expect(fromGoogleRecurrence([])).toBeNull();
  });
});
