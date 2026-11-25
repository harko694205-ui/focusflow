/**
 * Schedule analysis: per-day workload, overload, conflicts and free time, and a per-task plan
 * status derived from where its blocks actually sit. Pure and cheap enough to run after every
 * scenario edit.
 */
import { addDays, format } from 'date-fns';
import { DEFAULT_WORK_WEEK, type WorkWeek } from '@/domain/constants';
import { blocksByDay, dayKey, dayLoad, durationMinutes, freeIntervals, layoutBlocks, minuteOfDay, startOfLocalDay } from '@/domain/schedule';
import type { ID, Instant, Minutes, Task } from '@/domain/types';
import { scheduledMinutes } from './autoplan';
import type { ScheduleState } from './types';

export interface DayMetrics {
  key: string;
  date: Date;
  label: string;
  capacity: Minutes;
  /** Union of all blocks inside working hours. */
  booked: Minutes;
  /** Block time outside working hours. */
  overtime: Minutes;
  /** Total task-block minutes (overlaps counted). */
  taskMinutes: Minutes;
  eventMinutes: Minutes;
  /** Scheduled load beyond capacity: max(0, booked + overtime − capacity) on working days, all of it on days off. */
  overload: Minutes;
  /** Number of blocks that overlap at least one other block. */
  conflicts: number;
  /** Working time still free (from `now` onward for today, none for past days). */
  free: Minutes;
  /** Day off in this scenario (no capacity). */
  off: boolean;
  /** Tasks due this day. */
  due: ID[];
}

export type PlanStatus = 'done' | 'overdue' | 'late' | 'short' | 'on_track';

export interface TaskPlan {
  status: PlanStatus;
  scheduled: Minutes;
  /** Estimate minus scheduled, floored at 0. */
  unscheduled: Minutes;
  /** End of the task's last block (null when nothing is scheduled). */
  finish: Instant | null;
  /** deadline − finish in minutes (negative = late). Null when nothing is scheduled. */
  margin: Minutes | null;
}

export interface Totals {
  scheduledTaskMinutes: Minutes;
  overloadedDays: number;
  overloadMinutes: Minutes;
  conflicts: number;
  /** Late or overdue tasks. */
  lateTasks: number;
  /** Tasks with unscheduled work left (and not late). */
  shortTasks: number;
  unscheduledMinutes: Minutes;
  freeMinutes: Minutes;
  capacity: Minutes;
}

export interface Analysis {
  days: DayMetrics[];
  tasks: Map<ID, TaskPlan>;
  totals: Totals;
}

const NO_WORK: WorkWeek = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };

export const STATUS_LABEL: Record<PlanStatus, string> = {
  done: 'Done',
  overdue: 'Overdue',
  late: 'Finishes late',
  short: 'Not fully scheduled',
  on_track: 'On track',
};
export const STATUS_RANK: Record<PlanStatus, number> = { overdue: 0, late: 1, short: 2, on_track: 3, done: 4 };

export function planTask(t: Task, scheduled: Minutes, finish: Instant | null, now: Instant): TaskPlan {
  const unscheduled = Math.max(0, t.estimate - scheduled);
  const margin = finish === null ? null : Math.round((t.deadline - finish) / 60_000);
  const status: PlanStatus =
    t.status === 'done'
      ? 'done'
      : t.deadline < now
        ? 'overdue'
        : margin !== null && margin < 0
          ? 'late'
          : unscheduled > 0
            ? 'short'
            : 'on_track';
  return { status, scheduled, unscheduled, finish, margin };
}

export function analyze(state: ScheduleState, range: { from: Instant; days: number }, now: Instant, week: WorkWeek = DEFAULT_WORK_WEEK): Analysis {
  const byDay = blocksByDay([...state.blocks]);
  const todayKey = dayKey(now);
  const todayStart = startOfLocalDay(now).getTime();
  const nowMin = minuteOfDay(now);
  const dueByDay = new Map<string, ID[]>();
  for (const t of state.tasks) {
    if (t.status === 'done') continue;
    const k = dayKey(t.deadline);
    if (!dueByDay.has(k)) dueByDay.set(k, []);
    dueByDay.get(k)!.push(t.id);
  }

  const off = new Set(state.offDays ?? []);
  const start = startOfLocalDay(range.from);
  const days: DayMetrics[] = Array.from({ length: range.days }, (_, i) => {
    const date = addDays(start, i);
    const k = dayKey(date);
    const list = byDay.get(k) ?? [];
    const dayWeek = off.has(k) ? NO_WORK : week;
    const load = dayLoad(date, list, dayWeek);
    const lay = layoutBlocks(list);
    const isPast = date.getTime() < todayStart;
    const free = isPast
      ? 0
      : freeIntervals(date, list, { week: dayWeek, fromMinute: k === todayKey ? nowMin : undefined }).reduce((a, x) => a + x.end - x.start, 0);
    return {
      key: k,
      date,
      label: format(date, 'EEE d'),
      capacity: load.capacity,
      booked: load.booked,
      overtime: load.overtime,
      taskMinutes: list.filter((b) => b.kind === 'task').reduce((a, b) => a + durationMinutes(b), 0),
      eventMinutes: list.filter((b) => b.kind === 'event').reduce((a, b) => a + durationMinutes(b), 0),
      overload: Math.max(0, load.booked + load.overtime - load.capacity),
      conflicts: [...lay.values()].filter((l) => l.overlaps.length > 0).length,
      free,
      off: off.has(k),
      due: dueByDay.get(k) ?? [],
    };
  });

  // Per-task plan
  const minutes = scheduledMinutes(state.blocks);
  const finish = new Map<ID, Instant>();
  for (const b of state.blocks) if (b.kind === 'task' && b.taskId) finish.set(b.taskId, Math.max(finish.get(b.taskId) ?? 0, b.end));
  const tasks = new Map<ID, TaskPlan>();
  for (const t of state.tasks) tasks.set(t.id, planTask(t, minutes.get(t.id) ?? 0, finish.get(t.id) ?? null, now));

  const plans = [...tasks.values()];
  const totals: Totals = {
    scheduledTaskMinutes: days.reduce((a, d) => a + d.taskMinutes, 0),
    overloadedDays: days.filter((d) => d.overload > 0).length,
    overloadMinutes: days.reduce((a, d) => a + d.overload, 0),
    conflicts: days.reduce((a, d) => a + d.conflicts, 0),
    lateTasks: plans.filter((p) => p.status === 'late' || p.status === 'overdue').length,
    shortTasks: plans.filter((p) => p.status === 'short').length,
    unscheduledMinutes: plans.filter((p) => p.status !== 'done').reduce((a, p) => a + p.unscheduled, 0),
    freeMinutes: days.reduce((a, d) => a + d.free, 0),
    capacity: days.reduce((a, d) => a + d.capacity, 0),
  };
  return { days, tasks, totals };
}
