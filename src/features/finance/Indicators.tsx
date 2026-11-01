import { useTranslation } from 'react-i18next';
import { money, pct } from '@/lib/format';
import { Collapsible } from '@/components/ui';
import { categoryName, useIndicators } from './hooks';

/** Month/week spending, top categories and total balance. Collapsible so it stays out of the way. */
export function Indicators({ storageKey = 'finance-indicators', title }: { storageKey?: string; title?: string }) {
  const { t } = useTranslation();
  const { indicators: ind, categories } = useIndicators();
  return (
    <Collapsible title={title ?? t('finance.indicators')} storageKey={storageKey}>
      {!ind ? (
        <div className="h-24 animate-pulse rounded-lg bg-surface" />
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Stat label={t('finance.spentMonth')} value={money(ind.thisMonth)} sub={`${pct(ind.monthChangePct)} ${t('finance.vsLastMonth')}`} subTone={ind.monthChangePct != null && ind.monthChangePct > 0 ? 'text-expense' : 'text-income'} />
          <Stat label={t('finance.lastMonth')} value={money(ind.lastMonth)} />
          <Stat label={t('finance.spentWeek')} value={money(ind.thisWeek)} />
          <Stat label={t('finance.totalBalance')} value={money(ind.totalBalance)} tone={ind.totalBalance < 0 ? 'text-expense' : ''} />
          <div className="col-span-2 sm:col-span-4">
            <div className="label">{t('finance.topCategories')}</div>
            {ind.top3.length === 0 ? (
              <p className="text-sm text-muted">{t('finance.noSpending')}</p>
            ) : (
              <ol className="space-y-1">
                {ind.top3.map((c, i) => (
                  <li key={c.categoryId ?? 'none'} className="flex items-center gap-2 text-sm">
                    <span className="w-4 text-muted">{i + 1}</span>
                    <span className="flex-1 truncate">{categoryName(categories.byId, c.categoryId, t('finance.uncategorized'))}</span>
                    <span className="font-medium text-expense">{money(c.amount)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </Collapsible>
  );
}

function Stat({ label, value, sub, tone = '', subTone = 'text-muted' }: { label: string; value: string; sub?: string; tone?: string; subTone?: string }) {
  return (
    <div className="min-w-0">
      <div className="label">{label}</div>
      <div className={`truncate text-lg font-semibold ${tone}`}>{value}</div>
      {sub && <div className={`text-xs ${subTone}`}>{sub}</div>}
    </div>
  );
}
