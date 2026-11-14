import { useQuery } from '@tanstack/react-query';
import { addMonths, isSameMonth, startOfMonth, subMonths } from 'date-fns';
import { supabase, unwrap } from '@/lib/supabase';
import { useRows } from '@/lib/data';
import { useProfile } from '@/lib/profile';
import { computeIndicators, signedAmount } from '@/domain/finance/totals';
import type { Account, AccountValuation, Category, Transaction } from '@/domain/types';

const PAGE = 1000; // PostgREST max rows per request

/** Fetches every matching transaction, paging past the 1000-row limit. */
export async function fetchTransactions(from?: Date, to?: Date): Promise<Transaction[]> {
  const out: Transaction[] = [];
  for (let page = 0; ; page++) {
    let q = supabase.from('transactions').select('*').order('occurred_at', { ascending: false }).order('id');
    if (from) q = q.gte('occurred_at', from.toISOString());
    if (to) q = q.lt('occurred_at', to.toISOString());
    const rows = unwrap(await q.range(page * PAGE, page * PAGE + PAGE - 1)) as Transaction[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** Transactions since a date (or all of them), optionally before another; cached under the transactions key. */
export function useTransactions(from?: Date, to?: Date) {
  return useQuery({
    queryKey: ['transactions', from?.toISOString() ?? 'all', to?.toISOString() ?? 'open'],
    queryFn: () => fetchTransactions(from, to),
  });
}

export function useAccounts() {
  return useRows('accounts', { filter: (q) => q.order('position').order('name') });
}

export function useCategories() {
  const q = useRows('categories', { filter: (x) => x.order('position').order('name') });
  const list = q.data ?? [];
  return {
    ...q,
    list,
    byId: new Map(list.map((c) => [c.id, c])),
    parents: (type: Category['type']) => list.filter((c) => c.type === type && !c.parent_id && !c.archived),
    children: (parentId: string) => list.filter((c) => c.parent_id === parentId && !c.archived),
  };
}

/** Balances from the account_balances view, keyed by account id. */
export function useBalances() {
  return useQuery({
    queryKey: ['accounts', 'balances'],
    queryFn: async () => {
      const rows = unwrap(await supabase.from('account_balances').select('account_id,balance')) as { account_id: string; balance: string }[];
      return new Map(rows.map((r) => [r.account_id, Number(r.balance)]));
    },
  });
}

export interface BalanceDetail {
  /** What the account is worth now (from the latest valuation when there is one). */
  balance: number;
  /** Initial balance + applied transactions: for an investment, the net amount contributed. */
  book: number;
  lastValue: number | null;
  lastValuedAt: string | null;
}

/** Every column of the account_balances view, keyed by account id. */
export function useBalanceDetails() {
  return useQuery({
    queryKey: ['accounts', 'balance-details'],
    queryFn: async () => {
      const rows = unwrap(await supabase.from('account_balances').select('account_id,balance,book_balance,last_value,last_valued_at')) as {
        account_id: string;
        balance: string;
        book_balance: string;
        last_value: string | null;
        last_valued_at: string | null;
      }[];
      return new Map<string, BalanceDetail>(
        rows.map((r) => [
          r.account_id,
          { balance: Number(r.balance), book: Number(r.book_balance), lastValue: r.last_value == null ? null : Number(r.last_value), lastValuedAt: r.last_valued_at },
        ]),
      );
    },
  });
}

/** An account's valuations, newest first. */
export function useValuations(accountId: string) {
  return useQuery({
    queryKey: ['account_valuations', accountId],
    enabled: !!accountId,
    queryFn: async () =>
      unwrap(await supabase.from('account_valuations').select('*').eq('account_id', accountId).order('valued_at', { ascending: false })) as AccountValuation[],
  });
}

/** Every applied transaction of one account (the fields needed for totals), for its whole history. */
export function useAccountFlows(accountId: string) {
  return useQuery({
    queryKey: ['transactions', 'flows', accountId],
    enabled: !!accountId,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('transactions')
          .select('account_id,type,direction,original_amount,currency,base_amount_mxn,status,occurred_at')
          .eq('account_id', accountId)
          .eq('status', 'applied')
          .order('occurred_at'),
      ) as Pick<Transaction, 'account_id' | 'type' | 'direction' | 'original_amount' | 'currency' | 'base_amount_mxn' | 'status' | 'occurred_at'>[],
  });
}

/**
 * Net effect of pending (future) transactions per account, in the account's currency.
 * Balance + this = what the account will be once everything scheduled is applied
 * (e.g. a credit card's total debt including future installments).
 */
export function usePendingByAccount() {
  const accounts = useAccounts();
  return useQuery({
    queryKey: ['transactions', 'pending-by-account'],
    enabled: !!accounts.data,
    queryFn: async () => {
      const rows = unwrap(
        await supabase.from('transactions').select('account_id,type,direction,original_amount,currency,base_amount_mxn').eq('status', 'pending'),
      ) as Pick<Transaction, 'account_id' | 'type' | 'direction' | 'original_amount' | 'currency' | 'base_amount_mxn'>[];
      const currency = new Map((accounts.data ?? []).map((a) => [a.id, a.currency]));
      const m = new Map<string, number>();
      for (const r of rows) m.set(r.account_id, (m.get(r.account_id) ?? 0) + signedAmount(r, currency.get(r.account_id)));
      return m;
    },
  });
}

/** Spending indicators for a month (the current one by default) and the month before it. */
export function useIndicators(month?: Date) {
  const { rates, weekStartsOn } = useProfile();
  const current = !month || isSameMonth(month, new Date());
  const mStart = startOfMonth(month ?? new Date());
  const from = subMonths(mStart, 1);
  // The current month stays open-ended so this week's spending is complete across a month change.
  const txs = useTransactions(from, current ? undefined : addMonths(mStart, 1));
  const accounts = useAccounts();
  const categories = useCategories();
  const balances = useBalances();
  const pending = usePendingByAccount();
  const ready = txs.data && accounts.data && balances.data && categories.data && pending.data;
  // Total balance counts every debt, including pending installments.
  const withPending = ready ? new Map([...balances.data!].map(([id, b]) => [id, b + (pending.data!.get(id) ?? 0)])) : new Map<string, number>();
  return {
    isLoading: !ready,
    current,
    categories,
    accounts: accounts.data ?? [],
    balances: balances.data ?? new Map<string, number>(),
    indicators: ready
      ? computeIndicators({
          txs: txs.data!,
          categories: categories.byId,
          accounts: accounts.data as Account[],
          balances: withPending,
          rates,
          now: current ? new Date() : mStart,
          weekStartsOn,
        })
      : null,
  };
}

export const categoryName = (byId: Map<string, Category>, id: string | null | undefined, fallback = '—') => (id ? byId.get(id)?.name ?? fallback : fallback);
