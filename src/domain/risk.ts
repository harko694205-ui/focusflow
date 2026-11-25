import { AT_RISK_SLACK, DEFAULT_WORK_WEEK, type WorkWeek } from './constants';
import { workingMinutesBetween } from './capacity';
import type { ID, Instant, Minutes, Task } from './types';

export type RiskLevel = 'overdue' | 'late' | 'at_risk' | 'on_track';

export interface TaskRisk {
  level: RiskLevel;
  /** Working minutes left before the deadline once all earlier-due work is done. Negative = projected late. */
  slack: Minutes;
  /** Working minutes available from now until the deadline. */
  available: Minutes;
  /** Open work (this task + everything due before it). */
  demand: Minutes;
}

/**
 * Deadline pressure, earliest-deadline-first.
 *
 * Walk open tasks in deadline order and accumulate their estimates. For each task,
 * slack = (working time from now until its deadline) − (work due up to and including it).
 * This is a deliberately simple, explainable bound: if slack < 0, even working on nothing
 * else in perfect EDF order cannot meet the deadline. The full scheduler arrives in Phase 2.
 */
export function computeRisk(tasks: Task[], now: Instant, week: WorkWeek = DEFAULT_WORK_WEEK): Map<ID, TaskRisk> {
  const open = tasks.filter((t) => t.status !== 'done').sort((a, b) => a.deadline - b.deadline || a.priority - b.priority);
  const out = new Map<ID, TaskRisk>();
  let demand = 0;
  for (const t of open) {
    demand += t.estimate;
    const available = workingMinutesBetween(now, t.deadline, week);
    const slack = available - demand;
    const level: RiskLevel =
      t.deadline < now ? 'overdue' : slack < 0 ? 'late' : slack < AT_RISK_SLACK ? 'at_risk' : 'on_track';
    out.set(t.id, { level, slack, available, demand });
  }
  return out;
}

export const RISK_ORDER: Record<RiskLevel, number> = { overdue: 0, late: 1, at_risk: 2, on_track: 3 };
