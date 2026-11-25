/**
 * Timeline commands — the only module that writes time blocks.
 * Every function validates, writes inside a transaction and returns the before/after
 * records the UI needs for undo.
 */
import { db } from '@/db/db';
import { validateSpan } from '@/domain/schedule';
import type { ID, Instant, TimeBlock } from '@/domain/types';

export class ScheduleError extends Error {}

const now = () => Date.now();

function check(start: Instant, end: Instant) {
  const err = validateSpan(start, end);
  if (err) throw new ScheduleError(err);
}

/** Schedule a block of work for a task. Done tasks can't be scheduled. */
export async function scheduleTask(taskId: ID, start: Instant, end: Instant): Promise<TimeBlock> {
  check(start, end);
  return db.transaction('rw', db.tasks, db.blocks, async () => {
    const task = await db.tasks.get(taskId);
    if (!task) throw new ScheduleError('Task no longer exists.');
    if (task.status === 'done') throw new ScheduleError('That task is already done.');
    const t = now();
    const block: TimeBlock = { id: crypto.randomUUID(), kind: 'task', taskId, title: '', start, end, createdAt: t, updatedAt: t };
    await db.blocks.add(block);
    return block;
  });
}

/** Create a fixed event (meeting, appointment). */
export async function createEvent(title: string, start: Instant, end: Instant): Promise<TimeBlock> {
  check(start, end);
  const clean = title.trim().replace(/\s+/g, ' ');
  if (!clean) throw new ScheduleError('Give the event a title.');
  if (clean.length > 120) throw new ScheduleError('Event title is too long.');
  const t = now();
  const block: TimeBlock = { id: crypto.randomUUID(), kind: 'event', taskId: null, title: clean, start, end, createdAt: t, updatedAt: t };
  await db.blocks.add(block);
  return block;
}

/** Move and/or resize a block. */
export async function updateBlock(id: ID, patch: { start?: Instant; end?: Instant; title?: string }): Promise<{ before: TimeBlock; after: TimeBlock }> {
  return db.transaction('rw', db.blocks, async () => {
    const before = await db.blocks.get(id);
    if (!before) throw new ScheduleError('That block no longer exists.');
    const start = patch.start ?? before.start;
    const end = patch.end ?? before.end;
    check(start, end);
    let title = before.title;
    if (patch.title !== undefined) {
      if (before.kind !== 'event') throw new ScheduleError('Only events have their own title.');
      title = patch.title.trim().replace(/\s+/g, ' ');
      if (!title) throw new ScheduleError('Give the event a title.');
    }
    const after: TimeBlock = { ...before, start, end, title, updatedAt: now() };
    await db.blocks.put(after);
    return { before, after };
  });
}

export async function deleteBlocks(ids: ID[]): Promise<TimeBlock[]> {
  return db.transaction('rw', db.blocks, async () => {
    const removed = (await db.blocks.bulkGet(ids)).filter((b): b is TimeBlock => !!b);
    await db.blocks.bulkDelete(ids);
    return removed;
  });
}

/**
 * Re-insert exact block records (undo). Task blocks whose task has since been deleted are dropped
 * rather than restored as orphans.
 */
export async function restoreBlocks(blocks: TimeBlock[]): Promise<void> {
  await db.transaction('rw', db.tasks, db.blocks, async () => {
    const taskIds = [...new Set(blocks.filter((b) => b.taskId).map((b) => b.taskId!))];
    const existing = new Set((await db.tasks.bulkGet(taskIds)).filter(Boolean).map((t) => t!.id));
    await db.blocks.bulkPut(blocks.filter((b) => b.kind === 'event' || (b.taskId && existing.has(b.taskId))));
  });
}

/** Schedule several sessions for one task in a single transaction (accepting a recommendation). */
export async function scheduleSessions(taskId: ID, spans: Array<{ start: Instant; end: Instant }>): Promise<TimeBlock[]> {
  for (const s of spans) check(s.start, s.end);
  return db.transaction('rw', db.tasks, db.blocks, async () => {
    const task = await db.tasks.get(taskId);
    if (!task) throw new ScheduleError('Task no longer exists.');
    if (task.status === 'done') throw new ScheduleError('That task is already done.');
    const t = now();
    const blocks: TimeBlock[] = spans.map((s) => ({ id: crypto.randomUUID(), kind: 'task', taskId, title: '', start: s.start, end: s.end, createdAt: t, updatedAt: t }));
    await db.blocks.bulkAdd(blocks);
    return blocks;
  });
}
