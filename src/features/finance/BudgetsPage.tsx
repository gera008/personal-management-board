import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { startOfMonth } from 'date-fns';
import { useRemove, useRows, useSave } from '@/lib/data';
import { money } from '@/lib/format';
import { Empty, ErrorText, Fab, Field, Progress, SaveBar, Sheet } from '@/components/ui';
import { budgetProgress } from '@/domain/finance/totals';
import { num, type Budget } from '@/domain/types';
import { categoryName, useCategories, useTransactions } from './hooks';

export function useBudgetProgress() {
  const budgets = useRows('budgets');
  const cats = useCategories();
  const txs = useTransactions(startOfMonth(new Date()));
  const progress = budgets.data && txs.data && cats.data ? budgetProgress(budgets.data, txs.data, cats.byId, new Date()) : [];
  return { progress, cats, isLoading: budgets.isLoading || txs.isLoading };
}

export function BudgetList({ onOpen }: { onOpen?: (b: Budget) => void }) {
  const { t } = useTranslation();
  const { progress, cats } = useBudgetProgress();
  if (!progress.length) return <Empty>{t('finance.noBudgets')}</Empty>;
  return (
    <div className="space-y-3">
      {progress
        .sort((a, b) => b.ratio - a.ratio)
        .map((p) => {
          const c = cats.byId.get(p.budget.category_id);
          const parent = c?.parent_id ? cats.byId.get(c.parent_id) : null;
          return (
            <button key={p.budget.id} onClick={() => onOpen?.(p.budget)} className="block w-full text-left">
              <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate font-medium">
                  {parent ? `${parent.name} › ` : ''}
                  {categoryName(cats.byId, p.budget.category_id)}
                </span>
                <span className={`shrink-0 text-xs ${p.ratio > 1 ? 'text-expense' : 'text-muted'}`}>
                  {money(p.spent)} / {money(p.limit)}
                </span>
              </div>
              <Progress ratio={p.ratio} color={p.ratio > 0.85 ? 'bg-tasks' : 'bg-fg'} />
              <div className="mt-0.5 text-[11px] text-muted">{p.ratio > 1 ? t('finance.overBy', { amount: money(p.spent - p.limit) }) : t('finance.left', { amount: money(p.limit - p.spent) })}</div>
            </button>
          );
        })}
    </div>
  );
}

export function BudgetsPage() {
  const { t } = useTranslation();
  const [sheet, setSheet] = useState<{ budget?: Budget | null } | null>(null);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t('finance.budgetsHelp')}</p>
      <div className="card">
        <BudgetList onOpen={(budget) => setSheet({ budget })} />
      </div>
      <Fab label={t('finance.newBudget')} onClick={() => setSheet({})} />
      <BudgetSheet open={!!sheet} budget={sheet?.budget} onClose={() => setSheet(null)} />
    </div>
  );
}

function BudgetSheet({ open, budget, onClose }: { open: boolean; budget?: Budget | null; onClose: () => void }) {
  const { t } = useTranslation();
  const cats = useCategories();
  const save = useSave('budgets');
  const remove = useRemove('budgets');
  const [categoryId, setCategoryId] = useState('');
  const [limit, setLimit] = useState('');
  useEffect(() => {
    if (!open) return;
    setCategoryId(budget?.category_id ?? '');
    setLimit(budget ? String(num(budget.monthly_limit_mxn)) : '');
    save.reset();
  }, [open, budget?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await save.mutateAsync({ id: budget?.id, category_id: categoryId, monthly_limit_mxn: Number(limit) });
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={budget ? t('finance.editBudget') : t('finance.newBudget')}
      footer={<SaveBar onCancel={onClose} saving={save.isPending} onDelete={budget ? () => remove.mutateAsync(budget.id).then(onClose) : undefined} />}
    >
      <form id="sheet-form" onSubmit={submit}>
        <ErrorText error={save.error} />
        <Field label={t('finance.category')}>
          <select className="input" required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="" />
            {cats.parents('expense').map((p) => (
              <optgroup key={p.id} label={p.name}>
                <option value={p.id}>{p.name}</option>
                {cats.children(p.id).map((c) => (
                  <option key={c.id} value={c.id}>
                    {'  '}
                    {p.name} › {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label={t('finance.monthlyLimit')}>
          <input className="input" inputMode="decimal" required value={limit} onChange={(e) => setLimit(e.target.value.replace(',', '.'))} />
        </Field>
      </form>
    </Sheet>
  );
}
