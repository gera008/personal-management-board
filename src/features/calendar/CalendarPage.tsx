import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { addDays, addMonths, addWeeks, isSameMonth, isSameYear, setHours, startOfDay } from 'date-fns';
import { useProfile } from '@/lib/profile';
import { formatDate } from '@/lib/format';
import { Fab, Icon, Segmented } from '@/components/ui';
import { daysBetween, useCalendarItems, itemsForDay, type CalItem } from './items';
import { AgendaView, ItemCard, MonthGrid, TimeGrid, WeekStrip, monthRange, weekRange } from './views';
import { EventSheet, type EventTarget } from './EventSheet';

type View = 'month' | 'week' | 'day' | 'agenda';
const AGENDA_DAYS = 60;
/** On phones the "week" shows this many days: seven columns are too narrow to read. */
const PHONE_DAYS = 3;

function usePhone() {
  const query = '(max-width: 639px)';
  const [phone, setPhone] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setPhone(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return phone;
}

/** A horizontal swipe (touch) calls `onSwipe(1)` for left, `onSwipe(-1)` for right. */
function useSwipe(onSwipe: (dir: 1 | -1) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const p = e.touches[0];
      start.current = e.touches.length === 1 ? { x: p.clientX, y: p.clientY } : null;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const p = e.changedTouches[0];
      const dx = p.clientX - s.x;
      const dy = p.clientY - s.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipe(dx < 0 ? 1 : -1);
    },
  };
}

/** "28 – 30 nov", or "30 nov – 2 dic" across months. */
function rangeTitle(from: Date, last: Date) {
  return isSameMonth(from, last) ? `${formatDate(from, 'd')} – ${formatDate(last, 'd MMM')}` : `${formatDate(from, 'd MMM')} – ${formatDate(last, 'd MMM')}`;
}

export function CalendarPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { weekStartsOn } = useProfile();
  const phone = usePhone();
  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [sheet, setSheet] = useState<EventTarget | null>(null);

  const threeDays = view === 'week' && phone;
  const range =
    view === 'month'
      ? monthRange(cursor, weekStartsOn)
      : threeDays
        ? { from: cursor, to: addDays(cursor, PHONE_DAYS) }
        : view === 'week'
          ? weekRange(cursor, weekStartsOn)
          : view === 'day'
            ? // The strip on top shows the whole week's dots.
              weekRange(cursor, weekStartsOn)
            : { from: startOfDay(new Date()), to: addDays(startOfDay(new Date()), AGENDA_DAYS) };
  const { items } = useCalendarItems(range.from, range.to);

  const step = (dir: 1 | -1) =>
    setCursor((c) => (view === 'month' ? addMonths(c, dir) : threeDays ? addDays(c, dir * PHONE_DAYS) : view === 'week' ? addWeeks(c, dir) : addDays(c, dir)));
  const swipe = useSwipe((dir) => view !== 'agenda' && step(dir));

  const openItem = (i: CalItem) =>
    i.kind === 'event' ? setSheet({ event: i.event, occurrence: i.occurrence, instanceStart: i.start, instanceEnd: i.end }) : navigate(`/tasks?task=${i.id}`);

  const title =
    view === 'month'
      ? // Phones leave out the current year so the month fits beside the arrows.
        formatDate(cursor, phone && isSameYear(cursor, new Date()) ? 'MMMM' : 'MMMM yyyy')
      : view === 'week'
        ? rangeTitle(range.from, addDays(range.to, -1))
        : view === 'day'
          ? formatDate(cursor, phone ? 'EEE d MMM' : 'EEEE d MMMM')
          : t('calendar.upcoming');

  const dayItems = itemsForDay(items, cursor);
  const dayList = (
    <section>
      <h3 className="section-title capitalize">{formatDate(cursor, 'EEEE d MMMM')}</h3>
      <div className="space-y-1.5">
        {dayItems.map((i) => (
          <ItemCard key={i.kind + i.id} item={i} onClick={() => openItem(i)} />
        ))}
        {dayItems.length === 0 && <p className="text-sm text-muted">{t('calendar.nothing')}</p>}
      </div>
    </section>
  );

  return (
    <div>
      {/* The period is the page title: the tab bar already says this is the calendar. */}
      <header className="mb-3 flex items-center gap-2">
        <h1 className="min-w-0 flex-1 truncate text-[24px] font-semibold leading-tight first-letter:uppercase tracking-[-0.4px] sm:text-[30px]">{title}</h1>
        {view !== 'agenda' && (
          <>
            <button className="btn-round h-10 w-10" onClick={() => step(-1)} aria-label={t('common.previous')}>
              <Icon name="chevronLeft" size={18} />
            </button>
            <button className="btn-round h-10 w-10" onClick={() => step(1)} aria-label={t('common.next')}>
              <Icon name="chevronRight" size={18} />
            </button>
          </>
        )}
        <button className="btn-ghost h-10 px-3.5 py-0" onClick={() => setCursor(startOfDay(new Date()))}>
          {t('calendar.today')}
        </button>
      </header>
      <Segmented
        className="mb-4 w-full sm:w-auto"
        value={view}
        onChange={setView}
        options={(['month', 'week', 'day', 'agenda'] as View[]).map((v) => ({ value: v, label: t(v === 'week' && phone ? 'calendar.views.threeDays' : `calendar.views.${v}`) }))}
      />

      <div {...swipe}>
        {view === 'month' && (
          <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start lg:gap-6">
            <MonthGrid month={cursor} items={items} weekStartsOn={weekStartsOn} selected={cursor} onSelect={setCursor} onItem={openItem} />
            {/* The selected day: under the grid on phones, beside it on wide screens. */}
            <div className="mt-4 lg:sticky lg:top-24 lg:mt-6">{dayList}</div>
          </div>
        )}
        {view === 'day' && <WeekStrip selected={cursor} items={items} weekStartsOn={weekStartsOn} onSelect={setCursor} />}
        {(view === 'week' || view === 'day') && (
          <TimeGrid
            days={view === 'day' ? [cursor] : daysBetween(range.from, range.to)}
            items={items}
            onItem={openItem}
            onSlot={(d, h) => setSheet({ defaultStart: setHours(d, h) })}
            onDay={(d) => {
              setCursor(d);
              setView('day');
            }}
          />
        )}
        {view === 'agenda' && <AgendaView from={range.from} to={range.to} items={items} onItem={openItem} />}
      </div>

      <Fab accent="ring-calendar" label={t('calendar.newEvent')} onClick={() => setSheet({ defaultStart: view === 'agenda' ? undefined : setHours(cursor, Math.max(9, new Date().getHours() + 1)) })} />
      <EventSheet open={!!sheet} onClose={() => setSheet(null)} target={sheet} />
    </div>
  );
}
