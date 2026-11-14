import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, unwrap } from '@/lib/supabase';
import { googleCall } from '@/lib/google';
import { formatDate } from '@/lib/format';
import { ErrorText, Icon, Switch } from '@/components/ui';

interface GoogleAccount {
  email: string | null;
  default_calendar_id: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  tasks_enabled: boolean;
  scopes: string | null;
}

const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';

interface GoogleCalendar {
  calendar_id: string;
  summary: string;
  color: string | null;
  access_role: string | null;
  sync_enabled: boolean;
}

const writable = (c: GoogleCalendar) => c.access_role === 'owner' || c.access_role === 'writer';

/** Settings › Google Calendar: connect, choose calendars and the default one for new events. */
export function GoogleCalendarSettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');

  const account = useQuery({
    queryKey: ['google', 'account'],
    queryFn: async () => unwrap(await supabase.from('google_accounts').select('*').maybeSingle()) as GoogleAccount | null,
  });
  const calendars = useQuery({
    queryKey: ['google', 'calendars'],
    enabled: !!account.data,
    queryFn: async () => unwrap(await supabase.from('google_calendars').select('*').order('summary')) as GoogleCalendar[],
  });

  // Back from Google's consent screen: /settings?google=connected|cancelled|error
  useEffect(() => {
    const result = params.get('google');
    if (!result) return;
    setNotice(t(`google.result.${result}`, { defaultValue: '' }));
    params.delete('google');
    setParams(params, { replace: true });
    qc.invalidateQueries({ queryKey: ['google'] });
    qc.invalidateQueries({ queryKey: ['events'] });
    qc.invalidateQueries({ queryKey: ['tasks'] });
    qc.invalidateQueries({ queryKey: ['task_lists'] });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    setNotice('');
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ['google'] });
      qc.invalidateQueries({ queryKey: ['events'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['task_lists'] });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const connect = () =>
    run('connect', async () => {
      const data = await googleCall({ mode: 'auth-url', returnTo: window.location.origin });
      window.location.href = data.url;
    });

  const a = account.data;
  const cals = calendars.data ?? [];
  const tasksAllowed = (a?.scopes ?? '').includes(TASKS_SCOPE);

  // Turning Tasks on may need Google's permission first: then it goes to the consent screen.
  const setTasks = (enabled: boolean) =>
    run('tasks', async () => {
      if (enabled && !confirm(t('google.tasksConfirm'))) return;
      const data = await googleCall({ mode: 'set-tasks', enabled });
      if (data?.needsReconnect) {
        const auth = await googleCall({ mode: 'auth-url', returnTo: window.location.origin });
        window.location.href = auth.url;
      }
    });

  return (
    <section className="card">
      <h2 className="section-title">{t('google.title')}</h2>
      <ErrorText error={error} />
      {notice && <p className="mb-3 rounded-2xl bg-surface px-3 py-2 text-sm">{notice}</p>}

      {!a ? (
        <>
          <p className="mb-3 text-sm text-muted">{t('google.help')}</p>
          <button className="btn-primary" onClick={connect} disabled={busy === 'connect'}>
            <Icon name="calendar" size={16} /> {t('google.connect')}
          </button>
        </>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 text-sm">
              <div className="truncate font-medium">{a.email}</div>
              <div className="text-xs text-muted">
                {a.last_sync_at ? `${t('google.lastSync')}: ${formatDate(a.last_sync_at, 'd MMM HH:mm')}` : t('google.neverSynced')}
              </div>
              {a.last_error && <div className="text-xs text-expense">{a.last_error}</div>}
            </div>
            <button className="btn-ghost" onClick={() => run('sync', () => googleCall({ mode: 'sync' }))} disabled={!!busy}>
              <Icon name="repeat" size={16} /> {busy === 'sync' ? t('garmin.syncing') : t('garmin.syncNow')}
            </button>
          </div>

          <div>
            <div className="label">{t('google.calendars')}</div>
            <ul className="divide-y divide-border">
              {cals.map((c) => (
                <li key={c.calendar_id} className="flex items-center gap-3 py-2">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c.color ?? 'rgb(var(--muted))' }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{c.summary}</div>
                    {!writable(c) && <div className="text-[11px] text-muted">{t('google.readOnlyCalendar')}</div>}
                  </div>
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={c.sync_enabled}
                    disabled={!!busy}
                    aria-label={c.summary}
                    onChange={() => {
                      if (c.sync_enabled && !confirm(t('google.disableConfirm', { name: c.summary }))) return;
                      run(`cal-${c.calendar_id}`, () => googleCall({ mode: 'set-calendar', calendarId: c.calendar_id, enabled: !c.sync_enabled }));
                    }}
                  />
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl bg-surface px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">{t('google.tasksTitle')}</div>
                <div className="text-xs text-muted">{t('google.tasksHelp')}</div>
              </div>
              <Switch checked={!!a.tasks_enabled && tasksAllowed} onChange={setTasks} disabled={!!busy} label={t('google.tasksTitle')} />
            </div>
            {a.tasks_enabled && !tasksAllowed && (
              <button className="btn-ghost mt-2" onClick={connect} disabled={!!busy}>
                {t('google.tasksReconnect')}
              </button>
            )}
          </div>

          <label className="block">
            <span className="label">{t('google.defaultCalendar')}</span>
            <select
              className="input"
              value={a.default_calendar_id ?? ''}
              onChange={(e) => run('default', async () => unwrap(await supabase.from('google_accounts').update({ default_calendar_id: e.target.value }).not('user_id', 'is', null)))}
            >
              {cals.filter(writable).map((c) => (
                <option key={c.calendar_id} value={c.calendar_id}>
                  {c.summary}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-muted">{t('google.defaultHelp')}</span>
          </label>

          <button
            className="btn-danger"
            disabled={!!busy}
            onClick={() => confirm(t('google.disconnectConfirm')) && run('disconnect', () => googleCall({ mode: 'disconnect' }))}
          >
            {t('google.disconnect')}
          </button>
        </div>
      )}
    </section>
  );
}
