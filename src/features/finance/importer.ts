import { supabase, unwrap } from '@/lib/supabase';
import type { ImportPlan, PlannedTransfer, PlannedTx, Resolution } from '@/domain/import/moneyManager';
import { resolvePlan } from '@/domain/import/moneyManager';
import type { Account, Category } from '@/domain/types';

const BATCH = 500;
const norm = (s: string) => s.trim().toLocaleLowerCase('es');

/** Deterministic UUID from an import hash, so re-imports reuse the same transfer pair id. */
function pairUuid(hash: string) {
  const hex = (hash.replace(/[^0-9a-f]/g, '') + '0'.repeat(32)).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export interface ImportResult {
  inserted: number;
  skippedExisting: number;
  accountsCreated: number;
  categoriesCreated: number;
}

/**
 * Writes the plan. Accounts and categories are matched by name (case-insensitive)
 * and created when missing; transactions upsert on (user_id, import_hash) and
 * ignore duplicates, so importing the same file twice adds nothing.
 */
export async function commitImport(plan: ImportPlan, choices: Record<string, Resolution>, onProgress?: (done: number, total: number) => void): Promise<ImportResult> {
  const { transactions, transfers } = resolvePlan(plan, choices);

  // Accounts
  const existingAccounts = unwrap(await supabase.from('accounts').select('id,name')) as Pick<Account, 'id' | 'name'>[];
  const accountId = new Map(existingAccounts.map((a) => [norm(a.name), a.id]));
  const missingAccounts = plan.accounts.filter((a) => !accountId.has(norm(a.name)));
  if (missingAccounts.length) {
    const created = unwrap(
      await supabase
        .from('accounts')
        .insert(missingAccounts.map((a, i) => ({ name: a.name, type: a.type, currency: a.currency, initial_balance: 0, position: existingAccounts.length + i })))
        .select('id,name'),
    ) as Pick<Account, 'id' | 'name'>[];
    for (const a of created) accountId.set(norm(a.name), a.id);
  }

  // Categories (parents, then subcategories)
  let categoriesCreated = 0;
  const existingCats = unwrap(await supabase.from('categories').select('id,name,type,parent_id')) as Pick<Category, 'id' | 'name' | 'type' | 'parent_id'>[];
  const catKey = (type: string, parent: string | null, name: string) => `${type}|${parent ?? ''}|${norm(name)}`;
  const catId = new Map(existingCats.map((c) => [catKey(c.type, c.parent_id, c.name), c.id]));
  for (const c of plan.categories) {
    let pid = catId.get(catKey(c.type, null, c.name));
    if (!pid) {
      pid = (unwrap(await supabase.from('categories').insert({ name: c.name, type: c.type }).select('id').single()) as { id: string }).id;
      catId.set(catKey(c.type, null, c.name), pid);
      categoriesCreated++;
    }
    const missingSubs = c.subcategories.filter((s) => !catId.has(catKey(c.type, pid!, s)));
    if (missingSubs.length) {
      const created = unwrap(await supabase.from('categories').insert(missingSubs.map((s) => ({ name: s, type: c.type, parent_id: pid }))).select('id,name')) as { id: string; name: string }[];
      for (const s of created) catId.set(catKey(c.type, pid, s.name), s.id);
      categoriesCreated += created.length;
    }
  }

  const acc = (name: string) => {
    const id = accountId.get(norm(name));
    if (!id) throw new Error(`Account not found: ${name}`);
    return id;
  };

  const txRow = (x: PlannedTx) => {
    const parent = catId.get(catKey(x.type, null, x.category)) ?? null;
    return {
      type: x.type,
      direction: null,
      occurred_at: x.occurredAt,
      account_id: acc(x.account),
      category_id: parent,
      subcategory_id: x.subcategory && parent ? catId.get(catKey(x.type, parent, x.subcategory)) ?? null : null,
      note: x.note,
      description: x.description,
      original_amount: x.amount,
      currency: x.currency,
      exchange_rate: x.rate,
      base_amount_mxn: x.mxn,
      status: x.pending ? 'pending' : 'applied',
      import_hash: x.hash,
    };
  };

  const transferRows = (x: PlannedTransfer) => {
    const pair = pairUuid(x.hash);
    const mxn = x.out.mxn;
    const side = (s: PlannedTransfer['out'], direction: 'in' | 'out') => ({
      type: 'transfer',
      direction,
      occurred_at: x.occurredAt,
      account_id: acc(s.account),
      category_id: null,
      subcategory_id: null,
      note: x.note,
      description: x.description,
      original_amount: s.amount,
      currency: s.currency,
      exchange_rate: mxn / s.amount,
      base_amount_mxn: mxn,
      status: x.pending ? 'pending' : 'applied',
      transfer_pair_id: pair,
      import_hash: `${x.hash}:${direction}`,
    });
    return [side(x.out, 'out'), side(x.in, 'in')];
  };

  const rows = [...transactions.map(txRow), ...transfers.flatMap(transferRows)];
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const res = unwrap(await supabase.from('transactions').upsert(chunk, { onConflict: 'user_id,import_hash', ignoreDuplicates: true }).select('id')) as { id: string }[];
    inserted += res.length;
    onProgress?.(Math.min(i + BATCH, rows.length), rows.length);
  }

  return { inserted, skippedExisting: rows.length - inserted, accountsCreated: missingAccounts.length, categoriesCreated };
}
