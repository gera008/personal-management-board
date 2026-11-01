import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { supabase, unwrap } from '@/lib/supabase';
import { useInvalidate, useRows } from '@/lib/data';
import { formatDate } from '@/lib/format';
import { toDateKey } from '@/domain/dates';
import { Icon } from '@/components/ui';
import type { Task, TaskList } from '@/domain/types';

export const PRIORITY_FLAGS = ['', '!', '!!', '!!!'];

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
      unwrap(await supabase.from('tasks').update({ completed_at: task.completed_at ? null : new Date().toISOString() }).eq('id', task.id));
    },
    onSuccess: () => invalidate('tasks'),
  });
}

/** Due today or overdue, not completed. */
export const isTodayTask = (t: Task, today = toDateKey(new Date())) => !t.completed_at && !!t.due_date && t.due_date <= today;

export function TaskRow({ task, list, onOpen }: { task: Task; list?: TaskList; onOpen: () => void }) {
  const { t } = useTranslation();
  const toggle = useToggleTask();
  const today = toDateKey(new Date());
  const overdue = !task.completed_at && task.due_date && task.due_date < today;
  const subs = task.subtasks ?? [];
  return (
    <div className="flex items-start gap-3 py-2.5">
      <button
        onClick={() => toggle.mutate(task)}
        aria-label={task.completed_at ? t('tasks.markIncomplete') : t('tasks.markComplete')}
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${task.completed_at ? 'border-tasks bg-tasks text-white' : 'border-muted'}`}
        style={!task.completed_at && list ? { borderColor: list.color } : undefined}
      >
        {task.completed_at && <Icon name="check" size={12} />}
      </button>
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className={`text-sm ${task.completed_at ? 'text-muted line-through' : ''}`}>
          {task.priority > 0 && <span className="mr-1 font-bold text-tasks">{PRIORITY_FLAGS[task.priority]}</span>}
          {task.title}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {task.due_date && (
            <span className={overdue ? 'text-expense' : ''}>
              {formatDate(task.due_date, 'd MMM')}
              {task.due_time ? ` ${task.due_time.slice(0, 5)}` : ''}
            </span>
          )}
          {task.reminder_at && <Icon name="bell" size={12} />}
          {subs.length > 0 && (
            <span>
              {subs.filter((s) => s.completed_at).length}/{subs.length}
            </span>
          )}
          {list && <span style={{ color: list.color }}>{list.name}</span>}
          {task.tags.map((tag) => (
            <span key={tag} className="chip py-0">
              #{tag}
            </span>
          ))}
        </div>
      </button>
    </div>
  );
}
