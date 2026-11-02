import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/ui';
import type { WidgetId, WidgetSetting } from '@/domain/types';

const ICONS: Record<WidgetId, string> = {
  month_calendar: 'calendar',
  week_detail: 'list',
  tasks: 'tasks',
  finance_summary: 'finance',
  habits_today: 'habits',
  habit_heatmap: 'chart',
};

/**
 * Dashboard edit mode: drag the handle to reorder (pointer events, so it works
 * with touch), arrow keys on the handle do the same, and the eye shows/hides.
 */
export function LayoutEditor({ layout, onSave, onCancel, saving }: { layout: WidgetSetting[]; onSave: (l: WidgetSetting[]) => void; onCancel: () => void; saving: boolean }) {
  const { t } = useTranslation();
  const [items, setItems] = useState(layout);
  const [dragId, setDragId] = useState<WidgetId | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const move = (id: WidgetId, to: number) =>
    setItems((list) => {
      const from = list.findIndex((w) => w.id === id);
      if (from === to || to < 0 || to >= list.length) return list;
      const next = [...list];
      const [w] = next.splice(from, 1);
      next.splice(to, 0, w);
      return next;
    });

  const onPointerDown = (e: PointerEvent, id: WidgetId) => {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDragId(id);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragId || !listRef.current) return;
    // Target slot = first tile whose middle is below the pointer.
    const tiles = [...listRef.current.children] as HTMLElement[];
    let to = tiles.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    if (to === -1) to = tiles.length - 1;
    move(dragId, to);
  };

  const onKey = (e: KeyboardEvent, id: WidgetId, index: number) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      move(id, index + (e.key === 'ArrowUp' ? -1 : 1));
    }
  };

  return (
    <div>
      <p className="mb-3 text-sm text-muted">{t('dashboard.editHelp')}</p>
      <ul ref={listRef} className="space-y-2">
        {items.map((w, i) => (
          <li
            key={w.id}
            className={`card flex items-center gap-3 p-3 transition-shadow ${dragId === w.id ? 'relative z-10 scale-[1.02] shadow-lg ring-2 ring-fg' : ''} ${w.visible ? '' : 'opacity-50'}`}
          >
            <button
              type="button"
              className="flex h-9 w-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted hover:bg-surface active:cursor-grabbing"
              aria-label={t('dashboard.dragHandle', { name: t(`widgets.${w.id}`) })}
              onPointerDown={(e) => onPointerDown(e, w.id)}
              onPointerMove={onPointerMove}
              onPointerUp={() => setDragId(null)}
              onPointerCancel={() => setDragId(null)}
              onKeyDown={(e) => onKey(e, w.id, i)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                {[6, 12, 18].flatMap((y) => [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r={1.6} />))}
              </svg>
            </button>
            <Icon name={ICONS[w.id]} className="shrink-0 text-muted" />
            <span className={`flex-1 text-sm font-medium ${w.visible ? '' : 'line-through'}`}>{t(`widgets.${w.id}`)}</span>
            <button
              type="button"
              className="rounded-lg p-2 text-muted hover:bg-surface"
              aria-pressed={w.visible}
              aria-label={w.visible ? t('dashboard.hideWidget') : t('dashboard.showWidget')}
              onClick={() => setItems(items.map((x) => (x.id === w.id ? { ...x, visible: !x.visible } : x)))}
            >
              <Icon name={w.visible ? 'eye' : 'eyeOff'} size={18} />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </button>
        <button className="btn-primary" onClick={() => onSave(items)} disabled={saving}>
          {saving ? t('common.saving') : t('common.done')}
        </button>
      </div>
    </div>
  );
}
