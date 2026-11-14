import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { startOfMonth } from 'date-fns';
import { useRemove, useRows, useSave } from '@/lib/data';
import { useProfile } from '@/lib/profile';
import { money } from '@/lib/format';
import { Empty, ErrorText, Fab, Group, Progress, Row, SaveBar, Sheet } from '@/components/ui';
import { AmountInput, amountValue } from './AmountInput';
import { budgetProgress } from '@/domain/finance/totals';
import { num, type Budget } from '@/domain/types';
import { categoryName, useCategories, useTransactions } from './hooks';

export function useBudgetProgress() {
  const { weekStartsOn } = useProfile();
  const budgets = useRows('budgets');
  const cats = useCategories();
  const txs = useTransactions(startOfMonth(new Date()));
  const progress = budgets.data && txs.data && cats.data ? budgetProgress(budgets.data, txs.data, cats.byId, new Date(), weekStartsOn) : [];
  return { progress, cats, isLoading: budgets.isLoading || txs.isLoading };
}

export function BudgetList({ onOpen }: { onOpen?: (b: Budget) => void }) {
  const { t } = useTranslation();
  const { progress, cats } = useBudgetProgress();
  if (!progress.length) return <Empty>{t('finance.noBudgets')}</Empty>;
  const name = (b: Budget) => {
    if (!b.category_id) return t('finance.generalBudget');
    const c = cats.byId.get(b.category_id);
    const parent = c?.parent_id ? cats.byId.get(c.parent_id) : null;
    return `${parent ? `${parent.name} › ` : ''}${categoryName(cats.byId, b.category_id)}`;
  };
  // The general budget leads; the rest go from most to least used.
  const sorted = [...progress].sort((a, b) => Number(!!a.budget.category_id) - Number(!!b.budget.category_id) || b.ratio - a.ratio);
  return (
    <div className="divide-y divide-border">
      {sorted.map((p) => (
        <button key={p.budget.id} onClick={() => onOpen?.(p.budget)} className="block w-full py-4 text-left first:pt-0 last:pb-0">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <span className={`truncate font-medium ${p.budget.category_id ? 'text-sm' : 'text-base'}`}>{name(p.budget)}</span>
            <span className="shrink-0 text-xs text-muted">
              {t('finance.perMonth', { amount: money(p.limit) })}
            </span>
          </div>
          <Bar label={t('finance.thisWeek')} spent={p.week.spent} limit={p.week.limit} ratio={p.week.ratio} />
          <Bar label={t('finance.thisMonthBudget')} spent={p.spent} limit={p.limit} ratio={p.ratio} />
        </button>
      ))}
    </div>
  );
}

function Bar({ label, spent, limit, ratio }: { label: string; spent: number; limit: number; ratio: number }) {
  const { t } = useTranslation();
  const over = ratio > 1;
  return (
    <div className="mt-1.5">
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted">{label}</span>
        <span className={over ? 'text-expense' : ''}>
          {money(spent)} <span className="text-muted">/ {money(limit)}</span>
        </span>
      </div>
      <Progress ratio={Math.min(ratio, 1)} color={over ? 'bg-expense' : ratio > 0.85 ? 'bg-tasks' : 'bg-accent'} />
      <div className="mt-0.5 text-[11px] text-muted">{over ? t('finance.overBy', { amount: money(spent - limit) }) : t('finance.left', { amount: money(limit - spent) })}</div>
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

const GENERAL = 'general';

function BudgetSheet({ open, budget, onClose }: { open: boolean; budget?: Budget | null; onClose: () => void }) {
  const { t } = useTranslation();
  const cats = useCategories();
  const save = useSave('budgets');
  const remove = useRemove('budgets');
  const budgets = useRows('budgets');
  const [categoryId, setCategoryId] = useState('');
  const [limit, setLimit] = useState('');
  useEffect(() => {
    if (!open) return;
    setCategoryId(budget ? budget.category_id ?? GENERAL : '');
    setLimit(budget ? String(num(budget.monthly_limit_mxn)) : '');
    save.reset();
  }, [open, budget?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasGeneral = (budgets.data ?? []).some((b) => b.category_id === null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!(amountValue(limit) > 0)) return;
    await save.mutateAsync({ id: budget?.id, category_id: categoryId === GENERAL ? null : categoryId, monthly_limit_mxn: amountValue(limit) });
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
        <p className="text-center text-[13px] text-muted">{t('finance.monthlyLimit')}</p>
        <div className="mb-4">
          <AmountInput hero required autoFocus={!budget} value={limit} onChange={setLimit} />
        </div>
        <Group className="mb-1">
          <Row icon="tag" label={t('finance.category')}>
            <select className="pill max-w-[12rem]" required aria-label={t('finance.category')} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="" disabled>
                {t('finance.chooseCategory')}
              </option>
              {/* Only one general budget; editing it keeps the option. */}
              <option value={GENERAL} disabled={hasGeneral && budget?.category_id !== null}>
                {t('finance.generalBudgetOption')}
              </option>
              {cats.parents('expense').map((p) => (
                <optgroup key={p.id} label={p.name}>
                  <option value={p.id}>{p.name}</option>
                  {cats.children(p.id).map((c) => (
                    <option key={c.id} value={c.id}>
                      {p.name} › {c.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Row>
        </Group>
      </form>
    </Sheet>
  );
}
