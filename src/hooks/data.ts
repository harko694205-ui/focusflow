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
import type { Category, ID, Task, TimeBlock } from '@/domain/types';

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

export function useRisk(tasks: Task[] | undefined, now: number): Map<ID, TaskRisk> {
  return useMemo(() => (tasks ? computeRisk(tasks, now) : new Map()), [tasks, now]);
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
  const categoryMap = useCategoryMap(categories);
  const risk = useRisk(tasks, now);
  const schedule = useMemo(() => scheduleByTask(blocks ?? EMPTY_BLOCKS, now), [blocks, now]);
  const loading = tasks === undefined || categories === undefined || blocks === undefined;
  return {
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
