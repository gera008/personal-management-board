import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { addHours, endOfDay, format, startOfDay } from 'date-fns';
import { useRemove, useSave } from '@/lib/data';
import { ErrorText, Field, SaveBar, Sheet } from '@/components/ui';
import type { CalendarEvent } from '@/domain/types';

const REMINDERS = [null, 0, 5, 10, 15, 30, 60, 120, 1440];
const local = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");

export function EventSheet({ open, onClose, event, defaultStart }: { open: boolean; onClose: () => void; event?: CalendarEvent | null; defaultStart?: Date }) {
  const { t } = useTranslation();
  const save = useSave('events');
  const remove = useRemove('events');
  const [f, setF] = useState({ title: '', notes: '', location: '', start: '', end: '', all_day: false, reminder: '' as string });

  useEffect(() => {
    if (!open) return;
    if (event) {
      setF({
        title: event.title,
        notes: event.notes ?? '',
        location: event.location ?? '',
        start: local(new Date(event.start_at)),
        end: local(new Date(event.end_at)),
        all_day: event.all_day,
        reminder: event.reminder_minutes == null ? '' : String(event.reminder_minutes),
      });
    } else {
      const s = defaultStart ?? addHours(new Date(new Date().setMinutes(0, 0, 0)), 1);
      setF({ title: '', notes: '', location: '', start: local(s), end: local(addHours(s, 1)), all_day: false, reminder: '' });
    }
    save.reset();
  }, [open, event?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    let start = new Date(f.start);
    let end = new Date(f.end);
    if (f.all_day) {
      start = startOfDay(new Date(`${f.start.slice(0, 10)}T00:00`));
      end = endOfDay(new Date(`${f.end.slice(0, 10)}T00:00`));
    }
    if (end < start) end = f.all_day ? endOfDay(start) : addHours(start, 1);
    await save.mutateAsync({
      id: event?.id,
      title: f.title.trim(),
      notes: f.notes || null,
      location: f.location || null,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      all_day: f.all_day,
      reminder_minutes: f.reminder === '' ? null : Number(f.reminder),
      ...(event ? { reminder_sent_at: null } : {}),
    } as Partial<CalendarEvent>);
    onClose();
  };

  const reminderLabel = (m: number | null) =>
    m == null ? t('calendar.noReminder') : m === 0 ? t('calendar.atStart') : m < 60 ? t('calendar.minutesBefore', { count: m }) : m < 1440 ? t('calendar.hoursBefore', { count: m / 60 }) : t('calendar.daysBefore', { count: m / 1440 });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={event ? t('calendar.editEvent') : t('calendar.newEvent')}
      footer={<SaveBar onCancel={onClose} saving={save.isPending} onDelete={event ? () => remove.mutateAsync(event.id).then(onClose) : undefined} />}
    >
      <form id="sheet-form" onSubmit={submit}>
        <ErrorText error={save.error ?? remove.error} />
        <Field label={t('calendar.title')}>
          <input className="input" required autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
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
