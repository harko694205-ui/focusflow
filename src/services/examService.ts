/**
 * Exams and their study plans. An exam has an event block on the timeline (so its time is
 * blocked out), and its study sessions are ordinary tasks with `examId` set, placed in free time
 * on the planned day. Every write returns what changed so the UI can offer undo.
 */
import { db } from '@/db/db';
import type { WorkWeek } from '@/domain/constants';
import { examProgress, planExamPrep, sessionNotes, sessionTitle, validateExam, type ExamPlan, type PlannedSession } from '@/domain/exam';
import { endMinuteOfDay, freeIntervals, minuteOfDay, startOfLocalDay } from '@/domain/schedule';
import type { Difficulty, Exam, ExamDraft, ID, Instant, Task, TimeBlock, WorkSession } from '@/domain/types';
import { getWorkWeek } from './settingsService';
import { createTask, deleteTasks, restoreTasks, ValidationError } from './taskService';

const now = () => Date.now();
const MIN = 60_000;
const ALL = [db.exams, db.tasks, db.blocks, db.sessions, db.meta, db.categories] as const;

function clean(d: ExamDraft): ExamDraft {
  return {
    ...d,
    title: d.title.trim().replace(/\s+/g, ' '),
    location: d.location.trim(),
    notes: d.notes.trim(),
    duration: Math.round(d.duration),
    prepTarget: Math.round(d.prepTarget),
    topics: d.topics.map((t) => ({ ...t, name: t.name.trim() })),
  };
}

function check(d: ExamDraft) {
  const errors = validateExam(d);
  if (Object.keys(errors).length) throw new ValidationError(errors);
}

/** The exam's event block: same day, clipped at midnight (blocks never cross days). */
function eventFor(exam: Exam, existing?: TimeBlock): TimeBlock {
  const start = exam.start;
  const dayEnd = startOfLocalDay(start).getTime() + 24 * 60 * MIN;
  const t = now();
  return {
    id: existing?.id ?? crypto.randomUUID(),
    kind: 'event',
    taskId: null,
    title: `${exam.title} (exam)`,
    start,
    end: Math.min(start + exam.duration * MIN, dayEnd),
    createdAt: existing?.createdAt ?? t,
    updatedAt: t,
    examId: exam.id,
  };
}

export async function createExam(draft: ExamDraft): Promise<Exam> {
  const d = clean(draft);
  check(d);
  return db.transaction('rw', [...ALL], async () => {
    if (!(await db.categories.get(d.categoryId))) throw new ValidationError({ categoryId: 'That course no longer exists.' });
    const t = now();
    const exam: Exam = { id: crypto.randomUUID(), ...d, createdAt: t, updatedAt: t };
    await db.exams.add(exam);
    await db.blocks.add(eventFor(exam));
    return exam;
  });
}

export async function updateExam(id: ID, patch: Partial<ExamDraft>): Promise<{ before: Exam; after: Exam; eventBefore: TimeBlock | null }> {
  return db.transaction('rw', [...ALL], async () => {
    const before = await db.exams.get(id);
    if (!before) throw new Error('Exam not found');
    const d = clean({ ...before, ...patch });
    check(d);
    if (patch.categoryId && !(await db.categories.get(d.categoryId))) throw new ValidationError({ categoryId: 'That course no longer exists.' });
    const after: Exam = { ...before, ...d, updatedAt: now() };
    await db.exams.put(after);
    const eventBefore = (await db.blocks.where('examId').equals(id).first()) ?? null;
    await db.blocks.put(eventFor(after, eventBefore ?? undefined));
    // Study sessions follow the course if it changed.
    if (after.categoryId !== before.categoryId) {
      const prep = await db.tasks.where('examId').equals(id).toArray();
      await db.tasks.bulkPut(prep.map((t) => ({ ...t, categoryId: after.categoryId })));
    }
    return { before, after, eventBefore };
  });
}

/** Undo an update exactly. */
export async function restoreExamEdit(before: Exam, eventBefore: TimeBlock | null): Promise<void> {
  await db.transaction('rw', [...ALL], async () => {
    await db.exams.put(before);
    await db.blocks.where('examId').equals(before.id).delete();
    if (eventBefore) await db.blocks.put(eventBefore);
    const prep = await db.tasks.where('examId').equals(before.id).toArray();
    await db.tasks.bulkPut(prep.map((t) => ({ ...t, categoryId: before.categoryId })));
  });
}

export interface RemovedWork {
  tasks: Task[];
  blocks: TimeBlock[];
  sessions: WorkSession[];
}

/** Study sessions that can be replaced or removed: unfinished and with no time tracked. */
async function replaceablePrep(examId: ID): Promise<Task[]> {
  const prep = await db.tasks.where('examId').equals(examId).toArray();
  const open = prep.filter((t) => t.status !== 'done');
  if (!open.length) return [];
  const tracked = new Set((await db.sessions.where('taskId').anyOf(open.map((t) => t.id)).toArray()).map((s) => s.taskId));
  return open.filter((t) => !tracked.has(t.id));
}

/** Delete an exam with its timeline event and its untouched study sessions (finished ones stay). */
export async function deleteExam(id: ID): Promise<{ exam: Exam; event: TimeBlock | null; removed: RemovedWork }> {
  return db.transaction('rw', [...ALL], async () => {
    const exam = await db.exams.get(id);
    if (!exam) throw new Error('Exam not found');
    const event = (await db.blocks.where('examId').equals(id).first()) ?? null;
    const removed = await deleteTasks((await replaceablePrep(id)).map((t) => t.id));
    if (event) await db.blocks.delete(event.id);
    await db.exams.delete(id);
    return { exam, event, removed };
  });
}

export async function restoreExam(exam: Exam, event: TimeBlock | null, removed: RemovedWork): Promise<void> {
  await db.transaction('rw', [...ALL], async () => {
    await db.exams.put(exam);
    if (event) await db.blocks.put(event);
    await restoreTasks(removed.tasks, removed.blocks, removed.sessions);
  });
}

/** Minutes tracked per task, for prep progress. */
export async function trackedFor(taskIds: ID[]): Promise<Map<ID, number>> {
  const m = new Map<ID, number>();
  if (!taskIds.length) return m;
  for (const s of await db.sessions.where('taskId').anyOf(taskIds).toArray()) m.set(s.taskId, (m.get(s.taskId) ?? 0) + (s.end - s.start) / MIN);
  return m;
}

/** What a fresh plan would look like now, counting prep already done (for the preview). */
export async function previewPlan(examId: ID, at: Instant = now(), week?: WorkWeek): Promise<ExamPlan> {
  const exam = await db.exams.get(examId);
  if (!exam) throw new Error('Exam not found');
  const replaceable = new Set((await replaceablePrep(examId)).map((t) => t.id));
  const kept = (await db.tasks.where('examId').equals(examId).toArray()).filter((t) => !replaceable.has(t.id));
  const progress = examProgress(exam, kept, await trackedFor(kept.map((t) => t.id)), at);
  return planExamPrep({ exam, now: at, doneMinutes: progress.done, week: week ?? (await getWorkWeek()) });
}

const DIFFICULTY: Record<PlannedSession['kind'], Difficulty> = { study: 2, practice: 3, review: 1 };
const CHUNK_MAX = 120;

/**
 * Place `minutes` of a task into free working time on its day; returns the blocks (may cover
 * less). One sitting is preferred: the first gap that fits the whole session (up to 3h) is used;
 * otherwise the session is split across gaps.
 */
function placeOnDay(task: Task, day: Instant, minutes: number, dayBlocks: TimeBlock[], week: WorkWeek, at: Instant, latest: Instant): TimeBlock[] {
  const isToday = startOfLocalDay(at).getTime() === day;
  const fromMinute = isToday ? Math.ceil(minuteOfDay(at) / 15) * 15 : undefined;
  const latestMinute = startOfLocalDay(latest).getTime() === day ? minuteOfDay(latest) : 24 * 60;
  const out: TimeBlock[] = [];
  let left = minutes;
  const t = now();
  const gaps = freeIntervals(day, dayBlocks, { week, fromMinute, minLength: 30 }).map((g) => ({ start: g.start, end: Math.min(g.end, latestMinute) }));
  const whole = gaps.find((g) => g.end - g.start >= minutes);
  if (whole) {
    return [{ id: crypto.randomUUID(), kind: 'task', taskId: task.id, title: '', start: day + whole.start * MIN, end: day + (whole.start + minutes) * MIN, createdAt: t, updatedAt: t }];
  }
  for (const free of gaps) {
    let cursor = free.start;
    const end = free.end;
    while (left >= 15 && end - cursor >= 30) {
      const len = Math.min(left, CHUNK_MAX, end - cursor);
      if (len < 30 && left >= 30) break;
      out.push({ id: crypto.randomUUID(), kind: 'task', taskId: task.id, title: '', start: day + cursor * MIN, end: day + (cursor + len) * MIN, createdAt: t, updatedAt: t });
      cursor += len;
      left -= len;
    }
    if (left < 15) break;
  }
  return out;
}

/**
 * (Re)build the study plan: replace untouched sessions with a fresh plan for the prep still
 * needed, create a task per session and place it on its day. Returns what to undo.
 */
export async function applyPlan(
  examId: ID,
  at: Instant = now(),
): Promise<{ plan: ExamPlan; createdTaskIds: ID[]; scheduled: number; removed: RemovedWork }> {
  return db.transaction('rw', [...ALL], async () => {
    const exam = await db.exams.get(examId);
    if (!exam) throw new Error('Exam not found');
    const week = await getWorkWeek();
    const plan = await previewPlan(examId, at, week);
    const removed = await deleteTasks((await replaceablePrep(examId)).map((t) => t.id));

    const createdTaskIds: ID[] = [];
    let scheduled = 0;
    for (const s of plan.sessions) {
      const dayEnd = s.day + 24 * 60 * MIN - MIN; // 23:59
      const task = await createTask({
        title: sessionTitle(exam.title, s),
        notes: sessionNotes(s),
        categoryId: exam.categoryId,
        priority: 1,
        difficulty: DIFFICULTY[s.kind],
        estimate: s.minutes,
        deadline: Math.min(dayEnd, exam.start),
        examId,
      });
      createdTaskIds.push(task.id);
      const dayBlocks = await db.blocks.where('start').between(s.day, s.day + 24 * 60 * MIN, true, false).toArray();
      const blocks = placeOnDay(task, s.day, s.minutes, dayBlocks, week, at, Math.min(dayEnd, exam.start));
      if (blocks.length) {
        await db.blocks.bulkAdd(blocks);
        scheduled += blocks.reduce((a, b) => a + (endMinuteOfDay(b.start, b.end) - minuteOfDay(b.start)), 0);
      }
    }
    return { plan, createdTaskIds, scheduled, removed };
  });
}

/** Undo applyPlan: remove the new sessions, bring back the replaced ones. */
export async function undoPlan(createdTaskIds: ID[], removed: RemovedWork): Promise<void> {
  await db.transaction('rw', [...ALL], async () => {
    await deleteTasks(createdTaskIds);
    await restoreTasks(removed.tasks, removed.blocks, removed.sessions);
  });
}

/** Rate one topic, reading the exam fresh (safe with quick successive clicks). */
export async function setTopicConfidence(examId: ID, topicId: ID, confidence: 1 | 2 | 3) {
  return db.transaction('rw', db.exams, async () => {
    const before = await db.exams.get(examId);
    if (!before) throw new Error('Exam not found');
    const after = { ...before, topics: before.topics.map((t) => (t.id === topicId ? { ...t, confidence } : t)), updatedAt: now() };
    await db.exams.put(after);
    return { before, after };
  });
}

/** Undo a topic rating. */
export async function restoreExamRecord(before: Exam): Promise<void> {
  await db.exams.put(before);
}
