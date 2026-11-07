import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInvalidate } from '@/lib/data';
import { formatDate } from '@/lib/format';
import { exportAllJson, exportTransactionsCsv } from '@/lib/exporter';
import { ErrorText, Icon } from '@/components/ui';
import { buildImportPlan, type ImportPlan, type Resolution } from '@/domain/import/excelImport';
import { commitImport, type ImportResult } from './importer';

export function ImportExportPage() {
  const { t } = useTranslation();
  const invalidate = useInvalidate();
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [fileName, setFileName] = useState('');
  const [choices, setChoices] = useState<Record<string, Resolution>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setResult(null);
    setPlan(null);
    setChoices({});
    setFileName(file.name);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const table = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true });
      setPlan(buildImportPlan(table));
    } catch (e) {
      setError(e);
    }
  };

  const commit = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const r = await commitImport(plan, choices, (d, n) => setProgress([d, n]));
      setResult(r);
      setPlan(null);
      for (const tbl of ['transactions', 'accounts', 'categories'] as const) invalidate(tbl);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="space-y-4">
      <section className="card">
        <h2 className="mb-1 text-sm font-semibold">{t('import.title')}</h2>
        <p className="mb-3 text-sm text-muted">{t('import.help')}</p>
        <label className="btn-ghost cursor-pointer">
          <Icon name="upload" size={16} /> {t('import.choose')}
          <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        {fileName && <span className="ml-2 text-sm text-muted">{fileName}</span>}
        <div className="mt-3">
          <ErrorText error={error} />
        </div>
        {result && (
          <p className="rounded-lg bg-income/10 px-3 py-2 text-sm">
            {t('import.done', { inserted: result.inserted, skipped: result.skippedExisting, accounts: result.accountsCreated, categories: result.categoriesCreated })}
          </p>
        )}
      </section>

      {plan && (
        <section className="card space-y-4">
          <h2 className="text-sm font-semibold">{t('import.preview')}</h2>
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Count label={t('import.rows')} value={plan.counts.rows} />
            <Count label={t('finance.types.expense')} value={plan.counts.expenses} />
            <Count label={t('finance.types.income')} value={plan.counts.incomes} />
            <Count label={t('import.transfers')} value={`${plan.counts.transferPairs} (${plan.counts.transferRows} ${t('import.rowsShort')})`} />
            <Count label={t('import.pending')} value={plan.counts.pending} />
            <Count label={t('import.accounts')} value={plan.accounts.length} />
            <Count label={t('import.categories')} value={plan.categories.length} />
            <Count label={t('import.range')} value={plan.counts.from ? `${formatDate(plan.counts.from, 'MMM yy')} – ${formatDate(plan.counts.to!, 'MMM yy')}` : '—'} />
          </dl>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">{t('import.accountsDetected')}</summary>
            <ul className="mt-2 space-y-0.5">
              {plan.accounts.map((a) => (
                <li key={a.name}>
                  {a.name} · {a.currency} · {t(`finance.accountTypes.${a.type}`)}
                </li>
              ))}
            </ul>
          </details>

          <div>
            <h3 className="section-title">{t('import.issues', { count: plan.issues.length })}</h3>
            {plan.issues.length === 0 ? (
              <p className="text-sm text-muted">{t('import.noIssues')}</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {plan.issues.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{t(`import.issueKinds.${i.kind}`)}</div>
                      <div className="text-xs text-muted">
                        {t('import.row', { count: i.rows.length })} {i.rows.join(', ')} ·{' '}
                        {Object.entries(i.detail)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(' · ')}
                      </div>
                    </div>
                    <select className="input w-auto py-1" value={choices[i.id] ?? i.defaultResolution} onChange={(e) => setChoices({ ...choices, [i.id]: e.target.value as Resolution })}>
                      {i.options.map((o) => (
                        <option key={o} value={o}>
                          {t(`import.resolutions.${o}`)}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button className="btn-ghost" onClick={() => setPlan(null)} disabled={busy}>
              {t('common.cancel')}
            </button>
            <button className="btn-primary" onClick={commit} disabled={busy}>
              {busy ? (progress ? `${progress[0]}/${progress[1]}` : t('common.saving')) : t('import.commit')}
            </button>
          </div>
          <p className="text-xs text-muted">{t('import.idempotent')}</p>
        </section>
      )}

      <section className="card">
        <h2 className="mb-3 text-sm font-semibold">{t('import.export')}</h2>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => exportTransactionsCsv().catch(setError)}>
            <Icon name="download" size={16} /> {t('settings.exportCsv')}
          </button>
          <button className="btn-ghost" onClick={() => exportAllJson().catch(setError)}>
            <Icon name="download" size={16} /> {t('settings.exportJson')}
          </button>
        </div>
      </section>
    </div>
  );
}

function Count({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl bg-surface p-2">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
