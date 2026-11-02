import { addDays, differenceInCalendarDays, endOfMonth, startOfMonth, startOfWeek } from 'date-fns';
import type { Habit, HabitLog } from '../types';
import { num } from '../types';
import { fromDateKey, toDateKey } from '../dates';

export type LogMap = Map<string, HabitLog>; // date key -> log for one habit

export const logMap = (logs: HabitLog[], habitId: string): LogMap =>
  new Map(logs.filter((l) => l.habit_id === habitId).map((l) => [l.date, l]));

const target = (h: Habit) => (h.type === 'numeric' ? num(h.target_value) || 1 : 1);

/** A day can be logged (or fixed) from the habit's start date up to today; never in the future. */
export function canLogOn(h: Habit, date: string, today: string): boolean {
  return date >= h.start_date && date <= today;
}

/** Whether a good habit is due on a date. "X times per week" habits can be done any day. */
export function isScheduled(h: Habit, date: string): boolean {
  if (date < h.start_date) return false;
  const f = h.frequency;
  switch (f.type) {
    case 'daily':
    case 'times_per_week':
      return true;
    case 'weekdays':
      return f.days.includes(fromDateKey(date).getDay());
    case 'every_n_days':
      return differenceInCalendarDays(fromDateKey(date), fromDateKey(h.start_date)) % Math.max(1, f.n) === 0;
  }
}

/** Good habit: logged value reached target. Bad habit: no slip that day. */
export function isSuccess(h: Habit, logs: LogMap, date: string): boolean {
  const l = logs.get(date);
  if (h.kind === 'bad') return !l?.is_slip;
  return !!l && !l.is_slip && num(l.value) >= target(h);
}

/** 0..1 progress for a day (partial numeric progress counts proportionally). */
export function dayProgress(h: Habit, logs: LogMap, date: string): number {
  const l = logs.get(date);
  if (h.kind === 'bad') return l?.is_slip ? 0 : 1;
  if (!l || l.is_slip) return 0;
  return Math.min(1, num(l.value) / target(h));
}

function* daysBetween(from: string, to: string): Generator<string> {
  for (let d = fromDateKey(from); toDateKey(d) <= to; d = addDays(d, 1)) yield toDateKey(d);
}

export interface Streaks {
  current: number;
  best: number;
  unit: 'days' | 'weeks';
}

export function computeStreaks(h: Habit, logs: LogMap, today: string, weekStartsOn: 0 | 1 = 0): Streaks {
  if (today < h.start_date) return { current: 0, best: 0, unit: 'days' };

  if (h.kind === 'bad') {
    // "Días sin": length of each clean run between slips, counting today.
    let run = 0;
    let best = 0;
    for (const d of daysBetween(h.start_date, today)) {
      run = logs.get(d)?.is_slip ? 0 : run + 1;
      best = Math.max(best, run);
    }
    return { current: run, best, unit: 'days' };
  }

  if (h.frequency.type === 'times_per_week') {
    const n = Math.max(1, h.frequency.n);
    const weeks: boolean[] = [];
    let ws = startOfWeek(fromDateKey(h.start_date), { weekStartsOn });
    const curWeek = toDateKey(startOfWeek(fromDateKey(today), { weekStartsOn }));
    let currentWeekMet = false;
    while (toDateKey(ws) <= curWeek) {
      let count = 0;
      for (let i = 0; i < 7; i++) {
        const d = toDateKey(addDays(ws, i));
        if (d >= h.start_date && d <= today && isSuccess(h, logs, d)) count++;
      }
      if (toDateKey(ws) === curWeek) currentWeekMet = count >= n;
      else weeks.push(count >= n);
      ws = addDays(ws, 7);
    }
    // The running week only adds to the streak once its target is met; until then it doesn't break it.
    if (currentWeekMet) weeks.push(true);
    return { ...runs(weeks), unit: 'weeks' };
  }

  const results: boolean[] = [];
  for (const d of daysBetween(h.start_date, today)) {
    if (!isScheduled(h, d)) continue;
    const ok = isSuccess(h, logs, d);
    // Today is still in progress: count it if done, otherwise don't break the streak.
    if (d === today && !ok) break;
    results.push(ok);
  }
  return { ...runs(results), unit: 'days' };
}

function runs(results: boolean[]): { current: number; best: number } {
  let run = 0;
  let best = 0;
  for (const ok of results) {
    run = ok ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return { current: run, best };
}

/** Share of successful due days in [from, to] (to is capped at today). */
export function completionRate(h: Habit, logs: LogMap, from: string, to: string, today: string): number {
  const start = from < h.start_date ? h.start_date : from;
  const end = to > today ? today : to;
  if (end < start) return 0;
  if (h.kind === 'good' && h.frequency.type === 'times_per_week') {
    let done = 0;
    let days = 0;
    for (const d of daysBetween(start, end)) {
      days++;
      if (isSuccess(h, logs, d)) done++;
    }
    const expected = (h.frequency.n * days) / 7;
    return expected > 0 ? Math.min(1, done / expected) : 0;
  }
  let due = 0;
  let ok = 0;
  for (const d of daysBetween(start, end)) {
    if (h.kind === 'good' && !isScheduled(h, d)) continue;
    due++;
    if (isSuccess(h, logs, d)) ok++;
  }
  return due ? ok / due : 0;
}

export function weeklyCompletion(h: Habit, logs: LogMap, today: string, weekStartsOn: 0 | 1 = 0): number {
  const ws = startOfWeek(fromDateKey(today), { weekStartsOn });
  return completionRate(h, logs, toDateKey(ws), toDateKey(addDays(ws, 6)), today);
}

export function monthlyCompletion(h: Habit, logs: LogMap, today: string): number {
  const d = fromDateKey(today);
  return completionRate(h, logs, toDateKey(startOfMonth(d)), toDateKey(endOfMonth(d)), today);
}

/** Heatmap cell values for one habit. Good habits: 0..1 progress (null when not due). Bad: 1 clean, -1 slip. */
export function habitHeatmap(h: Habit, logs: LogMap, from: string, to: string): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const d of daysBetween(from, to)) {
    if (d < h.start_date) out.set(d, null);
    else if (h.kind === 'bad') out.set(d, logs.get(d)?.is_slip ? -1 : 1);
    else if (h.frequency.type === 'times_per_week') out.set(d, logs.has(d) ? dayProgress(h, logs, d) : 0);
    else out.set(d, isScheduled(h, d) ? dayProgress(h, logs, d) : null);
  }
  return out;
}

/** Combined heatmap: average success across habits due that day (0..1), null if none due. */
export function combinedHeatmap(habits: Habit[], logs: HabitLog[], from: string, to: string): Map<string, number | null> {
  const maps = habits.map((h) => habitHeatmap(h, logMap(logs, h.id), from, to));
  const out = new Map<string, number | null>();
  for (const d of daysBetween(from, to)) {
    const vals = maps.map((m) => m.get(d)).filter((v): v is number => v != null).map((v) => (v < 0 ? 0 : v));
    out.set(d, vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
  }
  return out;
}
