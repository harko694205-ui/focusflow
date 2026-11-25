import { startOfWeek } from 'date-fns';
import { workingMinutesBetween } from './capacity';
import { DEFAULT_WORK_WEEK, type WorkWeek } from './constants';
import type { TaskRisk } from './risk';
import type { Category, ID, Instant, Minutes, Task } from './types';

const DAY = 86_400_000;

export interface WorkloadSummary {
  openCount: number;
  openMinutes: Minutes;
  inProgressCount: number;
  overdueCount: number;
  lateCount: number;
  atRiskCount: number;
  /** Open work due within the next 7 days. */
  dueSoonCount: number;
  dueSoonMinutes: Minutes;
  /** Working minutes available in the next 7 days. */
  capacity7d: Minutes;
  /** dueSoonMinutes / capacity7d */
  utilization7d: number;
  completedThisWeek: number;
  completedThisWeekMinutes: Minutes;
}

export function summarize(tasks: Task[], risk: Map<ID, TaskRisk>, now: Instant, week: WorkWeek = DEFAULT_WORK_WEEK): WorkloadSummary {
  const open = tasks.filter((t) => t.status !== 'done');
  const horizon = now + 7 * DAY;
  const dueSoon = open.filter((t) => t.deadline <= horizon);
  const weekStart = startOfWeek(now, { weekStartsOn: 1 }).getTime();
  const completed = tasks.filter((t) => t.status === 'done' && (t.completedAt ?? 0) >= weekStart);
  const capacity7d = workingMinutesBetween(now, horizon, week);
  const dueSoonMinutes = dueSoon.reduce((a, t) => a + t.estimate, 0);
  const level = (t: Task) => risk.get(t.id)?.level;

  return {
    openCount: open.length,
    openMinutes: open.reduce((a, t) => a + t.estimate, 0),
    inProgressCount: open.filter((t) => t.status === 'in_progress').length,
    overdueCount: open.filter((t) => level(t) === 'overdue').length,
    lateCount: open.filter((t) => level(t) === 'late').length,
    atRiskCount: open.filter((t) => level(t) === 'at_risk').length,
    dueSoonCount: dueSoon.length,
    dueSoonMinutes,
    capacity7d,
    utilization7d: capacity7d > 0 ? dueSoonMinutes / capacity7d : dueSoonMinutes > 0 ? Infinity : 0,
    completedThisWeek: completed.length,
    completedThisWeekMinutes: completed.reduce((a, t) => a + t.estimate, 0),
  };
}

export interface CategoryStats {
  category: Category;
  openCount: number;
  doneCount: number;
  openMinutes: Minutes;
  doneMinutes: Minutes;
  /** Overdue or projected late. */
  troubleCount: number;
  nextDeadline: Instant | null;
}

export function categoryStats(tasks: Task[], categories: Category[], risk: Map<ID, TaskRisk>): CategoryStats[] {
  return categories.map((category) => {
    const own = tasks.filter((t) => t.categoryId === category.id);
    const open = own.filter((t) => t.status !== 'done');
    const done = own.filter((t) => t.status === 'done');
    return {
      category,
      openCount: open.length,
      doneCount: done.length,
      openMinutes: open.reduce((a, t) => a + t.estimate, 0),
      doneMinutes: done.reduce((a, t) => a + t.estimate, 0),
      troubleCount: open.filter((t) => ['overdue', 'late'].includes(risk.get(t.id)?.level ?? '')).length,
      nextDeadline: open.length ? Math.min(...open.map((t) => t.deadline)) : null,
    };
  });
}
