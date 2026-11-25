/**
 * Task & category commands. The only module that writes domain data.
 * Pure async functions over Dexie — no React, no UI concerns (toasts/undo live in the feature layer).
 * Every read in the app goes through liveQuery, so a successful write here updates all views.
 */
import { db } from '@/db/db';
import { buildDemoBlocks, buildSeed } from '@/db/seed';
import { buildDemoHistory, buildDemoTracking } from '@/db/history';
import { CATEGORY_COLOR_VALUES, LIMITS } from '@/domain/constants';
import { isValid, validateDraft } from '@/domain/validation';
import { validateDependencies } from '@/domain/dependencies';
import type { Category, CategoryColor, ID, Task, TaskDraft, TaskStatus, TimeBlock, WorkSession } from '@/domain/types';
import { startOfLocalDay } from '@/domain/schedule';
import { closeTimer, dropFocusFor } from './timeService';

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
      ...(d.examId ? { examId: d.examId } : {}),
    };
    await db.tasks.add(task);
    return task;
  });
}

/** Partial update. Returns the task before and after, so callers can offer undo. */
export async function updateTask(id: ID, patch: Partial<TaskDraft>): Promise<{ before: Task; after: Task }> {
  return db.transaction('rw', db.tasks, db.meta, db.sessions, async () => {
    const before = await db.tasks.get(id);
    if (!before) throw new Error('Task not found');
    const merged = normalize({ ...before, ...patch });
    const errors = validateDraft(merged);
    if (patch.dependsOn) merged.dependsOn = await cleanDependencies(id, merged.dependsOn);
    if (!isValid(errors)) throw new ValidationError(errors);
    const t = now();
    const status = merged.status ?? before.status;
    // Pushing an open task's deadline to a later day counts as a postponement (Insights).
    const pushed = before.status !== 'done' && startOfLocalDay(merged.deadline).getTime() > startOfLocalDay(before.deadline).getTime();
    const after: Task = {
      ...before,
      ...merged,
      status,
      ...(pushed ? { postponed: (before.postponed ?? 0) + 1, firstDeadline: before.firstDeadline ?? before.deadline } : {}),
      updatedAt: t,
      completedAt: status === 'done' ? (before.status === 'done' ? before.completedAt : t) : null,
    };
    await db.tasks.put(after);
    // Finishing a task stops its focus timer and keeps the time.
    if (status === 'done' && before.status !== 'done') {
      await closeTimer(t, id);
      await dropFocusFor([id]);
    }
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
export async function deleteTasks(ids: ID[]): Promise<{ tasks: Task[]; blocks: TimeBlock[]; sessions: WorkSession[] }> {
  return db.transaction('rw', db.tasks, db.blocks, db.sessions, db.meta, async () => {
    const tasks = (await db.tasks.bulkGet(ids)).filter((t): t is Task => !!t);
    const blocks = await db.blocks.where('taskId').anyOf(ids).toArray();
    const sessions = await db.sessions.where('taskId').anyOf(ids).toArray();
    for (const id of ids) await closeTimer(now(), id);
    await dropFocusFor(ids);
    await db.blocks.bulkDelete(blocks.map((b) => b.id));
    await db.sessions.bulkDelete(sessions.map((s) => s.id));
    // A timer that was just stopped may have added a session for a deleted task.
    await db.sessions.where('taskId').anyOf(ids).delete();
    await db.tasks.bulkDelete(ids);
    return { tasks, blocks, sessions };
  });
}

/** Re-insert exact task (block and session) records — undo of delete/update. */
export async function restoreTasks(tasks: Task[], blocks: TimeBlock[] = [], sessions: WorkSession[] = []): Promise<void> {
  await db.transaction('rw', db.tasks, db.blocks, db.sessions, async () => {
    await db.tasks.bulkPut(tasks);
    if (blocks.length) await db.blocks.bulkPut(blocks);
    if (sessions.length) await db.sessions.bulkPut(sessions);
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

export async function updateCategory(id: ID, patch: { name?: string; color?: CategoryColor }): Promise<{ before: Category; after: Category }> {
  return db.transaction('rw', db.categories, async () => {
    const before = await db.categories.get(id);
    if (!before) throw new Error('Category not found');
    let name = before.name;
    if (patch.name !== undefined) {
      name = patch.name.trim().replace(/\s+/g, ' ');
      if (!name) throw new ValidationError({ name: 'Name the category.' });
      if (name.length > LIMITS.categoryNameMax) throw new ValidationError({ name: 'Name is too long.' });
      const dupe = (await db.categories.toArray()).find((c) => c.id !== id && c.name.toLowerCase() === name.toLowerCase());
      if (dupe) throw new ValidationError({ name: `“${dupe.name}” already exists.` });
    }
    if (patch.color !== undefined && !CATEGORY_COLOR_VALUES.includes(patch.color)) throw new Error('Unknown color');
    const after: Category = { ...before, name, color: patch.color ?? before.color };
    await db.categories.put(after);
    return { before, after };
  });
}

/**
 * Delete a category. Its tasks (if any) move to `moveTo`, which is required then.
 * Returns what changed so the deletion can be undone exactly.
 */
export async function deleteCategory(id: ID, moveTo?: ID): Promise<{ category: Category; moved: Task[] }> {
  return db.transaction('rw', db.categories, db.tasks, async () => {
    const category = await db.categories.get(id);
    if (!category) throw new Error('Category not found');
    if ((await db.categories.count()) <= 1) throw new Error('Keep at least one category.');
    const moved = await db.tasks.where('categoryId').equals(id).toArray();
    if (moved.length) {
      if (!moveTo || moveTo === id || !(await db.categories.get(moveTo))) throw new Error('Choose where its tasks should go.');
      const t = now();
      await db.tasks.bulkPut(moved.map((x) => ({ ...x, categoryId: moveTo, updatedAt: t })));
    }
    await db.categories.delete(id);
    return { category, moved };
  });
}

/** Undo deleteCategory: the category comes back and its tasks return to it. */
export async function restoreCategory(category: Category, moved: Task[]): Promise<void> {
  await db.transaction('rw', db.categories, db.tasks, async () => {
    await db.categories.put(category);
    const still = (await db.tasks.bulkGet(moved.map((t) => t.id))).filter((t): t is Task => !!t);
    const byId = new Map(moved.map((t) => [t.id, t]));
    await db.tasks.bulkPut(still.map((t) => ({ ...t, categoryId: category.id, updatedAt: byId.get(t.id)!.updatedAt })));
  });
}

export async function restoreCategoryEdit(before: Category): Promise<void> {
  await db.categories.put(before);
}

/* -------------------------------------------------------------------------- */
/* Workspace                                                                  */
/* -------------------------------------------------------------------------- */

/** Remove all tasks and the schedule (categories are kept so the user can start fresh). */
export async function clearTasks(): Promise<void> {
  await db.transaction('rw', [db.tasks, db.blocks, db.sessions, db.meta, db.exams], async () => {
    await db.tasks.clear();
    await db.blocks.clear();
    await db.sessions.clear();
    await db.exams.clear();
    await db.meta.delete('activeTimer');
    await db.meta.delete('focusSession');
    await db.meta.put({ key: 'taskSeq', value: 0 });
  });
}

/** Replace the workspace with demo data, including a demo schedule and tracked history. */
export async function loadDemoData(): Promise<void> {
  const t = now();
  const { categories, tasks } = buildSeed(t);
  const blocks = buildDemoBlocks(tasks, t);
  const history = buildDemoHistory(t, tasks.length, categories.map((c) => c.id));
  await db.transaction('rw', [db.tasks, db.categories, db.blocks, db.sessions, db.meta, db.exams], async () => {
    await db.tasks.clear();
    await db.blocks.clear();
    await db.sessions.clear();
    await db.exams.clear();
    await db.meta.delete('activeTimer');
    await db.meta.delete('focusSession');
    await db.categories.bulkPut(categories);
    await db.tasks.bulkAdd([...tasks, ...history.tasks]);
    await db.blocks.bulkAdd([...blocks, ...history.blocks]);
    await db.sessions.bulkAdd([...history.sessions, ...buildDemoTracking(tasks, blocks, t)]);
    await db.meta.put({ key: 'taskSeq', value: tasks.length + history.tasks.length });
  });
}

/**
 * Add generated history (finished tasks with tracked time) to the current workspace, so Insights
 * has something to show before real history builds up. Existing tasks are untouched; past
 * blocks of tasks with no tracked time get matching sessions. Returns what was added, for undo.
 */
export async function addSampleHistory(): Promise<{ taskIds: ID[]; sessionIds: ID[] }> {
  const t = now();
  return db.transaction('rw', db.tasks, db.categories, db.blocks, db.sessions, db.meta, async () => {
    const categories = await db.categories.orderBy('order').toArray();
    if (!categories.length) throw new ValidationError({ categoryId: 'Create a category first.' });
    const seq = ((await db.meta.get('taskSeq'))?.value as number | undefined) ?? 0;
    const history = buildDemoHistory(t, seq, categories.map((c) => c.id));
    const [tasks, blocks, sessions] = await Promise.all([db.tasks.toArray(), db.blocks.toArray(), db.sessions.toArray()]);
    const tracked = new Set(sessions.map((s) => s.taskId));
    const tracking = buildDemoTracking(tasks.filter((x) => !tracked.has(x.id)), blocks, t);
    await db.tasks.bulkAdd(history.tasks);
    await db.blocks.bulkAdd(history.blocks);
    await db.sessions.bulkAdd([...history.sessions, ...tracking]);
    await db.meta.put({ key: 'taskSeq', value: seq + history.tasks.length });
    return { taskIds: history.tasks.map((x) => x.id), sessionIds: tracking.map((s) => s.id) };
  });
}
