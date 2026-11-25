/** Workspace preferences stored in `meta`: working hours (Focus Mode settings live in focusService). */
import { db } from '@/db/db';
import type { WorkWeek } from '@/domain/constants';
import { normalizeWorkWeek, readWorkWeek } from '@/domain/workweek';

export const WORK_WEEK_KEY = 'workWeek';

export async function getWorkWeek(): Promise<WorkWeek> {
  return readWorkWeek((await db.meta.get(WORK_WEEK_KEY))?.value);
}

/** Validate and save working hours. Returns the previous value (null = default) for undo. */
export async function setWorkWeek(week: WorkWeek): Promise<{ before: WorkWeek | null; after: WorkWeek }> {
  const after = normalizeWorkWeek(week);
  return db.transaction('rw', db.meta, async () => {
    const stored = (await db.meta.get(WORK_WEEK_KEY))?.value as WorkWeek | undefined;
    await db.meta.put({ key: WORK_WEEK_KEY, value: after });
    return { before: stored ?? null, after };
  });
}

/** Back to the built-in default (or an exact earlier value, for undo). */
export async function restoreWorkWeek(week: WorkWeek | null): Promise<void> {
  if (week) await db.meta.put({ key: WORK_WEEK_KEY, value: week });
  else await db.meta.delete(WORK_WEEK_KEY);
}
