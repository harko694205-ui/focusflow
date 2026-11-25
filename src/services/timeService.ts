/**
 * Time tracking: the focus timer and logged work sessions. The only module that writes sessions.
 * A running timer lives in `meta.activeTimer` so it survives reloads; stopping it turns the
 * elapsed time into a WorkSession.
 */
import { db } from '@/db/db';
import type { ActiveTimer, ID, Instant, Minutes, Task, WorkSession } from '@/domain/types';

export class TimeError extends Error {}

const TIMER_KEY = 'activeTimer';
/** Shorter timer runs are discarded (an accidental start/stop). */
export const MIN_SESSION_MS = 60_000;
/** A timer left running longer than this is capped (forgotten overnight). */
export const MAX_SESSION_MS = 10 * 3_600_000;

const now = () => Date.now();

export async function getActiveTimer(): Promise<ActiveTimer | null> {
  return ((await db.meta.get(TIMER_KEY))?.value as ActiveTimer | undefined) ?? null;
}

/**
 * Stop the running timer (if any) and record its session. Optionally only when it's for `taskId`.
 * Safe to call inside a transaction that includes db.meta and db.sessions.
 */
export async function closeTimer(at: Instant = now(), onlyFor?: ID): Promise<{ timer: ActiveTimer; session: WorkSession | null } | null> {
  return db.transaction('rw', db.meta, db.sessions, async () => {
    const timer = await getActiveTimer();
    if (!timer || (onlyFor && timer.taskId !== onlyFor)) return null;
    await db.meta.delete(TIMER_KEY);
    const end = Math.min(at, timer.start + MAX_SESSION_MS);
    if (end - timer.start < MIN_SESSION_MS) return { timer, session: null };
    const session: WorkSession = { id: crypto.randomUUID(), taskId: timer.taskId, start: timer.start, end, source: 'timer', createdAt: at };
    await db.sessions.add(session);
    return { timer, session };
  });
}

/**
 * Start the focus timer on a task. A timer running on another task is stopped (and recorded)
 * first. A to-do task moves to "in progress".
 */
export async function startTimer(taskId: ID, at: Instant = now()) {
  return db.transaction('rw', db.tasks, db.meta, db.sessions, async () => {
    const task = await db.tasks.get(taskId);
    if (!task) throw new TimeError('Task no longer exists.');
    if (task.status === 'done') throw new TimeError('That task is already done.');
    const current = await getActiveTimer();
    if (current?.taskId === taskId) return { timer: current, stopped: null, taskBefore: null as Task | null };
    const stopped = await closeTimer(at);
    const timer: ActiveTimer = { taskId, start: at };
    await db.meta.put({ key: TIMER_KEY, value: timer });
    let taskBefore: Task | null = null;
    if (task.status === 'todo') {
      taskBefore = task;
      await db.tasks.put({ ...task, status: 'in_progress', updatedAt: at });
    }
    return { timer, stopped, taskBefore };
  });
}

export function stopTimer(at: Instant = now()) {
  return closeTimer(at);
}

/** Restore a timer exactly (undo of stop). */
export async function restoreTimer(timer: ActiveTimer | null, removeSession?: ID) {
  await db.transaction('rw', db.meta, db.sessions, async () => {
    if (removeSession) await db.sessions.delete(removeSession);
    if (timer) await db.meta.put({ key: TIMER_KEY, value: timer });
    else await db.meta.delete(TIMER_KEY);
  });
}

/** Log time by hand: `minutes` of work ending at `end` (default now). */
export async function logTime(taskId: ID, minutes: Minutes, end: Instant = now()): Promise<WorkSession> {
  if (!Number.isFinite(minutes) || minutes < 1) throw new TimeError('Log at least a minute.');
  if (minutes > 16 * 60) throw new TimeError('That’s more than 16 hours — log it in parts.');
  return db.transaction('rw', db.tasks, db.sessions, async () => {
    if (!(await db.tasks.get(taskId))) throw new TimeError('Task no longer exists.');
    const session: WorkSession = { id: crypto.randomUUID(), taskId, start: end - Math.round(minutes) * 60_000, end, source: 'manual', createdAt: now() };
    await db.sessions.add(session);
    return session;
  });
}

export async function deleteSessions(ids: ID[]): Promise<WorkSession[]> {
  return db.transaction('rw', db.sessions, async () => {
    const removed = (await db.sessions.bulkGet(ids)).filter((s): s is WorkSession => !!s);
    await db.sessions.bulkDelete(ids);
    return removed;
  });
}

/** Re-insert exact sessions (undo); sessions whose task is gone are dropped. */
export async function restoreSessions(sessions: WorkSession[]): Promise<void> {
  await db.transaction('rw', db.tasks, db.sessions, async () => {
    const ids = new Set((await db.tasks.bulkGet([...new Set(sessions.map((s) => s.taskId))])).filter(Boolean).map((t) => t!.id));
    await db.sessions.bulkPut(sessions.filter((s) => ids.has(s.taskId)));
  });
}
