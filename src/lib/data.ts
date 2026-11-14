import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { supabase, unwrap } from './supabase';
import type {
  Account,
  AccountValuation,
  Budget,
  CalendarEvent,
  Category,
  CurrencyRate,
  Habit,
  HabitLog,
  Profile,
  RecurringSeries,
  Subtask,
  Task,
  TaskList,
  Transaction,
} from '@/domain/types';

/** Every table the client reads, with its row type. */
export interface Tables {
  profiles: Profile;
  currency_rates: CurrencyRate;
  events: CalendarEvent;
  task_lists: TaskList;
  tasks: Task;
  subtasks: Subtask;
  accounts: Account;
  account_valuations: AccountValuation;
  categories: Category;
  transactions: Transaction;
  recurring_series: RecurringSeries;
  budgets: Budget;
  habits: Habit;
  habit_logs: HabitLog;
}
export type TableName = keyof Tables;

// Which cached queries a write to a table should refresh.
const dependents: Partial<Record<TableName, TableName[]>> = {
  transactions: ['accounts', 'recurring_series'],
  // Balances (the accounts query key) start from the latest valuation.
  account_valuations: ['accounts'],
  recurring_series: ['transactions'],
  tasks: ['subtasks'],
  subtasks: ['tasks'],
  task_lists: ['tasks'],
  habits: ['habit_logs'],
  categories: ['budgets'],
};

export function useInvalidate() {
  const qc = useQueryClient();
  return (table: TableName) => {
    qc.invalidateQueries({ queryKey: [table] });
    for (const t of dependents[table] ?? []) qc.invalidateQueries({ queryKey: [t] });
  };
}

type Filter = (q: any) => any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Reads a whole table (RLS limits it to the user's rows), with an optional filter/order. */
export function useRows<T extends TableName>(table: T, opts: { key?: QueryKey; filter?: Filter; select?: string; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [table, ...(opts.key ?? [])],
    enabled: opts.enabled ?? true,
    queryFn: async () => {
      let q = supabase.from(table).select(opts.select ?? '*');
      if (opts.filter) q = opts.filter(q);
      return unwrap(await q) as unknown as Tables[T][];
    },
  });
}

export function useSave<T extends TableName>(table: T) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (row: Partial<Tables[T]> & { id?: string }) => {
      const { id, ...rest } = row as { id?: string } & Record<string, unknown>;
      if (id) return unwrap(await supabase.from(table).update(rest).eq('id', id).select().single()) as Tables[T];
      return unwrap(await supabase.from(table).insert(rest).select().single()) as Tables[T];
    },
    onSuccess: () => invalidate(table),
  });
}

export function useRemove(table: TableName) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await supabase.from(table).delete().eq('id', id));
    },
    onSuccess: () => invalidate(table),
  });
}

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  return unwrap(await supabase.rpc(fn, args)) as T;
}
