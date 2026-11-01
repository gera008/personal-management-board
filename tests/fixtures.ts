import type { Account, Category, Habit, HabitLog, Transaction } from '../src/domain/types';

let seq = 0;
const id = () => `id-${++seq}`;

export function tx(p: Partial<Transaction> & Pick<Transaction, 'type' | 'occurred_at'>): Transaction {
  const amount = p.original_amount ?? 100;
  return {
    id: id(),
    direction: null,
    account_id: 'acc-debit',
    category_id: null,
    subcategory_id: null,
    note: null,
    description: null,
    original_amount: amount,
    currency: 'MXN',
    exchange_rate: 1,
    base_amount_mxn: p.base_amount_mxn ?? amount,
    status: 'applied',
    series_id: null,
    series_index: null,
    transfer_pair_id: null,
    ...p,
  };
}

export function account(p: Partial<Account> & Pick<Account, 'id'>): Account {
  return {
    name: p.id,
    type: 'debit',
    currency: 'MXN',
    initial_balance: 0,
    cutoff_day: null,
    payment_day: null,
    include_in_total: true,
    position: 0,
    archived: false,
    ...p,
  };
}

export function category(p: Partial<Category> & Pick<Category, 'id'>): Category {
  return { name: p.id, type: 'expense', parent_id: null, position: 0, archived: false, ...p };
}

export function habit(p: Partial<Habit>): Habit {
  return {
    id: 'h1',
    name: 'Habit',
    kind: 'good',
    type: 'boolean',
    unit: null,
    target_value: null,
    frequency: { type: 'daily' },
    goal_days: null,
    color: '#8b5cf6',
    tags: [],
    reminder_time: null,
    start_date: '2026-10-01',
    position: 0,
    archived: false,
    ...p,
  };
}

export function logs(habitId: string, dates: string[], extra: Partial<HabitLog> = {}): HabitLog[] {
  return dates.map((date) => ({ id: id(), habit_id: habitId, date, value: 1, note: null, is_slip: false, ...extra }));
}
