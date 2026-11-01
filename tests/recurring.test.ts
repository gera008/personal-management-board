import { describe, expect, it } from 'vitest';
import { installmentProgress, lastInstallmentDate, occurrenceDate, scheduleDates } from '../src/domain/recurring/schedule';

describe('recurring schedule', () => {
  it('keeps month-end anchors stable', () => {
    expect(scheduleDates({ startDate: '2026-01-31', frequency: 'monthly', limit: 4 })).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('handles leap days for yearly series', () => {
    expect(occurrenceDate('2028-02-29', 'yearly', 1)).toBe('2029-02-28');
    expect(occurrenceDate('2028-02-29', 'yearly', 4)).toBe('2032-02-29');
  });

  it('steps weekly series by 7 days', () => {
    expect(scheduleDates({ startDate: '2026-12-28', frequency: 'weekly', limit: 3 })).toEqual(['2026-12-28', '2027-01-04', '2027-01-11']);
  });

  it('stops installments at the last payment', () => {
    const dates = scheduleDates({ startDate: '2026-11-17', frequency: 'monthly', totalCount: 20 });
    expect(dates).toHaveLength(20);
    expect(dates.at(-1)).toBe('2028-06-17');
    expect(lastInstallmentDate('2026-11-17', 'monthly', 20)).toBe('2028-06-17');
  });

  it('stops subscriptions at the optional end date', () => {
    expect(scheduleDates({ startDate: '2026-01-15', frequency: 'monthly', endDate: '2026-04-14' })).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
    ]);
  });

  it('reports installment progress', () => {
    expect(installmentProgress(2, 20)).toEqual({ paid: 2, total: 20, ratio: 0.1, label: '2/20' });
    expect(installmentProgress(25, 20).label).toBe('20/20');
  });
});
