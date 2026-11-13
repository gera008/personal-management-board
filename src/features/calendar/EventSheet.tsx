import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { addHours, addMinutes, differenceInMinutes, endOfDay, format, startOfDay } from 'date-fns';
import { supabase, unwrap } from '@/lib/supabase';
import { useInvalidate } from '@/lib/data';
import { syncGoogleSoon } from '@/lib/google';
import { ErrorText, Group, Row, SaveBar, Sheet, Switch, TimeSelect } from '@/components/ui';
import { RecurrencePicker } from '@/components/RecurrencePicker';
import { cleanRule, type Recurrence } from '@shared/recurrence';
import { planSeriesDelete, planSeriesEdit, type EventFields, type SeriesPlan, type SeriesScope } from '@/domain/eventSeries';
import { DEFAULT_EVENT_COLOR, type CalendarEvent } from '@/domain/types';
import { useLists } from '../tasks/shared';

const REMINDERS = [null, 0, 5, 10, 15, 30, 60, 120, 1440];
const DURATIONS = [15, 30, 45, 60, 90, 120];
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
  const [f, setF] = useState({ title: '', notes: '', location: '', start: '', end: '', all_day: false, reminder: '' as string, list_id: null as string | null });
  const [rule, setRule] = useState<Recurrence | null>(null);
  const [ask, setAsk] = useState<'save' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const lists = (useLists().data ?? []).map((l) => ({ id: l.id as string | null, name: l.name, color: l.color }));
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
        list_id: event.list_id ?? null,
      });
      setRule(event.recurrence);
    } else {
      const s = target?.defaultStart ?? addHours(new Date(new Date().setMinutes(0, 0, 0)), 1);
      setF({ title: '', notes: '', location: '', start: local(s), end: local(addHours(s, 1)), all_day: false, reminder: '', list_id: null });
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
      list_id: f.list_id,
    };
    return { fields, start, end };
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      invalidate('events');
      syncGoogleSoon();
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
  const [startDate, startTime] = [f.start.slice(0, 10), f.start.slice(11, 16)];
  const [endDate, endTime] = [f.end.slice(0, 10), f.end.slice(11, 16)];
  const duration = f.start && f.end ? differenceInMinutes(new Date(f.end), new Date(f.start)) : 0;
  /** Moving the start keeps the event's length, so the end follows it. */
  const setStart = (start: string) => {
    const keep = duration > 0 ? duration : 60;
    setF({ ...f, start, end: local(addMinutes(new Date(start), keep)) });
  };
  const durationLabel = (m: number) => (m < 60 ? t('calendar.minutesShort', { count: m }) : m % 60 ? t('calendar.hoursMinutesShort', { h: Math.floor(m / 60), m: m % 60 }) : t('calendar.hoursShort', { count: m / 60 }));
  const readonly = !!event?.google_readonly;
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
        ) : readonly ? (
          <button type="button" className="btn-ghost ml-auto" onClick={onClose}>
            {t('common.close')}
          </button>
        ) : (
          <SaveBar onCancel={onClose} saving={busy} onDelete={event ? onDelete : undefined} confirmDelete={!occurrence} />
        )
      }
    >
      <form id="sheet-form" onSubmit={submit}>
        <ErrorText error={error} />
        {event?.google_event_id && (
          <p className="mb-3 rounded-2xl bg-surface px-3 py-2 text-xs text-muted">{readonly ? t('google.eventReadOnly') : t('google.eventLinked')}</p>
        )}
        <fieldset disabled={readonly} className="min-w-0">
          <input
            className="mb-4 w-full bg-transparent text-[22px] font-semibold tracking-tight outline-none placeholder:text-muted/70"
            required
            autoFocus={!event}
            aria-label={t('calendar.title')}
            placeholder={t('calendar.titlePlaceholder')}
            value={f.title}
            onChange={(e) => setF({ ...f, title: e.target.value })}
          />

          <div className="no-scrollbar -mx-5 mb-4 flex gap-2 overflow-x-auto px-5" role="radiogroup" aria-label={t('calendar.category')}>
            {[{ id: null, name: t('calendar.noCategory'), color: DEFAULT_EVENT_COLOR }, ...lists].map((l) => (
              <button
                key={l.id ?? 'none'}
                type="button"
                role="radio"
                aria-checked={f.list_id === l.id}
                onClick={() => setF({ ...f, list_id: l.id })}
                className={`chip shrink-0 gap-1.5 py-1.5 transition ${f.list_id === l.id ? 'border-fg bg-surface text-fg' : 'text-muted hover:text-fg'}`}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
                {l.name}
              </button>
            ))}
          </div>

          <Group>
            <Row icon="clock" label={t('calendar.allDay')}>
              <Switch checked={f.all_day} onChange={(all_day) => setF({ ...f, all_day })} label={t('calendar.allDay')} disabled={readonly} />
            </Row>
            {[
              { label: t('calendar.start'), date: startDate, time: startTime, onDate: (d: string) => setStart(`${d}T${startTime}`), onTime: (v: string) => setStart(`${startDate}T${v}`), min: undefined, timeLabel: t('calendar.startTime') },
              { label: t('calendar.end'), date: endDate, time: endTime, onDate: (d: string) => setF({ ...f, end: `${d}T${endTime}` }), onTime: (v: string) => setF({ ...f, end: `${endDate}T${v}` }), min: startDate, timeLabel: t('calendar.endTime') },
            ].map((r) => (
              <div key={r.label} className="flex min-h-[3.25rem] items-center gap-2 px-4 py-2">
                <span className="w-12 shrink-0 text-[15px] text-muted">{r.label}</span>
                <div className="flex min-w-0 flex-1 justify-end gap-2">
                  <input type="date" className="pill min-w-0 flex-1 px-3 sm:max-w-[11rem] sm:flex-none" required min={r.min} aria-label={r.label} value={r.date} onChange={(e) => e.target.value && r.onDate(e.target.value)} />
                  {!f.all_day && <TimeSelect value={r.time} onChange={(v) => v && r.onTime(v)} aria-label={r.timeLabel} />}
                </div>
              </div>
            ))}
            {!f.all_day && (
              <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 py-2.5">
                {DURATIONS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setF({ ...f, end: local(addMinutes(new Date(f.start), m)) })}
                    className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-[13px] transition ${duration === m ? 'bg-calendar text-bg' : 'bg-surface text-muted hover:text-fg'}`}
                  >
                    {durationLabel(m)}
                  </button>
                ))}
              </div>
            )}
            {canRepeat && anchor && <RecurrencePicker value={rule} onChange={setRule} anchor={anchor} />}
          </Group>

          <Group>
            <Row icon="pin">
              <input className="w-full bg-transparent py-1 text-[15px] outline-none placeholder:text-muted" aria-label={t('calendar.location')} placeholder={t('calendar.locationPlaceholder')} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
            </Row>
            <Row icon="bell" label={t('calendar.reminder')}>
              <select className="pill max-w-[11rem]" aria-label={t('calendar.reminder')} value={f.reminder} onChange={(e) => setF({ ...f, reminder: e.target.value })}>
                {REMINDERS.map((m) => (
                  <option key={String(m)} value={m == null ? '' : m}>
                    {reminderLabel(m)}
                  </option>
                ))}
              </select>
            </Row>
          </Group>

          <Group className="mb-1">
            <textarea
              rows={3}
              className="block w-full resize-y bg-transparent px-4 py-3 text-[15px] outline-none placeholder:text-muted"
              aria-label={t('common.notes')}
              placeholder={t('common.notes')}
              value={f.notes}
              onChange={(e) => setF({ ...f, notes: e.target.value })}
            />
          </Group>
        </fieldset>
      </form>
    </Sheet>
  );
}
