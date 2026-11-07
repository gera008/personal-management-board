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
  weeklySpending,
  spendingBySubcategory,
  periodSummary,
  dailySpending,
  categoryBreakdown,
  previousPeriod,
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

  it('splits balances into assets, liabilities and total', () => {
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


describe('weekly and subcategory spending', () => {
  const at = (m: number, day: number) => new Date(2026, m, day, 12).toISOString();
  const list = [
    tx({ type: 'expense', original_amount: 100, occurred_at: at(10, 2), category_id: 'food', subcategory_id: 'rest' }), // Mon Nov 2
    tx({ type: 'expense', original_amount: 50, occurred_at: at(10, 7), category_id: 'food', subcategory_id: 'rest' }), // Sat Nov 7
    tx({ type: 'expense', original_amount: 30, occurred_at: at(10, 8), category_id: 'food' }), // Sun Nov 8
    tx({ type: 'expense', original_amount: 999, occurred_at: at(10, 9), category_id: 'food', status: 'pending' }),
    tx({ type: 'income', original_amount: 500, occurred_at: at(10, 9) }),
  ];

  it('totals each week from the configured week start', () => {
    const weeks = weeklySpending(list, new Date(2026, 10, 1), new Date(2026, 10, 15), 0);
    expect(weeks.map((w) => [w.start.getDate(), w.total])).toEqual([
      [1, 150],
      [8, 30],
    ]);
    const mondays = weeklySpending(list, new Date(2026, 10, 1), new Date(2026, 10, 15), 1);
    expect(mondays.map((w) => [w.start.getDate(), w.total])).toEqual([
      [26, 0],
      [2, 180],
      [9, 0],
    ]);
  });

  it('groups by subcategory, falling back to the category', () => {
    expect(spendingBySubcategory(list, new Date(2026, 10, 1), new Date(2026, 11, 1))).toEqual([
      { categoryId: 'rest', amount: 150, count: 2 },
      { categoryId: 'food', amount: 30, count: 1 },
    ]);
  });
});

describe('analytics periods', () => {
  const at = (m: number, day: number) => new Date(2026, m, day, 12).toISOString();
  const cats = new Map([
    ['food', category({ id: 'food', name: 'Food' })],
    ['rest', category({ id: 'rest', name: 'Restaurants', parent_id: 'food' })],
    ['fun', category({ id: 'fun', name: 'Fun' })],
  ]);
  const list = [
    tx({ type: 'expense', original_amount: 100, occurred_at: at(10, 2), category_id: 'food', subcategory_id: 'rest', paid_for_others: true }),
    tx({ type: 'expense', original_amount: 40, occurred_at: at(10, 2), category_id: 'food' }),
    tx({ type: 'expense', original_amount: 60, occurred_at: at(10, 4), category_id: 'fun', series_id: 's1' }),
    tx({ type: 'expense', original_amount: 80, occurred_at: at(9, 20), category_id: 'food' }),
    tx({ type: 'income', original_amount: 1000, occurred_at: at(10, 1) }),
    tx({ type: 'expense', original_amount: 999, occurred_at: at(10, 20), status: 'pending' }),
  ];
  const nov = [new Date(2026, 10, 1), new Date(2026, 11, 1)] as const;

  it('summarises how much', () => {
    expect(periodSummary(list, ...nov)).toEqual({ expense: 200, income: 1000, net: 800, savingsRate: 80, fixed: 60, variable: 140, paidForOthers: 100 });
  });

  it('totals each day', () => {
    const days = dailySpending(list, new Date(2026, 10, 1), new Date(2026, 10, 5));
    expect(days.map((d) => d.total)).toEqual([0, 140, 0, 60]);
  });

  it('breaks categories into subcategories against the previous period', () => {
    const b = categoryBreakdown(list, cats, ...nov, previousPeriod('month', ...nov));
    expect(b[0]).toEqual({
      categoryId: 'food',
      amount: 140,
      previous: 80,
      pct: 75,
      subs: [
        { categoryId: 'rest', amount: 100, count: 1 },
        { categoryId: 'food', amount: 40, count: 1 },
      ],
    });
    expect(b[1]).toMatchObject({ categoryId: 'fun', amount: 60, previous: 0, pct: null });
    expect(categoryBreakdown(list, cats, ...nov)[0].previous).toBeNull();
  });

  it('finds the previous period', () => {
    expect(previousPeriod('custom', new Date(2026, 10, 10), new Date(2026, 10, 20))).toEqual({ from: new Date(2026, 9, 31), to: new Date(2026, 10, 10) });
    expect(previousPeriod('year', new Date(2026, 0, 1), new Date(2027, 0, 1)).from).toEqual(new Date(2025, 0, 1));
  });
});

describe('budgets with an adjustable weekly allowance', () => {
  const at = (m: number, day: number) => new Date(2026, m, day, 12).toISOString();
  const cats = new Map([
    ['food', category({ id: 'food' })],
    ['fun', category({ id: 'fun' })],
  ]);
  // November 2026: 30 days, starts on a Sunday.
  const list = [
    tx({ type: 'expense', original_amount: 3000, occurred_at: at(10, 2), category_id: 'food' }), // week 1
    tx({ type: 'expense', original_amount: 500, occurred_at: at(10, 9), category_id: 'fun' }), // week 2
    tx({ type: 'expense', original_amount: 200, occurred_at: at(10, 10), category_id: 'food' }), // week 2
  ];
  const general = { id: 'g', category_id: null, monthly_limit_mxn: 9000 };
  const food = { id: 'f', category_id: 'food', monthly_limit_mxn: 9000 };

  it('a general budget counts every expense', () => {
    const [g] = budgetProgress([general], list, cats, new Date(2026, 10, 11, 12));
    expect(g.spent).toBe(3700);
  });

  it('spreads what is left of the month over the remaining days', () => {
    // Week of Nov 8–14: before it 3000 spent, 6000 left for 23 days -> 7 days get 1826.09.
    const [g, f] = budgetProgress([general, food], list, cats, new Date(2026, 10, 11, 12));
    expect(g.week.limit).toBe(1826.09);
    expect(g.week.spent).toBe(700);
    expect(f.week.spent).toBe(200);
    // The first week has the whole month ahead: 9000 * 7 / 30.
    expect(budgetProgress([general], list, cats, new Date(2026, 10, 3, 12))[0].week.limit).toBe(2100);
  });

  it('clips the last week to the month', () => {
    // Nov 29 (Sun) – Nov 30: 2 days left of the month.
    const [g] = budgetProgress([general], list, cats, new Date(2026, 10, 30, 12));
    expect(g.week.from).toEqual(new Date(2026, 10, 29));
    expect(g.week.to).toEqual(new Date(2026, 11, 1));
    expect(g.week.limit).toBe(5300); // all that's left
  });
});
