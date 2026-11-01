import { supabase, unwrap } from './supabase';

const TABLES = [
  'profiles',
  'currency_rates',
  'events',
  'task_lists',
  'tasks',
  'subtasks',
  'accounts',
  'categories',
  'transactions',
  'recurring_series',
  'budgets',
  'habits',
  'habit_logs',
] as const;

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

export async function exportAllJson() {
  const out: Record<string, unknown[]> = {};
  for (const t of TABLES) out[t] = unwrap(await supabase.from(t).select('*'));
  download(`personal-hub-${stamp()}.json`, JSON.stringify(out, null, 2), 'application/json');
}

const csvCell = (v: unknown) => {
  if (v == null) return '';
  const s = Array.isArray(v) || typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: Record<string, unknown>[], columns: string[]) {
  return [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\n');
}

/** Transactions as CSV with account and category names resolved. */
export async function exportTransactionsCsv() {
  const [txs, accounts, categories] = await Promise.all([
    supabase.from('transactions').select('*').order('occurred_at', { ascending: false }).then(unwrap),
    supabase.from('accounts').select('id,name').then(unwrap),
    supabase.from('categories').select('id,name').then(unwrap),
  ]);
  const acc = new Map((accounts as { id: string; name: string }[]).map((a) => [a.id, a.name]));
  const cat = new Map((categories as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const rows = (txs as Record<string, unknown>[]).map((t) => ({
    date: t.occurred_at,
    type: t.type,
    direction: t.direction,
    account: acc.get(t.account_id as string),
    category: t.category_id ? cat.get(t.category_id as string) : '',
    subcategory: t.subcategory_id ? cat.get(t.subcategory_id as string) : '',
    note: t.note,
    description: t.description,
    amount: t.original_amount,
    currency: t.currency,
    exchange_rate: t.exchange_rate,
    amount_mxn: t.base_amount_mxn,
    status: t.status,
    transfer_id: t.transfer_pair_id,
  }));
  const cols = ['date', 'type', 'direction', 'account', 'category', 'subcategory', 'note', 'description', 'amount', 'currency', 'exchange_rate', 'amount_mxn', 'status', 'transfer_id'];
  download(`transactions-${stamp()}.csv`, toCsv(rows, cols), 'text/csv');
}
