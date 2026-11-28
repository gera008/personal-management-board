import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { supabase, unwrap } from '@/lib/supabase';
import { useInvalidate, useRows } from '@/lib/data';
import { formatDate } from '@/lib/format';
import { toDateKey } from '@/domain/dates';
import { nextTaskInstance, staleDays } from '@/domain/tasks';
import { Icon } from '@/components/ui';
import type { Task, TaskList } from '@/domain/types';


export function useTasks() {
  return useRows('tasks', {
    key: ['all'],
    select: '*, subtasks(*)',
    filter: (q) => q.order('completed_at', { ascending: true, nullsFirst: true }).order('due_date', { ascending: true, nullsFirst: false }).order('position'),
  });
}

export function useLists() {
  return useRows('task_lists', { filter: (q) => q.order('position') });
}

export function useToggleTask() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (task: Task) => {
      const completing = !task.completed_at;
      unwrap(await supabase.from('tasks').update({ completed_at: completing ? new Date().toISOString() : null }).eq('id', task.id));
      if (completing) await createNextInstance(task);
    },
    onSuccess: () => invalidate('tasks'),
  });
}

/**
 * Completing a repeating task creates its next instance with fresh subtasks.
 * A unique index on recurrence_parent_id means completing it again (after
 * un-checking) never creates a second copy.
 */
async function createNextInstance(task: Task) {
  const next = nextTaskInstance(task);
  if (!next) return;
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      list_id: task.list_id,
      title: task.title,
      notes: task.notes,
      due_time: task.due_time,
      priority: task.priority,
      tags: task.tags,
      position: task.position,
      recurrence: task.recurrence,
      recurrence_parent_id: task.id,
      ...next,
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') return; // successor already exists
    throw new Error(error.message);
  }
  const subs = (task.subtasks ?? []).map((s) => ({ task_id: data.id, title: s.title, position: s.position }));
  if (subs.length) unwrap(await supabase.from('subtasks').insert(subs));
}

/** Due today or overdue, not completed. */
export const isTodayTask = (t: Task, today = toDateKey(new Date())) => !t.completed_at && !!t.due_date && t.due_date <= today;

/** Priority as three rising bars, the filled ones in the tasks color. */
export function PriorityBars({ level, className = '' }: { level: number; className?: string }) {
  const { t } = useTranslation();
  if (!level) return null;
  return (
    <span className={`inline-flex items-end gap-[2px] ${className}`} role="img" aria-label={`${t('tasks.priority')}: ${t(`tasks.priorities.${level}`)}`}>
      {[1, 2, 3].map((b) => (
        <span key={b} className={`w-[3px] rounded-full ${b <= level ? 'bg-tasks' : 'bg-line'}`} style={{ height: 4 + b * 3 }} />
      ))}
    </span>
  );
}

/** The task checkbox: a rounded square in the category color, filled with a check once done. */
export function TaskCheck({ task, color, onToggle, size = 20 }: { task: Task; color?: string; onToggle: () => void; size?: number }) {
  const { t } = useTranslation();
  const done = !!task.completed_at;
  return (
    <button
      onClick={onToggle}
      aria-label={done ? t('tasks.markIncomplete') : t('tasks.markComplete')}
      className={`flex shrink-0 items-center justify-center rounded-[7px] border-2 transition active:scale-90 ${done ? 'border-accent bg-accent text-bg' : 'border-line hover:bg-surface'}`}
      style={{ width: size, height: size, ...(!done && color ? { borderColor: color } : {}) }}
    >
      {done && <Icon name="check" size={size - 8} />}
    </button>
  );
}

/**
 * One task. `card` draws it as its own card with the category's color on the
 * left edge (Tasks page); without it, a plain row for lists inside a card.
 */
export function TaskRow({ task, list, onOpen, card }: { task: Task; list?: TaskList; onOpen: () => void; card?: boolean }) {
  const { t } = useTranslation();
  const toggle = useToggleTask();
  const today = toDateKey(new Date());
  const overdue = !task.completed_at && task.due_date && task.due_date < today;
  const subs = task.subtasks ?? [];
  const stale = staleDays(task);
  const color = list?.color;
  return (
    <div
      className={`flex items-start gap-3 ${card ? 'rounded-2xl border border-border bg-card py-3 pl-3 pr-3.5' : 'py-2.5'}`}
      style={card && color ? { boxShadow: `inset 3px 0 0 ${color}` } : undefined}
    >
      <span className={card ? 'ml-1 mt-px' : 'mt-px'}>
        <TaskCheck task={task} color={color} onToggle={() => toggle.mutate(task)} />
      </span>
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className={`flex items-start gap-2 ${card ? 'text-[15px]' : 'text-sm'} ${task.completed_at ? 'text-muted line-through' : ''}`}>
          <span className="min-w-0 flex-1">{task.title}</span>
          <PriorityBars level={task.priority} className="mt-1 shrink-0" />
        </div>
        {/* A peek at the notes (two lines at most) without opening the task. */}
        {task.notes?.trim() && <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-xs text-muted">{task.notes.trim()}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
          {task.due_date && (
            <span className={`inline-flex items-center gap-1 ${overdue ? 'font-medium text-expense' : ''}`}>
              <Icon name="calendar" size={12} />
              {formatDate(task.due_date, 'd MMM')}
              {task.due_time ? ` · ${task.due_time.slice(0, 5)}` : ''}
            </span>
          )}
          {stale != null && (
            <span className="text-tasks" title={t('tasks.staleHint')}>
              {stale >= 60 ? t('tasks.staleMonths', { count: Math.floor(stale / 30) }) : t('tasks.staleWeeks', { count: Math.floor(stale / 7) })}
            </span>
          )}
          {task.reminder_at && <Icon name="bell" size={12} />}
          {task.recurrence && (
            <span title={t('recurrence.repeats')} aria-label={t('recurrence.repeats')}>
              <Icon name="repeat" size={12} />
            </span>
          )}
          {subs.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <Icon name="tasks" size={12} />
              {subs.filter((s) => s.completed_at).length}/{subs.length}
            </span>
          )}
          {list && (
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: list.color }} />
              {list.name}
            </span>
          )}
          {task.tags.map((tag) => (
            <span key={tag} className="text-muted">
              #{tag}
            </span>
          ))}
        </div>
      </button>
    </div>
  );
}
