import { format, parseISO } from 'date-fns';

/** Local calendar date as YYYY-MM-DD. */
export const toDateKey = (d: Date): string => format(d, 'yyyy-MM-dd');

/** Parses YYYY-MM-DD as a local date (parseISO would also work, kept explicit). */
export const fromDateKey = (key: string): Date => parseISO(key);

/** Date key of an ISO timestamp in the browser's local time. */
export const isoToDateKey = (iso: string): string => toDateKey(new Date(iso));
