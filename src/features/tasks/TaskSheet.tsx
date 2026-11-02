import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useRemove, useSave } from '@/lib/data';
import { supabase, unwrap } from '@/lib/supabase';
import { ErrorText, Field, Icon, SaveBar, Sheet, TagInput } from '@/components/ui';
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

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={task ? t('tasks.editTask') : t('tasks.newTask')}
      footer={<SaveBar onCancel={onClose} saving={save.isPending} onDelete={task ? () => remove.mutateAsync(task.id).then(onClose) : undefined} />}
    >
      <form id="sheet-form" onSubmit={submit}>
        <ErrorText error={error ?? remove.error} />
        <Field label={t('tasks.title')}>
          <input className="input" required autoFocus={!task} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label={t('tasks.list')}>
          <select className="input" required value={f.list_id} onChange={(e) => setF({ ...f, list_id: e.target.value })}>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('tasks.dueDate')}>
            <input type="date" className="input" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
          </Field>
          <Field label={t('tasks.dueTime')}>
            <input type="time" className="input" disabled={!f.due_date} value={f.due_time} onChange={(e) => setF({ ...f, due_time: e.target.value })} />
          </Field>
        </div>
        {f.due_date && <RecurrencePicker value={rule} onChange={setRule} anchor={f.due_date} accent="tasks" />}
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={!f.due_date} checked={f.remind && !!f.due_date} onChange={(e) => setF({ ...f, remind: e.target.checked })} />
          {t('tasks.remindAtDue')}
        </label>
        <Field label={t('tasks.priority')}>
          <div className="grid grid-cols-4 gap-1">
            {[0, 1, 2, 3].map((p) => (
              <button type="button" key={p} onClick={() => setF({ ...f, priority: p })} className={`btn border ${f.priority === p ? 'border-tasks bg-tasks/10 text-tasks' : 'border-border'}`}>
                {p === 0 ? t('tasks.none') : PRIORITY_FLAGS[p]}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t('common.tags')}>
          <TagInput value={f.tags} onChange={(tags) => setF({ ...f, tags })} placeholder={t('common.addTag')} />
        </Field>
        <div className="mb-3">
          <span className="label">{t('tasks.subtasks')}</span>
          <ul className="space-y-1">
            {subs.map((s, i) => (
              <li key={s.id ?? `new-${i}`} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!s.completed_at}
                  onChange={() => setSubs(subs.map((x, j) => (j === i ? { ...x, completed_at: x.completed_at ? null : new Date().toISOString() } : x)))}
                  aria-label={s.title}
                />
                <input className="input py-1" value={s.title} onChange={(e) => setSubs(subs.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                <button type="button" className="p-1 text-muted" onClick={() => setSubs(subs.filter((_, j) => j !== i))} aria-label={t('common.delete')}>
                  <Icon name="close" size={16} />
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-1 flex gap-2">
            <input
              className="input py-1"
              placeholder={t('tasks.addSubtask')}
              value={newSub}
              onChange={(e) => setNewSub(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addSub();
                }
              }}
            />
            <button type="button" className="btn-ghost py-1" onClick={addSub} aria-label={t('tasks.addSubtask')}>
              <Icon name="plus" size={16} />
            </button>
          </div>
        </div>
        <Field label={t('common.notes')}>
          <textarea className="input min-h-[5rem]" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </form>
    </Sheet>
  );
}

