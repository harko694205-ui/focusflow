import { beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { db, FocusFlowDB } from '@/db/db';
import { STUDENT_PRESET, WORK_WEEK_PRESETS } from '@/domain/workweek';
import * as ob from '../onboardingService';
import { getProfile, getWorkWeek } from '../settingsService';
import { buildBackup, importWorkspace } from '../backup';

const fall = { name: 'Fall 2026', start: '2026-09-24', weeks: 10, finals: true };

beforeEach(async () => {
  db.close();
  await db.delete();
  await db.open();
});

describe('first-run setup', () => {
  it('a new browser starts empty and not set up (no demo data)', async () => {
    expect(await ob.isOnboarded()).toBe(false);
    expect(await db.tasks.count()).toBe(0);
    expect(await db.categories.count()).toBe(0);
  });

  it('a workspace from before this version counts as set up', async () => {
    db.close();
    await db.delete();
    // Someone's existing data, written by the previous schema version.
    const old = new Dexie('focusflow-upgrade-test');
    old.version(6).stores({ tasks: 'id, &seq, status, categoryId, deadline, priority, updatedAt, examId', categories: 'id, order', meta: 'key' });
    await old.open();
    await old.table('categories').add({ id: 'c', name: 'Mine', color: 'iris', order: 0, createdAt: 0 });
    old.close();
    const upgraded = new FocusFlowDB('focusflow-upgrade-test');
    await upgraded.open();
    expect((await upgraded.meta.get(ob.ONBOARDED_KEY))?.value).toBe(true);
    expect(await upgraded.categories.count()).toBe(1);
    upgraded.close();
    await Dexie.delete('focusflow-upgrade-test');
  });

  it('student path: Student mode, the term, student hours and a Personal course', async () => {
    await ob.startStudent(fall);
    expect(await getProfile()).toMatchObject({ mode: 'student', term: fall, dueTime: '23:59' });
    expect(await getWorkWeek()).toEqual(STUDENT_PRESET.week);
    expect((await db.categories.toArray()).map((c) => c.name)).toEqual(['Personal']);
    expect(await ob.isOnboarded()).toBe(false); // done only when the last step finishes
    await ob.finishOnboarding();
    expect(await ob.isOnboarded()).toBe(true);
  });

  it('work path: areas and hours; needs at least one area', async () => {
    const nineFive = WORK_WEEK_PRESETS.find((p) => p.id === 'nine-five')!.week;
    await expect(ob.startWork(['  '], nineFive)).rejects.toThrow(/area/);
    await ob.startWork(['Work', 'Personal', 'work '], nineFive);
    expect((await getProfile()).mode).toBe('work');
    expect(await getWorkWeek()).toEqual(nineFive);
    expect((await db.categories.toArray()).map((c) => c.name).sort()).toEqual(['Personal', 'Work']);
  });

  it('exploring the demo finishes setup', async () => {
    await ob.exploreDemo();
    expect(await ob.isOnboarded()).toBe(true);
    expect(await db.tasks.count()).toBeGreaterThan(5);
  });

  it('running setup again keeps everything; restoring a backup counts as set up', async () => {
    await ob.startWork(['Work'], STUDENT_PRESET.week);
    await ob.finishOnboarding();
    await ob.restartOnboarding();
    expect(await ob.isOnboarded()).toBe(false);
    expect(await db.categories.count()).toBe(1);
    await importWorkspace(JSON.stringify(await buildBackup()));
    expect(await ob.isOnboarded()).toBe(true);
  });
});
