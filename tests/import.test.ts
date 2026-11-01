import { describe, expect, it } from 'vitest';
import { buildImportPlan, resolvePlan } from '../src/domain/import/moneyManager';

const HEADER = ['Period', 'Accounts', 'Category', 'Subcategory', 'Note', 'MXN', 'Income/Expense', 'Description', 'Amount', 'Currency', 'Accounts'];
const row = (date: Date, account: string, category: string, sub: string | null, note: string | null, mxn: number, kind: string, amount: number, currency = 'MXN') =>
  [date, account, category, sub, note, mxn, kind, null, amount, currency, mxn];

const NOW = new Date(2026, 10, 1);
const t1 = new Date(2026, 9, 29, 20, 22, 22);
const t2 = new Date(2025, 8, 5);

// Synthetic sample that mirrors the export's structure (no real data).
const table = [
  HEADER,
  row(new Date(2026, 9, 1), 'Debit Card', 'Comida', 'Súper', 'Oxxo', 250, 'Exp.', 250),
  row(new Date(2026, 9, 2), 'Debit Card', 'Comida', 'súper', null, 100, 'Exp.', 100),
  row(new Date(2026, 9, 3), 'Debit Card', 'Otros', 'Reposición de gastos', null, 50, 'Exp.', 50),
  row(new Date(2026, 9, 4), 'Debit Card', 'Otros', 'Reposición de Gastos', null, 60, 'Exp.', 60),
  row(new Date(2026, 9, 5), 'Debit Card', 'Salario', null, null, 20000, 'Income', 20000),
  row(new Date(2026, 9, 6), 'TD', 'Comida', null, 'Tim Hortons', 69.18, 'Exp.', 5, 'CAD'),
  row(new Date(2026, 9, 7), 'TD', 'Comida', null, null, 553.43, 'Exp.', 40, 'CAD'),
  row(new Date(2026, 9, 8), 'TD', 'Comida', null, null, 200, 'Exp.', 10, 'CAD'), // rate 20: outlier
  row(new Date(2026, 9, 9), 'Debit Card', 'Comida', null, null, 999, 'Exp.', 99), // MXN mismatch
  // Same-currency transfer pair (Ahorro -> Debit Card)
  row(t1, 'Debit Card', 'Ahorro', null, null, 3500, 'Transfer-In', 3500),
  row(t1, 'Ahorro', 'Debit Card', null, null, 3500, 'Transfer-Out', 3500),
  // Cross-currency transfer TD (CAD) -> Credit Card, mislabelled as MXN on the MXN side
  row(t2, 'Credit Card (Azul)', 'TD', null, null, 35281.22, 'Transfer-In', 2550, 'MXN'),
  row(t2, 'TD', 'Credit Card (Azul)', null, null, 35281.22, 'Transfer-Out', 2550, 'CAD'),
  // Unpaired transfer
  row(new Date(2026, 9, 10), 'Debit Card', 'Cash', null, null, 500, 'Transfer-Out', 500),
  // Future installment -> pending
  row(new Date(2028, 5, 17, 15, 9), 'Credit Card (Oro)', 'Compras', 'Electrodomésticos', 'Pago (20/20)', 9419, 'Exp.', 9419),
  // Invalid row
  [new Date(2026, 9, 11), 'Debit Card', null, null, null, 'x', 'Exp.', null, 'abc', 'MXN', null],
];

describe('Money Manager import', () => {
  const plan = buildImportPlan(table, NOW);

  it('counts rows by type', () => {
    expect(plan.counts).toMatchObject({ rows: 16, expenses: 9, incomes: 1, transferRows: 5, transferPairs: 2, pending: 1 });
  });

  it('creates accounts with inferred currency and type', () => {
    const td = plan.accounts.find((a) => a.name === 'TD');
    expect(td).toMatchObject({ currency: 'CAD' });
    expect(plan.accounts.find((a) => a.name === 'Credit Card (Azul)')).toMatchObject({ currency: 'MXN', type: 'credit_card' });
    expect(plan.accounts.find((a) => a.name === 'Ahorro')?.type).toBe('savings');
    expect(plan.accounts.map((a) => a.name)).toContain('Cash');
  });

  it('normalizes duplicated subcategory names', () => {
    const otros = plan.categories.find((c) => c.name === 'Otros');
    expect(otros?.subcategories).toEqual(['Reposición de gastos']);
    expect(plan.categories.find((c) => c.name === 'Comida')?.subcategories).toEqual(['Súper']);
  });

  it('stores the implied exchange rate for foreign rows', () => {
    const tim = plan.transactions.find((t) => t.note === 'Tim Hortons')!;
    expect(tim).toMatchObject({ currency: 'CAD', amount: 5, mxn: 69.18, rate: 13.836 });
  });

  it('marks future rows as pending', () => {
    expect(plan.transactions.filter((t) => t.pending).map((t) => t.note)).toEqual(['Pago (20/20)']);
  });

  it('pairs transfers and fixes the currency of each side from its account', () => {
    const same = plan.transfers.find((t) => t.out.account === 'Ahorro')!;
    expect(same).toMatchObject({ out: { account: 'Ahorro', amount: 3500 }, in: { account: 'Debit Card', amount: 3500 } });
    const cross = plan.transfers.find((t) => t.out.account === 'TD')!;
    expect(cross.out).toMatchObject({ currency: 'CAD', amount: 2550 });
    expect(cross.in).toMatchObject({ account: 'Credit Card (Azul)', currency: 'MXN', amount: 35281.22 });
    expect(cross.rows).toHaveLength(2);
  });

  it('lists inconsistencies', () => {
    const kinds = plan.issues.map((i) => i.kind).sort();
    expect(kinds).toEqual(['amount_mismatch', 'currency_account_mismatch', 'invalid_row', 'rate_outlier', 'unpaired_transfer']);
  });

  it('applies per-issue choices', () => {
    const mismatch = plan.issues.find((i) => i.kind === 'amount_mismatch')!;
    const unpaired = plan.issues.find((i) => i.kind === 'unpaired_transfer')!;
    const fixed = resolvePlan(plan, {});
    expect(fixed.transactions.find((t) => t.hash === mismatch.target)?.amount).toBe(999);
    const asIs = resolvePlan(plan, { [mismatch.id]: 'import', [unpaired.id]: 'skip' });
    expect(asIs.transactions.find((t) => t.hash === mismatch.target)?.amount).toBe(99);
    expect(asIs.transfers).toHaveLength(2);
  });

  it('produces the same hashes for the same file (idempotent)', () => {
    const again = buildImportPlan(table, NOW);
    expect(again.transactions.map((t) => t.hash)).toEqual(plan.transactions.map((t) => t.hash));
    expect(again.transfers.map((t) => t.hash)).toEqual(plan.transfers.map((t) => t.hash));
    expect(new Set(plan.transactions.map((t) => t.hash)).size).toBe(plan.transactions.length);
  });

  it('keeps identical rows as separate records', () => {
    const dup = [HEADER, table[1], table[1]];
    const p = buildImportPlan(dup, NOW);
    expect(p.transactions).toHaveLength(2);
    expect(p.transactions[0].hash).not.toBe(p.transactions[1].hash);
  });

  it('rejects files without the expected columns', () => {
    expect(() => buildImportPlan([['Date', 'Amount']], NOW)).toThrow(/Missing columns/);
  });
});
