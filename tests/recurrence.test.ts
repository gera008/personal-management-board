import { describe, expect, it } from 'vitest';
import { cleanRule, countBefore, nextOccurrence, occurrences, occurrencesBetween, type Recurrence } from '../supabase/functions/_shared/recurrence';

const take = (anchor: string, rule: Recurrence, n: number) => {
  const out: string[] = [];
  for (const k of occurrences(anchor, rule)) {
    out.push(k);
    if (out.length === n) break;
  }
  return out;
};

describe('recurrence', () => {
  it('repeats daily with an interval', () => {
    expect(take('2026-12-30', { freq: 'daily', interval: 2 }, 3)).toEqual(['2026-12-30', '2027-01-01', '2027-01-03']);
  });

  it('repeats weekly on the anchor weekday by default', () => {
    // 2026-11-02 is a Monday
    expect(take('2026-11-02', { freq: 'weekly', interval: 1 }, 3)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16']);
  });

  it('repeats weekly on several weekdays, starting at the anchor', () => {
    // Tue/Thu, anchor Thursday 2026-11-05: Tue 3rd is before the anchor and skipped
    expect(take('2026-11-05', { freq: 'weekly', interval: 1, byweekday: [2, 4] }, 4)).toEqual(['2026-11-05', '2026-11-10', '2026-11-12', '2026-11-17']);
  });

  it('skips weeks with a weekly interval', () => {
    expect(take('2026-11-02', { freq: 'weekly', interval: 2, byweekday: [1, 3] }, 4)).toEqual(['2026-11-02', '2026-11-04', '2026-11-16', '2026-11-18']);
  });

  it('keeps the day of month for monthly rules, clamping short months', () => {
    expect(take('2026-01-31', { freq: 'monthly', interval: 1 }, 4)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(take('2026-11-17', { freq: 'monthly', interval: 3 }, 3)).toEqual(['2026-11-17', '2027-02-17', '2027-05-17']);
  });

  it('handles leap days yearly', () => {
    expect(take('2028-02-29', { freq: 'yearly', interval: 1 }, 2)).toEqual(['2028-02-29', '2029-02-28']);
  });

  it('stops after count occurrences or on the until date', () => {
    expect([...occurrences('2026-11-01', { freq: 'daily', interval: 1, count: 3 })]).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect([...occurrences('2026-11-01', { freq: 'weekly', interval: 1, until: '2026-11-15' })]).toEqual(['2026-11-01', '2026-11-08', '2026-11-15']);
  });

  it('lists occurrences in a window, skipping excluded dates', () => {
    const rule: Recurrence = { freq: 'daily', interval: 1 };
    expect(occurrencesBetween('2026-01-01', rule, '2026-11-01', '2026-11-04', ['2026-11-02'])).toEqual(['2026-11-01', '2026-11-03', '2026-11-04']);
  });

  it('finds the next occurrence after a date', () => {
    const rule: Recurrence = { freq: 'monthly', interval: 1, count: 3 };
    expect(nextOccurrence('2026-10-17', rule, '2026-10-17')).toBe('2026-11-17');
    expect(nextOccurrence('2026-10-17', rule, '2026-12-17')).toBeNull();
  });

  it('counts occurrences before a date', () => {
    expect(countBefore('2026-11-01', { freq: 'daily', interval: 1 }, '2026-11-05')).toBe(4);
  });

  it('cleans rules from the form', () => {
    expect(cleanRule(null)).toBeNull();
    expect(cleanRule({ freq: 'weekly', interval: 0, byweekday: [3, 1, 3], count: 0, until: '2027-01-01' })).toEqual({ freq: 'weekly', interval: 1, byweekday: [1, 3], until: '2027-01-01' });
    expect(cleanRule({ freq: 'daily', interval: 2, count: 5, until: '2027-01-01' })).toEqual({ freq: 'daily', interval: 2, count: 5 });
  });
});

describe('nextHourTime', () => {
  it('rounds up to the next full hour', async () => {
    const { nextHourTime } = await import('../src/domain/dates');
    expect(nextHourTime(new Date(2026, 10, 7, 13, 37))).toBe('14:00');
    expect(nextHourTime(new Date(2026, 10, 7, 9, 0))).toBe('10:00');
    expect(nextHourTime(new Date(2026, 10, 7, 23, 10))).toBe('00:00');
  });
});

describe('timeSteps', () => {
  it('lists the day in 15-minute steps and keeps an off-step value', async () => {
    const { timeSteps } = await import('../src/domain/dates');
    const all = timeSteps();
    expect(all).toHaveLength(96);
    expect(all.slice(0, 3)).toEqual(['00:00', '00:15', '00:30']);
    expect(all.at(-1)).toBe('23:45');
    const kept = timeSteps(15, '10:07');
    expect(kept).toHaveLength(97);
    expect(kept.indexOf('10:07')).toBe(kept.indexOf('10:00') + 1);
  });
});
