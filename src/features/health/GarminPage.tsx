import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, unwrap } from '@/lib/supabase';
import { formatDate } from '@/lib/format';
import { ErrorText, Icon } from '@/components/ui';

interface SyncStatus {
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  endpoints_ok: number;
  endpoints_failed: number;
}

interface RawRow {
  endpoint: string;
  window_key: string;
  status: number;
  fetched_at: string;
}

const METRICS = ['steps', 'sleep', 'stress', 'bodyBattery', 'heartRate', 'activities'] as const;

/**
 * Garmin stats sub-module. Stage 1: connection status, manual sync and what
 * each endpoint returned. The metric cards get filled once the real response
 * format is known.
 */
export function GarminPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const status = useQuery({
    queryKey: ['garmin', 'status'],
    queryFn: async () => unwrap(await supabase.from('garmin_sync_status').select('*').maybeSingle()) as SyncStatus | null,
  });
  const raw = useQuery({
    queryKey: ['garmin', 'raw'],
    queryFn: async () => unwrap(await supabase.from('garmin_raw').select('endpoint,window_key,status,fetched_at').order('endpoint')) as RawRow[],
  });

  const syncNow = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke('garmin', { body: { mode: 'sync', days: 7 } });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      qc.invalidateQueries({ queryKey: ['garmin'] });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const s = status.data;
  const connected = !!s?.last_success_at;

  return (
    <div className="space-y-4">
      <section className="card">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon name="target" className="text-habit" />
            <h2 className="text-sm font-semibold">{connected ? t('garmin.connected') : t('garmin.notConnected')}</h2>
          </div>
          <button className="btn-ghost" onClick={syncNow} disabled={busy}>
            <Icon name="repeat" size={16} /> {busy ? t('garmin.syncing') : t('garmin.syncNow')}
          </button>
        </div>
        <ErrorText error={error} />
        {s ? (
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-muted">{t('garmin.lastSync')}</dt>
              <dd>{s.last_success_at ? formatDate(s.last_success_at, 'd MMM HH:mm') : '—'}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">{t('garmin.endpoints')}</dt>
              <dd>
                {s.endpoints_ok} ✓ {s.endpoints_failed > 0 && <span className="text-expense">· {s.endpoints_failed} ✕</span>}
              </dd>
            </div>
            {s.last_error && <p className="text-xs text-expense">{s.last_error}</p>}
          </dl>
        ) : (
          <p className="text-sm text-muted">{t('garmin.comingSoon')}</p>
        )}
      </section>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {METRICS.map((m) => (
          <div key={m} className="rounded-xl border border-dashed border-border p-3">
            <div className="text-xs text-muted">{t(`garmin.metrics.${m}`)}</div>
            <div className="mt-1 text-lg font-semibold text-muted">—</div>
          </div>
        ))}
      </section>

      {(raw.data ?? []).length > 0 && (
        <details className="card text-sm">
          <summary className="cursor-pointer font-medium">{t('garmin.received')}</summary>
          <ul className="mt-2 divide-y divide-border">
            {(raw.data ?? []).map((r) => (
              <li key={r.endpoint + r.window_key} className="flex justify-between gap-2 py-1.5">
                <span className="truncate">{t(`garmin.endpointNames.${r.endpoint}`, { defaultValue: r.endpoint })}</span>
                <span className={r.status >= 200 && r.status < 300 ? 'text-income' : 'text-expense'}>{r.status}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
