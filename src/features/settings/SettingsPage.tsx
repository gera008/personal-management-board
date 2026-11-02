import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useProfile } from '@/lib/profile';
import { supabase } from '@/lib/supabase';
import { ErrorText, Icon, PageHeader, Segmented } from '@/components/ui';
import { currentSubscription, disablePush, enablePush, isIosBrowserTab, pushSupported, sendTestPush } from '@/lib/push';
import { exportAllJson, exportTransactionsCsv } from '@/lib/exporter';
import { GoogleCalendarSettings } from './GoogleCalendarSettings';
import type { Currency, WidgetSetting } from '@/domain/types';

export function SettingsPage() {
  const { t } = useTranslation();
  const { profile, update } = useProfile();
  const [error, setError] = useState<unknown>(null);
  const run = (p: Promise<unknown>) => p.then(() => setError(null)).catch(setError);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title={t('settings.title')} />
      <ErrorText error={error} />

      <section className="card space-y-4">
        <Row label={t('settings.language')}>
          <Segmented
            value={profile.language}
            onChange={(language) => run(update({ language }))}
            options={[
              { value: 'en', label: 'English' },
              { value: 'es', label: 'Español' },
            ]}
          />
        </Row>
        <Row label={t('settings.theme')}>
          <Segmented
            value={profile.theme}
            onChange={(theme) => run(update({ theme }))}
            options={(['light', 'dark', 'system'] as const).map((v) => ({ value: v, label: t(`settings.themes.${v}`) }))}
          />
        </Row>
        <Row label={t('settings.weekStart')}>
          <Segmented
            value={String(profile.week_start) as '0' | '1'}
            onChange={(v) => run(update({ week_start: Number(v) as 0 | 1 }))}
            options={[
              { value: '0', label: t('settings.sunday') },
              { value: '1', label: t('settings.monday') },
            ]}
          />
        </Row>
        <Row label={t('settings.timezone')}>
          <select className="input max-w-[14rem]" value={profile.timezone} onChange={(e) => run(update({ timezone: e.target.value }))}>
            {timezones(profile.timezone).map((tz) => (
              <option key={tz}>{tz}</option>
            ))}
          </select>
        </Row>
      </section>

      <Rates onError={setError} />
      <Widgets layout={profile.dashboard_layout} onSave={(dashboard_layout) => run(update({ dashboard_layout }))} />
      <Notifications digestTime={profile.digest_time} onDigest={(digest_time) => run(update({ digest_time }))} />
      <GoogleCalendarSettings />

      <section className="card">
        <h2 className="section-title">{t('settings.data')}</h2>
        <div className="flex flex-wrap gap-2">
          <Link to="/finance/data" className="btn-ghost">
            <Icon name="upload" size={16} /> {t('settings.importExcel')}
          </Link>
          <button className="btn-ghost" onClick={() => run(exportTransactionsCsv())}>
            <Icon name="download" size={16} /> {t('settings.exportCsv')}
          </button>
          <button className="btn-ghost" onClick={() => run(exportAllJson())}>
            <Icon name="download" size={16} /> {t('settings.exportJson')}
          </button>
        </div>
      </section>

      <section className="card flex items-center justify-between">
        <span className="truncate text-sm text-muted">{t('settings.signedIn')}</span>
        <button className="btn-ghost" onClick={() => supabase.auth.signOut()}>
          {t('settings.signOut')}
        </button>
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}

function timezones(current: string) {
  const list = (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  return list.includes(current) ? list : [current, ...list];
}

function Rates({ onError }: { onError: (e: unknown) => void }) {
  const { t } = useTranslation();
  const { rates } = useProfile();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => setDraft({ USD: rates.USD ? String(rates.USD) : '', CAD: rates.CAD ? String(rates.CAD) : '' }), [rates.USD, rates.CAD]);

  const save = async (currency: Currency) => {
    const value = Number(draft[currency]);
    if (!(value > 0)) return;
    const { error } = await supabase.from('currency_rates').upsert({ currency, rate_to_mxn: value }, { onConflict: 'user_id,currency' });
    if (error) onError(new Error(error.message));
    else qc.invalidateQueries({ queryKey: ['currency_rates'] });
  };

  return (
    <section className="card">
      <h2 className="section-title">{t('settings.rates')}</h2>
      <p className="mb-3 text-xs text-muted">{t('settings.ratesHelp')}</p>
      {(['USD', 'CAD'] as Currency[]).map((c) => (
        <div key={c} className="mb-2 flex items-center gap-2">
          <span className="w-24 text-sm">1 {c} =</span>
          <input
            className="input max-w-[8rem]"
            inputMode="decimal"
            placeholder="0.00"
            value={draft[c] ?? ''}
            onChange={(e) => setDraft({ ...draft, [c]: e.target.value })}
            onBlur={() => save(c)}
          />
          <span className="text-sm text-muted">MXN</span>
        </div>
      ))}
    </section>
  );
}

function Widgets({ layout, onSave }: { layout: WidgetSetting[]; onSave: (l: WidgetSetting[]) => void }) {
  const { t } = useTranslation();
  const move = (i: number, dir: -1 | 1) => {
    const next = [...layout];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onSave(next);
  };
  return (
    <section className="card">
      <h2 className="section-title">{t('settings.widgets')}</h2>
      <ul className="divide-y divide-border">
        {layout.map((w, i) => (
          <li key={w.id} className="flex items-center gap-2 py-2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-current"
              checked={w.visible}
              onChange={() => onSave(layout.map((x) => (x.id === w.id ? { ...x, visible: !x.visible } : x)))}
              aria-label={t(`widgets.${w.id}`)}
            />
            <span className={`flex-1 text-sm ${w.visible ? '' : 'text-muted line-through'}`}>{t(`widgets.${w.id}`)}</span>
            <button className="rounded p-1 text-muted hover:bg-surface disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('common.moveUp')}>
              <Icon name="chevronUp" size={18} />
            </button>
            <button className="rounded p-1 text-muted hover:bg-surface disabled:opacity-30" disabled={i === layout.length - 1} onClick={() => move(i, 1)} aria-label={t('common.moveDown')}>
              <Icon name="chevronDown" size={18} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Notifications({ digestTime, onDigest }: { digestTime: string; onDigest: (v: string) => void }) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>('');
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    currentSubscription()
      .then((s) => setEnabled(!!s))
      .catch(() => setEnabled(false));
  }, []);

  const act = async (fn: () => Promise<void>, after: () => void) => {
    setBusy(true);
    setError(null);
    setMsg('');
    try {
      await fn();
      after();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2 className="section-title">{t('settings.notifications')}</h2>
      <ErrorText error={error} />
      {!pushSupported() ? (
        <p className="text-sm text-muted">{t('settings.pushUnsupported')}</p>
      ) : (
        <>
          {isIosBrowserTab() && <p className="mb-3 text-xs text-muted">{t('settings.iosHint')}</p>}
          <div className="flex flex-wrap gap-2">
            {enabled ? (
              <button className="btn-ghost" disabled={busy} onClick={() => act(disablePush, () => setEnabled(false))}>
                {t('settings.disablePush')}
              </button>
            ) : (
              <button className="btn-primary" disabled={busy} onClick={() => act(enablePush, () => setEnabled(true))}>
                <Icon name="bell" size={16} /> {t('settings.enablePush')}
              </button>
            )}
            <button className="btn-ghost" disabled={busy || !enabled} onClick={() => act(sendTestPush, () => setMsg(t('settings.testSent')))}>
              {t('settings.testPush')}
            </button>
          </div>
          {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
        </>
      )}
      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="text-sm">{t('settings.digestTime')}</span>
        <input type="time" className="input max-w-[8rem]" value={digestTime.slice(0, 5)} onChange={(e) => e.target.value && onDigest(e.target.value)} />
      </div>
    </section>
  );
}
