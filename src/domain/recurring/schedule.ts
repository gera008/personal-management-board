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

/** Amount of payment n (0-based): the last installment may differ (balloon / final payment). */
export function paymentAmount(amount: number, n: number, totalCount?: number | null, finalAmount?: number | null): number {
  return finalAmount != null && totalCount != null && n === totalCount - 1 ? finalAmount : amount;
}

/** Sum of every payment of an installment plan. */
export function installmentTotal(amount: number, totalCount: number, finalAmount?: number | null): number {
  if (totalCount <= 0) return 0;
  return Math.round((amount * (totalCount - (finalAmount != null ? 1 : 0)) + (finalAmount ?? 0)) * 100) / 100;
}

/** What's left to pay on a plan: its pending payments dated after `now`. */
export function remainingPayments(rows: { status: string; occurred_at: string; original_amount: number | string }[], now: Date): { count: number; total: number } {
  const left = rows.filter((r) => r.status === 'pending' && new Date(r.occurred_at) > now);
  return { count: left.length, total: Math.round(left.reduce((s, r) => s + Number(r.original_amount), 0) * 100) / 100 };
}
