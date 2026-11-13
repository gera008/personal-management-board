import { useTranslation } from 'react-i18next';
import { weekdayOf, type Recurrence, type RecurrenceFreq } from '@shared/recurrence';
import { formatDate } from '@/lib/format';
import { Icon } from '@/components/ui';

const FREQS: RecurrenceFreq[] = ['daily', 'weekly', 'monthly', 'yearly'];

/**
 * "Repeat" row for a form Group: frequency on the right; once it repeats, the
 * interval, weekdays (weekly) and how it ends open underneath.
 */
export function RecurrencePicker({ value, onChange, anchor, accent = 'calendar' }: { value: Recurrence | null; onChange: (r: Recurrence | null) => void; anchor: string; accent?: 'calendar' | 'tasks' }) {
  const { t } = useTranslation();
  const ends = value?.count != null ? 'count' : value?.until ? 'until' : 'never';
  const set = (patch: Partial<Recurrence>) => value && onChange({ ...value, ...patch });
  const weekdays = Array.from({ length: 7 }, (_, d) => formatDate(new Date(2026, 10, 1 + d), 'EEEEE'));
  const active = accent === 'tasks' ? 'bg-tasks text-bg' : 'bg-calendar text-bg';
  const pillInput = 'pill w-16 px-2';

  return (
    <div>
      <div className="flex min-h-[3.25rem] items-center gap-3 px-4 py-2">
        <Icon name="repeat" size={18} className="text-muted" />
        <span className="flex-1 text-[15px]">{t('recurrence.repeat')}</span>
        <select
          className="pill"
          aria-label={t('recurrence.repeat')}
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
      </div>

      {value && (
        <div className="space-y-3 px-4 pb-3 pl-[2.875rem] text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted">{t('recurrence.every')}</span>
            <input type="number" inputMode="numeric" min={1} max={365} className={pillInput} value={value.interval} onChange={(e) => set({ interval: Math.max(1, Number(e.target.value) || 1) })} aria-label={t('recurrence.every')} />
            <span>{t(`recurrence.unit.${value.freq}`, { count: value.interval })}</span>
          </div>

          {value.freq === 'weekly' && (
            <div className="flex justify-between gap-1">
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
                    className={`h-9 w-9 rounded-full text-sm font-medium capitalize transition ${on ? active : 'bg-surface text-muted'}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted">{t('recurrence.ends')}</span>
            <select
              className="pill"
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
            {ends === 'until' && <input type="date" className="pill" min={anchor} value={value.until ?? ''} onChange={(e) => set({ until: e.target.value || anchor })} />}
            {ends === 'count' && (
              <>
                <input type="number" inputMode="numeric" min={1} max={999} className={pillInput} value={value.count ?? 1} onChange={(e) => set({ count: Math.max(1, Number(e.target.value) || 1) })} />
                <span>{t('recurrence.times')}</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
