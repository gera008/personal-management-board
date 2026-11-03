import { addDays, endOfMonth, endOfWeek, isSameDay, isSameMonth, isToday, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { formatDate } from '@/lib/format';
import { Empty } from '@/components/ui';
import { daysBetween, itemsForDay, layoutDay, type CalItem } from './items';

export function monthRange(month: Date, weekStartsOn: 0 | 1) {
  const from = startOfWeek(startOfMonth(month), { weekStartsOn });
  const to = startOfDay(addDays(endOfWeek(endOfMonth(month), { weekStartsOn }), 1));
  return { from, to };
}

export function weekRange(day: Date, weekStartsOn: 0 | 1) {
  const from = startOfWeek(day, { weekStartsOn });
  return { from, to: addDays(from, 7) };
}

const timeLabel = (d: Date) => formatDate(d, 'HH:mm');

export function ItemChip({ item, onClick, compact }: { item: CalItem; onClick?: () => void; compact?: boolean }) {
  const isTask = item.kind === 'task';
  return (
    <button
      onClick={onClick}
      className={`flex w-full min-w-0 items-center gap-1.5 rounded-md border-l-2 px-1.5 py-0.5 text-left text-xs ${
        isTask ? 'border-tasks bg-tasks/10' : 'border-calendar bg-calendar/10'
      } ${item.done ? 'text-muted line-through' : ''}`}
    >
      {isTask && <span className={`h-2.5 w-2.5 shrink-0 rounded-full border border-tasks ${item.done ? 'bg-tasks' : ''}`} />}
      {!compact && !item.allDay && <span className="shrink-0 text-muted">{timeLabel(item.start)}</span>}
      <span className="truncate">{item.title}</span>
    </button>
  );
}

/** Month grid. Compact mode shows dots instead of titles (dashboard / phone). */
export function MonthGrid({
  month,
  items,
  weekStartsOn,
  selected,
  onSelect,
  onItem,
  compact,
}: {
  month: Date;
  items: CalItem[];
  weekStartsOn: 0 | 1;
  selected?: Date;
  onSelect?: (d: Date) => void;
  onItem?: (i: CalItem) => void;
  compact?: boolean;
}) {
  const { from, to } = monthRange(month, weekStartsOn);
  const days = daysBetween(from, to);
  return (
    <div>
      <div className="grid grid-cols-7 text-center text-[11px] uppercase text-muted">
        {days.slice(0, 7).map((d) => (
          <div key={d.toISOString()} className="py-1">
            {formatDate(d, 'EEEEE')}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
        {days.map((d) => {
          const dayItems = itemsForDay(items, d);
          const sel = selected && isSameDay(d, selected);
          return (
            <div
              key={d.toISOString()}
              onClick={() => onSelect?.(d)}
              className={`min-w-0 cursor-pointer bg-bg p-1 ${compact ? 'h-12' : 'min-h-[4.5rem] sm:min-h-[6rem]'} ${isSameMonth(d, month) ? '' : 'text-muted/60'} ${sel ? 'ring-2 ring-inset ring-fg' : ''}`}
            >
              <div className={`mb-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs ${isToday(d) ? 'bg-calendar font-semibold text-bg' : ''}`}>{formatDate(d, 'd')}</div>
              {compact ? (
                <div className="flex flex-wrap gap-0.5 px-0.5">
                  {dayItems.slice(0, 4).map((i) => (
                    <span key={i.kind + i.id} className={`h-1.5 w-1.5 rounded-full ${i.kind === 'task' ? 'bg-tasks' : 'bg-calendar'} ${i.done ? 'opacity-40' : ''}`} />
                  ))}
                </div>
              ) : (
                <div className="hidden space-y-0.5 sm:block">
                  {dayItems.slice(0, 3).map((i) => (
                    <ItemChip key={i.kind + i.id} item={i} compact onClick={() => onItem?.(i)} />
                  ))}
                  {dayItems.length > 3 && <div className="px-1 text-[10px] text-muted">+{dayItems.length - 3}</div>}
                </div>
              )}
              {!compact && (
                <div className="flex flex-wrap gap-0.5 px-0.5 sm:hidden">
                  {dayItems.slice(0, 4).map((i) => (
                    <span key={i.kind + i.id} className={`h-1.5 w-1.5 rounded-full ${i.kind === 'task' ? 'bg-tasks' : 'bg-calendar'}`} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Week as a stacked day list (works at phone width). */
export function WeekList({ start, items, onItem, onDay }: { start: Date; items: CalItem[]; onItem?: (i: CalItem) => void; onDay?: (d: Date) => void }) {
  const { t } = useTranslation();
  return (
    <div className="divide-y divide-border">
      {daysBetween(start, addDays(start, 7)).map((d) => {
        const dayItems = itemsForDay(items, d);
        return (
          <div key={d.toISOString()} className="flex gap-3 py-2">
            <button onClick={() => onDay?.(d)} className={`w-12 shrink-0 text-left ${isToday(d) ? 'text-calendar' : ''}`}>
              <div className="text-[11px] uppercase text-muted">{formatDate(d, 'EEE')}</div>
              <div className="text-lg font-semibold leading-tight">{formatDate(d, 'd')}</div>
            </button>
            <div className="min-w-0 flex-1 space-y-1 pt-0.5">
              {dayItems.length === 0 ? <div className="pt-1 text-xs text-muted">{t('calendar.nothing')}</div> : dayItems.map((i) => <ItemChip key={i.kind + i.id} item={i} onClick={() => onItem?.(i)} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const HOUR_PX = 44;

/** An item on the day's time grid, filling the height of its time span. */
function TimedBlock({ item, short, onClick }: { item: CalItem; short: boolean; onClick: () => void }) {
  const isTask = item.kind === 'task';
  const time = isTask ? timeLabel(item.start) : `${timeLabel(item.start)} – ${timeLabel(item.end)}`;
  return (
    <button
      onClick={onClick}
      className={`flex h-full w-full min-w-0 overflow-hidden rounded-md border-l-2 px-1.5 py-0.5 text-left text-xs ${
        isTask ? 'border-tasks bg-tasks/15' : 'border-calendar bg-calendar/15'
      } ${short ? 'items-center gap-1.5' : 'flex-col'} ${item.done ? 'text-muted line-through' : ''}`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {isTask && <span className={`h-2.5 w-2.5 shrink-0 rounded-full border border-tasks ${item.done ? 'bg-tasks' : ''}`} />}
        <span className="truncate font-medium">{item.title}</span>
      </span>
      <span className="shrink-0 truncate text-muted">{time}</span>
      {!short && item.event?.location && <span className="truncate text-muted">{item.event.location}</span>}
    </button>
  );
}

export function DayView({ day, items, onItem, onHour }: { day: Date; items: CalItem[]; onItem: (i: CalItem) => void; onHour: (h: number) => void }) {
  const { t } = useTranslation();
  const dayItems = itemsForDay(items, day);
  const allDay = dayItems.filter((i) => i.allDay);
  const slots = layoutDay(
    dayItems.filter((i) => !i.allDay),
    day,
  );
  const px = (minutes: number) => (minutes / 60) * HOUR_PX;
  return (
    <div>
      {allDay.length > 0 && (
        <div className="mb-2 space-y-1 rounded-lg bg-surface p-2">
          <div className="text-[11px] uppercase text-muted">{t('calendar.allDay')}</div>
          {allDay.map((i) => (
            <ItemChip key={i.kind + i.id} item={i} onClick={() => onItem(i)} />
          ))}
        </div>
      )}
      <div className="flex gap-2 border-t border-border">
        <div className="w-12 shrink-0">
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="pt-1 text-right text-[11px] text-muted" style={{ height: HOUR_PX }}>
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>
        <div className="relative min-w-0 flex-1" style={{ height: 24 * HOUR_PX }}>
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="border-b border-border" style={{ height: HOUR_PX }} onClick={() => onHour(h)} />
          ))}
          {slots.map(({ item, top, bottom, col, cols }) => (
            <div
              key={item.kind + item.id}
              className="absolute px-px pb-px"
              style={{ top: px(top), height: px(bottom - top), left: `${(col / cols) * 100}%`, width: `${100 / cols}%` }}
            >
              {/* Solid backing so the hour lines don't show through the tinted block. */}
              <div className="h-full rounded-md bg-bg">
                <TimedBlock item={item} short={bottom - top < 45} onClick={() => onItem(item)} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AgendaView({ from, to, items, onItem }: { from: Date; to: Date; items: CalItem[]; onItem: (i: CalItem) => void }) {
  const { t } = useTranslation();
  const days = daysBetween(from, to)
    .map((d) => ({ d, list: itemsForDay(items, d) }))
    .filter((x) => x.list.length);
  if (!days.length) return <Empty>{t('calendar.agendaEmpty')}</Empty>;
  return (
    <div className="space-y-4">
      {days.map(({ d, list }) => (
        <section key={d.toISOString()}>
          <h3 className={`section-title ${isToday(d) ? 'text-calendar' : ''}`}>{formatDate(d, 'EEEE d MMMM')}</h3>
          <div className="space-y-1">
            {list.map((i) => (
              <button key={i.kind + i.id} onClick={() => onItem(i)} className="flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2 text-left">
                <span className={`h-8 w-1 shrink-0 rounded-full ${i.kind === 'task' ? 'bg-tasks' : 'bg-calendar'}`} />
                <div className="min-w-0 flex-1">
                  <div className={`truncate text-sm font-medium ${i.done ? 'text-muted line-through' : ''}`}>{i.title}</div>
                  <div className="text-xs text-muted">
                    {i.allDay ? t('calendar.allDay') : i.kind === 'task' ? timeLabel(i.start) : `${timeLabel(i.start)} – ${timeLabel(i.end)}`}
                    {i.event?.location ? ` · ${i.event.location}` : ''}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
