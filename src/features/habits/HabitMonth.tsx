import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, endOfMonth, endOfWeek, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import { useProfile } from '@/lib/profile';
import { formatDate } from '@/lib/format';
import { Icon } from '@/components/ui';
import { toDateKey } from '@/domain/dates';
import { dayState, logMap, monthSummary, nextTap, type DayState } from '@/domain/habits/streaks';
import { num, type Habit } from '@/domain/types';
import { useHabitLogs, useLogHabit } from './shared';

/**
 * One habit's month as a calendar you can tap. Good habits cycle
 * done → didn't do it → empty; bad habits toggle clean ↔ slip; numeric
 * habits open a small editor below the grid.
 */
export function HabitMonth({ habit, month }: { habit: Habit; month: Date }) {
  const { t } = useTranslation();
  const { weekStartsOn } = useProfile();
  const logs = useHabitLogs();
  const log = useLogHabit();
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => setEditing(null), [habit.id, month.getTime()]);

  const today = toDateKey(new Date());
  const map = logMap(logs.data ?? [], habit.id);
  const days: Date[] = [];
  for (let d = startOfWeek(startOfMonth(month), { weekStartsOn }); d <= endOfWeek(endOfMonth(month), { weekStartsOn }); d = addDays(d, 1)) days.push(d);
  const summary = monthSummary(habit, map, month, today);
  const isBad = habit.kind === 'bad';
  // Bad habits: clean days wear the habit's own color (softly), slips are red.
  const color = isBad ? 'rgb(var(--slip))' : habit.color;
  const cleanColor = habit.color;

  const tap = (date: string, state: DayState) => {
    const action = nextTap(habit, state);
    if (!action) return;
    if (action === 'ask') return setEditing(editing === date ? null : date);
    log.mutate({ habit, date, ...action });
  };

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] uppercase text-muted">
        {days.slice(0, 7).map((d) => (
          <div key={d.getDay()}>{formatDate(d, 'EEEEE')}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {days.map((d) => {
          const key = toDateKey(d);
          if (!isSameMonth(d, month)) return <div key={key} />;
          const state = dayState(habit, map, key, today);
          const value = num(map.get(key)?.value);
          return (
            <DayCell
              key={key}
              day={d.getDate()}
              state={state}
              color={state === 'clean' || state === 'pending' ? cleanColor : color}
              isToday={key === today}
              selected={editing === key}
              label={habit.type === 'numeric' && (state === 'done' || state === 'partial') ? String(value) : undefined}
              onClick={() => tap(key, state)}
              aria={`${formatDate(d, 'd MMMM')}: ${t(`habits.state.${state}`)}`}
            />
          );
        })}
      </div>

      {editing && <ValueEditor habit={habit} date={editing} current={map.get(editing)} onDone={() => setEditing(null)} />}

      <p className="mt-3 text-xs text-muted">
        {isBad
          ? t('habits.monthBad', { clean: summary.clean, slips: summary.slips })
          : t('habits.monthGood', { done: summary.done, missed: summary.missed, rate: Math.round(summary.rate * 100) })}
      </p>
      <p className="mt-1 text-[11px] text-muted">{isBad ? t('habits.monthHintBad') : habit.type === 'numeric' ? t('habits.monthHintNumeric') : t('habits.monthHintGood')}</p>
    </div>
  );
}

function DayCell({
  day,
  state,
  color,
  isToday,
  selected,
  label,
  onClick,
  aria,
}: {
  day: number;
  state: DayState;
  color: string;
  isToday: boolean;
  selected: boolean;
  label?: string;
  onClick: () => void;
  aria: string;
}) {
  const disabled = state === 'future' || state === 'beforeStart' || state === 'notDue';
  const filled = state === 'done';
  const style: React.CSSProperties =
    state === 'done'
      ? { background: color, borderColor: color, color: 'rgb(var(--bg))' }
      : state === 'partial'
        ? { borderColor: color, background: `color-mix(in srgb, ${color} 30%, transparent)` }
        : state === 'clean'
          ? { background: `color-mix(in srgb, ${color} 28%, transparent)`, borderColor: 'transparent' }
          : state === 'slip'
            ? { background: 'rgb(var(--slip))', borderColor: 'rgb(var(--slip))', color: 'rgb(var(--bg))' }
            : {};
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={aria}
      className={`relative flex aspect-square flex-col items-center justify-center rounded-lg border text-xs transition ${
        disabled ? 'border-transparent opacity-35' : 'border-border hover:border-current'
      } ${state === 'missed' ? 'border-expense/60 text-expense' : ''} ${isToday ? 'ring-1 ring-current ring-offset-1 ring-offset-bg' : ''} ${selected ? 'ring-2 ring-current' : ''}`}
      style={style}
    >
      <span className={`absolute left-1 top-0.5 text-[10px] ${filled || state === 'slip' ? 'opacity-80' : 'text-muted'}`}>{day}</span>
      {state === 'done' && !label && <Icon name="check" size={16} />}
      {(state === 'missed' || state === 'slip') && <Icon name="close" size={16} />}
      {label && <span className="text-sm font-semibold">{label}</span>}
    </button>
  );
}

/** Numeric habits: type the day's value, mark it as not done, or clear it. */
function ValueEditor({ habit, date, current, onDone }: { habit: Habit; date: string; current?: { value: number | string; is_slip: boolean }; onDone: () => void }) {
  const { t } = useTranslation();
  const log = useLogHabit();
  const [value, setValue] = useState(current && !current.is_slip ? String(num(current.value)) : '');
  const save = () => {
    const v = Number(value.replace(',', '.'));
    log.mutate(v > 0 ? { habit, date, value: v } : { habit, date, remove: true });
    onDone();
  };
  return (
    <form
      className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <span className="text-sm font-medium">{formatDate(date, 'd MMM')}</span>
      <input className="input w-24 py-1" inputMode="decimal" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={String(num(habit.target_value) || '')} />
      <span className="text-sm text-muted">
        / {num(habit.target_value)} {habit.unit ?? ''}
      </span>
      <div className="ml-auto flex gap-1">
        <button
          type="button"
          className="btn-ghost px-2 text-xs text-expense"
          onClick={() => {
            log.mutate({ habit, date, value: 0, isSlip: true });
            onDone();
          }}
        >
          {t('habits.state.missed')}
        </button>
        {current && (
          <button
            type="button"
            className="btn-ghost px-2 text-xs"
            onClick={() => {
              log.mutate({ habit, date, remove: true });
              onDone();
            }}
          >
            {t('habits.clear')}
          </button>
        )}
        <button className="btn-primary px-3 text-xs">{t('common.save')}</button>
      </div>
    </form>
  );
}
