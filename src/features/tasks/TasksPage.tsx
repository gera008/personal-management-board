import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useRemove, useSave } from '@/lib/data';
import { Empty, ErrorText, Fab, Field, Icon, PageHeader, SaveBar, Sheet } from '@/components/ui';
import { toDateKey } from '@/domain/dates';
import type { Task, TaskList } from '@/domain/types';
import { TaskRow, isTodayTask, useLists, useTasks } from './shared';
import { TaskSheet } from './TaskSheet';

const LIST_ICONS = ['list', 'user', 'book', 'briefcase', 'cart', 'heart', 'star', 'flag', 'home'];
const LIST_COLORS = ['#9C6534', '#C08552', '#B0564E', '#96644F', '#4E7299', '#467659', '#75639F', '#6B7280'];

export function TasksPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const lists = useLists();
  const tasks = useTasks();
  const view = params.get('list') ?? 'today';
  const [showDone, setShowDone] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [taskSheet, setTaskSheet] = useState<{ task?: Task | null } | null>(null);
  const [listSheet, setListSheet] = useState<{ list?: TaskList | null } | null>(null);

  // Deep link from calendar/dashboard: /tasks?task=<id>
  const deepTask = params.get('task');
  useEffect(() => {
    if (!deepTask || !tasks.data) return;
    const found = tasks.data.find((x) => x.id === deepTask);
    if (found) setTaskSheet({ task: found });
    params.delete('task');
    setParams(params, { replace: true });
  }, [deepTask, tasks.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const allLists = lists.data ?? [];
  const listById = new Map(allLists.map((l) => [l.id, l]));
  const all = tasks.data ?? [];
  const today = toDateKey(new Date());
  const currentList = listById.get(view);

  let visible = view === 'today' ? all.filter((x) => isTodayTask(x, today)) : view === 'all' ? all : all.filter((x) => x.list_id === view);
  if (tagFilter) visible = visible.filter((x) => x.tags.includes(tagFilter));
  const open = visible.filter((x) => !x.completed_at);
  const done = view === 'today' ? [] : visible.filter((x) => x.completed_at);
  const tags = [...new Set(all.flatMap((x) => x.tags))].sort();

  const select = (id: string) => {
    params.set('list', id);
    setParams(params, { replace: true });
  };

  const counts = (id: string) => all.filter((x) => !x.completed_at && (id === 'today' ? isTodayTask(x, today) : id === 'all' || x.list_id === id)).length;

  return (
    <div className="md:flex md:gap-6">
      <aside className="md:w-56 md:shrink-0">
        <PageHeader
          title={t('nav.tasks')}
          right={
            <button className="btn-ghost px-2" onClick={() => setListSheet({})} aria-label={t('tasks.newList')}>
              <Icon name="plus" size={18} />
            </button>
          }
        />
        <nav className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-col md:gap-1 md:px-0">
          {[
            { id: 'today', name: t('tasks.today'), color: 'rgb(var(--tasks))', icon: 'calendar' },
            { id: 'all', name: t('tasks.all'), color: 'rgb(var(--fg))', icon: 'tasks' },
            ...allLists.map((l) => ({ id: l.id, name: l.name, color: l.color, icon: l.icon })),
          ].map((l) => (
            <button
              key={l.id}
              onClick={() => select(l.id)}
              className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-sm md:border-0 ${view === l.id ? 'border-fg bg-surface font-semibold' : 'border-border'}`}
            >
              <span style={{ color: l.color }}>
                <Icon name={l.icon} size={16} />
              </span>
              <span className="md:flex-1 md:text-left">{l.name}</span>
              <span className="text-xs text-muted">{counts(l.id) || ''}</span>
            </button>
          ))}
        </nav>
        {tags.length > 0 && (
          <div className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
            {tags.map((tag) => (
              <button key={tag} onClick={() => setTagFilter(tagFilter === tag ? null : tag)} className={`chip shrink-0 ${tagFilter === tag ? 'border-tasks bg-tasks/10 text-tasks' : ''}`}>
                #{tag}
              </button>
            ))}
          </div>
        )}
      </aside>

      <section className="min-w-0 flex-1">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold" style={currentList ? { color: currentList.color } : undefined}>
            {view === 'today' ? t('tasks.today') : view === 'all' ? t('tasks.all') : currentList?.name}
          </h2>
          {currentList && (
            <button className="btn-ghost px-2" onClick={() => setListSheet({ list: currentList })} aria-label={t('tasks.editList')}>
              <Icon name="edit" size={16} />
            </button>
          )}
        </div>
        {open.length === 0 ? (
          <Empty>{view === 'today' ? t('tasks.todayEmpty') : t('tasks.empty')}</Empty>
        ) : (
          <div className="divide-y divide-border">
            {open.map((x) => (
              <TaskRow key={x.id} task={x} list={view === 'today' || view === 'all' ? listById.get(x.list_id) : undefined} onOpen={() => setTaskSheet({ task: x })} />
            ))}
          </div>
        )}
        {done.length > 0 && (
          <div className="mt-4">
            <button className="text-sm text-muted" onClick={() => setShowDone(!showDone)}>
              {showDone ? t('tasks.hideCompleted') : t('tasks.showCompleted', { count: done.length })}
            </button>
            {showDone && (
              <div className="divide-y divide-border">
                {done.map((x) => (
                  <TaskRow key={x.id} task={x} onOpen={() => setTaskSheet({ task: x })} />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <Fab accent="ring-tasks" label={t('tasks.newTask')} onClick={() => setTaskSheet({})} />
      <TaskSheet
        open={!!taskSheet}
        onClose={() => setTaskSheet(null)}
        task={taskSheet?.task}
        lists={allLists}
        defaultListId={currentList?.id}
      />
      <ListSheet open={!!listSheet} list={listSheet?.list} position={allLists.length} onClose={() => setListSheet(null)} onDeleted={() => select('today')} />
    </div>
  );
}

function ListSheet({ open, list, position, onClose, onDeleted }: { open: boolean; list?: TaskList | null; position: number; onClose: () => void; onDeleted: () => void }) {
  const { t } = useTranslation();
  const save = useSave('task_lists');
  const remove = useRemove('task_lists');
  const [f, setF] = useState({ name: '', color: LIST_COLORS[0], icon: 'list' });
  useEffect(() => {
    if (open) setF({ name: list?.name ?? '', color: list?.color ?? LIST_COLORS[0], icon: list?.icon ?? 'list' });
  }, [open, list?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await save.mutateAsync({ id: list?.id, ...f, name: f.name.trim(), ...(list ? {} : { position }) });
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={list ? t('tasks.editList') : t('tasks.newList')}
      footer={
        <SaveBar
          onCancel={onClose}
          saving={save.isPending}
          onDelete={
            list
              ? () =>
                  remove.mutateAsync(list.id).then(() => {
                    onClose();
                    onDeleted();
                  })
              : undefined
          }
        />
      }
    >
      <form id="sheet-form" onSubmit={submit}>
        <ErrorText error={save.error ?? remove.error} />
        {list && <p className="mb-3 text-xs text-muted">{t('tasks.deleteListWarning')}</p>}
        <Field label={t('common.name')}>
          <input className="input" required autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label={t('common.color')}>
          <div className="flex flex-wrap gap-2">
            {LIST_COLORS.map((c) => (
              <button type="button" key={c} onClick={() => setF({ ...f, color: c })} className={`h-8 w-8 rounded-full ${f.color === c ? 'ring-2 ring-fg ring-offset-2 ring-offset-bg' : ''}`} style={{ background: c }} aria-label={c} />
            ))}
          </div>
        </Field>
        <Field label={t('common.icon')}>
          <div className="flex flex-wrap gap-2">
            {LIST_ICONS.map((i) => (
              <button type="button" key={i} onClick={() => setF({ ...f, icon: i })} className={`rounded-lg border p-2 ${f.icon === i ? 'border-fg bg-surface' : 'border-border'}`} style={{ color: f.color }} aria-label={i}>
                <Icon name={i} />
              </button>
            ))}
          </div>
        </Field>
      </form>
    </Sheet>
  );
}
