import { useQuery } from '@tanstack/react-query';
import { startOfMonth, subMonths } from 'date-fns';
import { supabase, unwrap } from '@/lib/supabase';
import { useRows } from '@/lib/data';
import { useProfile } from '@/lib/profile';
import { computeIndicators, signedAmount } from '@/domain/finance/totals';
import type { Account, Category, Transaction } from '@/domain/types';

const PAGE = 1000; // PostgREST max rows per request

/** Fetches every matching transaction, paging past the 1000-row limit. */
export async function fetchTransactions(from?: Date): Promise<Transaction[]> {
  const out: Transaction[] = [];
  for (let page = 0; ; page++) {
    let q = supabase.from('transactions').select('*').order('occurred_at', { ascending: false }).order('id');
    if (from) q = q.gte('occurred_at', from.toISOString());
    const rows = unwrap(await q.range(page * PAGE, page * PAGE + PAGE - 1)) as Transaction[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** Transactions since a date (or all of them), cached under the transactions key. */
export function useTransactions(from?: Date) {
  return useQuery({
    queryKey: ['transactions', from?.toISOString() ?? 'all'],
    queryFn: () => fetchTransactions(from),
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

export function useIndicators() {
  const { rates, weekStartsOn } = useProfile();
  const from = startOfMonth(subMonths(new Date(), 1));
  const txs = useTransactions(from);
  const accounts = useAccounts();
  const categories = useCategories();
  const balances = useBalances();
  const ready = txs.data && accounts.data && balances.data && categories.data;
  return {
    isLoading: !ready,
    categories,
    accounts: accounts.data ?? [],
    balances: balances.data ?? new Map<string, number>(),
    indicators: ready
      ? computeIndicators({
          txs: txs.data!,
          categories: categories.byId,
          accounts: accounts.data as Account[],
          balances: balances.data!,
          rates,
          now: new Date(),
          weekStartsOn,
        })
      : null,
  };
}

export const categoryName = (byId: Map<string, Category>, id: string | null | undefined, fallback = '—') => (id ? byId.get(id)?.name ?? fallback : fallback);
