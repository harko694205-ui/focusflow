/**
 * Task & category commands. The only module that writes domain data.
 * Pure async functions over Dexie — no React, no UI concerns (toasts/undo live in the feature layer).
 * Every read in the app goes through liveQuery, so a successful write here updates all views.
 */
import { db } from '@/db/db';
import { buildDemoBlocks, buildSeed } from '@/db/seed';
import { CATEGORY_COLOR_VALUES, LIMITS } from '@/domain/constants';
import { isValid, validateDraft } from '@/domain/validation';
import { validateDependencies } from '@/domain/dependencies';
import type { Category, CategoryColor, ID, Task, TaskDraft, TaskStatus, TimeBlock } from '@/domain/types';

export class ValidationError extends Error {
  constructor(public errors: Record<string, string>) {
    super(Object.values(errors)[0] ?? 'Invalid task');
  }
}

const now = () => Date.now();

async function nextSeq(): Promise<number> {
  const row = await db.meta.get('taskSeq');
  const seq = ((row?.value as number | undefined) ?? 0) + 1;
  await db.meta.put({ key: 'taskSeq', value: seq });
  return seq;
}

function normalize(d: TaskDraft): TaskDraft {
  return {
    ...d,
    title: d.title.trim().replace(/\s+/g, ' '),
    notes: (d.notes ?? '').trim(),
    estimate: Math.round(d.estimate),
    ...(d.dependsOn ? { dependsOn: [...new Set(d.dependsOn)] } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Tasks                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Clean a dependency list: links to tasks that no longer exist are dropped (they can linger
 * after a delete), self-links and loops are refused. Must run inside a transaction on db.tasks.
 */
async function cleanDependencies(id: ID | null, deps: ID[] | undefined): Promise<ID[] | undefined> {
  if (!deps?.length) return deps;
  const byId = new Map((await db.tasks.toArray()).map((t) => [t.id, t]));
  const kept = deps.filter((d) => d === id || byId.has(d));
  const err = validateDependencies(id, kept, byId);
  if (err) throw new ValidationError({ dependsOn: err });
  return kept;
}

export async function createTask(draft: TaskDraft): Promise<Task> {
  const errors = validateDraft(draft);
  if (!isValid(errors)) throw new ValidationError(errors);
  const d = normalize(draft);
  return db.transaction('rw', db.tasks, db.meta, db.categories, async () => {
    if (!(await db.categories.get(d.categoryId))) throw new ValidationError({ categoryId: 'Category no longer exists.' });
    d.dependsOn = await cleanDependencies(null, d.dependsOn);
    const t = now();
    const status = d.status ?? 'todo';
    const task: Task = {
      id: crypto.randomUUID(),
      seq: await nextSeq(),
      title: d.title,
      notes: d.notes,
      categoryId: d.categoryId,
      status,
      priority: d.priority,
      difficulty: d.difficulty,
      estimate: d.estimate,
      deadline: d.deadline,
      createdAt: t,
      updatedAt: t,
      completedAt: status === 'done' ? t : null,
      ...(d.dependsOn?.length ? { dependsOn: d.dependsOn } : {}),
    };
    await db.tasks.add(task);
    return task;
  });
}

/** Partial update. Returns the task before and after, so callers can offer undo. */
export async function updateTask(id: ID, patch: Partial<TaskDraft>): Promise<{ before: Task; after: Task }> {
  return db.transaction('rw', db.tasks, async () => {
    const before = await db.tasks.get(id);
    if (!before) throw new Error('Task not found');
    const merged = normalize({ ...before, ...patch });
    const errors = validateDraft(merged);
    if (patch.dependsOn) merged.dependsOn = await cleanDependencies(id, merged.dependsOn);
    if (!isValid(errors)) throw new ValidationError(errors);
    const t = now();
    const status = merged.status ?? before.status;
    const after: Task = {
      ...before,
      ...merged,
      status,
      updatedAt: t,
      completedAt: status === 'done' ? (before.status === 'done' ? before.completedAt : t) : null,
    };
    await db.tasks.put(after);
    return { before, after };
  });
}

export function setStatus(id: ID, status: TaskStatus) {
  return updateTask(id, { status });
}

/** Done ⇄ To do. In-progress tasks become done. */
export async function toggleComplete(id: ID) {
  const task = await db.tasks.get(id);
  if (!task) throw new Error('Task not found');
  return setStatus(id, task.status === 'done' ? 'todo' : 'done');
}

export async function duplicateTask(id: ID): Promise<Task> {
  const src = await db.tasks.get(id);
  if (!src) throw new Error('Task not found');
  return createTask({
    // "X" → "X (copy)"; duplicating "X (copy)" again keeps a single suffix.
    title: /\(copy\)$/.test(src.title) || src.title.length + 7 > LIMITS.titleMax ? src.title : `${src.title} (copy)`,
    notes: src.notes,
    categoryId: src.categoryId,
    priority: src.priority,
    difficulty: src.difficulty,
    estimate: src.estimate,
    deadline: src.deadline,
    status: 'todo',
    dependsOn: src.dependsOn,
  });
}

/**
 * Deletes tasks and their scheduled blocks in one transaction.
 * Returns everything removed so the deletion can be undone exactly.
 */
export async function deleteTasks(ids: ID[]): Promise<{ tasks: Task[]; blocks: TimeBlock[] }> {
  return db.transaction('rw', db.tasks, db.blocks, async () => {
    const tasks = (await db.tasks.bulkGet(ids)).filter((t): t is Task => !!t);
    const blocks = await db.blocks.where('taskId').anyOf(ids).toArray();
    await db.blocks.bulkDelete(blocks.map((b) => b.id));
    await db.tasks.bulkDelete(ids);
    return { tasks, blocks };
  });
}

/** Re-insert exact task (and block) records — undo of delete/update. */
export async function restoreTasks(tasks: Task[], blocks: TimeBlock[] = []): Promise<void> {
  await db.transaction('rw', db.tasks, db.blocks, async () => {
    await db.tasks.bulkPut(tasks);
    if (blocks.length) await db.blocks.bulkPut(blocks);
  });
}

/* -------------------------------------------------------------------------- */
/* Categories                                                                 */
/* -------------------------------------------------------------------------- */

export async function createCategory(name: string, color?: CategoryColor): Promise<Category> {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) throw new ValidationError({ name: 'Name the category.' });
  if (clean.length > LIMITS.categoryNameMax) throw new ValidationError({ name: 'Name is too long.' });
  return db.transaction('rw', db.categories, async () => {
    const all = await db.categories.toArray();
    const dupe = all.find((c) => c.name.toLowerCase() === clean.toLowerCase());
    if (dupe) return dupe;
    const used = new Set(all.map((c) => c.color));
    const pick = color ?? CATEGORY_COLOR_VALUES.find((c) => !used.has(c)) ?? CATEGORY_COLOR_VALUES[all.length % CATEGORY_COLOR_VALUES.length];
    const cat: Category = {
      id: crypto.randomUUID(),
      name: clean,
      color: pick,
      order: all.reduce((m, c) => Math.max(m, c.order), -1) + 1,
      createdAt: now(),
    };
    await db.categories.add(cat);
    return cat;
  });
}

/* -------------------------------------------------------------------------- */
/* Workspace                                                                  */
/* -------------------------------------------------------------------------- */

/** Remove all tasks and the schedule (categories are kept so the user can start fresh). */
export async function clearTasks(): Promise<void> {
  await db.transaction('rw', db.tasks, db.blocks, db.meta, async () => {
    await db.tasks.clear();
    await db.blocks.clear();
    await db.meta.put({ key: 'taskSeq', value: 0 });
  });
}

/** Replace the workspace with demo data, including a demo schedule. */
export async function loadDemoData(): Promise<void> {
  const t = now();
  const { categories, tasks } = buildSeed(t);
  const blocks = buildDemoBlocks(tasks, t);
  await db.transaction('rw', db.tasks, db.categories, db.blocks, db.meta, async () => {
    await db.tasks.clear();
    await db.blocks.clear();
    await db.categories.bulkPut(categories);
    await db.tasks.bulkAdd(tasks);
    await db.blocks.bulkAdd(blocks);
    await db.meta.put({ key: 'taskSeq', value: tasks.length });
  });
}
