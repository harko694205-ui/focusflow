/**
 * Live data hooks. Every hook re-renders when the underlying IndexedDB tables change —
 * in this tab or any other tab — so writes from the task service propagate everywhere.
 * `undefined` means "still loading".
 */
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { computeRisk, type TaskRisk } from '@/domain/risk';
import { scheduleByTask } from '@/domain/schedule';
import type { ActiveTimer, Category, ClassMeeting, Exam, ID, Task, TimeBlock, WorkSession } from '@/domain/types';
import { DEFAULT_WORK_WEEK, type WorkWeek } from '@/domain/constants';
import { normalizeSettings, type FocusSession, type FocusSettings } from '@/domain/focus';
import { readWorkWeek } from '@/domain/workweek';
import { readProfile, termsFor, type Profile, type Terms } from '@/domain/profile';

export function useTasks(): Task[] | undefined {
  return useLiveQuery(() => db.tasks.toArray(), []);
}

export function useCategories(): Category[] | undefined {
  return useLiveQuery(() => db.categories.orderBy('order').toArray(), []);
}

/**
 * A single task: `undefined` while loading, `null` if it doesn't exist.
 * useLiveQuery keeps returning the previous result while a new query is in flight, so the result is
 * tagged with the id it was fetched for — otherwise switching ids would briefly report the old value.
 */
export function useTask(id: ID | null | undefined): Task | undefined | null {
  const result = useLiveQuery(async () => ({ id, task: id ? ((await db.tasks.get(id)) ?? null) : null }), [id]);
  if (!result || result.id !== id) return undefined;
  return result.task;
}

/** A ticking clock (default: every minute) so relative labels and risk stay current. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useCategoryMap(categories: Category[] | undefined): Map<ID, Category> {
  return useMemo(() => new Map((categories ?? []).map((c) => [c.id, c])), [categories]);
}

export function useRisk(tasks: Task[] | undefined, now: number, week: WorkWeek = DEFAULT_WORK_WEEK): Map<ID, TaskRisk> {
  return useMemo(() => (tasks ? computeRisk(tasks, now, week) : new Map()), [tasks, now, week]);
}


const EMPTY_BLOCKS: TimeBlock[] = [];

/** All time blocks. Workspaces hold at most a few thousand, so loading them whole is fine. */
export function useBlocks(): TimeBlock[] | undefined {
  return useLiveQuery(() => db.blocks.toArray(), []);
}

/** Blocks for one task, earliest first. */
export function useTaskBlocks(taskId: ID | null | undefined): TimeBlock[] | undefined {
  return useLiveQuery(
    async () => (taskId ? (await db.blocks.where('taskId').equals(taskId).toArray()).sort((a, b) => a.start - b.start) : EMPTY_BLOCKS),
    [taskId],
  );
}

/** Everything most views need, in one subscription set. */
export function useWorkspace() {
  const tasks = useTasks();
  const categories = useCategories();
  const blocks = useBlocks();
  const now = useNow();
  const stored = useWorkWeek();
  const week = stored ?? DEFAULT_WORK_WEEK;
  const categoryMap = useCategoryMap(categories);
  const risk = useRisk(tasks, now, week);
  const schedule = useMemo(() => scheduleByTask(blocks ?? EMPTY_BLOCKS, now), [blocks, now]);
  const loading = tasks === undefined || categories === undefined || blocks === undefined || stored === undefined;
  return {
    week,
    tasks: tasks ?? [],
    categories: categories ?? [],
    blocks: blocks ?? EMPTY_BLOCKS,
    categoryMap,
    risk,
    schedule,
    now,
    loading,
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;

const EMPTY_SESSIONS: WorkSession[] = [];

/** All tracked work sessions. */
export function useSessions(): WorkSession[] | undefined {
  return useLiveQuery(() => db.sessions.toArray(), []);
}

/** Sessions for one task, newest first. */
export function useTaskSessions(taskId: ID | null | undefined): WorkSession[] | undefined {
  return useLiveQuery(
    async () => (taskId ? (await db.sessions.where('taskId').equals(taskId).toArray()).sort((a, b) => b.start - a.start) : EMPTY_SESSIONS),
    [taskId],
  );
}

/** The running focus timer, or null. `undefined` while loading. */
export function useActiveTimer(): ActiveTimer | null | undefined {
  return useLiveQuery(async () => ((await db.meta.get('activeTimer'))?.value as ActiveTimer | undefined) ?? null, []);
}

/** The Focus Mode session, or null. `undefined` while loading. */
export function useFocusSession(): FocusSession | null | undefined {
  return useLiveQuery(async () => ((await db.meta.get('focusSession'))?.value as FocusSession | undefined) ?? null, []);
}

export function useFocusSettings(): FocusSettings | undefined {
  return useLiveQuery(async () => normalizeSettings((await db.meta.get('focusSettings'))?.value as Partial<FocusSettings> | undefined), []);
}

/** Working hours (live). `undefined` while loading. */
export function useWorkWeek(): WorkWeek | undefined {
  const raw = useLiveQuery(async () => ({ v: (await db.meta.get('workWeek'))?.value }), []);
  const key = raw ? JSON.stringify(raw.v ?? null) : null;
  // Stable identity while the stored value is unchanged, so memoized calculations don't rerun.
  return useMemo(() => (key === null ? undefined : readWorkWeek(JSON.parse(key))), [key]);
}

/** Last profile any component has loaded, so a newly mounted one (e.g. the task editor) starts right. */
let lastProfileKey = 'null';

/** Work / Student mode, term and default due time (live). */
export function useProfile(): Profile {
  const raw = useLiveQuery(async () => ({ v: (await db.meta.get('profile'))?.value }), []);
  const key = raw ? JSON.stringify(raw.v ?? null) : lastProfileKey;
  lastProfileKey = key;
  return useMemo(() => readProfile(JSON.parse(key)), [key]);
}

/** "Category"/"Course" wording for the current mode. */
export function useTerms(): Terms {
  const mode = useProfile().mode;
  return useMemo(() => termsFor(mode), [mode]);
}

/** All exams, soonest first. `undefined` while loading. */
export function useExams(): Exam[] | undefined {
  return useLiveQuery(() => db.exams.orderBy('start').toArray(), []);
}

/** Recurring classes. `undefined` while loading. */
export function useClasses(): ClassMeeting[] | undefined {
  return useLiveQuery(() => db.classes.toArray(), []);
}
