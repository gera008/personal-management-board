import { addMonths, addWeeks, addYears, format } from 'date-fns';
import type { Frequency } from '../types';
import { fromDateKey } from '../dates';

/**
 * Date of occurrence n (0-based). Always computed from the anchor date so
 * month-end dates stay stable: Jan 31 -> Feb 28 -> Mar 31.
 * Mirrors public.series_occurrence_date in SQL.
 */
export function occurrenceDate(startDate: string, frequency: Frequency, n: number): string {
  const start = fromDateKey(startDate);
  const d = frequency === 'weekly' ? addWeeks(start, n) : frequency === 'monthly' ? addMonths(start, n) : addYears(start, n);
  return format(d, 'yyyy-MM-dd');
}

/** Upcoming dates for a preview. Installments stop at totalCount; subscriptions at endDate or `limit`. */
export function scheduleDates(opts: {
  startDate: string;
  frequency: Frequency;
  totalCount?: number | null;
  endDate?: string | null;
  limit?: number;
}): string[] {
  const out: string[] = [];
  const limit = opts.limit ?? 120;
  for (let n = 0; out.length < limit; n++) {
    if (opts.totalCount != null && n >= opts.totalCount) break;
    const d = occurrenceDate(opts.startDate, opts.frequency, n);
    if (opts.endDate && d > opts.endDate) break;
    out.push(d);
  }
  return out;
}

export function lastInstallmentDate(startDate: string, frequency: Frequency, totalCount: number): string {
  return occurrenceDate(startDate, frequency, totalCount - 1);
}

/** "2/20" style progress from the number of applied occurrences. */
export function installmentProgress(appliedCount: number, totalCount: number): { paid: number; total: number; ratio: number; label: string } {
  const paid = Math.min(appliedCount, totalCount);
  return { paid, total: totalCount, ratio: totalCount ? paid / totalCount : 0, label: `${paid}/${totalCount}` };
}
