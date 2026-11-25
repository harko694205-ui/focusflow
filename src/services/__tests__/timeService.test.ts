import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import type { TaskDraft } from '@/domain/types';
import * as tasks from '../taskService';
import * as time from '../timeService';
import * as sched from '../scheduleService';
import { buildBackup, importWorkspace } from '../backup';

const H = 3_600_000;
const T0 = new Date(2026, 10, 23, 9).getTime(); // Mon 09:00

function draft(over: Partial<TaskDraft> = {}): TaskDraft {
  return { title: 'Task', notes: '', categoryId: 'cat-a', priority: 2, difficulty: 2, estimate: 90, deadline: T0 + 48 * H, ...over };
}

beforeEach(async () => {
  db.close();
  await db.delete();
  db.seedOnCreate = false;
  await db.open();
  await db.categories.add({ id: 'cat-a', name: 'Work', color: 'iris', order: 0, createdAt: 0 });
});

describe('focus timer', () => {
  it('records a session on stop, survives as meta, and moves to-do tasks to in progress', async () => {
    const t = await tasks.createTask(draft());
    await time.startTimer(t.id, T0);
    expect(await time.getActiveTimer()).toEqual({ taskId: t.id, start: T0 });
    expect((await db.tasks.get(t.id))!.status).toBe('in_progress');
    const r = await time.stopTimer(T0 + 0.5 * H);
    expect(r!.session).toMatchObject({ taskId: t.id, start: T0, end: T0 + 0.5 * H, source: 'timer' });
    expect(await time.getActiveTimer()).toBeNull();
  });

  it('switching tasks stops the previous timer; very short runs are discarded; long ones capped', async () => {
    const a = await tasks.createTask(draft({ title: 'A' }));
    const b = await tasks.createTask(draft({ title: 'B' }));
    await time.startTimer(a.id, T0);
    const r = await time.startTimer(b.id, T0 + 20_000);
    expect(r.stopped!.session).toBeNull(); // 20s → discarded
    await time.stopTimer(T0 + 30 * H);
    const [s] = await db.sessions.toArray();
    expect(s.end - s.start).toBe(time.MAX_SESSION_MS);
  });

  it('completing a task stops its timer and keeps the time', async () => {
    const t = await tasks.createTask(draft());
    await time.startTimer(t.id, Date.now() - H);
    await tasks.toggleComplete(t.id);
    expect(await time.getActiveTimer()).toBeNull();
    expect(await db.sessions.where('taskId').equals(t.id).count()).toBe(1);
  });

  it('refuses done tasks', async () => {
    const t = await tasks.createTask(draft({ status: 'done' }));
    await expect(time.startTimer(t.id)).rejects.toThrow(/already done/);
  });
});

describe('logged time', () => {
  it('logs minutes ending now and validates the amount', async () => {
    const t = await tasks.createTask(draft());
    const s = await time.logTime(t.id, 45, T0);
    expect(s).toMatchObject({ start: T0 - 45 * 60_000, end: T0, source: 'manual' });
    await expect(time.logTime(t.id, 0)).rejects.toThrow();
    await expect(time.logTime(t.id, 17 * 60)).rejects.toThrow(/16 hours/);
  });

  it('deleting a task removes its sessions; undo restores them', async () => {
    const t = await tasks.createTask(draft());
    await time.logTime(t.id, 30, T0);
    const removed = await tasks.deleteTasks([t.id]);
    expect(await db.sessions.count()).toBe(0);
    await tasks.restoreTasks(removed.tasks, removed.blocks, removed.sessions);
    expect(await db.sessions.count()).toBe(1);
  });

  it('round-trips sessions through backups', async () => {
    const t = await tasks.createTask(draft());
    await time.logTime(t.id, 30, T0);
    const json = JSON.stringify(await buildBackup());
    await db.sessions.clear();
    await importWorkspace(json);
    expect(await db.sessions.count()).toBe(1);
  });
});

describe('postponement history', () => {
  it('counts deadlines pushed to a later day, not same-day tweaks or earlier dates', async () => {
    const t = await tasks.createTask(draft({ deadline: T0 }));
    await tasks.updateTask(t.id, { deadline: T0 + 2 * H }); // same day
    await tasks.updateTask(t.id, { deadline: T0 + 24 * H }); // next day
    await tasks.updateTask(t.id, { deadline: T0 + 12 * H }); // earlier
    await tasks.updateTask(t.id, { deadline: T0 + 72 * H });
    const after = (await db.tasks.get(t.id))!;
    expect(after.postponed).toBe(2);
    expect(after.firstDeadline).toBe(T0 + 2 * H);
  });

  it('counts work moved to a later day on the timeline, and undo restores the count', async () => {
    const t = await tasks.createTask(draft());
    const b = await sched.scheduleTask(t.id, T0, T0 + H);
    await sched.updateBlock(b.id, { start: T0 + H, end: T0 + 2 * H }); // same day
    expect((await db.tasks.get(t.id))!.rescheduled).toBeUndefined();
    const r = await sched.updateBlock(b.id, { start: T0 + 24 * H, end: T0 + 25 * H });
    expect((await db.tasks.get(t.id))!.rescheduled).toBe(1);
    await sched.restoreMove(r.before, r.taskBefore);
    expect((await db.tasks.get(t.id))!.rescheduled).toBeUndefined();
    expect((await db.blocks.get(b.id))!.start).toBe(T0 + H);
  });
});
