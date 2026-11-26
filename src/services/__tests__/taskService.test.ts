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

  it('seeds the demo workspace (when asked) only when a database is first created', async () => {
    const fresh = new FocusFlowDB('focusflow-seed-test');
    fresh.seedOnCreate = true;
    // 20 current demo tasks plus generated history (finished tasks with tracked time).
    const tasks = await fresh.tasks.toArray();
    expect(tasks.filter((t) => t.seq <= 20)).toHaveLength(20);
    const history = tasks.filter((t) => t.seq > 20);
    expect(history.length).toBeGreaterThan(20);
    expect(history.every((t) => t.status === 'done' && t.completedAt !== null)).toBe(true);
    expect(await fresh.sessions.count()).toBeGreaterThan(history.length);
    expect((await fresh.meta.get('taskSeq'))!.value).toBe(tasks.length);
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

describe('dependencies', () => {
  it('stores dependencies, refuses self-links, missing tasks and loops', async () => {
    const a = await svc.createTask(draft({ title: 'A' }));
    const b = await svc.createTask(draft({ title: 'B', dependsOn: [a.id, a.id] }));
    expect((await db.tasks.get(b.id))!.dependsOn).toEqual([a.id]);
    const c = await svc.createTask(draft({ title: 'C', dependsOn: ['nope', a.id] }));
    expect(c.dependsOn).toEqual([a.id]); // links to missing tasks are dropped
    await expect(svc.updateTask(a.id, { dependsOn: [a.id] })).rejects.toThrow(/itself/);
    await expect(svc.updateTask(a.id, { dependsOn: [b.id] })).rejects.toThrow(/loop/);
    expect((await db.tasks.get(a.id))!.dependsOn).toBeUndefined();
  });

  it('keeps links through duplicate, and delete + undo restores them', async () => {
    const a = await svc.createTask(draft({ title: 'A' }));
    const b = await svc.createTask(draft({ title: 'B', dependsOn: [a.id] }));
    const copy = await svc.duplicateTask(b.id);
    expect(copy.dependsOn).toEqual([a.id]);
    const removed = await svc.deleteTasks([a.id]);
    await svc.restoreTasks(removed.tasks, removed.blocks);
    expect((await db.tasks.get(b.id))!.dependsOn).toEqual([a.id]);
    expect(await db.tasks.get(a.id)).toBeTruthy();
  });
});

describe('category management', () => {
  it('renames and recolors; refuses empty or duplicate names', async () => {
    const { before, after } = await svc.updateCategory('cat-a', { name: '  Client   work ', color: 'rose' });
    expect(before.name).toBe('Work');
    expect(after).toMatchObject({ name: 'Client work', color: 'rose' });
    await expect(svc.updateCategory('cat-a', { name: ' ' })).rejects.toBeInstanceOf(svc.ValidationError);
    await expect(svc.updateCategory('cat-a', { name: 'home' })).rejects.toThrow(/already exists/);
    await svc.restoreCategoryEdit(before);
    expect((await db.categories.get('cat-a'))!.name).toBe('Work');
  });

  it('deleting moves tasks to another category, and undo moves them back', async () => {
    const a = await svc.createTask(draft({ title: 'A' }));
    await expect(svc.deleteCategory('cat-a')).rejects.toThrow(/where its tasks/);
    const r = await svc.deleteCategory('cat-a', 'cat-b');
    expect(r.moved.map((t) => t.id)).toEqual([a.id]);
    expect((await db.tasks.get(a.id))!.categoryId).toBe('cat-b');
    expect(await db.categories.get('cat-a')).toBeUndefined();
    await expect(svc.deleteCategory('cat-b')).rejects.toThrow(/at least one/);
    await svc.restoreCategory(r.category, r.moved);
    expect((await db.tasks.get(a.id))!.categoryId).toBe('cat-a');
    expect(await db.categories.count()).toBe(2);
  });

  it('an empty category deletes without a destination', async () => {
    await svc.deleteCategory('cat-b');
    expect(await db.categories.count()).toBe(1);
  });
});

describe('working hours', () => {
  it('defaults, saves validated hours, and restores for undo', async () => {
    const { getWorkWeek, setWorkWeek, restoreWorkWeek } = await import('../settingsService');
    const { DEFAULT_WORK_WEEK } = await import('@/domain/constants');
    expect(await getWorkWeek()).toEqual(DEFAULT_WORK_WEEK);
    const week = { ...DEFAULT_WORK_WEEK, 6: [{ start: 600, end: 720 }] };
    const r = await setWorkWeek(week);
    expect(r.before).toBeNull();
    expect((await getWorkWeek())[6]).toEqual([{ start: 600, end: 720 }]);
    await expect(setWorkWeek({ ...week, 2: [{ start: 600, end: 500 }] })).rejects.toThrow(/Tuesday/);
    await restoreWorkWeek(r.before);
    expect(await getWorkWeek()).toEqual(DEFAULT_WORK_WEEK);
  });
});

describe('backup v4', () => {
  it('round-trips scenarios and preferences; older backups clear scenarios and keep preferences', async () => {
    const { setWorkWeek, getWorkWeek } = await import('../settingsService');
    const { updateFocusSettings, getFocusSettings } = await import('../focusService');
    const { DEFAULT_WORK_WEEK } = await import('@/domain/constants');
    const t = await svc.createTask(draft({ title: 'One' }));
    await db.scenarios.add({
      id: 'sc1',
      name: 'Try Friday off',
      status: 'draft',
      baseline: { tasks: [t], blocks: [], takenAt: 1 },
      ops: [{ id: 'op1', at: 1, op: { type: 'clearDay', day: Date.now() } }],
      createdAt: 1,
      updatedAt: 1,
      appliedAt: null,
    });
    const week = { ...DEFAULT_WORK_WEEK, 5: [] };
    await setWorkWeek(week);
    await updateFocusSettings({ focus: 50 });
    const backup = await buildBackup();
    expect(backup.version).toBe(6);

    await db.scenarios.clear();
    await setWorkWeek(DEFAULT_WORK_WEEK);
    await updateFocusSettings({ focus: 25 });
    await importWorkspace(JSON.stringify(backup));
    expect((await db.scenarios.get('sc1'))?.name).toBe('Try Friday off');
    expect((await getWorkWeek())[5]).toEqual([]);
    expect((await getFocusSettings()).focus).toBe(50);

    // A v3 backup (no scenarios, no preferences).
    const { scenarios: _s, preferences: _p, ...v3 } = backup;
    await importWorkspace(JSON.stringify({ ...v3, version: 3 }));
    expect(await db.scenarios.count()).toBe(0);
    expect((await getWorkWeek())[5]).toEqual([]);

    const broken = { ...backup, preferences: { workWeek: { 1: [{ start: 600, end: 500 }] } } };
    await expect(importWorkspace(JSON.stringify(broken))).rejects.toThrow(/working hours/);
    await expect(importWorkspace(JSON.stringify({ ...backup, scenarios: [{ id: 1 }] }))).rejects.toThrow(/scenarios/);
  });
});

describe('profile', () => {
  it('saves, merges, undoes and travels with backups', async () => {
    const { getProfile, setProfile, restoreProfile } = await import('../settingsService');
    expect((await getProfile()).mode).toBe('work');
    const r = await setProfile({ mode: 'student', dueTime: '23:59', term: { name: 'Fall 2026', start: '2026-09-24', weeks: 10, finals: true } });
    expect(r.before).toBeNull();
    expect((await getProfile()).term?.name).toBe('Fall 2026');
    await expect(setProfile({ dueTime: 'soon' })).rejects.toThrow(/hh:mm/);

    const backup = await buildBackup();
    await restoreProfile(null);
    expect((await getProfile()).mode).toBe('work');
    await importWorkspace(JSON.stringify(backup));
    expect(await getProfile()).toMatchObject({ mode: 'student', dueTime: '23:59' });
  });
});
