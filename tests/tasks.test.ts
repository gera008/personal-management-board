import { describe, expect, it } from 'vitest';
import { nextTaskInstance } from '../src/domain/tasks';
import type { Task } from '../src/domain/types';

const task = (p: Partial<Task>): Task => ({
  id: 't',
  list_id: 'l',
  title: 'Pay rent',
  notes: null,
  due_date: '2026-11-30',
  due_time: null,
  priority: 0,
  tags: [],
  position: 0,
  completed_at: null,
  reminder_at: null,
  recurrence: null,
  recurrence_index: 1,
  recurrence_parent_id: null,
  ...p,
});

describe('nextTaskInstance', () => {
  it('returns null for tasks that do not repeat', () => {
    expect(nextTaskInstance(task({}))).toBeNull();
  });

  it('moves a weekly task to its next weekday', () => {
    // Mon/Thu; due Mon 2 Nov -> Thu 5 Nov
    const t = task({ due_date: '2026-11-02', recurrence: { freq: 'weekly', interval: 1, byweekday: [1, 4], anchor: '2026-11-02' } });
    expect(nextTaskInstance(t)).toEqual({ due_date: '2026-11-05', recurrence_index: 2, reminder_at: null });
  });

  it('keeps month-end dates from the anchor', () => {
    const t = task({ due_date: '2027-02-28', recurrence_index: 4, recurrence: { freq: 'monthly', interval: 1, anchor: '2026-11-30' } });
    expect(nextTaskInstance(t)?.due_date).toBe('2027-03-30');
  });

  it('stops after the last of N times', () => {
    const rule = { freq: 'daily' as const, interval: 1, count: 3, anchor: '2026-11-01' };
    expect(nextTaskInstance(task({ due_date: '2026-11-02', recurrence: rule }))?.recurrence_index).toBe(3);
    expect(nextTaskInstance(task({ due_date: '2026-11-03', recurrence: rule }))).toBeNull();
  });

  it('moves the reminder with the due date', () => {
    const t = task({ due_date: '2026-11-02', reminder_at: '2026-11-02T15:00:00.000Z', recurrence: { freq: 'daily', interval: 3 } });
    expect(nextTaskInstance(t)).toMatchObject({ due_date: '2026-11-05', reminder_at: '2026-11-05T15:00:00.000Z' });
  });

  it('uses the due date as anchor when none is stored', () => {
    expect(nextTaskInstance(task({ due_date: '2026-11-17', recurrence: { freq: 'monthly', interval: 1 } }))?.due_date).toBe('2026-12-17');
  });
});
