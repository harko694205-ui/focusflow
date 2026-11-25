import { dueBucket, type DueBucket, DUE_BUCKETS } from './dates';
import { PRIORITIES, DIFFICULTIES, STATUSES } from './constants';
import { RISK_ORDER, type TaskRisk } from './risk';
import { taskRef } from './constants';
import type { Category, Difficulty, ID, Instant, Priority, Task, TaskStatus } from './types';

/* -------------------------------------------------------------------------- */
/* Filter                                                                     */
/* -------------------------------------------------------------------------- */

export type StatusFilter = 'open' | 'done' | 'all';

export interface TaskFilter {
  search: string;
  status: StatusFilter;
  categories: ID[];
  priorities: Priority[];
  difficulties: Difficulty[];
  due: DueBucket[];
}

export const EMPTY_FILTER: TaskFilter = { search: '', status: 'open', categories: [], priorities: [], difficulties: [], due: [] };

/** Number of active facet filters (status and search excluded). */
export function activeFilterCount(f: TaskFilter): number {
  return f.categories.length + f.priorities.length + f.difficulties.length + f.due.length;
}

function matchesStatus(s: TaskStatus, f: StatusFilter) {
  return f === 'all' || (f === 'done' ? s === 'done' : s !== 'done');
}

export function filterTasks(tasks: Task[], f: TaskFilter, now: Instant): Task[] {
  const q = f.search.trim().toLowerCase();
  return tasks.filter((t) => {
    if (!matchesStatus(t.status, f.status)) return false;
    if (f.categories.length && !f.categories.includes(t.categoryId)) return false;
    if (f.priorities.length && !f.priorities.includes(t.priority)) return false;
    if (f.difficulties.length && !f.difficulties.includes(t.difficulty)) return false;
    if (f.due.length && !f.due.includes(dueBucket(t.deadline, now))) return false;
    if (q) {
      const hay = `${t.title} ${t.notes} ${taskRef(t.seq)}`.toLowerCase();
      if (!q.split(/\s+/).every((word) => hay.includes(word))) return false;
    }
    return true;
  });
}

/* -------------------------------------------------------------------------- */
/* Sort                                                                       */
/* -------------------------------------------------------------------------- */

export type SortKey = 'deadline' | 'risk' | 'priority' | 'estimate' | 'difficulty' | 'created' | 'title';
export type SortDir = 'asc' | 'desc';
export interface TaskSort {
  key: SortKey;
  dir: SortDir;
}

export const SORT_LABELS: Record<SortKey, string> = {
  deadline: 'Deadline',
  risk: 'Schedule risk',
  priority: 'Priority',
  estimate: 'Estimate',
  difficulty: 'Difficulty',
  created: 'Created',
  title: 'Title',
};

type Cmp = (a: Task, b: Task) => number;

export function sortTasks(tasks: Task[], sort: TaskSort, risk?: Map<ID, TaskRisk>): Task[] {
  const primary: Record<SortKey, Cmp> = {
    deadline: (a, b) => a.deadline - b.deadline,
    priority: (a, b) => a.priority - b.priority,
    estimate: (a, b) => a.estimate - b.estimate,
    difficulty: (a, b) => a.difficulty - b.difficulty,
    created: (a, b) => a.createdAt - b.createdAt,
    title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
    risk: (a, b) => {
      const ra = risk?.get(a.id);
      const rb = risk?.get(b.id);
      // Completed tasks (no risk entry) sink to the bottom.
      if (!ra || !rb) return (ra ? -1 : 1) - (rb ? -1 : 1);
      return RISK_ORDER[ra.level] - RISK_ORDER[rb.level] || ra.slack - rb.slack;
    },
  };
  const dir = sort.dir === 'asc' ? 1 : -1;
  // Stable tiebreakers: deadline → priority → seq.
  return [...tasks].sort(
    (a, b) => dir * primary[sort.key](a, b) || a.deadline - b.deadline || a.priority - b.priority || a.seq - b.seq,
  );
}

/* -------------------------------------------------------------------------- */
/* Group                                                                      */
/* -------------------------------------------------------------------------- */

export type GroupKey = 'none' | 'category' | 'due' | 'priority' | 'status' | 'difficulty';
export const GROUP_LABELS: Record<GroupKey, string> = {
  none: 'No grouping',
  category: 'Category',
  due: 'Deadline',
  priority: 'Priority',
  status: 'Status',
  difficulty: 'Difficulty',
};

export interface TaskGroup {
  key: string;
  label: string;
  /** Optional color for category groups. */
  categoryId?: ID;
  tasks: Task[];
}

/** Groups preserve the incoming (already sorted) order within each group. */
export function groupTasks(tasks: Task[], by: GroupKey, categories: Category[], now: Instant): TaskGroup[] {
  if (by === 'none') return [{ key: 'all', label: 'All tasks', tasks }];

  const order: Array<{ key: string; label: string; categoryId?: ID }> =
    by === 'category'
      ? categories.map((c) => ({ key: c.id, label: c.name, categoryId: c.id }))
      : by === 'due'
        ? (Object.keys(DUE_BUCKETS) as DueBucket[]).map((k) => ({ key: k, label: DUE_BUCKETS[k] }))
        : by === 'priority'
          ? ([0, 1, 2, 3] as const).map((p) => ({ key: String(p), label: PRIORITIES[p].label }))
          : by === 'difficulty'
            ? ([3, 2, 1] as const).map((d) => ({ key: String(d), label: DIFFICULTIES[d].label }))
            : (['in_progress', 'todo', 'done'] as const).map((s) => ({ key: s, label: STATUSES[s].label }));

  const keyOf = (t: Task): string =>
    by === 'category'
      ? t.categoryId
      : by === 'due'
        ? t.status === 'done'
          ? 'done'
          : dueBucket(t.deadline, now)
        : by === 'priority'
          ? String(t.priority)
          : by === 'difficulty'
            ? String(t.difficulty)
            : t.status;

  const buckets = new Map<string, Task[]>();
  for (const t of tasks) {
    const k = keyOf(t);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(t);
  }

  const groups: TaskGroup[] = [];
  for (const o of order) {
    const list = buckets.get(o.key);
    if (list?.length) groups.push({ ...o, tasks: list });
    buckets.delete(o.key);
  }
  // Anything left over (e.g. done tasks under "due", or an orphaned category).
  for (const [k, list] of buckets) groups.push({ key: k, label: k === 'done' ? 'Completed' : 'Other', tasks: list });
  return groups;
}
