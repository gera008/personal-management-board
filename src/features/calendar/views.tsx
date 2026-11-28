import { addDays, endOfMonth, endOfWeek, isSameDay, isSameMonth, isToday, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

/** Tasks and events wear their category's color. */
export const itemColor = (i: CalItem) => i.color;
/** Colored left edge and a soft fill of the item's color. */
const tint = (i: CalItem, pct: number) => ({ borderColor: itemColor(i), background: `color-mix(in srgb, ${itemColor(i)} ${pct}%, transparent)` });

export function ItemChip({ item, onClick, compact }: { item: CalItem; onClick?: () => void; compact?: boolean }) {
  const isTask = item.kind === 'task';
  return (
    <button
      onClick={onClick}
      className={`flex w-full min-w-0 items-center gap-1.5 rounded-md border-l-2 px-1.5 py-0.5 text-left text-xs ${
        item.done ? 'text-muted line-through' : ''
      }`}
      style={tint(item, 26)}
    >
      {isTask && <span className="h-2.5 w-2.5 shrink-0 rounded-[3px] border" style={{ borderColor: item.color, background: item.done ? item.color : undefined }} />}
      {!compact && !item.allDay && <span className="shrink-0 text-muted">{timeLabel(item.start)}</span>}
      <span className="truncate">{item.title}</span>
    </button>
  );
}

/** Readable card for one item: color edge (a ring for tasks), title, time and place. */
export function ItemCard({ item, onClick }: { item: CalItem; onClick: () => void }) {
  const { t } = useTranslation();
  const isTask = item.kind === 'task';
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2.5 text-left transition hover:bg-surface">
      {isTask ? (
        <span className="h-4 w-4 shrink-0 rounded-[5px] border-2" style={{ borderColor: item.color, background: item.done ? item.color : undefined }} />
      ) : (
        <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: itemColor(item) }} />
      )}
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[15px] font-medium ${item.done ? 'text-muted line-through' : ''}`}>{item.title}</div>
        <div className="truncate text-xs text-muted">
          {item.allDay ? t('calendar.allDay') : isTask ? timeLabel(item.start) : `${timeLabel(item.start)} – ${timeLabel(item.end)}`}
          {item.event?.location ? ` · ${item.event.location}` : ''}
        </div>
      </div>
    </button>
  );
}

/** The week around `selected` as a row of days with dots; tapping one selects it. */
export function WeekStrip({ selected, items, weekStartsOn, onSelect }: { selected: Date; items: CalItem[]; weekStartsOn: 0 | 1; onSelect: (d: Date) => void }) {
  const { from, to } = weekRange(selected, weekStartsOn);
  return (
    <div className="mb-3 grid grid-cols-7 gap-1">
      {daysBetween(from, to).map((d) => {
        const sel = isSameDay(d, selected);
        const dots = itemsForDay(items, d).slice(0, 3);
        return (
          <button
            key={d.toISOString()}
            onClick={() => onSelect(d)}
            className={`flex flex-col items-center gap-0.5 rounded-2xl py-1.5 transition ${sel ? 'bg-fg text-bg' : 'hover:bg-surface'}`}
          >
            <span className={`text-[11px] uppercase ${sel ? 'text-bg/70' : 'text-muted'}`}>{formatDate(d, 'EEEEE')}</span>
            <span className={`text-[17px] font-semibold leading-tight ${!sel && isToday(d) ? 'text-accent' : ''}`}>{formatDate(d, 'd')}</span>
            <span className="flex h-1.5 gap-0.5">
              {dots.map((i) => (
                <span key={i.kind + i.id} className="h-1.5 w-1.5 rounded-full" style={{ background: itemColor(i) }} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
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
  short,
}: {
  month: Date;
  items: CalItem[];
  weekStartsOn: 0 | 1;
  selected?: Date;
  onSelect?: (d: Date) => void;
  onItem?: (i: CalItem) => void;
  compact?: boolean;
  /** Lower rows (the Overview's month card), so a quiet month doesn't fill the screen. */
  short?: boolean;
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
              className={`min-w-0 cursor-pointer bg-bg p-1 ${compact ? 'h-12' : short ? 'min-h-[4.5rem]' : 'min-h-[4.5rem] sm:min-h-[6rem]'} ${isSameMonth(d, month) ? '' : 'text-muted/60'} ${sel ? 'ring-2 ring-inset ring-accent' : ''}`}
            >
              <div className={`mb-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs ${isToday(d) ? 'bg-accent font-semibold text-bg' : ''}`}>{formatDate(d, 'd')}</div>
              {compact ? (
                <div className="flex flex-wrap gap-0.5 px-0.5">
                  {dayItems.slice(0, 4).map((i) => (
                    <span key={i.kind + i.id} className={`h-1.5 w-1.5 rounded-full ${i.done ? 'opacity-40' : ''}`} style={{ background: itemColor(i) }} />
                  ))}
                </div>
              ) : (
                <div className="hidden space-y-0.5 sm:block">
                  {dayItems.slice(0, 3).map((i) => (
                    <ItemChip key={i.kind + i.id} item={i} compact onClick={() => onItem?.(i)} />
                  ))}
                  {dayItems.length > 3 && <div className="px-1 text-[11px] text-muted">+{dayItems.length - 3}</div>}
                </div>
              )}
              {!compact && (
                <div className="flex flex-wrap gap-0.5 px-0.5 sm:hidden">
                  {dayItems.slice(0, 4).map((i) => (
                    <span key={i.kind + i.id} className="h-1.5 w-1.5 rounded-full" style={{ background: itemColor(i) }} />
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
            <button onClick={() => onDay?.(d)} className={`w-12 shrink-0 text-left ${isToday(d) ? 'text-accent' : ''}`}>
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
function TimedBlock({ item, short, narrow, onClick }: { item: CalItem; short: boolean; narrow?: boolean; onClick: () => void }) {
  const isTask = item.kind === 'task';
  // Week columns are narrow: just the start time under the title.
  const time = isTask || narrow ? timeLabel(item.start) : `${timeLabel(item.start)} – ${timeLabel(item.end)}`;
  return (
    <button
      onClick={onClick}
      className={`flex h-full w-full min-w-0 overflow-hidden rounded-md border-l-2 px-1.5 py-0.5 text-left text-xs ${short && !narrow ? 'items-center gap-1.5' : 'flex-col'} ${
        narrow ? 'px-1 text-[11px] leading-tight' : ''
      } ${item.done ? 'text-muted line-through' : ''}`}
      style={tint(item, 32)}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {isTask && <span className="h-2.5 w-2.5 shrink-0 rounded-[3px] border" style={{ borderColor: item.color, background: item.done ? item.color : undefined }} />}
        {/* Narrow week columns wrap the title over the block's height instead of cutting it to one line. */}
        <span className={`font-medium ${narrow && !short ? '[overflow-wrap:anywhere]' : 'truncate'}`}>{item.title}</span>
      </span>
      {!(short && narrow) && <span className="shrink-0 truncate text-muted">{time}</span>}
      {!short && !narrow && item.event?.location && <span className="truncate text-muted">{item.event.location}</span>}
    </button>
  );
}

/**
 * Day and week views: one column per day on a 24-hour grid, Google Calendar
 * style. Timed items span their duration; all-day items sit in a row on top.
 */
export function TimeGrid({
  days,
  items,
  onItem,
  onSlot,
  onDay,
}: {
  days: Date[];
  items: CalItem[];
  onItem: (i: CalItem) => void;
  onSlot: (day: Date, hour: number) => void;
  onDay?: (d: Date) => void;
}) {
  const { t } = useTranslation();
  const now = useNow();
  const columns = days.map((d) => {
    const dayItems = itemsForDay(items, d);
    return {
      day: d,
      allDay: dayItems.filter((i) => i.allDay),
      slots: layoutDay(
        dayItems.filter((i) => !i.allDay),
        d,
      ),
    };
  });
  const hasAllDay = columns.some((c) => c.allDay.length);
  const multi = days.length > 1;
  const px = (minutes: number) => (minutes / 60) * HOUR_PX;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  // The grid is the page's only scroller: as tall as the screen allows above the tab bar.
  const [height, setHeight] = useState<number>();
  // Open an hour before now when today is shown, else on the morning.
  const scroller = useRef<HTMLDivElement>(null);
  const showsToday = days.some((d) => isSameDay(d, now));
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = (showsToday ? Math.max(0, now.getHours() - 1) : FIRST_VISIBLE_HOUR) * HOUR_PX;
    // Once its height is known: before that the grid isn't a scroller yet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showsToday, height === undefined]);
  useLayoutEffect(() => {
    const measure = () => {
      const el = scroller.current;
      if (!el) return;
      const tabBar = document.querySelector('[data-tabbar]')?.getBoundingClientRect().height ?? 0;
      const top = el.getBoundingClientRect().top + window.scrollY;
      setHeight(Math.max(280, window.innerHeight - top - tabBar - 16));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [hasAllDay, multi]);

  return (
    <div>
      {multi && (
        <div className="flex">
          <div className="w-12 shrink-0" />
          {columns.map(({ day }) => (
            <button key={day.toISOString()} onClick={() => onDay?.(day)} className="min-w-0 flex-1 pb-2 text-center">
              <div className={`text-[11px] uppercase ${isToday(day) ? 'text-accent' : 'text-muted'}`}>{formatDate(day, 'EEE')}</div>
              <div
                className={`mx-auto mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-lg font-semibold ${
                  isToday(day) ? 'bg-accent text-bg' : ''
                }`}
              >
                {formatDate(day, 'd')}
              </div>
            </button>
          ))}
        </div>
      )}
      {hasAllDay && (
        <div className="flex border-t border-border">
          <div className="w-12 shrink-0 py-1 pr-1 text-right text-[11px] uppercase leading-tight text-muted">{t('calendar.allDay')}</div>
          {columns.map(({ day, allDay }) => (
            <div key={day.toISOString()} className={`min-w-0 flex-1 space-y-1 p-1 ${multi ? 'border-l border-border' : ''}`}>
              {allDay.map((i) => (
                <ItemChip key={i.kind + i.id} item={i} compact={multi} onClick={() => onItem(i)} />
              ))}
            </div>
          ))}
        </div>
      )}
      <div ref={scroller} className="no-scrollbar flex overflow-y-auto border-t border-border" style={{ height }}>
        <div className="w-12 shrink-0">
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="pr-1 pt-1 text-right text-[11px] text-muted" style={{ height: HOUR_PX }}>
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>
        {columns.map(({ day, slots }) => (
          <div key={day.toISOString()} className={`relative min-w-0 flex-1 ${multi ? 'border-l border-border' : ''}`} style={{ height: 24 * HOUR_PX }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="border-b border-border" style={{ height: HOUR_PX }} onClick={() => onSlot(day, h)} />
            ))}
            {slots.map(({ item, top, bottom, col, cols }) => (
              <div
                key={item.kind + item.id}
                className="absolute px-px pb-px"
                style={{ top: px(top), height: px(bottom - top), ...horizontal(col, cols, multi) }}
              >
                {/* Solid backing so the hour lines don't show through the tinted block. */}
                <div className="h-full rounded-md bg-bg ring-1 ring-bg">
                  <TimedBlock item={item} short={bottom - top < 45} narrow={multi} onClick={() => onItem(item)} />
                </div>
              </div>
            ))}
            {isSameDay(day, now) && (
              <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: px(nowMinutes) - 4 }}>
                <span className="-ml-1 h-2 w-2 rounded-full bg-expense" />
                <span className="h-0.5 flex-1 bg-expense" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const FIRST_VISIBLE_HOUR = 7;

/**
 * Horizontal placement of an overlapping item. A full-width day splits the
 * width into columns; narrow week columns cascade instead (each later item is
 * indented and drawn on top) so titles stay readable, like Google Calendar.
 */
function horizontal(col: number, cols: number, cascade: boolean) {
  if (cols === 1) return { left: 0, width: '100%' };
  if (!cascade) return { left: `${(col / cols) * 100}%`, width: `${100 / cols}%` };
  const indent = Math.min(35, 60 / (cols - 1)) * col;
  return { left: `${indent}%`, width: `${100 - indent}%` };
}

/** Current time, refreshed every minute for the "now" line. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
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
          <h3 className={`section-title capitalize ${isToday(d) ? 'text-accent' : ''}`}>{formatDate(d, 'EEEE d MMMM')}</h3>
          <div className="space-y-1.5">
            {list.map((i) => (
              <ItemCard key={i.kind + i.id} item={i} onClick={() => onItem(i)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
