/**
 * Recurring classes. Each class's meetings for the term are stored as event blocks (classId set),
 * so the timeline, free-time calculations, auto-scheduling and the exam planner all work around
 * them with no special cases. Blocks are regenerated whenever a class, the term or its holidays
 * change. Every write returns what changed for undo.
 */
import { db } from '@/db/db';
import { classRange, classTitle, expandClass, validateClass } from '@/domain/classes';
import type { ClassDraft, ClassMeeting, ID, TimeBlock } from '@/domain/types';
import { getProfile } from './settingsService';
import { ValidationError } from './taskService';

const now = () => Date.now();
const TABLES = [db.classes, db.blocks, db.categories, db.meta] as const;

function clean(d: ClassDraft): ClassDraft {
  return { ...d, kind: d.kind.trim().replace(/\s+/g, ' '), location: d.location.trim(), days: [...new Set(d.days)].sort(), start: Math.round(d.start), end: Math.round(d.end) };
}

function check(d: ClassDraft) {
  const errors = validateClass(d);
  if (Object.keys(errors).length) throw new ValidationError(errors);
}

/** Build the event blocks for a class over the current term. Inside a transaction. */
async function meetingsFor(c: ClassMeeting): Promise<TimeBlock[]> {
  const [profile, course] = await Promise.all([getProfile(), db.categories.get(c.categoryId)]);
  const title = classTitle(course?.name ?? 'Class', c.kind) + (c.location ? ` · ${c.location}` : '');
  const t = now();
  return expandClass(c, classRange(profile.term, t), profile.term?.holidays).map((m) => ({
    id: crypto.randomUUID(),
    kind: 'event' as const,
    taskId: null,
    title,
    start: m.start,
    end: m.end,
    createdAt: t,
    updatedAt: t,
    classId: c.id,
    categoryId: c.categoryId,
  }));
}

/** Replace a class's blocks; returns the old ones. Inside a transaction. */
async function regenerate(c: ClassMeeting): Promise<TimeBlock[]> {
  const old = await db.blocks.where('classId').equals(c.id).toArray();
  await db.blocks.bulkDelete(old.map((b) => b.id));
  await db.blocks.bulkAdd(await meetingsFor(c));
  return old;
}

export async function createClass(draft: ClassDraft): Promise<{ cls: ClassMeeting; meetings: number }> {
  const d = clean(draft);
  check(d);
  return db.transaction('rw', [...TABLES], async () => {
    if (!(await db.categories.get(d.categoryId))) throw new ValidationError({ categoryId: 'That course no longer exists.' });
    const t = now();
    const cls: ClassMeeting = { id: crypto.randomUUID(), ...d, createdAt: t, updatedAt: t };
    await db.classes.add(cls);
    await regenerate(cls);
    return { cls, meetings: await db.blocks.where('classId').equals(cls.id).count() };
  });
}

export async function updateClass(id: ID, patch: Partial<ClassDraft>): Promise<{ before: ClassMeeting; blocksBefore: TimeBlock[] }> {
  return db.transaction('rw', [...TABLES], async () => {
    const before = await db.classes.get(id);
    if (!before) throw new Error('Class not found');
    const d = clean({ ...before, ...patch });
    check(d);
    const after: ClassMeeting = { ...before, ...d, updatedAt: now() };
    await db.classes.put(after);
    return { before, blocksBefore: await regenerate(after) };
  });
}

export async function deleteClass(id: ID): Promise<{ cls: ClassMeeting; blocks: TimeBlock[] }> {
  return db.transaction('rw', [...TABLES], async () => {
    const cls = await db.classes.get(id);
    if (!cls) throw new Error('Class not found');
    const blocks = await db.blocks.where('classId').equals(id).toArray();
    await db.blocks.bulkDelete(blocks.map((b) => b.id));
    await db.classes.delete(id);
    return { cls, blocks };
  });
}

/** Undo create/update/delete exactly: the class record and its blocks as they were. */
export async function restoreClass(cls: ClassMeeting | null, id: ID, blocks: TimeBlock[]): Promise<void> {
  await db.transaction('rw', [...TABLES], async () => {
    await db.blocks.where('classId').equals(id).delete();
    if (cls) await db.classes.put(cls);
    else await db.classes.delete(id);
    await db.blocks.bulkPut(blocks);
  });
}

/** Rebuild every class's meetings (after the term or its holidays change). */
export async function regenerateAll(): Promise<number> {
  return db.transaction('rw', [...TABLES], async () => {
    const all = await db.classes.toArray();
    for (const c of all) await regenerate(c);
    return db.blocks.where('classId').above('').count();
  });
}
