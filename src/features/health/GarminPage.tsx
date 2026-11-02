import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/ui';

/** Garmin stats sub-module. Shows what's coming until the account is connected. */
export function GarminPage() {
  const { t } = useTranslation();
  const metrics = ['steps', 'sleep', 'stress', 'bodyBattery', 'heartRate', 'activities'] as const;
  return (
    <div className="space-y-4">
      <section className="card">
        <div className="mb-2 flex items-center gap-2">
          <Icon name="target" className="text-habit" />
          <h2 className="text-sm font-semibold">{t('garmin.notConnected')}</h2>
        </div>
        <p className="text-sm text-muted">{t('garmin.comingSoon')}</p>
      </section>
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {metrics.map((m) => (
          <div key={m} className="rounded-xl border border-dashed border-border p-3">
            <div className="text-xs text-muted">{t(`garmin.metrics.${m}`)}</div>
            <div className="mt-1 text-lg font-semibold text-muted">—</div>
          </div>
        ))}
      </section>
    </div>
  );
}
