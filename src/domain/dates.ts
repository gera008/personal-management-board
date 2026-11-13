import { format, parseISO } from 'date-fns';

/** Local calendar date as YYYY-MM-DD. */
export const toDateKey = (d: Date): string => format(d, 'yyyy-MM-dd');

/** Parses YYYY-MM-DD as a local date (parseISO would also work, kept explicit). */
export const fromDateKey = (key: string): Date => parseISO(key);

/** Date key of an ISO timestamp in the browser's local time. */
export const isoToDateKey = (iso: string): string => toDateKey(new Date(iso));

/** The next full hour as "HH:00" (13:37 → "14:00"; 23:10 → "00:00"). Default for empty time fields. */
export const nextHourTime = (now: Date = new Date()): string => `${String((now.getHours() + 1) % 24).padStart(2, '0')}:00`;

/** Times of day every `step` minutes ("00:00", "00:15", …). A value between steps is kept in order. */
export const timeSteps = (step = 15, keep?: string): string[] => {
  const out: string[] = [];
  for (let m = 0; m < 1440; m += step) out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  if (keep && !out.includes(keep)) out.push(keep), out.sort();
  return out;
};
