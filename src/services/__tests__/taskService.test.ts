import { beforeEach, describe, expect, it } from 'vitest';
import { db, FocusFlowDB } from '@/db/db';
import * as svc from '../taskService';
import { buildBackup, importWorkspace } from '../backup';
import type { TaskDraft } from '@/domain/types';

const tomorrow = () => Date.now() + 86_400_000;

function draft(over: Partial<TaskDraft> = {}): TaskDraft {
  return {
    title: 'Write quarterly report',
    notes: '',
    categoryId: 'cat-a',
    priority: 2,
    difficulty: 2,
    estimate: 90,
    deadline: tomorrow(),
    ...over,
  };
}

beforeEach(async () => {
  db.close();
  await db.delete();
  db.seedOnCreate = false;
  await db.open();
  await db.categories.bulkAdd([
    { id: 'cat-a', name: 'Work', color: 'iris', order: 0, createdAt: 0 },
    { id: 'cat-b', name: 'Home', color: 'teal', order: 1, createdAt: 0 },
  ]);
});

describe('create', () => {
  it('persists a task with normalized fields and sequential refs', async () => {
    const a = await svc.createTask(draft({ title: '  Write   quarterly report ', notes: ' x ' }));
    const b = await svc.createTask(draft({ title: 'Second' }));
    expect(a.title).toBe('Write quarterly report');
    expect(a.notes).toBe('x');
    expect(a.status).toBe('todo');
    expect(a.completedAt).toBeNull();
    expect([a.seq, b.seq]).toEqual([1, 2]);
    expect(await db.tasks.count()).toBe(2);
    expect((await db.tasks.get(a.id))?.title).toBe('Write quarterly report');
  });

  it('rejects invalid drafts without writing', async () => {
    await expect(svc.createTask(draft({ title: '' }))).rejects.toBeInstanceOf(svc.ValidationError);
    await expect(svc.createTask(draft({ estimate: 0 }))).rejects.toThrow();
    await expect(svc.createTask(draft({ categoryId: 'missing' }))).rejects.toThrow(/Category/);
    expect(await db.tasks.count()).toBe(0);
  });
});

describe('update / complete', () => {
  it('updates fields and returns before/after for undo', async () => {
    const t = await svc.createTask(draft());
    const { before, after } = await svc.updateTask(t.id, { title: 'Renamed', priority: 0, categoryId: 'cat-b' });
    expect(before.title).toBe('Write quarterly report');
    expect(after).toMatchObject({ title: 'Renamed', priority: 0, categoryId: 'cat-b' });
    expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
    expect((await db.tasks.get(t.id))?.title).toBe('Renamed');
  });

  it('toggles completion and stamps completedAt', async () => {
    const t = await svc.createTask(draft());
    const done = await svc.toggleComplete(t.id);
    expect(done.after.status).toBe('done');
    expect(done.after.completedAt).not.toBeNull();
    const reopened = await svc.toggleComplete(t.id);
    expect(reopened.after.status).toBe('todo');
    expect(reopened.after.completedAt).toBeNull();
  });

  it('rejects invalid patches and leaves the record untouched', async () => {
    const t = await svc.createTask(draft());
    await expect(svc.updateTask(t.id, { estimate: -5 })).rejects.toBeInstanceOf(svc.ValidationError);
    expect((await db.tasks.get(t.id))?.estimate).toBe(90);
  });

  it('restoring the "before" snapshot undoes an edit', async () => {
    const t = await svc.createTask(draft());
    const { before } = await svc.updateTask(t.id, { title: 'Oops' });
    await svc.restoreTasks([before]);
    expect((await db.tasks.get(t.id))?.title).toBe('Write quarterly report');
  });
});

describe('duplicate / delete', () => {
  it('duplicates as a new open task with a new ref', async () => {
    const t = await svc.createTask(draft({ notes: 'keep me' }));
    await svc.toggleComplete(t.id);
    const copy = await svc.duplicateTask(t.id);
    expect(copy.id).not.toBe(t.id);
    expect(copy.seq).toBe(t.seq + 1);
    expect(copy.title).toBe('Write quarterly report (copy)');
    expect(copy.notes).toBe('keep me');
    expect(copy.status).toBe('todo');
    expect(await db.tasks.count()).toBe(2);
  });

  it('deletes and can restore exactly', async () => {
    const a = await svc.createTask(draft());
    const b = await svc.createTask(draft({ title: 'B' }));
    const removed = await svc.deleteTasks([a.id, b.id, 'nope']);
    expect(removed.tasks.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
    expect(await db.tasks.count()).toBe(0);
    await svc.restoreTasks(removed.tasks, removed.blocks);
    expect(await db.tasks.get(a.id)).toEqual(a);
  });

  it('never reuses refs after deletion', async () => {
    const a = await svc.createTask(draft());
    await svc.deleteTasks([a.id]);
    const b = await svc.createTask(draft());
    expect(b.seq).toBe(a.seq + 1);
  });
});

describe('categories', () => {
  it('creates with the next free color and de-duplicates by name', async () => {
    const c = await svc.createCategory('  Side   project ');
    expect(c.name).toBe('Side project');
    expect(['iris', 'teal']).not.toContain(c.color);
    const again = await svc.createCategory('side PROJECT');
    expect(again.id).toBe(c.id);
    expect(await db.categories.count()).toBe(3);
  });
});

describe('persistence', () => {
  it('data survives closing and reopening the database', async () => {
    const t = await svc.createTask(draft({ title: 'Persist me' }));
    await svc.toggleComplete(t.id);
    db.close();

    const reopened = new FocusFlowDB();
    reopened.seedOnCreate = false;
    const stored = await reopened.tasks.get(t.id);
    expect(stored?.title).toBe('Persist me');
    expect(stored?.status).toBe('done');
    expect((await reopened.meta.get('taskSeq'))?.value).toBe(1);
    reopened.close();
    await db.open();
  });

  it('seeds a demo workspace only when a database is first created', async () => {
    const fresh = new FocusFlowDB('focusflow-seed-test');
    expect(await fresh.tasks.count()).toBe(20);
    expect(await fresh.categories.count()).toBe(5);
    await fresh.tasks.clear();
    fresh.close();
    const again = new FocusFlowDB('focusflow-seed-test');
    expect(await again.tasks.count()).toBe(0); // not re-seeded
    await again.delete();
  });

  it('round-trips through backup export and import', async () => {
    await svc.createTask(draft({ title: 'One' }));
    await svc.createTask(draft({ title: 'Two', categoryId: 'cat-b' }));
    const backup = JSON.stringify(await buildBackup());
    await svc.clearTasks();
    expect(await db.tasks.count()).toBe(0);
    expect(await importWorkspace(backup)).toBe(2);
    expect((await db.tasks.toArray()).map((t) => t.title).sort()).toEqual(['One', 'Two']);
    const next = await svc.createTask(draft());
    expect(next.seq).toBe(3);
  });

  it('rejects malformed backups without touching data', async () => {
    await svc.createTask(draft());
    await expect(importWorkspace('{')).rejects.toThrow(/JSON/);
    await expect(importWorkspace(JSON.stringify({ format: 'other' }))).rejects.toThrow(/Not a FocusFlow/);
    await expect(
      importWorkspace(JSON.stringify({ format: 'focusflow-backup', version: 1, categories: [], tasks: [{ id: 1 }] })),
    ).rejects.toThrow(/malformed/);
    expect(await db.tasks.count()).toBe(1);
  });
});
