/** Workspace preferences stored in `meta`: working hours (Focus Mode settings live in focusService). */
import { db } from '@/db/db';
import type { WorkWeek } from '@/domain/constants';
import { normalizeWorkWeek, readWorkWeek } from '@/domain/workweek';
import { readProfile, validateProfile, type Profile } from '@/domain/profile';

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

/* -------------------------------------------------------------------------- */
/* Profile (Work / Student mode, term, default due time)                      */
/* -------------------------------------------------------------------------- */

export const PROFILE_KEY = 'profile';

export async function getProfile(): Promise<Profile> {
  return readProfile((await db.meta.get(PROFILE_KEY))?.value);
}

/** Merge and save. Returns the stored value before (null = never set) for undo. */
export async function setProfile(patch: Partial<Profile>): Promise<{ before: Profile | null; after: Profile }> {
  return db.transaction('rw', db.meta, async () => {
    const stored = (await db.meta.get(PROFILE_KEY))?.value as Profile | undefined;
    const after = validateProfile({ ...readProfile(stored), ...patch });
    await db.meta.put({ key: PROFILE_KEY, value: after });
    return { before: stored ?? null, after };
  });
}

export async function restoreProfile(before: Profile | null): Promise<void> {
  if (before) await db.meta.put({ key: PROFILE_KEY, value: before });
  else await db.meta.delete(PROFILE_KEY);
}
