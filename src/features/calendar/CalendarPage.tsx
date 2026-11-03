import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { addDays, addMonths, addWeeks, setHours, startOfDay } from 'date-fns';
import { useProfile } from '@/lib/profile';
import { formatDate } from '@/lib/format';
import { Fab, Icon, PageHeader, Segmented } from '@/components/ui';
import { daysBetween, useCalendarItems, itemsForDay, type CalItem } from './items';
import { AgendaView, ItemChip, MonthGrid, TimeGrid, monthRange, weekRange } from './views';
import { EventSheet, type EventTarget } from './EventSheet';

type View = 'month' | 'week' | 'day' | 'agenda';
const AGENDA_DAYS = 60;

export function CalendarPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { weekStartsOn } = useProfile();
  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [sheet, setSheet] = useState<EventTarget | null>(null);

  const range =
    view === 'month' ? monthRange(cursor, weekStartsOn) : view === 'week' ? weekRange(cursor, weekStartsOn) : view === 'day' ? { from: cursor, to: addDays(cursor, 1) } : { from: cursor, to: addDays(cursor, AGENDA_DAYS) };
  const { items } = useCalendarItems(range.from, range.to);

  const step = (dir: 1 | -1) =>
    setCursor((c) => (view === 'month' ? addMonths(c, dir) : view === 'week' ? addWeeks(c, dir) : view === 'day' ? addDays(c, dir) : addDays(c, dir * AGENDA_DAYS)));

  const openItem = (i: CalItem) =>
    i.kind === 'event' ? setSheet({ event: i.event, occurrence: i.occurrence, instanceStart: i.start, instanceEnd: i.end }) : navigate(`/tasks?task=${i.id}`);

  const title =
    view === 'month' ? formatDate(cursor, 'MMMM yyyy') : view === 'week' ? `${formatDate(range.from, 'd MMM')} – ${formatDate(addDays(range.to, -1), 'd MMM')}` : view === 'day' ? formatDate(cursor, 'EEEE d MMMM') : t('calendar.upcoming');

  return (
    <div>
      <PageHeader title={t('nav.calendar')}>
        <Segmented
          className="mt-3 w-full sm:w-auto"
          value={view}
          onChange={setView}
          options={(['month', 'week', 'day', 'agenda'] as View[]).map((v) => ({ value: v, label: t(`calendar.views.${v}`) }))}
        />
      </PageHeader>

      <div className="mb-3 flex items-center gap-2">
        <button className="btn-ghost px-2" onClick={() => step(-1)} aria-label={t('common.previous')}>
          <Icon name="chevronLeft" size={18} />
        </button>
        <button className="btn-ghost px-2" onClick={() => step(1)} aria-label={t('common.next')}>
          <Icon name="chevronRight" size={18} />
        </button>
        <h2 className="flex-1 truncate text-lg font-semibold capitalize">{title}</h2>
        <button className="btn-ghost" onClick={() => setCursor(startOfDay(new Date()))}>
          {t('calendar.today')}
        </button>
      </div>

      {view === 'month' && (
        <>
          <MonthGrid month={cursor} items={items} weekStartsOn={weekStartsOn} selected={cursor} onSelect={setCursor} onItem={openItem} />
          {/* Selected day details (most useful on phones where cells only show dots) */}
          <section className="mt-4">
            <h3 className="section-title capitalize">{formatDate(cursor, 'EEEE d MMMM')}</h3>
            <div className="space-y-1">
              {itemsForDay(items, cursor).map((i) => (
                <ItemChip key={i.kind + i.id} item={i} onClick={() => openItem(i)} />
              ))}
              {itemsForDay(items, cursor).length === 0 && <p className="text-sm text-muted">{t('calendar.nothing')}</p>}
            </div>
          </section>
        </>
      )}
      {(view === 'week' || view === 'day') && (
        <TimeGrid
          days={view === 'week' ? daysBetween(range.from, range.to) : [cursor]}
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

      <Fab accent="ring-calendar" label={t('calendar.newEvent')} onClick={() => setSheet({ defaultStart: view === 'agenda' ? undefined : setHours(cursor, Math.max(9, new Date().getHours() + 1)) })} />
      <EventSheet open={!!sheet} onClose={() => setSheet(null)} target={sheet} />
    </div>
  );
}
