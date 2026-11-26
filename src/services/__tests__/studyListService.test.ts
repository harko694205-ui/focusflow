import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { STUDY_LIST_MD } from '@/test/studyList';
import * as sl from '../studyListService';
import { getProfile, setProfile } from '../settingsService';

const NOW = new Date('2026-11-25T12:00').getTime();

beforeEach(async () => {
  db.close();
  await db.delete();
  db.seedOnCreate = false;
  await db.open();
  // A course already created by the BruinLearn import, with a different spelling.
  await db.categories.add({ id: 'econ', name: 'ECON 11', color: 'iris', order: 0, createdAt: 0 });
  await setProfile({ mode: 'student' });
});

describe('Study List import', () => {
  it('previews: matches existing courses, proposes new ones, suggests the term', async () => {
    const p = await sl.previewStudyList(STUDY_LIST_MD, NOW);
    expect(p.courses.map((c) => [c.course.name, c.target])).toEqual([
      ['ECON 11', 'econ'],
      ['MGMT 1B', 'new'],
      ['MUSCLG M82', 'new'],
    ]);
    expect(p.term).toMatchObject({ name: 'Fall 2026', start: '2026-09-24', weeks: 10 });
    expect(p.courses.flatMap((c) => c.sections).every((s) => s.selected)).toBe(true);
    expect(p.courses.map((c) => c.final?.selected ?? null)).toEqual([true, true, null]);
  });

  it('imports classes with meetings all term, finals as exams, and sets the term', async () => {
    const r = await sl.applyStudyList(await sl.previewStudyList(STUDY_LIST_MD, NOW));
    expect(r.classIds).toHaveLength(6);
    expect(r.examIds).toHaveLength(2);
    expect(r.newCourses.map((c) => c.name)).toEqual(['MGMT 1B', 'MUSCLG M82']);
    expect((await getProfile()).term?.name).toBe('Fall 2026');

    const lec = (await db.classes.where('categoryId').equals('econ').toArray()).find((c) => c.kind === 'Lecture')!;
    expect(lec).toMatchObject({ days: [1, 3], start: 1020, end: 1095, location: 'Broad Art Center 2160E' });
    // MW from Mon Sep 28 to Wed Dec 2: 10 weeks × 2.
    expect(await db.blocks.where('classId').equals(lec.id).count()).toBe(20);
    const final = (await db.exams.where('categoryId').equals('econ').first())!;
    expect(final).toMatchObject({ title: 'Final', duration: 180, start: new Date(2026, 11, 10, 11, 30).getTime() });
    expect(await db.blocks.where('examId').equals(final.id).count()).toBe(1);
  });

  it('pasting again finds nothing new', async () => {
    await sl.applyStudyList(await sl.previewStudyList(STUDY_LIST_MD, NOW));
    const p = await sl.previewStudyList(STUDY_LIST_MD, NOW);
    expect(p.term).toBeNull();
    expect(p.courses.every((c) => c.target !== 'new')).toBe(true);
    expect(p.courses.flatMap((c) => c.sections).every((s) => s.exists && !s.selected)).toBe(true);
    expect(p.courses.filter((c) => c.final).every((c) => c.final!.exists && !c.final!.selected)).toBe(true);
  });

  it('undo removes everything it added and the term it set', async () => {
    const r = await sl.applyStudyList(await sl.previewStudyList(STUDY_LIST_MD, NOW));
    await sl.undoStudyList(r);
    expect(await db.classes.count()).toBe(0);
    expect(await db.exams.count()).toBe(0);
    expect(await db.blocks.count()).toBe(0);
    expect((await db.categories.toArray()).map((c) => c.id)).toEqual(['econ']);
    expect((await getProfile()).term).toBeNull();
  });
});
