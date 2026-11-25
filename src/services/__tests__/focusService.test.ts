import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import type { TaskDraft } from '@/domain/types';
import { isWaiting, remaining } from '@/domain/focus';
import * as tasks from '../taskService';
import * as time from '../timeService';
import * as focus from '../focusService';

const MIN = 60_000;
const H = 60 * MIN;
const T0 = new Date(2026, 10, 23, 9).getTime(); // Mon 09:00

function draft(over: Partial<TaskDraft> = {}): TaskDraft {
  return { title: 'Task', notes: '', categoryId: 'cat-a', priority: 2, difficulty: 2, estimate: 120, deadline: T0 + 48 * H, ...over };
}
const spans = async (taskId: string) =>
  (await db.sessions.where('taskId').equals(taskId).sortBy('start')).map((s) => [(s.start - T0) / MIN, (s.end - T0) / MIN]);

beforeEach(async () => {
  db.close();
  await db.delete();
  db.seedOnCreate = false;
  await db.open();
  await db.categories.add({ id: 'cat-a', name: 'Work', color: 'iris', order: 0, createdAt: 0 });
});

describe('focus session', () => {
  it('runs the focus timer during focus and records each interval as actual time', async () => {
    const t = await tasks.createTask(draft());
    await focus.startFocus(t.id, T0);
    expect(await time.getActiveTimer()).toEqual({ taskId: t.id, start: T0 });
    expect((await db.tasks.get(t.id))!.status).toBe('in_progress');

    const events = await focus.settleFocus(T0 + 25 * MIN + 500);
    expect(events.map((e) => e.type)).toEqual(['focus_done']);
    expect(await spans(t.id)).toEqual([[0, 25]]);
    expect(await time.getActiveTimer()).toBeNull(); // breaks aren't work time
    const s = (await focus.getFocus())!;
    expect(s).toMatchObject({ phase: 'short_break', completed: 1 });

    // Break ends; the next interval waits for the user, then runs the timer again.
    await focus.settleFocus(T0 + 30 * MIN + 500);
    expect(isWaiting((await focus.getFocus())!)).toBe(true);
    await focus.resumeFocus(T0 + 32 * MIN);
    expect(await time.getActiveTimer()).toEqual({ taskId: t.id, start: T0 + 32 * MIN });
  });

  it('pause and resume split the interval into two recorded stretches', async () => {
    const t = await tasks.createTask(draft());
    await focus.startFocus(t.id, T0);
    await focus.pauseFocus(T0 + 10 * MIN);
    expect(await time.getActiveTimer()).toBeNull();
    await focus.resumeFocus(T0 + 20 * MIN);
    expect(remaining((await focus.getFocus())!, T0 + 20 * MIN)).toBe(15 * MIN);
    await focus.settleFocus(T0 + 35 * MIN);
    expect(await spans(t.id)).toEqual([
      [0, 10],
      [20, 35],
    ]);
  });

  it('skipping to a break records the stretch without counting the interval', async () => {
    const t = await tasks.createTask(draft());
    await focus.startFocus(t.id, T0);
    await focus.skipPhase(T0 + 15 * MIN);
    expect(await focus.getFocus()).toMatchObject({ phase: 'short_break', completed: 0 });
    expect(await spans(t.id)).toEqual([[0, 15]]);
  });

  it('reopening the app after hours records only the interval that really ran', async () => {
    const t = await tasks.createTask(draft());
    await focus.updateFocusSettings({ autoStartFocus: true });
    await focus.startFocus(t.id, T0);
    await focus.settleFocus(T0 + 6 * H);
    expect(await spans(t.id)).toEqual([[0, 25]]);
    expect(isWaiting((await focus.getFocus())!)).toBe(true);
    expect(await time.getActiveTimer()).toBeNull();
  });

  it('completing the task records the stretch, ends the session and marks it done', async () => {
    const t = await tasks.createTask(draft());
    await focus.startFocus(t.id, T0);
    const r = await focus.completeFocusTask(T0 + 18 * MIN);
    expect(r!.summary).toMatchObject({ taskId: t.id, completed: 0, focusMs: 18 * MIN });
    expect((await db.tasks.get(t.id))!.status).toBe('done');
    expect(await focus.getFocus()).toBeNull();
    expect(await time.getActiveTimer()).toBeNull();
    expect(await spans(t.id)).toEqual([[0, 18]]);
  });

  it('ends when the task is finished or deleted elsewhere, or another task is timed', async () => {
    const a = await tasks.createTask(draft({ title: 'A' }));
    const b = await tasks.createTask(draft({ title: 'B' }));
    await focus.startFocus(a.id, T0);
    await tasks.updateTask(a.id, { status: 'done' });
    expect(await focus.getFocus()).toBeNull();

    await focus.startFocus(b.id, T0);
    const c = await tasks.createTask(draft({ title: 'C' }));
    await time.startTimer(c.id, T0 + 5 * MIN);
    expect(await focus.getFocus()).toBeNull();
    expect(await spans(b.id)).toEqual([[0, 5]]);

    await focus.startFocus(b.id, T0 + 10 * MIN);
    await tasks.deleteTasks([b.id]);
    expect(await focus.getFocus()).toBeNull();
  });

  it('switching Focus Mode to another task ends the first session', async () => {
    const a = await tasks.createTask(draft({ title: 'A' }));
    const b = await tasks.createTask(draft({ title: 'B' }));
    await focus.startFocus(a.id, T0);
    const r = await focus.startFocus(b.id, T0 + 12 * MIN);
    expect(r.ended).toMatchObject({ taskId: a.id, focusMs: 12 * MIN });
    expect(await spans(a.id)).toEqual([[0, 12]]);
    expect(await time.getActiveTimer()).toEqual({ taskId: b.id, start: T0 + 12 * MIN });
    // Re-entering for the same task keeps the session.
    expect((await focus.startFocus(b.id, T0 + 20 * MIN)).session.startedAt).toBe(T0 + 12 * MIN);
  });

  it('stores settings and applies them to the running session', async () => {
    const t = await tasks.createTask(draft());
    await focus.startFocus(t.id, T0);
    const s = await focus.updateFocusSettings({ focus: 50, shortBreak: 0 });
    expect(s).toMatchObject({ focus: 50, shortBreak: 1 });
    expect(remaining((await focus.getFocus())!, T0 + 20 * MIN)).toBe(30 * MIN);
    expect((await focus.getFocusSettings()).focus).toBe(50);
  });

  it('a session is refused for done or missing tasks', async () => {
    const t = await tasks.createTask(draft());
    await tasks.updateTask(t.id, { status: 'done' });
    await expect(focus.startFocus(t.id, T0)).rejects.toThrow(/already done/);
    await expect(focus.startFocus('nope', T0)).rejects.toThrow(/no longer exists/);
  });
});
