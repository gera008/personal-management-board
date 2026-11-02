import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { addHours, endOfDay, format, startOfDay } from 'date-fns';
import { supabase, unwrap } from '@/lib/supabase';
import { useInvalidate } from '@/lib/data';
import { ErrorText, Field, SaveBar, Sheet } from '@/components/ui';
import { RecurrencePicker } from '@/components/RecurrencePicker';
import { cleanRule, type Recurrence } from '@shared/recurrence';
import { planSeriesDelete, planSeriesEdit, type EventFields, type SeriesPlan, type SeriesScope } from '@/domain/eventSeries';
import type { CalendarEvent } from '@/domain/types';

const REMINDERS = [null, 0, 5, 10, 15, 30, 60, 120, 1440];
const local = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");

export interface EventTarget {
  event?: CalendarEvent | null;
  /** Occurrence being opened when the event repeats. */
  occurrence?: string | null;
  instanceStart?: Date;
  instanceEnd?: Date;
  defaultStart?: Date;
}

export function EventSheet({ open, onClose, target }: { open: boolean; onClose: () => void; target: EventTarget | null }) {
  const { t } = useTranslation();
  const invalidate = useInvalidate();
  const event = target?.event ?? null;
  const occurrence = event?.recurrence ? target?.occurrence ?? null : null;
  const [f, setF] = useState({ title: '', notes: '', location: '', start: '', end: '', all_day: false, reminder: '' as string });
  const [rule, setRule] = useState<Recurrence | null>(null);
  const [ask, setAsk] = useState<'save' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    setAsk(null);
    setError(null);
    if (event) {
      setF({
        title: event.title,
        notes: event.notes ?? '',
        location: event.location ?? '',
        // A repeating event opens at the occurrence that was tapped.
        start: local(target?.instanceStart ?? new Date(event.start_at)),
        end: local(target?.instanceEnd ?? new Date(event.end_at)),
        all_day: event.all_day,
        reminder: event.reminder_minutes == null ? '' : String(event.reminder_minutes),
      });
      setRule(event.recurrence);
    } else {
      const s = target?.defaultStart ?? addHours(new Date(new Date().setMinutes(0, 0, 0)), 1);
      setF({ title: '', notes: '', location: '', start: local(s), end: local(addHours(s, 1)), all_day: false, reminder: '' });
      setRule(null);
    }
  }, [open, event?.id, occurrence]); // eslint-disable-line react-hooks/exhaustive-deps

  const formValues = () => {
    let start = new Date(f.start);
    let end = new Date(f.end);
    if (f.all_day) {
      start = startOfDay(new Date(`${f.start.slice(0, 10)}T00:00`));
      end = endOfDay(new Date(`${f.end.slice(0, 10)}T00:00`));
    }
    if (end < start) end = f.all_day ? endOfDay(start) : addHours(start, 1);
    const fields: EventFields = {
      title: f.title.trim(),
      notes: f.notes || null,
      location: f.location || null,
      all_day: f.all_day,
      reminder_minutes: f.reminder === '' ? null : Number(f.reminder),
    };
    return { fields, start, end };
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      invalidate('events');
      onClose();
    } catch (err) {
      setError(err);
      setAsk(null);
    } finally {
      setBusy(false);
    }
  };

  const applyPlan = async (plan: SeriesPlan) => {
    if (!event) return;
    if (plan.deleteMaster) unwrap(await supabase.from('events').delete().eq('id', event.id));
    else if (plan.updateMaster) unwrap(await supabase.from('events').update(plan.updateMaster).eq('id', event.id));
    if (plan.insert) unwrap(await supabase.from('events').insert(plan.insert));
  };

  const saveSimple = () =>
    run(async () => {
      const { fields, start, end } = formValues();
      const row = { ...fields, start_at: start.toISOString(), end_at: end.toISOString(), recurrence: cleanRule(rule), reminder_sent_at: null, reminder_sent_for: null };
      if (event) unwrap(await supabase.from('events').update(row).eq('id', event.id));
      else unwrap(await supabase.from('events').insert(row));
    });

  const saveScoped = (scope: SeriesScope) =>
    run(async () => {
      const { fields, start, end } = formValues();
      await applyPlan(planSeriesEdit(event!, occurrence!, target!.instanceStart!, { fields, start, end, rule }, scope));
    });

  const removeScoped = (scope: SeriesScope) => run(() => applyPlan(planSeriesDelete(event!, occurrence!, scope)));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (occurrence) setAsk('save');
    else saveSimple();
  };

  const onDelete = () => {
    if (occurrence) setAsk('delete');
    else
      run(async () => {
        unwrap(await supabase.from('events').delete().eq('id', event!.id));
      });
  };

  const reminderLabel = (m: number | null) =>
    m == null ? t('calendar.noReminder') : m === 0 ? t('calendar.atStart') : m < 60 ? t('calendar.minutesBefore', { count: m }) : m < 1440 ? t('calendar.hoursBefore', { count: m / 60 }) : t('calendar.daysBefore', { count: m / 1440 });

  const anchor = f.start.slice(0, 10);
  // A one-off copy of a single occurrence can't repeat on its own.
  const canRepeat = !event?.recurrence_parent_id;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={event ? t('calendar.editEvent') : t('calendar.newEvent')}
      footer={
        ask ? (
          <div className="w-full space-y-2">
            <p className="text-sm font-medium">{ask === 'save' ? t('recurrence.saveWhich') : t('recurrence.deleteWhich')}</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {(['this', 'following', 'all'] as SeriesScope[]).map((scope) => (
                <button
                  key={scope}
                  type="button"
                  disabled={busy}
                  className={ask === 'delete' ? 'btn-danger' : 'btn-ghost'}
                  onClick={() => (ask === 'save' ? saveScoped(scope) : removeScoped(scope))}
                >
                  {t(`recurrence.scope.${scope}`)}
                </button>
              ))}
            </div>
            <button type="button" className="w-full text-sm text-muted" onClick={() => setAsk(null)}>
              {t('common.cancel')}
            </button>
          </div>
        ) : (
          <SaveBar onCancel={onClose} saving={busy} onDelete={event ? onDelete : undefined} confirmDelete={!occurrence} />
        )
      }
    >
      <form id="sheet-form" onSubmit={submit}>
        <ErrorText error={error} />
        <Field label={t('calendar.title')}>
          <input className="input" required autoFocus={!event} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.all_day} onChange={(e) => setF({ ...f, all_day: e.target.checked })} />
          {t('calendar.allDay')}
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('calendar.start')}>
            {f.all_day ? (
              <input type="date" className="input" required value={f.start.slice(0, 10)} onChange={(e) => setF({ ...f, start: `${e.target.value}T00:00` })} />
            ) : (
              <input type="datetime-local" className="input" required value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
            )}
          </Field>
          <Field label={t('calendar.end')}>
            {f.all_day ? (
              <input type="date" className="input" required value={f.end.slice(0, 10)} onChange={(e) => setF({ ...f, end: `${e.target.value}T00:00` })} />
            ) : (
              <input type="datetime-local" className="input" required value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />
            )}
          </Field>
        </div>
        {canRepeat && anchor && <RecurrencePicker value={rule} onChange={setRule} anchor={anchor} />}
        <Field label={t('calendar.location')}>
          <input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
        </Field>
        <Field label={t('calendar.reminder')}>
          <select className="input" value={f.reminder} onChange={(e) => setF({ ...f, reminder: e.target.value })}>
            {REMINDERS.map((m) => (
              <option key={String(m)} value={m == null ? '' : m}>
                {reminderLabel(m)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('common.notes')}>
          <textarea className="input min-h-[5rem]" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </form>
    </Sheet>
  );
}
