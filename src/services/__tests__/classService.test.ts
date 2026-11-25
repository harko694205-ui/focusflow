import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { STUDENT_PRESET } from '@/domain/workweek';
import type { ClassDraft } from '@/domain/types';
import * as classes from '../classService';
import * as tasks from '../taskService';
import * as exams from '../examService';
import { setProfile, setWorkWeek } from '../settingsService';
import { buildBackup, importWorkspace } from '../backup';

const term = { name: 'Fall 2026', start: '2026-09-24', weeks: 10, finals: true, holidays: ['2026-11-11'] };
const lecture = (over: Partial<ClassDraft> = {}): ClassDraft => ({ categoryId: 'cs31', kind: 'Lecture', days: [1, 3], start: 600, end: 710, location: 'Moore 100', ...over });
const count = (id: string) => db.blocks.where('classId').equals(id).count();

beforeEach(async () => {
  db.close();
  await db.delete();
  db.seedOnCreate = false;
  await db.open();
  await db.categories.bulkAdd([
    { id: 'cs31', name: 'CS 31', color: 'iris', order: 0, createdAt: 0 },
    { id: 'math', name: 'MATH 33A', color: 'teal', order: 1, createdAt: 0 },
  ]);
  await setProfile({ mode: 'student', term });
  await setWorkWeek(STUDENT_PRESET.week);
});

describe('classes', () => {
  it('a class becomes titled, coloured event blocks for every meeting of the term', async () => {
    const { cls, meetings } = await classes.createClass(lecture());
    expect(meetings).toBe(19); // 10 weeks × MW, minus Veterans Day
    const b = (await db.blocks.where('classId').equals(cls.id).first())!;
    expect(b).toMatchObject({ kind: 'event', title: 'CS 31 Lecture · Moore 100', categoryId: 'cs31', taskId: null });
    expect(new Date(b.start).toTimeString().slice(0, 5)).toBe('10:00');
  });

  it('editing regenerates the meetings; undo restores them exactly', async () => {
    const { cls } = await classes.createClass(lecture());
    const before = await db.blocks.where('classId').equals(cls.id).toArray();
    const r = await classes.updateClass(cls.id, { days: [2, 4, 5] });
    expect(await count(cls.id)).toBe(32); // TRF × 10 weeks, plus Thu+Fri of Week 0
    await classes.restoreClass(r.before, cls.id, r.blocksBefore);
    expect((await db.blocks.where('classId').equals(cls.id).toArray()).map((x) => x.id).sort()).toEqual(before.map((x) => x.id).sort());
    expect((await db.classes.get(cls.id))?.days).toEqual([1, 3]);
  });

  it('deleting removes the meetings; undo brings them back', async () => {
    const { cls } = await classes.createClass(lecture());
    const r = await classes.deleteClass(cls.id);
    expect(await count(cls.id)).toBe(0);
    await classes.restoreClass(r.cls, cls.id, r.blocks);
    expect(await count(cls.id)).toBe(19);
  });

  it('meetings follow term changes and holidays', async () => {
    const { cls } = await classes.createClass(lecture());
    await setProfile({ term: { ...term, holidays: ['2026-11-11', '2026-11-30'] } });
    await classes.regenerateAll();
    expect(await count(cls.id)).toBe(18);
  });

  it('renaming a course retitles its classes; undo of the rename too', async () => {
    const { cls } = await classes.createClass(lecture());
    const r = await tasks.updateCategory('cs31', { name: 'COM SCI 31' });
    expect((await db.blocks.where('classId').equals(cls.id).first())!.title).toBe('COM SCI 31 Lecture · Moore 100');
    await tasks.restoreCategoryEdit(r.before);
    expect((await db.blocks.where('classId').equals(cls.id).first())!.title).toBe('CS 31 Lecture · Moore 100');
  });

  it('deleting a course moves its classes; undo restores them', async () => {
    const { cls } = await classes.createClass(lecture());
    await expect(tasks.deleteCategory('cs31')).rejects.toThrow(/where its tasks and classes/);
    const r = await tasks.deleteCategory('cs31', 'math');
    expect((await db.classes.get(cls.id))?.categoryId).toBe('math');
    expect((await db.blocks.where('classId').equals(cls.id).first())!.title).toMatch(/^MATH 33A Lecture/);
    await tasks.restoreCategory(r.category, r.moved, r.movedClasses, r.classBlocks);
    expect((await db.classes.get(cls.id))?.categoryId).toBe('cs31');
    expect((await db.blocks.where('classId').equals(cls.id).first())!.title).toMatch(/^CS 31 Lecture/);
  });

  it('study sessions are planned around classes', async () => {
    // Mon–Fri 10:00–17:00 classes leave only evenings free on weekdays.
    await classes.createClass(lecture({ days: [1, 2, 3, 4, 5], start: 600, end: 17 * 60, location: '' }));
    const e = await exams.createExam({ title: 'Midterm', categoryId: 'cs31', start: new Date('2026-11-04T10:00').getTime(), duration: 110, location: '', prepTarget: 4 * 60, topics: [], notes: '' });
    await exams.applyPlan(e.id, new Date('2026-10-28T09:00').getTime());
    const prep = await db.tasks.where('examId').equals(e.id).toArray();
    const blocks = await db.blocks.where('taskId').anyOf(prep.map((t) => t.id)).toArray();
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) {
      const d = new Date(b.start);
      if (d.getDay() >= 1 && d.getDay() <= 5) expect(d.getHours()).toBeGreaterThanOrEqual(17); // never during class
    }
  });

  it('clearing tasks keeps the class schedule; backups carry classes', async () => {
    const { cls } = await classes.createClass(lecture());
    await tasks.clearTasks();
    expect(await count(cls.id)).toBe(19);
    const backup = await buildBackup();
    await db.classes.clear();
    await importWorkspace(JSON.stringify(backup));
    expect((await db.classes.get(cls.id))?.kind).toBe('Lecture');
    expect(await count(cls.id)).toBe(19);
  });

  it('rejects invalid classes', async () => {
    await expect(classes.createClass(lecture({ days: [] }))).rejects.toThrow(/days/);
    await expect(classes.createClass(lecture({ categoryId: 'nope' }))).rejects.toThrow(/course/);
  });
});
