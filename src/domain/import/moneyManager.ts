import type { AccountType, Currency } from '../types';
import { CURRENCIES } from '../types';

/**
 * Money Manager Excel export -> import plan.
 *
 * Columns: Period, Accounts, Category, Subcategory, Note, MXN, Income/Expense,
 * Description, Amount, Currency, Accounts (duplicate, ignored).
 *
 * Quirks of the format:
 * - For transfers, `Category` holds the other account. A Transfer-Out row has
 *   Accounts = source, Category = destination; its Transfer-In twin is the
 *   reverse, with the same timestamp.
 * - Cross-currency transfers may be labelled with the wrong currency; the
 *   account's own currency decides which amount belongs to each side.
 * - MXN is rounded, so the implied rate of foreign rows varies slightly.
 */

export type RawKind = 'Exp.' | 'Income' | 'Transfer-In' | 'Transfer-Out';

export interface SourceRow {
  row: number; // 1-based spreadsheet row
  occurredAt: Date;
  account: string;
  category: string;
  subcategory: string | null;
  note: string | null;
  description: string | null;
  mxn: number;
  kind: RawKind;
  amount: number;
  currency: Currency;
}

export interface PlannedTx {
  hash: string;
  type: 'expense' | 'income';
  occurredAt: string;
  account: string;
  category: string;
  subcategory: string | null;
  note: string | null;
  description: string | null;
  amount: number;
  currency: Currency;
  rate: number;
  mxn: number;
  pending: boolean;
  rows: number[];
}

export interface TransferSide {
  account: string;
  amount: number;
  currency: Currency;
  rate: number;
  mxn: number;
}

export interface PlannedTransfer {
  hash: string;
  occurredAt: string;
  out: TransferSide;
  in: TransferSide;
  note: string | null;
  description: string | null;
  pending: boolean;
  rows: number[];
}

export type IssueKind = 'invalid_row' | 'amount_mismatch' | 'rate_outlier' | 'currency_account_mismatch' | 'unpaired_transfer' | 'transfer_amount_mismatch';
export type Resolution = 'fix' | 'skip' | 'import';

export interface ImportIssue {
  id: string;
  kind: IssueKind;
  rows: number[];
  detail: Record<string, string | number>;
  options: Resolution[];
  defaultResolution: Resolution;
  /** Hash of the planned record this issue applies to. */
  target?: string;
  /** Replacement record used when the user picks "fix". */
  fixed?: PlannedTx | PlannedTransfer;
}

export interface ImportPlan {
  accounts: { name: string; currency: Currency; type: AccountType }[];
  categories: { type: 'expense' | 'income'; name: string; subcategories: string[] }[];
  transactions: PlannedTx[];
  transfers: PlannedTransfer[];
  issues: ImportIssue[];
  counts: { rows: number; expenses: number; incomes: number; transferRows: number; transferPairs: number; pending: number; from: string | null; to: string | null };
}

const HEADER = ['Period', 'Accounts', 'Category', 'Subcategory', 'Note', 'MXN', 'Income/Expense', 'Description', 'Amount', 'Currency'];

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Fast deterministic string hash (cyrb53, doubled) -> 26 hex chars. */
export function stableHash(input: string): string {
  const h = (seed: number) => {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < input.length; i++) {
      const ch = input.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
  };
  return 'mm:' + h(1) + h(2);
}

/** Parses the sheet as an array of rows (first row = header). Returns parsed rows plus invalid-row issues. */
export function parseRows(table: unknown[][]): { rows: SourceRow[]; issues: ImportIssue[] } {
  const header = (table[0] ?? []).map((h) => String(h ?? '').trim());
  const missing = HEADER.filter((h) => !header.includes(h));
  if (missing.length) throw new Error(`Missing columns: ${missing.join(', ')}`);
  const col = (name: string) => header.indexOf(name); // first occurrence, so the duplicate "Accounts" is ignored

  const rows: SourceRow[] = [];
  const issues: ImportIssue[] = [];
  table.slice(1).forEach((r, i) => {
    const rowNo = i + 2;
    if (!r || r.every((c) => c == null || c === '')) return;
    const period = r[col('Period')];
    const occurredAt = period instanceof Date ? period : period != null ? new Date(String(period)) : new Date(NaN);
    const kind = str(r[col('Income/Expense')]) as RawKind | null;
    const currency = (str(r[col('Currency')]) ?? 'MXN').toUpperCase() as Currency;
    const amount = Number(r[col('Amount')]);
    const mxn = Number(r[col('MXN')]);
    const account = str(r[col('Accounts')]);
    const category = str(r[col('Category')]);
    const problems: string[] = [];
    if (isNaN(occurredAt.getTime())) problems.push('date');
    if (!kind || !['Exp.', 'Income', 'Transfer-In', 'Transfer-Out'].includes(kind)) problems.push('type');
    if (!CURRENCIES.includes(currency)) problems.push('currency');
    if (!(amount > 0) || !(mxn >= 0)) problems.push('amount');
    if (!account) problems.push('account');
    if (!category) problems.push('category');
    if (problems.length) {
      issues.push({ id: `invalid-${rowNo}`, kind: 'invalid_row', rows: [rowNo], detail: { fields: problems.join(', ') }, options: ['skip'], defaultResolution: 'skip' });
      return;
    }
    rows.push({
      row: rowNo,
      occurredAt,
      account: account!,
      category: category!,
      subcategory: str(r[col('Subcategory')]),
      note: str(r[col('Note')]),
      description: str(r[col('Description')]),
      mxn,
      kind: kind!,
      amount,
      currency,
    });
  });
  return { rows, issues };
}

/** Picks one spelling per case-insensitive name (first seen wins). */
function canonicalizer() {
  const seen = new Map<string, string>();
  return (name: string) => {
    const key = name.trim().toLocaleLowerCase('es');
    if (!seen.has(key)) seen.set(key, name.trim());
    return seen.get(key)!;
  };
}

function median(values: number[]): number {
  if (!values.length) return 1;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function guessAccountType(name: string): AccountType {
  const n = name.toLowerCase();
  if (/credit|cr[eé]dito/.test(n)) return 'credit_card';
  if (/debit|d[eé]bito/.test(n)) return 'debit';
  if (/cash|efectivo/.test(n)) return 'cash';
  if (/ahorro|saving/.test(n)) return 'savings';
  if (/gbm|stock|invest|inversi/.test(n)) return 'investment';
  return 'other';
}

export function buildImportPlan(table: unknown[][], now: Date = new Date()): ImportPlan {
  const { rows, issues } = parseRows(table);
  const canonAccount = canonicalizer();
  const canonCategory = canonicalizer();
  const subCanon = new Map<string, ReturnType<typeof canonicalizer>>();
  const canonSub = (cat: string, sub: string) => {
    if (!subCanon.has(cat)) subCanon.set(cat, canonicalizer());
    return subCanon.get(cat)!(sub);
  };
  for (const r of rows) r.account = canonAccount(r.account);

  // Account currency = most common currency of its expense/income rows.
  const currencyVotes = new Map<string, Map<Currency, number>>();
  for (const r of rows) {
    if (r.kind.startsWith('Transfer')) continue;
    const v = currencyVotes.get(r.account) ?? new Map();
    v.set(r.currency, (v.get(r.currency) ?? 0) + 1);
    currencyVotes.set(r.account, v);
  }
  const accountCurrency = (name: string): Currency => {
    const v = currencyVotes.get(name);
    if (!v) return 'MXN';
    return [...v.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };

  // Typical rate per foreign currency, to flag outliers.
  const typicalRate = new Map<Currency, number>();
  for (const c of CURRENCIES) {
    if (c === 'MXN') continue;
    typicalRate.set(c, median(rows.filter((r) => r.currency === c && r.amount > 0).map((r) => r.mxn / r.amount)));
  }

  // Identical rows can legitimately repeat; a per-key counter keeps their hashes distinct but stable.
  const occurrences = new Map<string, number>();
  const hashFor = (key: string) => {
    const n = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, n);
    return stableHash(`${key}#${n}`);
  };
  const rowKey = (r: SourceRow) =>
    [r.occurredAt.toISOString(), r.kind, r.account, r.category, r.subcategory ?? '', r.note ?? '', r.amount, r.currency, r.mxn].join('|');

  // A row labelled MXN whose Amount equals the MXN column really is in pesos. On a
  // CAD/USD account it is converted to the account's currency at the file's typical rate.
  const isPesoRow = (r: SourceRow) => r.currency === 'MXN' && Math.abs(r.mxn - r.amount) <= 0.01;
  const toAccountCurrency = (mxn: number, currency: Currency) => {
    const rate = typicalRate.get(currency)!;
    return { amount: round2(mxn / rate), rate: round2(rate * 10000) / 10000 };
  };

  const transactions: PlannedTx[] = [];
  const categories = new Map<string, { type: 'expense' | 'income'; name: string; subs: Set<string> }>();

  for (const r of rows.filter((x) => x.kind === 'Exp.' || x.kind === 'Income')) {
    const type = r.kind === 'Exp.' ? 'expense' : 'income';
    const category = canonCategory(r.category);
    const subcategory = r.subcategory ? canonSub(`${type}:${category}`, r.subcategory) : null;
    const catKey = `${type}:${category.toLocaleLowerCase('es')}`;
    const cat = categories.get(catKey) ?? { type, name: category, subs: new Set<string>() };
    if (subcategory) cat.subs.add(subcategory);
    categories.set(catKey, cat);

    const rate = r.currency === 'MXN' ? 1 : round2((r.mxn / r.amount) * 10000) / 10000;
    const tx: PlannedTx = {
      hash: hashFor(rowKey(r)),
      type,
      occurredAt: r.occurredAt.toISOString(),
      account: r.account,
      category,
      subcategory,
      note: r.note,
      description: r.description,
      amount: r.amount,
      currency: r.currency,
      rate,
      mxn: r.currency === 'MXN' ? r.amount : r.mxn,
      pending: r.occurredAt > now,
      rows: [r.row],
    };
    const accCur = accountCurrency(r.account);
    if (accCur !== 'MXN' && isPesoRow(r)) {
      Object.assign(tx, { currency: accCur, mxn: r.mxn, ...toAccountCurrency(r.mxn, accCur) });
      issues.push({
        id: `currency-${r.row}`,
        kind: 'currency_account_mismatch',
        rows: [r.row],
        detail: { accounts: r.account, mxn: r.mxn, converted: `${tx.amount} ${accCur}` },
        options: ['import', 'skip'],
        defaultResolution: 'import',
        target: tx.hash,
      });
    }
    transactions.push(tx);

    if (tx.currency === 'MXN' && Math.abs(r.mxn - r.amount) > 0.01) {
      issues.push({
        id: `mismatch-${r.row}`,
        kind: 'amount_mismatch',
        rows: [r.row],
        detail: { amount: r.amount, mxn: r.mxn },
        options: ['fix', 'import', 'skip'],
        defaultResolution: 'fix',
        target: tx.hash,
        fixed: { ...tx, amount: r.mxn, mxn: r.mxn },
      });
    } else if (tx.currency !== 'MXN' && r.currency !== 'MXN') {
      const typical = typicalRate.get(r.currency)!;
      if (Math.abs(rate - typical) / typical > 0.005) {
        issues.push({
          id: `rate-${r.row}`,
          kind: 'rate_outlier',
          rows: [r.row],
          detail: { rate, typical: round2(typical * 10000) / 10000, currency: r.currency },
          options: ['import', 'fix', 'skip'],
          defaultResolution: 'import',
          target: tx.hash,
          fixed: { ...tx, rate: typical, mxn: round2(r.amount * typical) },
        });
      }
    }
  }

  // Pair transfers: Out(A -> B) with In(B <- A) at the same timestamp.
  const outs = rows.filter((r) => r.kind === 'Transfer-Out');
  const ins = rows.filter((r) => r.kind === 'Transfer-In');
  for (const r of [...outs, ...ins]) r.category = canonAccount(r.category);
  const usedIns = new Set<SourceRow>();
  const transfers: PlannedTransfer[] = [];

  const side = (r: SourceRow, account: string, flag: (s: TransferSide) => void): TransferSide => {
    const accCur = accountCurrency(account);
    // The MXN column is always the MXN value, so MXN accounts take it directly; a row
    // labelled MXN whose Amount differs is really carrying the other side's currency.
    const mislabelled = r.currency !== accCur || (r.currency === 'MXN' && Math.abs(r.mxn - r.amount) > 0.01);
    const s: TransferSide =
      accCur === 'MXN'
        ? { account, amount: r.mxn, currency: 'MXN', rate: 1, mxn: r.mxn }
        : isPesoRow(r)
          ? { account, currency: accCur, mxn: r.mxn, ...toAccountCurrency(r.mxn, accCur) }
          : { account, amount: r.amount, currency: accCur, rate: r.mxn / r.amount, mxn: r.mxn };
    if (mislabelled) flag(s);
    return s;
  };

  for (const o of outs) {
    const twin = ins.find(
      (i) => !usedIns.has(i) && i.occurredAt.getTime() === o.occurredAt.getTime() && i.account === o.category && i.category === o.account,
    );
    if (twin) usedIns.add(twin);
    const currencyFlags: string[] = [];
    const outSide = side(o, o.account, () => currencyFlags.push(o.account));
    const inSide = twin
      ? side(twin, twin.account, () => currencyFlags.push(twin.account))
      : side(o, o.category, () => currencyFlags.push(o.category));
    const t: PlannedTransfer = {
      hash: hashFor(rowKey(o)),
      occurredAt: o.occurredAt.toISOString(),
      out: outSide,
      in: inSide,
      note: o.note ?? twin?.note ?? null,
      description: o.description ?? twin?.description ?? null,
      pending: o.occurredAt > now,
      rows: twin ? [o.row, twin.row] : [o.row],
    };
    transfers.push(t);
    if (!twin) {
      issues.push({
        id: `unpaired-${o.row}`,
        kind: 'unpaired_transfer',
        rows: [o.row],
        detail: { from: o.account, to: o.category, amount: o.amount },
        options: ['import', 'skip'],
        defaultResolution: 'import',
        target: t.hash,
      });
    } else if (Math.abs(outSide.mxn - inSide.mxn) > 1) {
      issues.push({
        id: `transfer-${o.row}`,
        kind: 'transfer_amount_mismatch',
        rows: t.rows,
        detail: { from: o.account, to: o.category, out: outSide.mxn, in: inSide.mxn },
        options: ['import', 'fix', 'skip'],
        defaultResolution: 'import',
        target: t.hash,
        fixed: { ...t, in: { ...inSide, mxn: outSide.mxn, amount: inSide.currency === 'MXN' ? outSide.mxn : inSide.amount } },
      });
    } else if (currencyFlags.length) {
      issues.push({
        id: `currency-${o.row}`,
        kind: 'currency_account_mismatch',
        rows: t.rows,
        detail: { accounts: currencyFlags.join(', '), out: `${outSide.amount} ${outSide.currency}`, in: `${inSide.amount} ${inSide.currency}` },
        options: ['import', 'skip'],
        defaultResolution: 'import',
        target: t.hash,
      });
    }
  }
  for (const i of ins.filter((x) => !usedIns.has(x))) {
    const inSide = side(i, i.account, () => undefined);
    const t: PlannedTransfer = {
      hash: hashFor(rowKey(i)),
      occurredAt: i.occurredAt.toISOString(),
      out: side(i, i.category, () => undefined),
      in: inSide,
      note: i.note,
      description: i.description,
      pending: i.occurredAt > now,
      rows: [i.row],
    };
    transfers.push(t);
    issues.push({
      id: `unpaired-${i.row}`,
      kind: 'unpaired_transfer',
      rows: [i.row],
      detail: { from: i.category, to: i.account, amount: i.amount },
      options: ['import', 'skip'],
      defaultResolution: 'import',
      target: t.hash,
    });
  }

  const accountNames = new Set<string>();
  for (const r of rows) {
    accountNames.add(r.account);
    if (r.kind.startsWith('Transfer')) accountNames.add(r.category);
  }
  const dates = rows.map((r) => r.occurredAt.getTime());

  return {
    accounts: [...accountNames].map((name) => ({ name, currency: accountCurrency(name), type: guessAccountType(name) })),
    categories: [...categories.values()].map((c) => ({ type: c.type, name: c.name, subcategories: [...c.subs] })),
    transactions,
    transfers,
    issues,
    counts: {
      rows: rows.length + issues.filter((i) => i.kind === 'invalid_row').length,
      expenses: transactions.filter((t) => t.type === 'expense').length,
      incomes: transactions.filter((t) => t.type === 'income').length,
      transferRows: outs.length + ins.length,
      transferPairs: transfers.filter((t) => t.rows.length === 2).length,
      pending: transactions.filter((t) => t.pending).length + transfers.filter((t) => t.pending).length,
      from: dates.length ? new Date(Math.min(...dates)).toISOString() : null,
      to: dates.length ? new Date(Math.max(...dates)).toISOString() : null,
    },
  };
}

/** Applies the user's per-issue choices and returns the records to write. */
export function resolvePlan(plan: ImportPlan, choices: Record<string, Resolution>): { transactions: PlannedTx[]; transfers: PlannedTransfer[] } {
  const skip = new Set<string>();
  const replace = new Map<string, PlannedTx | PlannedTransfer>();
  for (const issue of plan.issues) {
    if (!issue.target) continue;
    const choice = choices[issue.id] ?? issue.defaultResolution;
    if (choice === 'skip') skip.add(issue.target);
    else if (choice === 'fix' && issue.fixed) replace.set(issue.target, issue.fixed);
  }
  const pick = <T extends { hash: string }>(list: T[]) =>
    list.filter((x) => !skip.has(x.hash)).map((x) => (replace.get(x.hash) as T | undefined) ?? x);
  return { transactions: pick(plan.transactions), transfers: pick(plan.transfers) };
}
