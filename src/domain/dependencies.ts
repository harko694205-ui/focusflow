/**
 * Task dependency graph ("A is blocked by B"). Pure helpers shared by the editor, the task
 * service (validation) and the scheduler. Links to tasks that no longer exist are ignored
 * everywhere rather than cleaned up, so undoing a delete restores the link for free.
 */
import type { ID, Task } from './types';

type TaskLike = Pick<Task, 'id' | 'dependsOn'>;

/** Dependency ids that point at existing tasks (deduplicated, never self). */
export function liveDependencies(task: TaskLike, byId: ReadonlyMap<ID, unknown>): ID[] {
  const out: ID[] = [];
  for (const d of task.dependsOn ?? []) if (d !== task.id && byId.has(d) && !out.includes(d)) out.push(d);
  return out;
}

/** Dependencies that are not done yet — the task is blocked while this is non-empty. */
export function openDependencies(task: TaskLike, byId: ReadonlyMap<ID, Pick<Task, 'status'>>): ID[] {
  return liveDependencies(task, byId).filter((d) => byId.get(d)!.status !== 'done');
}

/** Tasks that list `id` as a dependency. */
export function dependentsOf(id: ID, tasks: readonly TaskLike[]): ID[] {
  return tasks.filter((t) => t.id !== id && (t.dependsOn ?? []).includes(id)).map((t) => t.id);
}

/** Every task reachable through dependsOn from `start` (not including `start` itself unless it's on a cycle). */
export function upstream(start: ID, byId: ReadonlyMap<ID, TaskLike>): Set<ID> {
  const seen = new Set<ID>();
  const stack = [...(byId.get(start)?.dependsOn ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    const t = byId.get(id);
    if (!t) continue;
    seen.add(id);
    stack.push(...(t.dependsOn ?? []));
  }
  return seen;
}

/** Would making `taskId` depend on `depId` create a cycle? */
export function wouldCreateCycle(taskId: ID, depId: ID, byId: ReadonlyMap<ID, TaskLike>): boolean {
  return depId === taskId || upstream(depId, byId).has(taskId);
}

/**
 * Tasks that sit on a dependency cycle (only possible through imported data; the editor and the
 * service refuse to create one). Tarjan's strongly connected components.
 */
export function cyclicTasks(tasks: readonly TaskLike[]): Set<ID> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const index = new Map<ID, number>();
  const low = new Map<ID, number>();
  const onStack = new Set<ID>();
  const stack: ID[] = [];
  const out = new Set<ID>();
  let i = 0;
  const visit = (v: ID) => {
    index.set(v, i);
    low.set(v, i);
    i++;
    stack.push(v);
    onStack.add(v);
    for (const w of liveDependencies(byId.get(v)!, byId)) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const scc: ID[] = [];
      let w: ID;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      if (scc.length > 1) for (const x of scc) out.add(x);
    }
  };
  for (const t of tasks) if (!index.has(t.id)) visit(t.id);
  return out;
}

/** Check a proposed dependency list for `taskId`. Returns an error message, or null when fine. */
export function validateDependencies(taskId: ID | null, deps: readonly ID[], byId: ReadonlyMap<ID, TaskLike>): string | null {
  for (const d of deps) {
    if (d === taskId) return 'A task can’t depend on itself.';
    if (!byId.has(d)) return 'A dependency no longer exists.';
    if (taskId && upstream(d, byId).has(taskId)) return 'That would create a dependency loop.';
  }
  return null;
}
