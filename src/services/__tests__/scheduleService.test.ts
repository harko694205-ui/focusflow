import { beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { db, FocusFlowDB } from '@/db/db';
import { buildSeed } from '@/db/seed';
import { atMinute } from '@/domain/schedule';
import * as sched from '../scheduleService';
import * as tasks from '../taskService';
import { buildBackup, importWorkspace } from '../backup';

const day = new Date(2026, 10, 23);
const at = (h: number, m = 0) => atMinute(day, h * 60 + m);

async function makeTask(title = 'Write report') {
  return tasks.createTask({ title, notes: '', categoryId: 'cat-a', priority: 2, difficulty: 2, estimate: 180, deadline: at(17) + 86_400_000 });
}

beforeEach(async () => {
  db.close();
  await db.delete();
  db.seedOnCreate = false;
  await db.open();
  await db.categories.add({ id: 'cat-a', name: 'Work', color: 'iris', order: 0, createdAt: 0 });
});

describe('scheduling', () => {
  it('schedules a task block and persists it', async () => {
    const t = await makeTask();
    const b = await sched.scheduleTask(t.id, at(9), at(11));
    expect(b).toMatchObject({ kind: 'task', taskId: t.id, start: at(9), end: at(11) });
    expect(await db.blocks.get(b.id)).toEqual(b);
  });

  it('rejects invalid spans, missing tasks and done tasks', async () => {
    const t = await makeTask();
    await expect(sched.scheduleTask(t.id, at(9), at(9, 5))).rejects.toThrow(/at least/);
    await expect(sched.scheduleTask('nope', at(9), at(10))).rejects.toThrow(/no longer exists/);
    await tasks.toggleComplete(t.id);
    await expect(sched.scheduleTask(t.id, at(9), at(10))).rejects.toThrow(/already done/);
    expect(await db.blocks.count()).toBe(0);
  });

  it('creates, renames and validates events', async () => {
    const e = await sched.createEvent('  Team   sync ', at(14), at(15));
    expect(e).toMatchObject({ kind: 'event', taskId: null, title: 'Team sync' });
    await expect(sched.createEvent('   ', at(14), at(15))).rejects.toThrow(/title/);
    const { after } = await sched.updateBlock(e.id, { title: 'Design sync' });
    expect(after.title).toBe('Design sync');
  });

  it('moves and resizes, returning the previous record for undo', async () => {
    const t = await makeTask();
    const b = await sched.scheduleTask(t.id, at(9), at(10));
    const { before, after } = await sched.updateBlock(b.id, { start: at(13), end: at(15) });
    expect(before.start).toBe(at(9));
    expect([after.start, after.end]).toEqual([at(13), at(15)]);
    await expect(sched.updateBlock(b.id, { end: at(13, 5) })).rejects.toThrow(/at least/);
    await sched.restoreBlocks([before]);
    expect((await db.blocks.get(b.id))?.start).toBe(at(9));
  });

  it('deletes and restores blocks, dropping orphans whose task is gone', async () => {
    const t = await makeTask();
    const b = await sched.scheduleTask(t.id, at(9), at(10));
    const e = await sched.createEvent('Sync', at(11), at(12));
    const removed = await sched.deleteBlocks([b.id, e.id]);
    expect(await db.blocks.count()).toBe(0);
    await tasks.deleteTasks([t.id]);
    await sched.restoreBlocks(removed);
    expect((await db.blocks.toArray()).map((x) => x.id)).toEqual([e.id]); // task block not resurrected
  });
});

describe('task ↔ schedule sync', () => {
  it('deleting a task removes its blocks; restoring brings both back', async () => {
    const t = await makeTask();
    const other = await makeTask('Other');
    await sched.scheduleTask(t.id, at(9), at(10));
    await sched.scheduleTask(t.id, at(13), at(14));
    const keep = await sched.scheduleTask(other.id, at(15), at(16));
    const removed = await tasks.deleteTasks([t.id]);
    expect(removed.blocks).toHaveLength(2);
    expect((await db.blocks.toArray()).map((b) => b.id)).toEqual([keep.id]);
    await tasks.restoreTasks(removed.tasks, removed.blocks);
    expect(await db.blocks.count()).toBe(3);
  });

  it('duplicating a task does not copy its schedule', async () => {
    const t = await makeTask();
    await sched.scheduleTask(t.id, at(9), at(10));
    const copy = await tasks.duplicateTask(t.id);
    expect(await db.blocks.where('taskId').equals(copy.id).count()).toBe(0);
  });

  it('clearing the workspace clears the schedule', async () => {
    const t = await makeTask();
    await sched.scheduleTask(t.id, at(9), at(10));
    await sched.createEvent('Sync', at(11), at(12));
    await tasks.clearTasks();
    expect(await db.blocks.count()).toBe(0);
  });
});

describe('persistence & migration', () => {
  it('blocks survive closing and reopening the database', async () => {
    const t = await makeTask();
    const b = await sched.scheduleTask(t.id, at(9), at(10));
    db.close();
    const reopened = new FocusFlowDB();
    expect(await reopened.blocks.get(b.id)).toEqual(b);
    reopened.close();
    await db.open();
  });

  it('round-trips blocks through backup v2 and accepts v1 files without blocks', async () => {
    const t = await makeTask();
    await sched.scheduleTask(t.id, at(9), at(10));
    await sched.createEvent('Sync', at(11), at(12));
    const backup = await buildBackup();
    await tasks.clearTasks();
    await importWorkspace(JSON.stringify(backup));
    expect(await db.blocks.count()).toBe(2);

    const v1 = { ...backup, version: 1, blocks: undefined };
    await importWorkspace(JSON.stringify(v1));
    expect(await db.blocks.count()).toBe(0);
    expect(await db.tasks.count()).toBe(1);
  });

  it('drops orphaned task blocks on import', async () => {
    const t = await makeTask();
    await sched.scheduleTask(t.id, at(9), at(10));
    const backup = await buildBackup();
    backup.blocks![0].taskId = 'ghost';
    await importWorkspace(JSON.stringify(backup));
    expect(await db.blocks.count()).toBe(0);
  });

  it('upgrades a v1 demo workspace to v2 with a demo schedule', async () => {
    const name = 'focusflow-upgrade-test';
    const old = new Dexie(name);
    old.version(1).stores({ tasks: 'id, &seq, status, categoryId, deadline, priority, updatedAt', categories: 'id, order', meta: 'key' });
    const { categories, tasks: seedTasks } = buildSeed(Date.now());
    await old.table('categories').bulkAdd(categories);
    await old.table('tasks').bulkAdd(seedTasks);
    old.close();

    const upgraded = new FocusFlowDB(name);
    expect(await upgraded.tasks.count()).toBe(seedTasks.length);
    const blocks = await upgraded.blocks.toArray();
    expect(blocks.length).toBeGreaterThan(5);
    const ids = new Set(seedTasks.map((t) => t.id));
    expect(blocks.filter((b) => b.kind === 'task').every((b) => ids.has(b.taskId!))).toBe(true);
    await upgraded.delete();
  });
});
