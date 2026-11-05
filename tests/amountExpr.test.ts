import { describe, expect, it } from 'vitest';
import { evalAmount, isExpression } from '@/domain/finance/amountExpr';

describe('evalAmount', () => {
  it('reads plain amounts', () => {
    expect(evalAmount('250')).toBe(250);
    expect(evalAmount('99.9')).toBe(99.9);
    expect(evalAmount('.5')).toBe(0.5);
  });

  it('adds and subtracts', () => {
    expect(evalAmount('120+35.50-10')).toBe(145.5);
    expect(evalAmount(' 100 + 50 ')).toBe(150);
    expect(evalAmount('0.1+0.2')).toBe(0.3);
    expect(evalAmount('100−30')).toBe(70);
  });

  it('accepts commas as decimals', () => {
    expect(evalAmount('10,5+1')).toBe(11.5);
  });

  it('is null for incomplete or invalid text', () => {
    for (const s of ['', '100+', '+', '1++2', 'abc', '2*3', '1.2.3']) expect(evalAmount(s)).toBeNull();
  });

  it('detects expressions', () => {
    expect(isExpression('100+5')).toBe(true);
    expect(isExpression('100')).toBe(false);
    expect(isExpression('-100')).toBe(false);
  });
});
