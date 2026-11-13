import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useRemove, useSave } from '@/lib/data';
import { supabase, unwrap } from '@/lib/supabase';
import { addDays } from 'date-fns';
import { ErrorText, Group, Icon, Row, SaveBar, Sheet, Switch, TagInput, TimeSelect } from '@/components/ui';
import { toDateKey } from '@/domain/dates';
import { RecurrencePicker } from '@/components/RecurrencePicker';
import { cleanRule, type Recurrence } from '@shared/recurrence';
import type { Task, TaskList } from '@/domain/types';
import { PRIORITY_FLAGS } from './shared';

interface SubDraft {
  id?: string;
  title: string;
  completed_at: string | null;
}

export function TaskSheet({ open, onClose, task, lists, defaultListId }: { open: boolean; onClose: () => void; task?: Task | null; lists: TaskList[]; defaultListId?: string }) {
  const { t } = useTranslation();
  const save = useSave('tasks');
  const remove = useRemove('tasks');
  const [error, setError] = useState<unknown>(null);
  const [f, setF] = useState({ title: '', notes: '', list_id: '', due_date: '', due_time: '', priority: 0, tags: [] as string[], remind: false });
  const [subs, setSubs] = useState<SubDraft[]>([]);
  const [rule, setRule] = useState<Recurrence | null>(null);
  const [newSub, setNewSub] = useState('');

  useEffect(() => {
    if (!open) return;
    setError(null);
    setNewSub('');
    setF({
      title: task?.title ?? '',
      notes: task?.notes ?? '',
      list_id: task?.list_id ?? defaultListId ?? lists[0]?.id ?? '',
      due_date: task?.due_date ?? '',
      due_time: task?.due_time?.slice(0, 5) ?? '',
      priority: task?.priority ?? 0,
      tags: task?.tags ?? [],
      remind: !!task?.reminder_at,
    });
    setRule(task?.recurrence ?? null);
    setSubs((task?.subtasks ?? []).sort((a, b) => a.position - b.position).map((s) => ({ id: s.id, title: s.title, completed_at: s.completed_at })));
  }, [open, task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      // Reminder fires at the due time (09:00 when the task has a date but no time).
      const reminder_at = f.remind && f.due_date ? new Date(`${f.due_date}T${f.due_time || '09:00'}`).toISOString() : null;
      // Repeating needs a due date. The anchor (first due date) is reset whenever
      // the date or the rule changes, so the count restarts from this task.
      const cleaned = f.due_date ? cleanRule(rule) : null;
      const sameAnchor = !!task?.recurrence && task.due_date === f.due_date && JSON.stringify(cleanRule(task.recurrence)) === JSON.stringify(cleaned);
      const recurrence = cleaned ? { ...cleaned, anchor: sameAnchor ? task!.recurrence!.anchor ?? task!.due_date! : f.due_date } : null;
      const saved = await save.mutateAsync({
        id: task?.id,
        title: f.title.trim(),
        notes: f.notes || null,
        list_id: f.list_id,
        due_date: f.due_date || null,
        due_time: f.due_date && f.due_time ? f.due_time : null,
        priority: f.priority as Task['priority'],
        tags: f.tags,
        reminder_at,
        recurrence,
        ...(sameAnchor ? {} : { recurrence_index: 1 }),
        ...(reminder_at !== task?.reminder_at ? { reminder_sent_at: null } : {}),
      } as Partial<Task>);
      await syncSubtasks(saved.id);
      onClose();
    } catch (err) {
      setError(err);
    }
  };

  const syncSubtasks = async (taskId: string) => {
    const keep = subs.filter((s) => s.id).map((s) => s.id!);
    const removed = (task?.subtasks ?? []).filter((s) => !keep.includes(s.id)).map((s) => s.id);
    if (removed.length) unwrap(await supabase.from('subtasks').delete().in('id', removed));
    for (const [position, s] of subs.entries()) {
      const row = { task_id: taskId, title: s.title, completed_at: s.completed_at, position };
      if (s.id) unwrap(await supabase.from('subtasks').update(row).eq('id', s.id));
      else unwrap(await supabase.from('subtasks').insert(row));
    }
  };

  const addSub = () => {
    if (!newSub.trim()) return;
    setSubs([...subs, { title: newSub.trim(), completed_at: null }]);
    setNewSub('');
  };

  const today = new Date();
  const quickDates = [
    { label: t('tasks.today'), value: toDateKey(today) },
    { label: t('tasks.tomorrow'), value: toDateKey(addDays(today, 1)) },
    { label: t('tasks.inAWeek'), value: toDateKey(addDays(today, 7)) },
    { label: t('tasks.noDate'), value: '' },
  ];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={task ? t('tasks.editTask') : t('tasks.newTask')}
      footer={<SaveBar onCancel={onClose} saving={save.isPending} onDelete={task ? () => remove.mutateAsync(task.id).then(onClose) : undefined} />}
    >
      <form id="sheet-form" onSubmit={submit}>
        <ErrorText error={error ?? remove.error} />
        <div className="mb-4">
          <input
            className="w-full bg-transparent text-[22px] font-semibold tracking-tight outline-none placeholder:text-muted/70"
            required
            autoFocus={!task}
            aria-label={t('tasks.title')}
            placeholder={t('tasks.titlePlaceholder')}
            value={f.title}
            onChange={(e) => setF({ ...f, title: e.target.value })}
          />
          <textarea
            rows={Math.min(6, Math.max(1, f.notes.split('\n').length))}
            className="mt-1 w-full resize-none bg-transparent text-[15px] leading-snug text-fg/90 outline-none placeholder:text-muted/70"
            aria-label={t('common.notes')}
            placeholder={t('tasks.notesPlaceholder')}
            value={f.notes}
            onChange={(e) => setF({ ...f, notes: e.target.value })}
          />
        </div>

        <div className="no-scrollbar -mx-5 mb-4 flex gap-2 overflow-x-auto px-5" role="radiogroup" aria-label={t('tasks.list')}>
          {lists.map((l) => {
            const on = f.list_id === l.id;
            return (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setF({ ...f, list_id: l.id })}
                className={`chip shrink-0 gap-1.5 py-1.5 transition ${on ? 'border-fg bg-surface text-fg' : 'text-muted hover:text-fg'}`}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
                {l.name}
              </button>
            );
          })}
        </div>

        <Group>
          <div>
            <Row icon="calendar" label={t('tasks.dueDate')}>
              <input type="date" className="pill" aria-label={t('tasks.dueDate')} value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
            </Row>
            <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 pb-3">
              {quickDates.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => setF({ ...f, due_date: q.value })}
                  className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-[13px] transition ${f.due_date === q.value ? 'bg-tasks text-bg' : 'bg-surface text-muted hover:text-fg'}`}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
          {f.due_date && (
            <>
              <Row icon="clock" label={t('tasks.dueTime')}>
                <TimeSelect value={f.due_time} onChange={(due_time) => setF({ ...f, due_time })} emptyLabel={t('tasks.noTime')} aria-label={t('tasks.dueTime')} />
              </Row>
              <RecurrencePicker value={rule} onChange={setRule} anchor={f.due_date} accent="tasks" />
              <Row icon="bell" label={<span className="block truncate">{t('tasks.remind')}<span className="block truncate text-[12px] text-muted">{t('tasks.remindHint')}</span></span>}>
                <Switch checked={f.remind} onChange={(remind) => setF({ ...f, remind })} label={t('tasks.remind')} />
              </Row>
            </>
          )}
        </Group>

        <Group>
          <Row icon="flag" label={t('tasks.priority')}>
            <div className="flex rounded-full bg-surface p-0.5" role="radiogroup" aria-label={t('tasks.priority')}>
              {[0, 1, 2, 3].map((p) => (
                <button
                  type="button"
                  key={p}
                  role="radio"
                  aria-checked={f.priority === p}
                  aria-label={p === 0 ? t('tasks.none') : PRIORITY_FLAGS[p]}
                  onClick={() => setF({ ...f, priority: p })}
                  className={`h-8 min-w-[2.5rem] rounded-full px-2 text-sm font-semibold transition ${f.priority === p ? 'bg-tasks text-bg' : 'text-muted hover:text-fg'}`}
                >
                  {p === 0 ? '–' : PRIORITY_FLAGS[p]}
                </button>
              ))}
            </div>
          </Row>
          <Row icon="tag">
            <TagInput className="w-full bg-transparent py-1 text-[15px] outline-none" value={f.tags} onChange={(tags) => setF({ ...f, tags })} placeholder={t('common.addTag')} />
          </Row>
        </Group>

        <p className="section-title px-1">{t('tasks.subtasks')}</p>
        <Group className="mb-1">
          {subs.map((s, i) => (
            <div key={s.id ?? `new-${i}`} className="flex min-h-[3rem] items-center gap-3 px-4 py-1.5">
              <button
                type="button"
                role="checkbox"
                aria-checked={!!s.completed_at}
                aria-label={s.title}
                onClick={() => setSubs(subs.map((x, j) => (j === i ? { ...x, completed_at: x.completed_at ? null : new Date().toISOString() } : x)))}
                className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition ${s.completed_at ? 'border-tasks bg-tasks text-bg' : 'border-line'}`}
              >
                {s.completed_at && <Icon name="check" size={12} />}
              </button>
              <input
                className={`min-w-0 flex-1 bg-transparent text-[15px] outline-none ${s.completed_at ? 'text-muted line-through' : ''}`}
                value={s.title}
                onChange={(e) => setSubs(subs.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
              />
              <button type="button" className="rounded-full p-1 text-muted hover:text-fg" onClick={() => setSubs(subs.filter((_, j) => j !== i))} aria-label={t('common.delete')}>
                <Icon name="close" size={16} />
              </button>
            </div>
          ))}
          <div className="flex min-h-[3rem] items-center gap-3 px-4 py-1.5">
            <button type="button" className="text-tasks" onClick={addSub} aria-label={t('tasks.addSubtask')}>
              <Icon name="plus" size={18} />
            </button>
            <input
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
              placeholder={t('tasks.addSubtask')}
              value={newSub}
              onChange={(e) => setNewSub(e.target.value)}
              onBlur={addSub}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addSub();
                }
              }}
            />
          </div>
        </Group>
      </form>
    </Sheet>
  );
}

