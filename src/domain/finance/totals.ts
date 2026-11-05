import {
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  differenceInCalendarWeeks,
  endOfMonth,
  format,
  getDaysInMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import type { Account, Budget, Category, Currency, Transaction } from '../types';
import { num } from '../types';

export type Rates = Partial<Record<Currency, number>>;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Amount signed by its effect on the balance, in the account's currency. A
 * transaction in another currency on an MXN account counts at its MXN value.
 * Mirrors the account_balances view.
 */
export function signedAmount(
  tx: Pick<Transaction, 'type' | 'direction' | 'original_amount'> & Partial<Pick<Transaction, 'currency' | 'base_amount_mxn'>>,
  accountCurrency?: Currency,
): number {
  const a = accountCurrency === 'MXN' && tx.currency && tx.currency !== 'MXN' ? num(tx.base_amount_mxn) : num(tx.original_amount);
  return tx.type === 'income' || tx.direction === 'in' ? a : -a;
}

const inRange = (tx: Transaction, from: Date, to: Date) => {
  const t = new Date(tx.occurred_at).getTime();
  return t >= from.getTime() && t < to.getTime();
};

const isApplied = (tx: Transaction) => tx.status === 'applied';

/** Sum of applied expenses (MXN) in [from, to). Transfers never count as spending. */
export function totalExpenses(txs: Transaction[], from: Date, to: Date): number {
  return round2(
    txs.filter((t) => t.type === 'expense' && isApplied(t) && inRange(t, from, to)).reduce((s, t) => s + num(t.base_amount_mxn), 0),
  );
}

export function totalIncome(txs: Transaction[], from: Date, to: Date): number {
  return round2(
    txs.filter((t) => t.type === 'income' && isApplied(t) && inRange(t, from, to)).reduce((s, t) => s + num(t.base_amount_mxn), 0),
  );
}

export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return round2(((current - previous) / previous) * 100);
}

/** Top-level category of a transaction (the parent if it has a subcategory chain). */
export function topCategoryId(tx: Transaction, categories: Map<string, Category>): string | null {
  if (!tx.category_id) return null;
  const c = categories.get(tx.category_id);
  return c?.parent_id ?? tx.category_id;
}

export interface CategoryAmount {
  categoryId: string | null;
  amount: number;
}

export function spendingByCategory(
  txs: Transaction[],
  categories: Map<string, Category>,
  from: Date,
  to: Date,
): CategoryAmount[] {
  const m = new Map<string | null, number>();
  for (const t of txs) {
    if (t.type !== 'expense' || !isApplied(t) || !inRange(t, from, to)) continue;
    const id = topCategoryId(t, categories);
    m.set(id, (m.get(id) ?? 0) + num(t.base_amount_mxn));
  }
  return [...m.entries()].map(([categoryId, amount]) => ({ categoryId, amount: round2(amount) })).sort((a, b) => b.amount - a.amount);
}

export interface Indicators {
  thisMonth: number;
  lastMonth: number;
  monthChangePct: number | null;
  thisWeek: number;
  /** The month's spending spread evenly over its weeks (for past months, where "this week" means nothing). */
  weekAverage: number;
  top3: CategoryAmount[];
  totalBalance: number;
}

export function accountBalance(account: Account, txs: Transaction[]): number {
  return round2(
    num(account.initial_balance) +
      txs.filter((t) => t.account_id === account.id && isApplied(t)).reduce((s, t) => s + signedAmount(t, account.currency), 0),
  );
}

/** Converts each account balance to MXN with today's rate and sums the ones included in totals. */
export function totalBalanceMXN(accounts: Account[], balances: Map<string, number>, rates: Rates): number {
  return round2(
    accounts
      .filter((a) => !a.archived && a.include_in_total)
      .reduce((s, a) => s + (balances.get(a.id) ?? 0) * (a.currency === 'MXN' ? 1 : rates[a.currency] ?? 0), 0),
  );
}

export interface BalanceSummary {
  assets: number;
  liabilities: number;
  total: number;
}

/**
 * Money Manager style summary in MXN: accounts with a positive balance add to
 * assets, negative ones (credit cards, overdrafts) to liabilities. Only
 * active accounts included in totals count.
 */
export function balanceSummary(accounts: Account[], balances: Map<string, number>, rates: Rates): BalanceSummary {
  let assets = 0;
  let liabilities = 0;
  for (const a of accounts) {
    if (a.archived || !a.include_in_total) continue;
    const mxn = (balances.get(a.id) ?? 0) * (a.currency === 'MXN' ? 1 : rates[a.currency] ?? 0);
    if (mxn >= 0) assets += mxn;
    else liabilities += mxn;
  }
  return { assets: round2(assets), liabilities: round2(liabilities), total: round2(assets + liabilities) };
}

export function computeIndicators(opts: {
  txs: Transaction[];
  categories: Map<string, Category>;
  accounts: Account[];
  balances: Map<string, number>;
  rates: Rates;
  now: Date;
  weekStartsOn: 0 | 1;
}): Indicators {
  const { txs, categories, now } = opts;
  const mStart = startOfMonth(now);
  const mEnd = addMonths(mStart, 1);
  const prevStart = subMonths(mStart, 1);
  const wStart = startOfWeek(now, { weekStartsOn: opts.weekStartsOn });
  const thisMonth = totalExpenses(txs, mStart, mEnd);
  const lastMonth = totalExpenses(txs, prevStart, mStart);
  return {
    thisMonth,
    lastMonth,
    monthChangePct: pctChange(thisMonth, lastMonth),
    thisWeek: totalExpenses(txs, wStart, new Date(wStart.getTime() + 7 * 86400000)),
    weekAverage: round2(thisMonth / (getDaysInMonth(mStart) / 7)),
    top3: spendingByCategory(txs, categories, mStart, mEnd).slice(0, 3),
    totalBalance: totalBalanceMXN(opts.accounts, opts.balances, opts.rates),
  };
}

export interface MonthPoint {
  month: string; // yyyy-MM
  income: number;
  expense: number;
}

export function monthlyTrend(txs: Transaction[], now: Date, months = 12): MonthPoint[] {
  const out: MonthPoint[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const s = startOfMonth(subMonths(now, i));
    const e = addMonths(s, 1);
    out.push({ month: format(s, 'yyyy-MM'), income: totalIncome(txs, s, e), expense: totalExpenses(txs, s, e) });
  }
  return out;
}

export interface CategoryComparison {
  categoryId: string | null;
  current: number;
  previous: number;
  pct: number | null;
}

export function monthOverMonth(txs: Transaction[], categories: Map<string, Category>, now: Date): CategoryComparison[] {
  const s = startOfMonth(now);
  const cur = spendingByCategory(txs, categories, s, addMonths(s, 1));
  const prev = spendingByCategory(txs, categories, subMonths(s, 1), s);
  const ids = new Set([...cur, ...prev].map((c) => c.categoryId));
  return [...ids]
    .map((id) => {
      const current = cur.find((c) => c.categoryId === id)?.amount ?? 0;
      const previous = prev.find((c) => c.categoryId === id)?.amount ?? 0;
      return { categoryId: id, current, previous, pct: pctChange(current, previous) };
    })
    .sort((a, b) => b.current - a.current);
}

/** Average daily spending so far this month and a straight-line end-of-month projection. */
export function monthProjection(txs: Transaction[], now: Date): { spent: number; dailyAverage: number; projected: number } {
  const s = startOfMonth(now);
  const spent = totalExpenses(txs, s, addMonths(s, 1));
  const daysElapsed = differenceInCalendarDays(now, s) + 1;
  const dailyAverage = round2(spent / daysElapsed);
  return { spent, dailyAverage, projected: round2(dailyAverage * getDaysInMonth(now)) };
}

export function topNotes(txs: Transaction[], from: Date, to: Date, limit = 10): { note: string; amount: number; count: number }[] {
  const m = new Map<string, { note: string; amount: number; count: number }>();
  for (const t of txs) {
    if (t.type !== 'expense' || !isApplied(t) || !inRange(t, from, to) || !t.note?.trim()) continue;
    const key = t.note.trim().toLowerCase();
    const e = m.get(key) ?? { note: t.note.trim(), amount: 0, count: 0 };
    e.amount += num(t.base_amount_mxn);
    e.count++;
    m.set(key, e);
  }
  return [...m.values()]
    .map((e) => ({ ...e, amount: round2(e.amount) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

/** Month-end balance per account (in its currency) and total net worth in MXN at current rates. */
export function balanceEvolution(
  accounts: Account[],
  txs: Transaction[],
  rates: Rates,
  now: Date,
  months = 12,
): { month: string; netWorth: number; byAccount: Record<string, number> }[] {
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const cutoff = endOfMonth(subMonths(now, i)).getTime();
    const upTo = txs.filter((t) => new Date(t.occurred_at).getTime() <= cutoff);
    const byAccount: Record<string, number> = {};
    const balances = new Map<string, number>();
    for (const a of accounts) {
      const b = accountBalance(a, upTo);
      byAccount[a.id] = b;
      balances.set(a.id, b);
    }
    out.push({ month: format(subMonths(now, i), 'yyyy-MM'), netWorth: totalBalanceMXN(accounts, balances, rates), byAccount });
  }
  return out;
}

export interface BudgetProgress {
  budget: Budget;
  spent: number;
  limit: number;
  ratio: number;
}

export function budgetProgress(budgets: Budget[], txs: Transaction[], categories: Map<string, Category>, now: Date): BudgetProgress[] {
  const s = startOfMonth(now);
  const spend = spendingByCategory(txs, categories, s, addMonths(s, 1));
  // A budget on a subcategory only counts that subcategory; on a parent it counts the whole tree.
  return budgets.map((b) => {
    const cat = categories.get(b.category_id);
    const spent = cat?.parent_id
      ? round2(
          txs
            .filter((t) => t.type === 'expense' && isApplied(t) && inRange(t, s, addMonths(s, 1)) && t.subcategory_id === b.category_id)
            .reduce((x, t) => x + num(t.base_amount_mxn), 0),
        )
      : spend.find((c) => c.categoryId === b.category_id)?.amount ?? 0;
    const limit = num(b.monthly_limit_mxn);
    return { budget: b, spent, limit, ratio: limit > 0 ? spent / limit : 0 };
  });
}

/** Total and average spending per weekday (0 = Sunday). */
export function weekdaySpending(txs: Transaction[], from: Date, to: Date): { weekday: number; total: number; average: number }[] {
  const totals = Array(7).fill(0);
  const days = Array(7).fill(0);
  for (let d = new Date(from); d < to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) days[d.getDay()]++;
  for (const t of txs) {
    if (t.type !== 'expense' || !isApplied(t) || !inRange(t, from, to)) continue;
    totals[new Date(t.occurred_at).getDay()] += num(t.base_amount_mxn);
  }
  return totals.map((total, weekday) => ({ weekday, total: round2(total), average: days[weekday] ? round2(total / days[weekday]) : 0 }));
}

/**
 * Spending per subcategory (falling back to the category when an expense has
 * none), largest first. `parentId` lets the screen show "Category › Sub".
 */
export function spendingBySubcategory(
  txs: Transaction[],
  from: Date,
  to: Date,
  limit = 10,
): { categoryId: string | null; amount: number; count: number }[] {
  const m = new Map<string | null, { amount: number; count: number }>();
  for (const t of txs) {
    if (t.type !== 'expense' || !isApplied(t) || !inRange(t, from, to)) continue;
    const id = t.subcategory_id ?? t.category_id;
    const e = m.get(id) ?? { amount: 0, count: 0 };
    e.amount += num(t.base_amount_mxn);
    e.count++;
    m.set(id, e);
  }
  return [...m.entries()]
    .map(([categoryId, e]) => ({ categoryId, amount: round2(e.amount), count: e.count }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

/** Expense total of every week (by the user's week start) that overlaps [from, to). */
export function weeklySpending(txs: Transaction[], from: Date, to: Date, weekStartsOn: 0 | 1): { start: Date; total: number }[] {
  const weeks: { start: Date; total: number }[] = [];
  for (let s = startOfWeek(from, { weekStartsOn }); s < to; s = addWeeks(s, 1)) weeks.push({ start: s, total: 0 });
  if (!weeks.length) return weeks;
  for (const t of txs) {
    if (t.type !== 'expense' || !isApplied(t) || !inRange(t, from, to)) continue;
    const i = differenceInCalendarWeeks(new Date(t.occurred_at), weeks[0].start, { weekStartsOn });
    if (i >= 0 && i < weeks.length) weeks[i].total += num(t.base_amount_mxn);
  }
  return weeks.map((w) => ({ ...w, total: round2(w.total) }));
}
