import { describe, expect, it } from 'vitest';
import { installmentProgress, installmentTotal, lastInstallmentDate, occurrenceDate, paymentAmount, remainingPayments, scheduleDates } from '../src/domain/recurring/schedule';

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

  it('uses the final amount only for the last payment', () => {
    // iPhone: 20 × 1,029 + final 9,419 = 21 payments
    expect(paymentAmount(1029, 0, 21, 9419)).toBe(1029);
    expect(paymentAmount(1029, 19, 21, 9419)).toBe(1029);
    expect(paymentAmount(1029, 20, 21, 9419)).toBe(9419);
    expect(paymentAmount(1029, 20, 21, null)).toBe(1029);
    expect(lastInstallmentDate('2026-10-17', 'monthly', 21)).toBe('2028-06-17');
  });

  it('totals an installment plan with and without a final payment', () => {
    expect(installmentTotal(1029, 21, 9419)).toBe(29999);
    expect(installmentTotal(1029, 20)).toBe(20580);
    expect(installmentTotal(500, 1, 800)).toBe(800);
  });

  it('sums what is left to pay for an early payoff', () => {
    const now = new Date('2026-11-02T12:00:00Z');
    const rows = [
      { status: 'applied', occurred_at: '2026-10-17T06:00:00Z', original_amount: 1029 },
      { status: 'pending', occurred_at: '2026-11-17T06:00:00Z', original_amount: '1029.00' },
      { status: 'pending', occurred_at: '2026-12-17T06:00:00Z', original_amount: 1029 },
      { status: 'pending', occurred_at: '2028-06-17T06:00:00Z', original_amount: 9419 },
      // Due already but not applied yet by the job: not part of the payoff.
      { status: 'pending', occurred_at: '2026-11-02T06:00:00Z', original_amount: 1029 },
    ];
    expect(remainingPayments(rows, now)).toEqual({ count: 3, total: 11477 });
  });
});
