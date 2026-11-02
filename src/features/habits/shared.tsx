import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { subDays } from 'date-fns';
import { supabase, unwrap } from '@/lib/supabase';
import { useInvalidate, useRows } from '@/lib/data';
import { useProfile } from '@/lib/profile';
import { formatDate } from '@/lib/format';
import { Heatmap } from '@/components/Heatmap';
import { Icon } from '@/components/ui';
import { toDateKey } from '@/domain/dates';
import { combinedHeatmap, computeStreaks, isScheduled, isSuccess, logMap } from '@/domain/habits/streaks';
import { num, type Habit, type HabitLog } from '@/domain/types';

export const LOG_DAYS = 400;

export function useHabits() {
  return useRows('habits', { filter: (q) => q.order('position').order('created_at') });
}

export function useHabitLogs() {
  const from = toDateKey(subDays(new Date(), LOG_DAYS));
  return useRows('habit_logs', { key: [from], filter: (q) => q.gte('date', from) });
}

export function useLogHabit() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ habit, date, value, isSlip, note, remove }: { habit: Habit; date: string; value?: number; isSlip?: boolean; note?: string | null; remove?: boolean }) => {
      if (remove) {
        unwrap(await supabase.from('habit_logs').delete().eq('habit_id', habit.id).eq('date', date));
        return;
      }
      const row: Record<string, unknown> = { habit_id: habit.id, date, value: value ?? 1, is_slip: !!isSlip };
      if (note !== undefined) row.note = note;
      unwrap(await supabase.from('habit_logs').upsert(row, { onConflict: 'habit_id,date' }));
    },
    onSuccess: () => invalidate('habit_logs'),
  });
}

/** Habits that belong on today's list: due good habits, weekly-target habits and all bad habits. */
export function todaysHabits(habits: Habit[], today: string) {
  return habits.filter((h) => !h.archived && h.start_date <= today && (h.kind === 'bad' || isScheduled(h, today)));
}

/** One habit for a day (`date`, today by default): check / count / slip, plus a note. */
export function HabitTodayRow({ habit, logs, date, onOpen }: { habit: Habit; logs: HabitLog[]; date?: string; onOpen?: () => void }) {
  const { t } = useTranslation();
  const { weekStartsOn } = useProfile();
  const log = useLogHabit();
  const realToday = toDateKey(new Date());
  const day = date ?? realToday;
  const map = logMap(logs, habit.id);
  const entry = map.get(day);
  // Streaks always run up to the real today, so fixing a past day updates them.
  const streak = computeStreaks(habit, map, realToday, weekStartsOn);
  const done = isSuccess(habit, map, day);
  const target = num(habit.target_value) || 1;
  const value = entry ? num(entry.value) : 0;
  const isBad = habit.kind === 'bad';
  const slipped = isBad && !!entry?.is_slip;

  const addNote = () => {
    const note = prompt(day === realToday ? t('habits.notePrompt') : t('habits.notePromptDay', { date: formatDate(day, 'd MMM') }), entry?.note ?? '');
    if (note === null) return;
    log.mutate({ habit, date: day, value: entry ? num(entry.value) : isBad ? 1 : 0, isSlip: isBad ? slipped : false, note: note || null });
  };

  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: isBad ? 'rgb(var(--slip))' : habit.color }} />
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="truncate text-sm font-medium">{habit.name}</div>
        <div className="text-xs text-muted">
          {isBad
            ? t('habits.daysWithout', { count: streak.current })
            : streak.unit === 'weeks'
              ? t('habits.weekStreak', { count: streak.current })
              : t('habits.dayStreak', { count: streak.current })}
          {habit.type === 'numeric' && ` · ${value}/${target} ${habit.unit ?? ''}`}
          {entry?.note && ' · ✎'}
        </div>
      </button>
      <button className="rounded p-1 text-muted hover:bg-surface" onClick={addNote} aria-label={t('habits.addNote')}>
        <Icon name="edit" size={16} />
      </button>
      {isBad ? (
        <button
          onClick={() => (slipped ? log.mutate({ habit, date: day, remove: true }) : log.mutate({ habit, date: day, isSlip: true }))}
          className={`btn border text-xs ${slipped ? 'border-slip bg-slip text-bg' : 'border-slip/50 text-slip'}`}
        >
          {slipped ? t('habits.slipped') : t('habits.slip')}
        </button>
      ) : habit.type === 'numeric' ? (
        <div className="flex items-center gap-1">
          <button className="btn-ghost h-8 w-8 p-0" disabled={value <= 0} onClick={() => (value - 1 <= 0 ? log.mutate({ habit, date: day, remove: true }) : log.mutate({ habit, date: day, value: value - 1 }))} aria-label="−1">
            <Icon name="minus" size={16} />
          </button>
          <button
            className={`h-8 w-8 rounded-lg border-2 text-xs font-semibold ${done ? 'text-white' : ''}`}
            style={{ borderColor: habit.color, background: done ? habit.color : 'transparent' }}
            onClick={() => log.mutate({ habit, date: day, value: value + 1 })}
            aria-label="+1"
          >
            {done ? <Icon name="check" size={14} className="mx-auto" /> : '+1'}
          </button>
        </div>
      ) : (
        <button
          onClick={() => (done ? log.mutate({ habit, date: day, remove: true }) : log.mutate({ habit, date: day, value: 1 }))}
          className="flex h-8 w-8 items-center justify-center rounded-full border-2 text-white"
          style={{ borderColor: habit.color, background: done ? habit.color : 'transparent' }}
          aria-label={done ? t('habits.undo') : t('habits.done')}
        >
          {done && <Icon name="check" size={16} />}
        </button>
      )}
    </div>
  );
}

export function CombinedHeatmap({ habits, logs }: { habits: Habit[]; logs: HabitLog[] }) {
  const { weekStartsOn } = useProfile();
  const today = new Date();
  const values = combinedHeatmap(
    habits.filter((h) => !h.archived),
    logs,
    toDateKey(subDays(today, 371)),
    toDateKey(today),
  );
  return <Heatmap values={values} weekStartsOn={weekStartsOn} />;
}
