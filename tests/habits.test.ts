import { describe, expect, it } from 'vitest';
import {
  canLogOn,
  combinedHeatmap,
  computeStreaks,
  dayState,
  monthSummary,
  nextTap,
  habitHeatmap,
  isScheduled,
  logMap,
  monthlyCompletion,
  weeklyCompletion,
} from '../src/domain/habits/streaks';
import { habit, logs } from './fixtures';

const range = (from: number, to: number, month = '2026-10') =>
  Array.from({ length: to - from + 1 }, (_, i) => `${month}-${String(from + i).padStart(2, '0')}`);

describe('good habit streaks', () => {
  const h = habit({ start_date: '2026-10-01' });

  it('counts consecutive done days and keeps the best run', () => {
    const l = logMap(logs('h1', [...range(1, 5), ...range(8, 10)]), 'h1');
    expect(computeStreaks(h, l, '2026-10-10')).toEqual({ current: 3, best: 5, unit: 'days' });
  });

  it('does not break the streak while today is still open', () => {
    const l = logMap(logs('h1', range(1, 9)), 'h1');
    expect(computeStreaks(h, l, '2026-10-10').current).toBe(9);
  });

  it('breaks the streak after a missed day', () => {
    const l = logMap(logs('h1', range(1, 8)), 'h1');
    expect(computeStreaks(h, l, '2026-10-10').current).toBe(0);
  });

  it('requires numeric habits to reach the target', () => {
    const n = habit({ type: 'numeric', target_value: 8, unit: 'glasses' });
    const l = logMap([...logs('h1', range(1, 2), { value: 8 }), ...logs('h1', ['2026-10-03'], { value: 5 })], 'h1');
    expect(computeStreaks(n, l, '2026-10-03')).toEqual({ current: 2, best: 2, unit: 'days' });
    expect(habitHeatmap(n, l, '2026-10-03', '2026-10-03').get('2026-10-03')).toBe(5 / 8);
  });

  it('only counts scheduled weekdays', () => {
    // Mon/Wed/Fri. Oct 2026: 5 Mon, 7 Wed, 9 Fri, 12 Mon
    const w = habit({ frequency: { type: 'weekdays', days: [1, 3, 5] }, start_date: '2026-10-05' });
    expect(isScheduled(w, '2026-10-06')).toBe(false);
    const l = logMap(logs('h1', ['2026-10-05', '2026-10-07', '2026-10-09', '2026-10-12']), 'h1');
    expect(computeStreaks(w, l, '2026-10-13').current).toBe(4);
  });

  it('supports every N days', () => {
    const e = habit({ frequency: { type: 'every_n_days', n: 3 }, start_date: '2026-10-01' });
    expect(isScheduled(e, '2026-10-04')).toBe(true);
    expect(isScheduled(e, '2026-10-05')).toBe(false);
    const l = logMap(logs('h1', ['2026-10-01', '2026-10-04', '2026-10-07']), 'h1');
    expect(computeStreaks(e, l, '2026-10-09').current).toBe(3);
  });

  it('counts weeks for "X times per week" habits', () => {
    // Weeks start Sunday: Oct 4-10, Oct 11-17, Oct 18-24 (current)
    const t = habit({ frequency: { type: 'times_per_week', n: 3 }, start_date: '2026-10-04' });
    const done = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-12', '2026-10-14', '2026-10-16', '2026-10-19'];
    const l = logMap(logs('h1', done), 'h1');
    expect(computeStreaks(t, l, '2026-10-20')).toEqual({ current: 2, best: 2, unit: 'weeks' });
    const l2 = logMap(logs('h1', [...done, '2026-10-20', '2026-10-21']), 'h1');
    expect(computeStreaks(t, l2, '2026-10-21')).toEqual({ current: 3, best: 3, unit: 'weeks' });
  });

  it('computes weekly and monthly completion', () => {
    const l = logMap(logs('h1', ['2026-10-04', '2026-10-05']), 'h1');
    // Week Sun Oct 4 – today Tue Oct 6: 2 of 3 days
    expect(weeklyCompletion(h, l, '2026-10-06')).toBeCloseTo(2 / 3);
    expect(monthlyCompletion(h, l, '2026-10-06')).toBeCloseTo(2 / 6);
  });
});

describe('bad habits ("días sin")', () => {
  const b = habit({ kind: 'bad', start_date: '2026-10-01' });

  it('counts days without a slip, including today', () => {
    expect(computeStreaks(b, new Map(), '2026-10-10')).toEqual({ current: 10, best: 10, unit: 'days' });
  });

  it('resets on a slip and remembers the best run', () => {
    const l = logMap(logs('h1', ['2026-10-05'], { is_slip: true }), 'h1');
    expect(computeStreaks(b, l, '2026-10-10')).toEqual({ current: 5, best: 5, unit: 'days' });
    const l2 = logMap(logs('h1', ['2026-10-08'], { is_slip: true }), 'h1');
    expect(computeStreaks(b, l2, '2026-10-10')).toEqual({ current: 2, best: 7, unit: 'days' });
  });

  it('is zero on the day of a slip', () => {
    const l = logMap(logs('h1', ['2026-10-10'], { is_slip: true }), 'h1');
    expect(computeStreaks(b, l, '2026-10-10').current).toBe(0);
  });

  it('marks slips as -1 in the heatmap', () => {
    const l = logMap(logs('h1', ['2026-10-02'], { is_slip: true }), 'h1');
    const m = habitHeatmap(b, l, '2026-10-01', '2026-10-03');
    expect([...m.values()]).toEqual([1, -1, 1]);
  });
});

describe('combined heatmap', () => {
  it('averages habits that are due each day', () => {
    const good = habit({ id: 'g' });
    const bad = habit({ id: 'b', kind: 'bad' });
    const all = [...logs('g', ['2026-10-01']), ...logs('b', ['2026-10-02'], { is_slip: true })];
    const m = combinedHeatmap([good, bad], all, '2026-10-01', '2026-10-02');
    expect(m.get('2026-10-01')).toBe(1);
    expect(m.get('2026-10-02')).toBe(0);
  });
});

describe('logging past days', () => {
  const h = habit({ start_date: '2026-10-01' });

  it('allows days from the start date up to today, never the future', () => {
    expect(canLogOn(h, '2026-09-30', '2026-11-02')).toBe(false);
    expect(canLogOn(h, '2026-10-01', '2026-11-02')).toBe(true);
    expect(canLogOn(h, '2026-11-02', '2026-11-02')).toBe(true);
    expect(canLogOn(h, '2026-11-03', '2026-11-02')).toBe(false);
  });

  it('restores the streak when a forgotten day is filled in', () => {
    const missed = logMap(logs('h1', ['2026-10-01', '2026-10-02', '2026-10-04']), 'h1');
    expect(computeStreaks(h, missed, '2026-10-04').current).toBe(1);
    const fixed = logMap(logs('h1', ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']), 'h1');
    expect(computeStreaks(h, fixed, '2026-10-04')).toEqual({ current: 4, best: 4, unit: 'days' });
  });
});

describe('month view', () => {
  const today = '2026-11-04';
  const good = habit({ id: 'g' });
  const map = logMap(
    [...logs('g', ['2026-11-01', '2026-11-02']), ...logs('g', ['2026-11-03'], { value: 0, is_slip: true })],
    'g',
  );

  it('reads each day of a good habit', () => {
    expect(['2026-09-30', '2026-11-01', '2026-11-03', '2026-11-04', '2026-11-05'].map((d) => dayState(good, map, d, today))).toEqual([
      'beforeStart',
      'done',
      'missed',
      'empty',
      'future',
    ]);
  });

  it('cycles a good habit through done, missed and empty', () => {
    expect(nextTap(good, 'empty')).toEqual({ value: 1 });
    expect(nextTap(good, 'done')).toEqual({ value: 0, isSlip: true });
    expect(nextTap(good, 'missed')).toEqual({ remove: true });
    expect(nextTap(good, 'future')).toBeNull();
    expect(nextTap(habit({ type: 'numeric', target_value: 8 }), 'empty')).toBe('ask');
  });

  it('a "missed" mark counts like an empty day', () => {
    expect(computeStreaks(good, map, today).current).toBe(0);
    expect(monthSummary(good, map, new Date(2026, 10, 1), today)).toMatchObject({ done: 2, missed: 1, rate: 0.5 });
  });

  it('skips days a weekday habit is not due', () => {
    const weekdays = habit({ id: 'w', frequency: { type: 'weekdays', days: [1, 2, 3, 4, 5] } });
    expect(dayState(weekdays, new Map(), '2026-11-01', today)).toBe('notDue'); // Sunday
    expect(nextTap(weekdays, 'notDue')).toBeNull();
  });

  it('reads a bad habit as clean unless it slipped', () => {
    const bad = habit({ id: 'b', kind: 'bad' });
    const slips = logMap(logs('b', ['2026-11-02'], { is_slip: true }), 'b');
    expect(['2026-11-01', '2026-11-02', today].map((d) => dayState(bad, slips, d, today))).toEqual(['clean', 'slip', 'pending']);
    expect(nextTap(bad, 'clean')).toEqual({ isSlip: true });
    expect(nextTap(bad, 'slip')).toEqual({ remove: true });
    expect(monthSummary(bad, slips, new Date(2026, 10, 1), today)).toMatchObject({ slips: 1, clean: 3 });
  });
});
