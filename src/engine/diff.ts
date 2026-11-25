/**
 * Comparing two schedules (original vs proposed) and planning how to apply the proposal to the
 * live schedule without clobbering anything that changed since the scenario was forked.
 */
import type { ID, Task, TimeBlock } from '@/domain/types';
import { STATUS_RANK, type Analysis, type PlanStatus, type Totals } from './analyze';
import type { ScheduleSnapshot, ScheduleState } from './types';

/* -------------------------------------------------------------------------- */
/* Schedule diff                                                              */
/* -------------------------------------------------------------------------- */

export type BlockChange = 'added' | 'moved' | 'resized' | 'removed';

export interface ScheduleDiff {
  blocks: Map<ID, BlockChange>;
  /** Original version of moved/resized/removed blocks (for ghosts). */
  originals: Map<ID, TimeBlock>;
  /** Fields changed per task. */
  tasks: Map<ID, Array<'estimate' | 'deadline' | 'priority'>>;
  counts: Record<BlockChange, number> & { tasks: number };
}

export function diffSchedules(a: ScheduleState, b: ScheduleState): ScheduleDiff {
  const aBlocks = new Map(a.blocks.map((x) => [x.id, x]));
  const bBlocks = new Map(b.blocks.map((x) => [x.id, x]));
  const blocks = new Map<ID, BlockChange>();
  const originals = new Map<ID, TimeBlock>();
  for (const [id, nb] of bBlocks) {
    const ob = aBlocks.get(id);
    if (!ob) blocks.set(id, 'added');
    else if (ob.start !== nb.start) {
      blocks.set(id, 'moved');
      originals.set(id, ob);
    } else if (ob.end !== nb.end) {
      blocks.set(id, 'resized');
      originals.set(id, ob);
    }
  }
  for (const [id, ob] of aBlocks)
    if (!bBlocks.has(id)) {
      blocks.set(id, 'removed');
      originals.set(id, ob);
    }

  const aTasks = new Map(a.tasks.map((t) => [t.id, t]));
  const tasks = new Map<ID, Array<'estimate' | 'deadline' | 'priority'>>();
  for (const t of b.tasks) {
    const o = aTasks.get(t.id);
    if (!o) continue;
    const fields = (['estimate', 'deadline', 'priority'] as const).filter((f) => o[f] !== t[f]);
    if (fields.length) tasks.set(t.id, [...fields]);
  }

  const counts = { added: 0, moved: 0, resized: 0, removed: 0, tasks: tasks.size };
  for (const c of blocks.values()) counts[c]++;
  return { blocks, originals, tasks, counts };
}

/* -------------------------------------------------------------------------- */
/* Impact                                                                     */
/* -------------------------------------------------------------------------- */

export type Better = 'better' | 'worse' | 'same';

export interface MetricDelta {
  key: keyof Totals;
  before: number;
  after: number;
  delta: number;
  verdict: Better;
}

/** For each metric, is lower better? */
const LOWER_IS_BETTER: Partial<Record<keyof Totals, boolean>> = {
  overloadedDays: true,
  overloadMinutes: true,
  conflicts: true,
  lateTasks: true,
  shortTasks: true,
  unscheduledMinutes: true,
  scheduledTaskMinutes: false,
  freeMinutes: false,
};

export function compareTotals(a: Totals, b: Totals, keys: Array<keyof Totals>): MetricDelta[] {
  return keys.map((key) => {
    const delta = b[key] - a[key];
    const lower = LOWER_IS_BETTER[key];
    const verdict: Better = delta === 0 || lower === undefined ? 'same' : (delta < 0) === lower ? 'better' : 'worse';
    return { key, before: a[key], after: b[key], delta, verdict };
  });
}

export interface RiskChange {
  taskId: ID;
  before: PlanStatus;
  after: PlanStatus;
  /** Finish moved by this many minutes (positive = later). */
  finishShift: number | null;
  verdict: Better;
}

/** Tasks whose plan status or finish time changed between two analyses. */
export function riskChanges(a: Analysis, b: Analysis): RiskChange[] {
  const out: RiskChange[] = [];
  for (const [id, after] of b.tasks) {
    const before = a.tasks.get(id);
    if (!before || before.status === 'done') continue;
    const finishShift = before.finish !== null && after.finish !== null ? Math.round((after.finish - before.finish) / 60_000) : null;
    const statusChanged = before.status !== after.status;
    if (!statusChanged && !finishShift && before.scheduled === after.scheduled) continue;
    const rankDelta = STATUS_RANK[after.status] - STATUS_RANK[before.status];
    const verdict: Better =
      rankDelta > 0 ? 'better' : rankDelta < 0 ? 'worse' : finishShift !== null && finishShift !== 0 ? (finishShift < 0 ? 'better' : 'worse') : 'same';
    out.push({ taskId: id, before: before.status, after: after.status, finishShift, verdict });
  }
  const order = { worse: 0, better: 1, same: 2 };
  return out.sort((x, y) => order[x.verdict] - order[y.verdict] || STATUS_RANK[x.after] - STATUS_RANK[y.after]);
}

/* -------------------------------------------------------------------------- */
/* Apply plan (optimistic concurrency)                                        */
/* -------------------------------------------------------------------------- */

export interface ApplyConflict {
  kind: 'block' | 'task';
  id: ID;
  reason: string;
}

export interface ApplyPlan {
  putBlocks: TimeBlock[];
  deleteBlockIds: ID[];
  putTasks: Task[];
  conflicts: ApplyConflict[];
  /** Number of individual changes that would be written. */
  changeCount: number;
}

/**
 * Work out the writes that turn the live schedule into the proposal.
 *
 * Only records the scenario actually changed are touched, and only if the live record is still
 * exactly what the scenario was forked from (same `updatedAt`). Anything edited, deleted or
 * completed since the snapshot becomes a conflict instead of being overwritten.
 */
export function planApply(baseline: ScheduleSnapshot, proposed: ScheduleState, live: ScheduleState, now: number): ApplyPlan {
  const diff = diffSchedules(baseline, proposed);
  const liveBlocks = new Map(live.blocks.map((b) => [b.id, b]));
  const liveTasks = new Map(live.tasks.map((t) => [t.id, t]));
  const baseBlocks = new Map(baseline.blocks.map((b) => [b.id, b]));
  const baseTasks = new Map(baseline.tasks.map((t) => [t.id, t]));
  const propBlocks = new Map(proposed.blocks.map((b) => [b.id, b]));
  const propTasks = new Map(proposed.tasks.map((t) => [t.id, t]));

  const plan: ApplyPlan = { putBlocks: [], deleteBlockIds: [], putTasks: [], conflicts: [], changeCount: 0 };
  const conflict = (kind: 'block' | 'task', id: ID, reason: string) => plan.conflicts.push({ kind, id, reason });

  for (const [id, change] of diff.blocks) {
    if (change === 'added') {
      const b = propBlocks.get(id)!;
      if (b.kind === 'task') {
        const t = b.taskId ? liveTasks.get(b.taskId) : undefined;
        if (!t) {
          conflict('block', id, 'Its task was deleted since this scenario was created.');
          continue;
        }
        if (t.status === 'done') {
          conflict('block', id, 'Its task was completed since this scenario was created.');
          continue;
        }
      }
      plan.putBlocks.push({ ...b, createdAt: now, updatedAt: now });
    } else {
      const base = baseBlocks.get(id)!;
      const cur = liveBlocks.get(id);
      if (!cur) {
        if (change !== 'removed') conflict('block', id, 'This block was deleted from your schedule since.');
        continue; // already gone — removal is a no-op
      }
      if (cur.updatedAt !== base.updatedAt) {
        conflict('block', id, 'This block was changed in your schedule since.');
        continue;
      }
      if (change === 'removed') plan.deleteBlockIds.push(id);
      else {
        const p = propBlocks.get(id)!;
        plan.putBlocks.push({ ...cur, start: p.start, end: p.end, updatedAt: now });
      }
    }
    plan.changeCount++;
  }

  for (const [id, fields] of diff.tasks) {
    const base = baseTasks.get(id)!;
    const cur = liveTasks.get(id);
    if (!cur) {
      conflict('task', id, 'This task was deleted since.');
      continue;
    }
    if (cur.updatedAt !== base.updatedAt) {
      conflict('task', id, 'This task was edited since.');
      continue;
    }
    const p = propTasks.get(id)!;
    const patch: Partial<Task> = {};
    for (const f of fields) (patch as Record<string, unknown>)[f] = p[f];
    plan.putTasks.push({ ...cur, ...patch, updatedAt: now });
    plan.changeCount++;
  }
  return plan;
}

/** How far the live schedule has drifted from a snapshot (records added, removed or edited). */
export function driftCount(baseline: ScheduleSnapshot, live: ScheduleState): number {
  let n = 0;
  const cmp = <T extends { id: ID; updatedAt: number }>(a: readonly T[], b: readonly T[]) => {
    const m = new Map(a.map((x) => [x.id, x.updatedAt]));
    for (const x of b) {
      const u = m.get(x.id);
      if (u === undefined || u !== x.updatedAt) n++;
      m.delete(x.id);
    }
    n += m.size;
  };
  cmp(baseline.tasks, live.tasks);
  cmp(baseline.blocks, live.blocks);
  return n;
}
