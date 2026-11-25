import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { STUDENT_PRESET } from '@/domain/workweek';
import type { ExamDraft } from '@/domain/types';
import * as exams from '../examService';
import * as tasks from '../taskService';
import * as time from '../timeService';
import { setWorkWeek } from '../settingsService';
import { buildBackup, importWorkspace } from '../backup';

const NOW = new Date('2026-11-25T14:00').getTime(); // Wed
const draft = (over: Partial<ExamDraft> = {}): ExamDraft => ({
  title: 'Midterm 2',
  categoryId: 'cs31',
  start: new Date('2026-12-01T10:00').getTime(), // Tue
  duration: 110,
  location: 'Moore 100',
  prepTarget: 6 * 60,
  topics: [
    { id: 't1', name: 'Recursion', confidence: 1 },
    { id: 't2', name: 'Pointers', confidence: 2 },
  ],
  notes: '',
  ...over,
});

beforeEach(async () => {
  db.close();
  await db.delete();
  db.seedOnCreate = false;
  await db.open();
  await db.categories.bulkAdd([
    { id: 'cs31', name: 'CS 31', color: 'iris', order: 0, createdAt: 0 },
    { id: 'math', name: 'MATH 33A', color: 'teal', order: 1, createdAt: 0 },
  ]);
  await setWorkWeek(STUDENT_PRESET.week);
});

describe('exams', () => {
  it('creating an exam blocks its time on the timeline; edits move the event', async () => {
    const e = await exams.createExam(draft());
    const event = await db.blocks.where('examId').equals(e.id).first();
    expect(event).toMatchObject({ kind: 'event', title: 'Midterm 2 (exam)', start: e.start, end: e.start + 110 * 60_000 });

    const later = new Date('2026-12-02T15:00').getTime();
    const r = await exams.updateExam(e.id, { start: later, title: 'Midterm II' });
    expect((await db.blocks.where('examId').equals(e.id).first())).toMatchObject({ start: later, title: 'Midterm II (exam)' });
    await exams.restoreExamEdit(r.before, r.eventBefore);
    expect((await db.blocks.where('examId').equals(e.id).first())?.start).toBe(e.start);
    expect((await db.exams.get(e.id))?.title).toBe('Midterm 2');
  });

  it('rejects invalid exams', async () => {
    await expect(exams.createExam(draft({ title: '' }))).rejects.toThrow(/Name the exam/);
    await expect(exams.createExam(draft({ categoryId: 'nope' }))).rejects.toThrow(/course/);
    expect(await db.exams.count()).toBe(0);
  });

  it('applying a plan creates study-session tasks placed on their days, before the exam', async () => {
    const e = await exams.createExam(draft());
    const r = await exams.applyPlan(e.id, NOW);
    expect(r.plan.sessions.length).toBeGreaterThanOrEqual(3);
    const prep = await db.tasks.where('examId').equals(e.id).toArray();
    expect(prep).toHaveLength(r.plan.sessions.length);
    expect(prep.every((t) => t.categoryId === 'cs31' && t.deadline <= e.start && t.title.startsWith('Midterm 2:'))).toBe(true);
    const blocks = await db.blocks.where('taskId').anyOf(prep.map((t) => t.id)).toArray();
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) {
      const t = prep.find((x) => x.id === b.taskId)!;
      expect(new Date(b.start).toDateString()).toBe(new Date(t.deadline).toDateString()); // on the planned day
      expect(b.start).toBeGreaterThanOrEqual(NOW);
    }
    expect(r.scheduled).toBeGreaterThan(5 * 60); // nearly all of it fits in free time
  });

  it('re-planning keeps finished and tracked sessions, replaces the rest; undo restores', async () => {
    const e = await exams.createExam(draft());
    const first = await exams.applyPlan(e.id, NOW);
    const [a, b] = await db.tasks.bulkGet(first.createdTaskIds.slice(0, 2));
    await tasks.updateTask(a!.id, { status: 'done' });
    await time.logTime(b!.id, 30, NOW);

    const second = await exams.applyPlan(e.id, NOW);
    const prep = await db.tasks.where('examId').equals(e.id).toArray();
    expect(prep.some((t) => t.id === a!.id)).toBe(true);
    expect(prep.some((t) => t.id === b!.id)).toBe(true);
    expect(second.removed.tasks.length).toBe(first.createdTaskIds.length - 2);
    expect(second.plan.remaining).toBeLessThan(first.plan.remaining); // done work counts

    await exams.undoPlan(second.createdTaskIds, second.removed);
    const after = await db.tasks.where('examId').equals(e.id).toArray();
    expect(after.map((t) => t.id).sort()).toEqual(first.createdTaskIds.slice().sort());
  });

  it('deleting an exam removes its event and untouched sessions; undo brings everything back', async () => {
    const e = await exams.createExam(draft());
    const plan = await exams.applyPlan(e.id, NOW);
    await tasks.updateTask(plan.createdTaskIds[0], { status: 'done' });
    const r = await exams.deleteExam(e.id);
    expect(await db.exams.count()).toBe(0);
    expect(await db.blocks.where('examId').equals(e.id).count()).toBe(0);
    expect(await db.tasks.where('examId').equals(e.id).count()).toBe(1); // the finished one stays
    await exams.restoreExam(r.exam, r.event, r.removed);
    expect(await db.tasks.where('examId').equals(e.id).count()).toBe(plan.createdTaskIds.length);
    expect(await db.blocks.where('examId').equals(e.id).count()).toBe(1);
  });

  it('changing the course moves the study sessions too', async () => {
    const e = await exams.createExam(draft());
    await exams.applyPlan(e.id, NOW);
    await exams.updateExam(e.id, { categoryId: 'math' });
    expect((await db.tasks.where('examId').equals(e.id).toArray()).every((t) => t.categoryId === 'math')).toBe(true);
  });

  it('exams travel with backups and are cleared with tasks', async () => {
    const e = await exams.createExam(draft());
    const backup = await buildBackup();
    await tasks.clearTasks();
    expect(await db.exams.count()).toBe(0);
    await importWorkspace(JSON.stringify(backup));
    expect((await db.exams.get(e.id))?.title).toBe('Midterm 2');
    await expect(importWorkspace(JSON.stringify({ ...backup, exams: [{ id: 1 }] }))).rejects.toThrow(/exams/);
  });
});

describe('topic ratings', () => {
  it('quick successive ratings all stick', async () => {
    const e = await exams.createExam(draft());
    await Promise.all([exams.setTopicConfidence(e.id, 't1', 3), exams.setTopicConfidence(e.id, 't2', 1)]);
    expect((await db.exams.get(e.id))!.topics.map((t) => t.confidence)).toEqual([3, 1]);
  });
});

describe('placement', () => {
  it('a session goes in one sitting when a gap is long enough', async () => {
    // A lecture 10:00–11:00 on Fri Dec 4 leaves 11:00–12:00 and 13:00–17:00 free (student hours).
    const fri = new Date('2026-12-04T00:00').getTime();
    await db.blocks.add({ id: 'lec', kind: 'event', taskId: null, title: 'Lecture', start: fri + 10 * 3_600_000, end: fri + 11 * 3_600_000, createdAt: 0, updatedAt: 0 });
    const e = await exams.createExam(draft({ start: new Date('2026-12-07T08:00').getTime(), prepTarget: 12 * 60, duration: 180 }));
    await exams.applyPlan(e.id, NOW);
    const practice = (await db.tasks.where('examId').equals(e.id).toArray()).find((t) => t.title.endsWith('practice exam'))!;
    const blocks = await db.blocks.where('taskId').equals(practice.id).toArray();
    expect(blocks).toHaveLength(1);
    expect((blocks[0].end - blocks[0].start) / 60_000).toBe(practice.estimate);
  });
});
