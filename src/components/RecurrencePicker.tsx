import { useTranslation } from 'react-i18next';
import { weekdayOf, type Recurrence, type RecurrenceFreq } from '@shared/recurrence';
import { formatDate } from '@/lib/format';

const FREQS: RecurrenceFreq[] = ['daily', 'weekly', 'monthly', 'yearly'];

/** "Repeat" control: frequency, interval, weekdays (weekly) and how it ends. */
export function RecurrencePicker({ value, onChange, anchor, accent = 'calendar' }: { value: Recurrence | null; onChange: (r: Recurrence | null) => void; anchor: string; accent?: 'calendar' | 'tasks' }) {
  const { t } = useTranslation();
  const ends = value?.count != null ? 'count' : value?.until ? 'until' : 'never';
  const set = (patch: Partial<Recurrence>) => value && onChange({ ...value, ...patch });
  const weekdays = Array.from({ length: 7 }, (_, d) => formatDate(new Date(2026, 10, 1 + d), 'EEEEE'));
  const active = accent === 'tasks' ? 'border-tasks bg-tasks/10 text-tasks' : 'border-calendar bg-calendar/10 text-calendar';

  return (
    <div className="mb-3 space-y-2">
      <label className="block">
        <span className="label">{t('recurrence.repeat')}</span>
        <select
          className="input"
          value={value?.freq ?? ''}
          onChange={(e) => {
            const freq = e.target.value as RecurrenceFreq | '';
            onChange(freq ? { freq, interval: 1, ...(freq === 'weekly' ? { byweekday: [weekdayOf(anchor)] } : {}) } : null);
          }}
        >
          <option value="">{t('recurrence.never')}</option>
          {FREQS.map((f) => (
            <option key={f} value={f}>
              {t(`recurrence.freq.${f}`)}
            </option>
          ))}
        </select>
      </label>

      {value && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-center gap-2 text-sm">
            <span>{t('recurrence.every')}</span>
            <input type="number" min={1} max={365} className="input w-20 py-1" value={value.interval} onChange={(e) => set({ interval: Math.max(1, Number(e.target.value) || 1) })} aria-label={t('recurrence.every')} />
            <span>{t(`recurrence.unit.${value.freq}`, { count: value.interval })}</span>
          </div>

          {value.freq === 'weekly' && (
            <div className="grid grid-cols-7 gap-1">
              {weekdays.map((label, d) => {
                const on = (value.byweekday ?? []).includes(d);
                return (
                  <button
                    type="button"
                    key={d}
                    aria-pressed={on}
                    onClick={() => {
                      const next = on ? (value.byweekday ?? []).filter((x) => x !== d) : [...(value.byweekday ?? []), d];
                      set({ byweekday: next.length ? next : [weekdayOf(anchor)] });
                    }}
                    className={`rounded-lg border py-1.5 text-sm ${on ? active : 'border-border'}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>{t('recurrence.ends')}</span>
            <select
              className="input w-auto py-1"
              value={ends}
              onChange={(e) => {
                const v = e.target.value;
                onChange({ ...value, count: v === 'count' ? 10 : null, until: v === 'until' ? value.until ?? anchor : null });
              }}
            >
              <option value="never">{t('recurrence.endsNever')}</option>
              <option value="until">{t('recurrence.endsOn')}</option>
              <option value="count">{t('recurrence.endsAfter')}</option>
            </select>
            {ends === 'until' && <input type="date" className="input w-auto py-1" min={anchor} value={value.until ?? ''} onChange={(e) => set({ until: e.target.value || anchor })} />}
            {ends === 'count' && (
              <>
                <input type="number" min={1} max={999} className="input w-20 py-1" value={value.count ?? 1} onChange={(e) => set({ count: Math.max(1, Number(e.target.value) || 1) })} />
                <span>{t('recurrence.times')}</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
