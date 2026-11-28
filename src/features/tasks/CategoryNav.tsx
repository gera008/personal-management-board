import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase, unwrap } from '@/lib/supabase';
import { useInvalidate } from '@/lib/data';
import { Icon } from '@/components/ui';
import type { TaskList } from '@/domain/types';

interface Props {
  lists: TaskList[];
  view: string;
  counts: (id: string) => number;
  onSelect: (id: string) => void;
}

/**
 * Tasks navigation. Wide screens: Today and All on top of the categories, one
 * list (categories reorder by dragging the grip). Phones: a row of chips, with
 * a "reorder" button that opens the same draggable list.
 */
export function CategoryNav({ lists, view, counts, onSelect }: Props) {
  const { t } = useTranslation();
  const [sorting, setSorting] = useState(false);
  const smart = [
    { id: 'today', name: t('tasks.today'), color: 'rgb(var(--tasks))', icon: 'calendar' },
    { id: 'all', name: t('tasks.all'), color: 'rgb(var(--fg))', icon: 'tasks' },
  ];

  return (
    <>
      {/* Phones */}
      <div className="md:hidden">
        <nav className="no-scrollbar fade-x -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
          {[...smart, ...lists.map((l) => ({ id: l.id, name: l.name, color: l.color, icon: l.icon }))].map((l) => (
            <button
              key={l.id}
              onClick={() => onSelect(l.id)}
              className={`flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-[15px] transition ${
                view === l.id ? 'border-transparent bg-fg font-semibold text-bg' : 'border-border bg-card'
              }`}
            >
              <span style={{ color: view === l.id ? undefined : l.color }}>
                <Icon name={l.icon} size={18} />
              </span>
              {l.name}
              {counts(l.id) > 0 && <span className={`text-xs ${view === l.id ? 'opacity-70' : 'text-muted'}`}>{counts(l.id)}</span>}
            </button>
          ))}
          {lists.length > 1 && (
            <button
              onClick={() => setSorting(!sorting)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-[15px] ${sorting ? 'border-accent text-accent' : 'border-border bg-card text-muted'}`}
              aria-pressed={sorting}
            >
              <Icon name="sort" size={18} />
              {sorting ? t('common.done') : t('tasks.reorder')}
            </button>
          )}
        </nav>
        {sorting && (
          <div className="mb-4">
            <SortableLists lists={lists} view={view} counts={counts} onSelect={onSelect} />
          </div>
        )}
      </div>

      {/* Wide screens */}
      <div className="hidden md:block">
        <ul className="mb-4 rounded-3xl border border-border bg-card p-1.5">
          {smart.map((l) => (
            <li key={l.id}>
              <NavItem active={view === l.id} color={l.color} icon={l.icon} name={l.name} count={counts(l.id)} onClick={() => onSelect(l.id)} />
            </li>
          ))}
        </ul>
        {lists.length > 0 && (
          <>
            <h3 className="section-title px-1">{t('tasks.categories')}</h3>
            <SortableLists lists={lists} view={view} counts={counts} onSelect={onSelect} />
          </>
        )}
      </div>
    </>
  );
}

/** A row of the wide-screen navigation: icon in its color, name and open count. The current one is inverted. */
function NavItem({ active, color, icon, name, count, onClick }: { active: boolean; color: string; icon: string; name: string; count: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full min-w-0 items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition ${active ? 'bg-fg text-bg' : 'hover:bg-surface'}`}
    >
      <span style={active ? undefined : { color }}>
        <Icon name={icon} size={18} />
      </span>
      <span className={`min-w-0 flex-1 truncate text-[15px] ${active ? 'font-semibold' : 'font-medium'}`}>{name}</span>
      {count > 0 && <span className={`text-xs tabular-nums ${active ? 'text-bg/70' : 'text-muted'}`}>{count}</span>}
    </button>
  );
}

/** Categories you can reorder by dragging the grip (mouse or touch). The new order is saved on drop. */
function SortableLists({ lists, view, counts, onSelect }: Props) {
  const { t } = useTranslation();
  const invalidate = useInvalidate();
  const [order, setOrder] = useState(lists);
  const [dragging, setDragging] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  // Follow the saved order (and new or deleted categories) when not dragging.
  useEffect(() => {
    if (!dragging) setOrder(lists);
  }, [lists]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = (e: React.PointerEvent, id: string) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(id);
    navigator.vibrate?.(8);
  };

  const move = (e: React.PointerEvent) => {
    if (!dragging) return;
    setOrder((cur) => {
      const i = cur.findIndex((l) => l.id === dragging);
      const mid = (id: string | undefined) => {
        const r = id ? rows.current.get(id)?.getBoundingClientRect() : undefined;
        return r ? r.top + r.height / 2 : NaN;
      };
      // Swap with a neighbour once the pointer passes its middle.
      if (i < cur.length - 1 && e.clientY > mid(cur[i + 1]?.id)) {
        const next = [...cur];
        [next[i], next[i + 1]] = [next[i + 1], next[i]];
        return next;
      }
      if (i > 0 && e.clientY < mid(cur[i - 1]?.id)) {
        const next = [...cur];
        [next[i], next[i - 1]] = [next[i - 1], next[i]];
        return next;
      }
      return cur;
    });
  };

  const end = async () => {
    if (!dragging) return;
    setDragging(null);
    const changed = order.map((l, i) => ({ l, i })).filter(({ l, i }) => l.position !== i);
    if (!changed.length) return;
    await Promise.all(changed.map(({ l, i }) => supabase.from('task_lists').update({ position: i }).eq('id', l.id).then(unwrap)));
    invalidate('task_lists');
  };

  return (
    <ul className="rounded-3xl border border-border bg-card p-1.5">
      {order.map((l) => {
        const active = view === l.id;
        const lifted = dragging === l.id;
        return (
          <li
            key={l.id}
            ref={(el) => {
              if (el) rows.current.set(l.id, el);
              else rows.current.delete(l.id);
            }}
            className={`flex items-center gap-1 rounded-2xl transition-shadow ${lifted ? 'relative z-10 bg-line shadow-[0_8px_24px_rgb(0_0_0/0.45)]' : ''}`}
          >
            <div className="min-w-0 flex-1">
              <NavItem active={active && !lifted} color={l.color} icon={l.icon} name={l.name} count={counts(l.id)} onClick={() => onSelect(l.id)} />
            </div>
            <span
              role="button"
              aria-label={t('tasks.dragToReorder', { name: l.name })}
              title={t('tasks.dragToReorder', { name: l.name })}
              onPointerDown={(e) => start(e, l.id)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              className="flex h-10 w-8 shrink-0 cursor-grab touch-none items-center justify-center text-muted hover:text-fg active:cursor-grabbing"
            >
              <Icon name="grip" size={18} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
