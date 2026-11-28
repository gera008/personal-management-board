import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useRemove, useSave } from '@/lib/data';
import { ColorDots, Empty, ErrorText, Fab, Group, Icon, PageHeader, Progress, SaveBar, Sheet, TitleInput } from '@/components/ui';
import { toDateKey } from '@/domain/dates';
import { PALETTE, type Task, type TaskList } from '@/domain/types';
import { isUndatedTask, taskBucket, type TaskBucket } from '@/domain/tasks';
import { TaskRow, isTodayTask, useLists, useTasks } from './shared';
import { TaskSheet } from './TaskSheet';
import { CategoryNav } from './CategoryNav';

const LIST_ICONS = ['list', 'user', 'book', 'briefcase', 'cart', 'heart', 'star', 'flag', 'home'];

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
  // Today also lists undated tasks, least recently touched first, so they don't get lost.
  let undated: Task[] = [];
  if (view === 'today') {
    undated = all.filter(isUndatedTask);
    if (tagFilter) undated = undated.filter((x) => x.tags.includes(tagFilter));
    undated.sort((a, b) => (a.updated_at ?? '').localeCompare(b.updated_at ?? ''));
  }


  // Open tasks grouped by how soon they're due (Today also brings the undated ones).
  const ORDER: TaskBucket[] = ['overdue', 'today', 'week', 'later', 'undated'];
  const grouped = new Map<TaskBucket, Task[]>();
  for (const x of [...open, ...undated]) {
    const b = taskBucket(x, today);
    grouped.set(b, [...(grouped.get(b) ?? []), x]);
  }
  const sections = ORDER.filter((b) => grouped.has(b)).map((b) => [b, grouped.get(b)!] as const);

  const select = (id: string) => {
    params.set('list', id);
    setParams(params, { replace: true });
  };

  const counts = (id: string) => all.filter((x) => !x.completed_at && (id === 'today' ? isTodayTask(x, today) : id === 'all' || x.list_id === id)).length;

  return (
    <div className="md:flex md:gap-6">
      <aside className="md:w-72 md:shrink-0">
        <PageHeader
          title={t('nav.tasks')}
          right={
            // New category, labelled so it isn't mistaken for the + that adds a task.
            <button className="btn-ghost px-3 py-1.5 text-[13px]" onClick={() => setListSheet({})} title={t('tasks.newList')}>
              <Icon name="plus" size={16} /> {t('tasks.newList')}
            </button>
          }
        />
        <DayProgress tasks={all} today={today} />
        <CategoryNav lists={allLists} view={view} counts={counts} onSelect={select} />
        {tags.length > 0 && (
          <div className="no-scrollbar fade-x -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
            {tags.map((tag) => (
              <button key={tag} onClick={() => setTagFilter(tagFilter === tag ? null : tag)} className={`chip shrink-0 ${tagFilter === tag ? 'border-tasks bg-tasks/10 text-tasks' : ''}`}>
                #{tag}
              </button>
            ))}
          </div>
        )}
      </aside>

      <section className="min-w-0 flex-1">
        <div className="mb-3 flex items-center gap-2">
          {currentList && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: currentList.color }} />}
          <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{view === 'today' ? t('tasks.today') : view === 'all' ? t('tasks.all') : currentList?.name}</h2>
          {currentList && (
            <button className="btn-ghost px-2" onClick={() => setListSheet({ list: currentList })} aria-label={t('tasks.editList')}>
              <Icon name="edit" size={16} />
            </button>
          )}
        </div>
        {open.length === 0 && undated.length === 0 ? (
          <Empty>{view === 'today' ? t('tasks.todayEmpty') : t('tasks.empty')}</Empty>
        ) : (
          <div className="space-y-5">
            {sections.map(([bucket, list]) => (
              <TaskSection
                key={bucket}
                // Today with only today's tasks: the page heading already says it.
                title={sections.length === 1 && bucket === 'today' ? null : bucket === 'undated' ? t('tasks.noDate') : t(`tasks.sections.${bucket}`)}
                count={list.length}
                tone={bucket === 'overdue' ? 'text-expense' : undefined}
              >
                {list.map((x) => (
                  <TaskRow key={x.id} card task={x} list={listById.get(x.list_id)} onOpen={() => setTaskSheet({ task: x })} />
                ))}
              </TaskSection>
            ))}
          </div>
        )}
        {done.length > 0 && (
          <div className="mt-5">
            <button className="section-title flex items-center gap-1.5 hover:text-fg" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
              <Icon name={showDone ? 'chevronDown' : 'chevronRight'} size={14} />
              {t('tasks.completed')} · {done.length}
            </button>
            {showDone && (
              <div className="space-y-1.5">
                {done.map((x) => (
                  <TaskRow key={x.id} card task={x} list={listById.get(x.list_id)} onOpen={() => setTaskSheet({ task: x })} />
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

/** Today at a glance: what's left and how much is done, with a bar in the accent color. */
function DayProgress({ tasks, today }: { tasks: Task[]; today: string }) {
  const { t } = useTranslation();
  const pending = tasks.filter((x) => isTodayTask(x, today)).length;
  const done = tasks.filter((x) => x.completed_at && toDateKey(new Date(x.completed_at)) === today).length;
  const total = pending + done;
  return (
    <div className="card mb-4 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] text-muted">{t('tasks.dayTitle')}</span>
        {total > 0 && <span className="text-xs text-muted">{t('tasks.dayProgress', { done, total })}</span>}
      </div>
      <div className="mt-1 text-[22px] font-semibold leading-tight tracking-tight">{pending > 0 ? t('tasks.pending', { count: pending }) : t('tasks.dayEmpty')}</div>
      {total > 0 && <Progress ratio={done / total} color="bg-accent" className="mt-3" />}
    </div>
  );
}

/** A group of task cards under a small heading with its count. */
function TaskSection({ title, count, tone, children }: { title: string | null; count: number; tone?: string; children: React.ReactNode }) {
  return (
    <section>
      {title && <h3 className={`mb-2 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide ${tone ?? 'text-muted'}`}>
        {title}
        <span className="font-normal opacity-70">· {count}</span>
      </h3>}
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function ListSheet({ open, list, position, onClose, onDeleted }: { open: boolean; list?: TaskList | null; position: number; onClose: () => void; onDeleted: () => void }) {
  const { t } = useTranslation();
  const save = useSave('task_lists');
  const remove = useRemove('task_lists');
  const [f, setF] = useState({ name: '', color: PALETTE[0], icon: 'list' });
  useEffect(() => {
    if (open) setF({ name: list?.name ?? '', color: list?.color ?? PALETTE[0], icon: list?.icon ?? 'list' });
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
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ background: `${f.color}26`, color: f.color }}>
            <Icon name={f.icon} size={22} />
          </span>
          <TitleInput value={f.name} onChange={(name) => setF({ ...f, name })} label={t('common.name')} placeholder={t('tasks.listNamePlaceholder')} autoFocus />
        </div>
        <Group>
          <div className="px-4 py-3">
            <span className="label">{t('common.color')}</span>
            <ColorDots colors={PALETTE} value={f.color} onChange={(color) => setF({ ...f, color })} />
          </div>
          <div className="px-4 py-3">
            <span className="label">{t('common.icon')}</span>
            <div className="flex flex-wrap gap-2">
              {LIST_ICONS.map((i) => (
                <button
                  type="button"
                  key={i}
                  onClick={() => setF({ ...f, icon: i })}
                  className={`flex h-10 w-10 items-center justify-center rounded-full transition ${f.icon === i ? 'bg-surface ring-2 ring-fg' : 'bg-surface/50 text-muted hover:text-fg'}`}
                  style={f.icon === i ? { color: f.color } : undefined}
                  aria-label={i}
                  aria-pressed={f.icon === i}
                >
                  <Icon name={i} size={18} />
                </button>
              ))}
            </div>
          </div>
        </Group>
        {list && <p className="px-1 text-xs text-muted">{t('tasks.deleteListWarning')}</p>}
      </form>
    </Sheet>
  );
}
