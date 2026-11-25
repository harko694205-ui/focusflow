/**
 * Auto-plan: fill free working time with unscheduled work. A thin wrapper over the scheduler
 * (./scheduler.ts), which holds the actual rules — this keeps the scenario `autoplan` op and
 * older callers on one code path.
 */
import type { WorkWeek } from '@/domain/constants';
import type { Instant, Task, TimeBlock } from '@/domain/types';
import { planSchedule, scheduledMinutes, SESSION_RULES } from './scheduler';
import type { PlanStrategy, ScheduleState } from './types';

export { scheduledMinutes };

/** Smallest and largest session the scheduler will create under normal rules. */
export const MIN_CHUNK = Math.min(...Object.values(SESSION_RULES).map((r) => r.minWindow));
export const MAX_CHUNK = Math.max(...Object.values(SESSION_RULES).map((r) => r.maxSession));

export interface AutoplanOptions {
  from: Instant;
  days: number;
  strategy: PlanStrategy;
  now: Instant;
  /** Prefix for generated block ids (keeps replays stable). */
  idPrefix: string;
  week?: WorkWeek;
}

/** Simple ordering (no dependencies) — kept for display lists. */
export function orderTasks(tasks: readonly Task[], strategy: PlanStrategy): Task[] {
  return [...tasks].sort((a, b) =>
    strategy === 'priority'
      ? a.priority - b.priority || a.deadline - b.deadline || a.seq - b.seq
      : a.deadline - b.deadline || a.priority - b.priority || a.seq - b.seq,
  );
}

export function autoplan(state: ScheduleState, opts: AutoplanOptions): TimeBlock[] {
  return planSchedule(state, opts).blocks;
}
