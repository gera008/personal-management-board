import type { Recurrence } from '@shared/recurrence';

export type { Recurrence } from '@shared/recurrence';

// Row shapes as stored in Supabase. Numeric columns arrive as strings from
// PostgREST, so money fields are typed `number | string` and parsed with num().

export type Currency = 'MXN' | 'USD' | 'CAD';
export const CURRENCIES: Currency[] = ['MXN', 'USD', 'CAD'];

export type Numeric = number | string;
export const num = (v: Numeric | null | undefined): number => (v == null ? 0 : typeof v === 'number' ? v : Number(v));

export interface Profile {
  user_id: string;
  language: 'en' | 'es';
  default_currency: Currency;
  theme: 'light' | 'dark' | 'system';
  timezone: string;
  week_start: 0 | 1;
  digest_time: string;
  dashboard_layout: WidgetSetting[];
}

export type WidgetId = 'month_calendar' | 'week_detail' | 'tasks' | 'finance_summary' | 'habits_today' | 'habit_heatmap';
export interface WidgetSetting {
  id: WidgetId;
  visible: boolean;
}

export interface CurrencyRate {
  currency: Currency;
  rate_to_mxn: Numeric;
}

export interface CalendarEvent {
  id: string;
  title: string;
  notes: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  reminder_minutes: number | null;
  recurrence: Recurrence | null;
  exdates: string[];
  recurrence_parent_id: string | null;
}

export interface TaskList {
  id: string;
  name: string;
  color: string;
  icon: string;
  position: number;
}

export interface Subtask {
  id: string;
  task_id: string;
  title: string;
  position: number;
  completed_at: string | null;
}

export interface Task {
  id: string;
  list_id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  due_time: string | null;
  priority: 0 | 1 | 2 | 3;
  tags: string[];
  position: number;
  completed_at: string | null;
  reminder_at: string | null;
  /** Rule plus `anchor`, the first due date, so monthly days don't drift. */
  recurrence: (Recurrence & { anchor?: string }) | null;
  recurrence_index: number;
  recurrence_parent_id: string | null;
  subtasks?: Subtask[];
}

export type AccountType = 'debit' | 'credit_card' | 'cash' | 'savings' | 'investment' | 'other';
export const ACCOUNT_TYPES: AccountType[] = ['debit', 'credit_card', 'cash', 'savings', 'investment', 'other'];

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: Currency;
  initial_balance: Numeric;
  cutoff_day: number | null;
  payment_day: number | null;
  include_in_total: boolean;
  position: number;
  archived: boolean;
}

export type CategoryType = 'expense' | 'income';
export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  parent_id: string | null;
  position: number;
  archived: boolean;
}

export type TxType = 'expense' | 'income' | 'transfer';
export interface Transaction {
  id: string;
  type: TxType;
  direction: 'in' | 'out' | null;
  occurred_at: string;
  account_id: string;
  category_id: string | null;
  subcategory_id: string | null;
  note: string | null;
  description: string | null;
  original_amount: Numeric;
  currency: Currency;
  exchange_rate: Numeric;
  base_amount_mxn: Numeric;
  status: 'applied' | 'pending';
  series_id: string | null;
  series_index: number | null;
  transfer_pair_id: string | null;
  paid_for_others: boolean;
}

export type Frequency = 'weekly' | 'monthly' | 'yearly';
export interface RecurringSeries {
  id: string;
  kind: 'installment' | 'subscription';
  type: 'expense' | 'income';
  amount: Numeric;
  currency: Currency;
  exchange_rate: Numeric;
  account_id: string;
  category_id: string | null;
  subcategory_id: string | null;
  note: string | null;
  description: string | null;
  frequency: Frequency;
  start_date: string;
  total_count: number | null;
  final_amount: Numeric | null;
  end_date: string | null;
  occurrences_created: number;
  next_run_date: string | null;
  status: 'active' | 'ended' | 'cancelled';
}

export interface Budget {
  id: string;
  category_id: string;
  monthly_limit_mxn: Numeric;
}

export type HabitFrequency =
  | { type: 'daily' }
  | { type: 'weekdays'; days: number[] }
  | { type: 'times_per_week'; n: number }
  | { type: 'every_n_days'; n: number };

export interface Habit {
  id: string;
  name: string;
  kind: 'good' | 'bad';
  type: 'boolean' | 'numeric';
  unit: string | null;
  target_value: Numeric | null;
  frequency: HabitFrequency;
  goal_days: number | null;
  color: string;
  tags: string[];
  reminder_time: string | null;
  start_date: string;
  position: number;
  archived: boolean;
}

export interface HabitLog {
  id: string;
  habit_id: string;
  date: string;
  value: Numeric;
  note: string | null;
  is_slip: boolean;
}
