import { describe, expect, it } from 'vitest';
import {
  accountBalance,
  budgetProgress,
  computeIndicators,
  monthlyTrend,
  monthOverMonth,
  monthProjection,
  signedAmount,
  topNotes,
  balanceSummary,
  totalBalanceMXN,
  totalExpenses,
  weekdaySpending,
} from '../src/domain/finance/totals';
import { account, category, tx } from './fixtures';

// Wednesday, Nov 11 2026, local time.
const NOW = new Date(2026, 10, 11, 12, 0);
const d = (m: number, day: number, h = 12) => new Date(2026, m, day, h).toISOString();

const cats = new Map(
  [
    category({ id: 'food' }),
    category({ id: 'groceries', parent_id: 'food' }),
    category({ id: 'transport' }),
    category({ id: 'fun' }),
    category({ id: 'rent' }),
  ].map((c) => [c.id, c]),
);

const txs = [
  tx({ type: 'expense', occurred_at: d(10, 2), original_amount: 300, category_id: 'food', subcategory_id: 'groceries', note: 'Oxxo' }),
  tx({ type: 'expense', occurred_at: d(10, 9), original_amount: 200, category_id: 'food', note: 'oxxo ' }),
  tx({ type: 'expense', occurred_at: d(10, 10), original_amount: 150, category_id: 'transport', note: 'Uber' }),
  tx({ type: 'expense', occurred_at: d(10, 11), original_amount: 50, category_id: 'fun' }),
  tx({ type: 'expense', occurred_at: d(10, 1), original_amount: 25, category_id: 'rent' }),
  // CAD expense: 10 CAD at 13.84
  tx({ type: 'expense', occurred_at: d(10, 3), original_amount: 10, currency: 'CAD', exchange_rate: 13.84, base_amount_mxn: 138.4, category_id: 'fun', account_id: 'acc-cad' }),
  // Pending (future) expense is not spending yet.
  tx({ type: 'expense', occurred_at: d(10, 25), original_amount: 999, category_id: 'fun', status: 'pending' }),
  // Last month
  tx({ type: 'expense', occurred_at: d(9, 15), original_amount: 400, category_id: 'food' }),
  tx({ type: 'expense', occurred_at: d(9, 20), original_amount: 100, category_id: 'transport' }),
  tx({ type: 'income', occurred_at: d(9, 30), original_amount: 5000 }),
  tx({ type: 'income', occurred_at: d(10, 1, 9), original_amount: 5000 }),
  // Transfer debit -> card, never counted as spending.
  tx({ type: 'transfer', direction: 'out', occurred_at: d(10, 5), original_amount: 1000, transfer_pair_id: 'p1' }),
  tx({ type: 'transfer', direction: 'in', occurred_at: d(10, 5), original_amount: 1000, transfer_pair_id: 'p1', account_id: 'acc-card' }),
];

describe('finance totals', () => {
  it('signs amounts by their effect on the account', () => {
    expect(signedAmount({ type: 'expense', direction: null, original_amount: '10.5' })).toBe(-10.5);
    expect(signedAmount({ type: 'income', direction: null, original_amount: 10 })).toBe(10);
    expect(signedAmount({ type: 'transfer', direction: 'out', original_amount: 10 })).toBe(-10);
    expect(signedAmount({ type: 'transfer', direction: 'in', original_amount: 10 })).toBe(10);
  });

  it('sums applied expenses in MXN and ignores transfers and pending rows', () => {
    expect(totalExpenses(txs, new Date(2026, 10, 1), new Date(2026, 11, 1))).toBe(300 + 200 + 150 + 50 + 25 + 138.4);
  });

  it('computes account balances in the account currency', () => {
    const debit = account({ id: 'acc-debit', initial_balance: '10000' });
    // 10000 - (300+200+150+50+25+400+100) + 10000 income - 1000 transfer out
    expect(accountBalance(debit, txs)).toBe(10000 - 1225 + 10000 - 1000);
    expect(accountBalance(account({ id: 'acc-card', type: 'credit_card' }), txs)).toBe(1000);
    expect(accountBalance(account({ id: 'acc-cad', currency: 'CAD', initial_balance: 100 }), txs)).toBe(90);
  });

  it('moves an MXN account by the MXN value of a foreign-currency purchase', () => {
    const card = account({ id: 'mxn-card', type: 'credit_card' });
    const usd = tx({ type: 'expense', occurred_at: d(10, 4), account_id: 'mxn-card', original_amount: 10, currency: 'USD', exchange_rate: 18, base_amount_mxn: 180 });
    expect(accountBalance(card, [usd])).toBe(-180);
  });

  it('converts foreign balances at current rates and skips archived/excluded accounts', () => {
    const accs = [
      account({ id: 'a' }),
      account({ id: 'b', currency: 'CAD' }),
      account({ id: 'c', archived: true }),
      account({ id: 'd', include_in_total: false }),
    ];
    const bal = new Map([['a', 1000], ['b', 100], ['c', 5000], ['d', 5000]]);
    expect(totalBalanceMXN(accs, bal, { CAD: 14 })).toBe(2400);
  });

  it('splits balances into assets, liabilities and total like Money Manager', () => {
    const accs = [
      account({ id: 'debit' }),
      account({ id: 'oro', type: 'credit_card' }),
      account({ id: 'azul', type: 'credit_card' }),
      account({ id: 'td', currency: 'CAD', include_in_total: false }),
      account({ id: 'old', archived: true }),
      account({ id: 'cad', currency: 'CAD' }),
    ];
    const bal = new Map([['debit', 103091.96], ['oro', -48722.03], ['azul', -5197.75], ['td', 1.3], ['old', -999], ['cad', 10]]);
    expect(balanceSummary(accs, bal, { CAD: 13.84 })).toEqual({ assets: 103230.36, liabilities: -53919.78, total: 49310.58 });
  });

  it('builds the main-screen indicators', () => {
    const ind = computeIndicators({ txs, categories: cats, accounts: [], balances: new Map(), rates: {}, now: NOW, weekStartsOn: 0 });
    expect(ind.thisMonth).toBe(863.4);
    expect(ind.lastMonth).toBe(500);
    expect(ind.monthChangePct).toBe(72.68);
    // Week of Sun Nov 8 – Sat Nov 14: 200 + 150 + 50
    expect(ind.thisWeek).toBe(400);
    // Subcategory spend rolls up into its parent.
    expect(ind.top3).toEqual([
      { categoryId: 'food', amount: 500 },
      { categoryId: 'fun', amount: 188.4 },
      { categoryId: 'transport', amount: 150 },
    ]);
  });

  it('uses Monday weeks when configured', () => {
    const ind = computeIndicators({ txs, categories: cats, accounts: [], balances: new Map(), rates: {}, now: NOW, weekStartsOn: 1 });
    expect(ind.thisWeek).toBe(400); // Mon Nov 9 – Sun Nov 15
  });

  it('reports a past month with its weekly average', () => {
    const ind = computeIndicators({ txs, categories: cats, accounts: [], balances: new Map(), rates: {}, now: new Date(2026, 9, 1), weekStartsOn: 0 });
    expect(ind.thisMonth).toBe(500);
    expect(ind.weekAverage).toBe(112.9); // 500 over October's 31/7 weeks
  });

  it('builds a 12-month trend', () => {
    const t = monthlyTrend(txs, NOW);
    expect(t).toHaveLength(12);
    expect(t[11]).toEqual({ month: '2026-11', income: 5000, expense: 863.4 });
    expect(t[10]).toEqual({ month: '2026-10', income: 5000, expense: 500 });
  });

  it('compares categories month over month', () => {
    const m = monthOverMonth(txs, cats, NOW);
    expect(m.find((x) => x.categoryId === 'food')).toEqual({ categoryId: 'food', current: 500, previous: 400, pct: 25 });
    expect(m.find((x) => x.categoryId === 'fun')?.pct).toBeNull();
  });

  it('projects month-end spending from the daily average', () => {
    const p = monthProjection(txs, NOW);
    expect(p.dailyAverage).toBe(78.49); // 863.4 / 11
    expect(p.projected).toBe(2354.7); // 78.49 * 30
  });

  it('groups top notes case-insensitively', () => {
    expect(topNotes(txs, new Date(2026, 10, 1), new Date(2026, 11, 1))[0]).toEqual({ note: 'Oxxo', amount: 500, count: 2 });
  });

  it('tracks budget progress for parents and subcategories', () => {
    const p = budgetProgress(
      [
        { id: 'b1', category_id: 'food', monthly_limit_mxn: '1000' },
        { id: 'b2', category_id: 'groceries', monthly_limit_mxn: 200 },
      ],
      txs,
      cats,
      NOW,
    );
    expect(p[0]).toMatchObject({ spent: 500, limit: 1000, ratio: 0.5 });
    expect(p[1]).toMatchObject({ spent: 300, limit: 200, ratio: 1.5 });
  });

  it('spreads spending by weekday', () => {
    const w = weekdaySpending(txs, new Date(2026, 10, 1), new Date(2026, 10, 15));
    expect(w[0]).toEqual({ weekday: 0, total: 25, average: 12.5 }); // Sundays Nov 1, 8
    expect(w[1].total).toBe(500); // Mondays Nov 2, 9
    expect(w[2].total).toBe(288.4); // Tuesdays Nov 3, 10
  });
});

