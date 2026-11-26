/**
 * First-run setup. A new browser starts with an empty workspace and a short guided setup
 * (school or work) instead of demo data; the demo is one choice in it. Existing workspaces are
 * marked set up by the v7 database upgrade, so they never see it.
 */
import { db } from '@/db/db';
import type { WorkWeek } from '@/domain/constants';
import { DUE_TIME_DEFAULTS } from '@/domain/profile';
import type { Term } from '@/domain/term';
import { STUDENT_PRESET } from '@/domain/workweek';
import { setProfile, setWorkWeek } from './settingsService';
import { createCategory, loadDemoData } from './taskService';

export const ONBOARDED_KEY = 'onboarded';

export async function isOnboarded(): Promise<boolean> {
  return (await db.meta.get(ONBOARDED_KEY))?.value === true;
}

export async function finishOnboarding(): Promise<void> {
  await db.meta.put({ key: ONBOARDED_KEY, value: true });
}

/** Show the setup again (Settings). Nothing is deleted; each step only adds. */
export async function restartOnboarding(): Promise<void> {
  await db.meta.put({ key: ONBOARDED_KEY, value: false });
}

/** Student path, step 1: Student mode, the term, student hours, and a Personal course for everything else. */
export async function startStudent(term: Term): Promise<void> {
  await db.transaction('rw', [db.meta, db.categories], async () => {
    await setProfile({ mode: 'student', term, dueTime: DUE_TIME_DEFAULTS.student });
    await setWorkWeek(STUDENT_PRESET.week);
    await createCategory('Personal');
  });
}

/** Work path: Work mode, working hours and the areas you track (at least one). */
export async function startWork(areas: string[], week: WorkWeek): Promise<void> {
  const names = [...new Set(areas.map((a) => a.trim()).filter(Boolean))];
  if (!names.length) throw new Error('Add at least one area, like “Work”.');
  await db.transaction('rw', [db.meta, db.categories], async () => {
    await setProfile({ mode: 'work', dueTime: DUE_TIME_DEFAULTS.work });
    await setWorkWeek(week);
    for (const n of names) await createCategory(n);
  });
}

/** "Explore with sample data": the demo workspace, and setup is done. */
export async function exploreDemo(): Promise<void> {
  await loadDemoData();
  await finishOnboarding();
}
