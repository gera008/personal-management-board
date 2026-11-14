import { describe, expect, it } from 'vitest';
import { contributedAt, currentValue, investmentHistory, isStale, periodGain, valuationChanges } from '../src/domain/finance/investments';
import type { AccountValuation } from '../src/domain/types';
import { account, tx } from './fixtures';

const gbm = account({ id: 'gbm', type: 'investment', initial_balance: 0 });
const contrib = (occurred_at: string, amount: number) => tx({ type: 'transfer', direction: 'in', account_id: 'gbm', occurred_at, original_amount: amount });
const withdraw = (occurred_at: string, amount: number) => tx({ type: 'transfer', direction: 'out', account_id: 'gbm', occurred_at, original_amount: amount });
let n = 0;
const val = (valued_at: string, value: number): AccountValuation => ({ id: `v${++n}`, account_id: 'gbm', valued_at, value, note: null });

const txs = [contrib('2026-01-10T12:00:00Z', 10000), contrib('2026-03-10T12:00:00Z', 5000), withdraw('2026-06-10T12:00:00Z', 2000), contrib('2026-09-10T12:00:00Z', 1000)];
const vals = [val('2026-02-28T23:00:00Z', 10500), val('2026-05-31T23:00:00Z', 16200), val('2026-08-31T23:00:00Z', 14500)];
const now = new Date('2026-11-14T12:00:00Z');

describe('investments', () => {
  it('contributed is the initial balance plus applied money in and out', () => {
    expect(contributedAt(gbm, txs, now)).toBe(14000);
    expect(contributedAt(gbm, txs, new Date('2026-04-01'))).toBe(15000);
    expect(contributedAt(gbm, [...txs, { ...contrib('2026-10-01T00:00:00Z', 999), status: 'pending' }], now)).toBe(14000);
  });

  it('current value is the latest valuation plus money moved after it', () => {
    expect(currentValue(gbm, txs, vals, now)).toBe(15500);
    expect(currentValue(gbm, txs, [], now)).toBe(14000);
  });

  it('history has a point per valuation and one for today after new money', () => {
    const h = investmentHistory(gbm, txs, vals, now);
    expect(h.map((p) => [p.value, p.contributed, p.gain])).toEqual([
      [10500, 10000, 500],
      [16200, 15000, 1200],
      [14500, 13000, 1500],
      [15500, 14000, 1500],
    ]);
    expect(investmentHistory(gbm, txs.slice(0, 3), vals, now)).toHaveLength(3);
  });

  it('valuation changes leave out contributions and withdrawals', () => {
    const c = valuationChanges(gbm, txs, vals);
    expect(c.map((x) => x.change)).toEqual([300, 700, 500]);
    expect(c[0].pct).toBeCloseTo(2.11, 2); // 300 over 16,200 − 2,000
    expect(c[2].pct).toBe(5);
  });

  it('period gain since the start and since a date', () => {
    const h = investmentHistory(gbm, txs, vals, now);
    expect(periodGain(h, null)).toEqual({ gain: 1500, pct: 10.71 });
    expect(periodGain(h, new Date('2026-06-01'))!.gain).toBe(300);
    expect(periodGain(h, new Date('2025-11-14'))).toEqual(periodGain(h, null));
    expect(periodGain([], null)).toBeNull();
  });

  it('a value older than 30 days is stale', () => {
    expect(isStale(null, now)).toBe(true);
    expect(isStale('2026-10-20T00:00:00Z', now)).toBe(false);
    expect(isStale('2026-10-01T00:00:00Z', now)).toBe(true);
  });
});
