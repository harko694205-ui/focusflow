/**
 * Focus Mode persistence. The pomodoro session lives in `meta.focusSession` (so it survives
 * reloads) and drives the ordinary focus timer: while a focus phase runs, `meta.activeTimer`
 * runs on the same task from the same instant, so every focus stretch becomes a WorkSession
 * exactly like timer-tracked time — Insights needs no special case.
 */
import { db } from '@/db/db';
import * as F from '@/domain/focus';
import type { ID, Instant, Task, WorkSession } from '@/domain/types';
import { closeTimer, FOCUS_KEY, getActiveTimer, MIN_SESSION_MS, TimeError } from './timeService';
import { updateTask } from './taskService';

export { FOCUS_KEY };
export const FOCUS_SETTINGS_KEY = 'focusSettings';

const now = () => Date.now();
const FOCUS_TABLES = [db.tasks, db.meta, db.sessions] as const;

export async function getFocus(): Promise<F.FocusSession | null> {
  return ((await db.meta.get(FOCUS_KEY))?.value as F.FocusSession | undefined) ?? null;
}

export async function getFocusSettings(): Promise<F.FocusSettings> {
  return F.normalizeSettings((await db.meta.get(FOCUS_SETTINGS_KEY))?.value as Partial<F.FocusSettings> | undefined);
}

/** Session summary, kept by the caller after the session itself is gone. */
export interface FocusSummary {
  taskId: ID;
  startedAt: Instant;
  endedAt: Instant;
  completed: number;
  focusMs: number;
}

const summarize = (s: F.FocusSession, at: Instant): FocusSummary => ({
  taskId: s.taskId,
  startedAt: s.startedAt,
  endedAt: at,
  completed: s.completed,
  focusMs: F.focusTime(s, at),
});

/** Record a finished focus stretch: via the running timer when it matches, else directly. */
async function recordRun(taskId: ID, run: F.FocusRun): Promise<WorkSession | null> {
  const timer = await getActiveTimer();
  if (timer?.taskId === taskId && timer.start === run.start) return (await closeTimer(run.end, taskId))?.session ?? null;
  if (run.end - run.start < MIN_SESSION_MS) return null;
  const session: WorkSession = { id: crypto.randomUUID(), taskId, start: run.start, end: run.end, source: 'timer', createdAt: run.end };
  await db.sessions.add(session);
  return session;
}

/** Make the focus timer match the session: running on the task during a running focus phase. */
async function syncTimer(s: F.FocusSession) {
  const timer = await getActiveTimer();
  const want = s.phase === 'focus' && s.runStart !== null;
  if (want && !(timer?.taskId === s.taskId && timer.start === s.runStart)) {
    if (timer) await closeTimer(s.runStart!);
    await db.meta.put({ key: 'activeTimer', value: { taskId: s.taskId, start: s.runStart! } });
  } else if (!want && timer?.taskId === s.taskId) {
    await closeTimer(now(), s.taskId);
  }
}

async function save(s: F.FocusSession) {
  await db.meta.put({ key: FOCUS_KEY, value: s });
  await syncTimer(s);
}

/**
 * Start Focus Mode on a task. Re-entering for the same task keeps the session; a session on
 * another task is ended (its running stretch recorded) first. A to-do task moves to in progress.
 */
export async function startFocus(taskId: ID, at: Instant = now()): Promise<{ session: F.FocusSession; ended: FocusSummary | null; taskBefore: Task | null }> {
  return db.transaction('rw', [...FOCUS_TABLES], async () => {
    const task = await db.tasks.get(taskId);
    if (!task) throw new TimeError('Task no longer exists.');
    if (task.status === 'done') throw new TimeError('That task is already done.');
    const current = await getFocus();
    if (current?.taskId === taskId) return { session: current, ended: null, taskBefore: null };
    const ended = current ? await endFocusInTx(current, at) : null;
    // A plain timer on another task is stopped (and recorded) by syncTimer.
    const session = F.createSession(taskId, await getFocusSettings(), at);
    await save(session);
    let taskBefore: Task | null = null;
    if (task.status === 'todo') {
      taskBefore = task;
      await db.tasks.put({ ...task, status: 'in_progress', updatedAt: at });
    }
    return { session, ended, taskBefore };
  });
}

/** Apply `fn` to the stored session (after settling anything that ran out) and save it. */
async function mutate<T>(fn: (s: F.FocusSession, at: Instant) => Promise<{ session: F.FocusSession; result: T }>, at: Instant) {
  return db.transaction('rw', [...FOCUS_TABLES], async () => {
    const stored = await getFocus();
    if (!stored) throw new TimeError('No focus session is running.');
    const settled = await settleInTx(stored, at);
    const { session, result } = await fn(settled.session, at);
    await save(session);
    return { session, result, events: settled.events };
  });
}

export function pauseFocus(at: Instant = now()) {
  return mutate(async (s) => {
    const { session, run } = F.pause(s, at);
    if (run) await recordRun(s.taskId, run);
    return { session, result: null };
  }, at);
}

export function resumeFocus(at: Instant = now()) {
  return mutate(async (s) => ({ session: F.resume(s, at), result: null }), at);
}

/** Start/pause toggle. */
export async function toggleFocus(at: Instant = now()) {
  const s = await getFocus();
  return s && F.isRunning(s) ? pauseFocus(at) : resumeFocus(at);
}

/** Cut the current phase short: take a break now, or skip the break. */
export function skipPhase(at: Instant = now()) {
  return mutate(async (s) => {
    const { session, run, event } = F.advance(s, at, 'skip');
    if (run) await recordRun(s.taskId, run);
    return { session, result: event };
  }, at);
}

export function updateFocusSettings(patch: Partial<F.FocusSettings>) {
  return db.transaction('rw', [...FOCUS_TABLES], async () => {
    const settings = F.normalizeSettings({ ...(await getFocusSettings()), ...patch });
    await db.meta.put({ key: FOCUS_SETTINGS_KEY, value: settings });
    const s = await getFocus();
    if (s) await db.meta.put({ key: FOCUS_KEY, value: F.withSettings(s, settings) });
    return settings;
  });
}

async function settleInTx(s: F.FocusSession, at: Instant) {
  const r = F.settle(s, at);
  for (const run of r.runs) await recordRun(s.taskId, run);
  return r;
}

/**
 * Move on any phase that ran out, recording its focus time at the moment it ended. Called on a
 * timer when a phase is due, and whenever the app regains attention. Returns the transitions.
 */
export async function settleFocus(at: Instant = now()): Promise<F.FocusEvent[]> {
  return db.transaction('rw', [...FOCUS_TABLES], async () => {
    const s = await getFocus();
    if (!s) return [];
    const task = await db.tasks.get(s.taskId);
    // The task was finished or deleted elsewhere: the session is over.
    if (!task || task.status === 'done') {
      await db.meta.delete(FOCUS_KEY);
      return [];
    }
    if (!F.isDue(s, at)) {
      // Keep the timer honest if it was changed behind Focus Mode's back.
      const timer = await getActiveTimer();
      if (s.phase === 'focus' && s.runStart !== null && timer?.taskId !== s.taskId) {
        await db.meta.put({ key: FOCUS_KEY, value: F.pause(s, timer ? timer.start : at).session });
      }
      return [];
    }
    const r = await settleInTx(s, at);
    await save(r.session);
    return r.events;
  });
}

async function endFocusInTx(s: F.FocusSession, at: Instant): Promise<FocusSummary> {
  const settled = await settleInTx(s, at);
  const { session, run } = F.pause(settled.session, at);
  if (run) await recordRun(s.taskId, run);
  await db.meta.delete(FOCUS_KEY);
  return summarize(session, at);
}

/** End the session, recording the running focus stretch. */
export async function endFocus(at: Instant = now()): Promise<FocusSummary | null> {
  return db.transaction('rw', [...FOCUS_TABLES], async () => {
    const s = await getFocus();
    return s ? endFocusInTx(s, at) : null;
  });
}

/** Finish the task from Focus Mode: record the stretch, end the session, mark the task done. */
export async function completeFocusTask(at: Instant = now()): Promise<{ summary: FocusSummary; taskBefore: Task } | null> {
  return db.transaction('rw', [...FOCUS_TABLES], async () => {
    const s = await getFocus();
    if (!s) return null;
    const task = await db.tasks.get(s.taskId);
    if (!task) throw new TimeError('Task no longer exists.');
    const summary = await endFocusInTx(s, at);
    if (task.status !== 'done') await updateTask(task.id, { status: 'done' });
    return { summary, taskBefore: task };
  });
}

