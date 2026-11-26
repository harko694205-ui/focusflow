/**
 * MyUCLA Study List import: a pasted Study List becomes recurring classes (with their meetings on
 * the timeline) and final exams. Preview first — courses matched to existing ones, sections already
 * in the schedule recognised — then one undoable import. Sets the term if none is set yet, so the
 * classes run for the whole quarter.
 */
import { db } from '@/db/db';
import { matchCourse } from '@/domain/canvas';
import { PREP_PRESETS } from '@/domain/exam';
import type { Profile } from '@/domain/profile';
import { parseStudyList, type StudyCourse, type StudyFinal, type StudySection } from '@/domain/studyList';
import { suggestTerm, type Term } from '@/domain/term';
import type { Category, ID } from '@/domain/types';
import { createClass, deleteClass, regenerateAll } from './classService';
import { createExam, deleteExam } from './examService';
import { getProfile, restoreProfile, setProfile } from './settingsService';
import { createCategory } from './taskService';

export interface PreviewSection extends StudySection {
  /** Already in the class schedule. */
  exists: boolean;
  selected: boolean;
}

export interface PreviewFinal extends StudyFinal {
  exists: boolean;
  selected: boolean;
}

export interface StudyPreviewCourse {
  course: StudyCourse;
  /** Existing course, or 'new'. */
  target: ID | 'new';
  newName: string;
  sections: PreviewSection[];
  final: PreviewFinal | null;
}

export interface StudyPreview {
  courses: StudyPreviewCourse[];
  /** Set when no term is configured yet; it's saved with the import. */
  term: Term | null;
}

const FINAL_PREP = PREP_PRESETS.find((p) => p.label === 'Final')?.minutes ?? 12 * 60;

export async function previewStudyList(text: string, now = Date.now()): Promise<StudyPreview> {
  const parsed = parseStudyList(text);
  const [categories, classes, exams, profile] = await Promise.all([db.categories.orderBy('order').toArray(), db.classes.toArray(), db.exams.toArray(), getProfile()]);
  const courses = parsed.map((course): StudyPreviewCourse => {
    const target = matchCourse(course.name, categories) ?? 'new';
    const mine = target === 'new' ? [] : classes.filter((c) => c.categoryId === target);
    const sections = course.sections.map((s) => {
      const exists = mine.some((c) => c.kind.toLowerCase() === s.kind.toLowerCase() && c.start === s.start && c.days.join() === s.days.join());
      // Waitlisted or dropped sections are shown but off.
      return { ...s, exists, selected: !exists && /^enrolled$/i.test(s.status) };
    });
    const f = course.final;
    const finalExists = !!f && target !== 'new' && exams.some((e) => e.categoryId === target && Math.abs(e.start - f.start) < 60_000);
    return {
      course,
      target,
      newName: course.name,
      sections,
      final: f ? { ...f, exists: finalExists, selected: !finalExists && f.start > now } : null,
    };
  });
  // No term yet: suggest the one the finals (or today) fall in.
  const anchor = parsed.find((c) => c.final)?.final?.start ?? now;
  return { courses, term: profile.term ? null : suggestTerm(anchor) };
}

export interface StudyImportResult {
  classIds: ID[];
  examIds: ID[];
  newCourses: Category[];
  /** Profile before the term was set (undefined = term untouched). */
  profileBefore?: Profile | null;
}

export async function applyStudyList(preview: StudyPreview): Promise<StudyImportResult> {
  return db.transaction('rw', [db.classes, db.blocks, db.categories, db.meta, db.exams, db.tasks, db.sessions], async () => {
    const result: StudyImportResult = { classIds: [], examIds: [], newCourses: [] };
    // The term first, so the classes' meetings cover the whole quarter.
    if (preview.term && !(await getProfile()).term) result.profileBefore = (await setProfile({ term: preview.term })).before;

    for (const c of preview.courses) {
      const sections = c.sections.filter((s) => s.selected);
      const final = c.final?.selected ? c.final : null;
      if (!sections.length && !final) continue;
      let categoryId = c.target;
      if (categoryId === 'new') {
        const before = new Set((await db.categories.toArray()).map((x) => x.id));
        const cat = await createCategory(c.newName.trim() || c.course.name);
        if (!before.has(cat.id)) result.newCourses.push(cat);
        categoryId = cat.id;
      } else if (!(await db.categories.get(categoryId))) throw new Error('A chosen course no longer exists.');

      for (const s of sections) {
        const { cls } = await createClass({ categoryId, kind: s.kind, days: s.days, start: s.start, end: s.end, location: s.location });
        result.classIds.push(cls.id);
      }
      if (final) {
        const exam = await createExam({ title: 'Final', categoryId, start: final.start, duration: final.duration, location: final.location, prepTarget: FINAL_PREP, topics: [], notes: '' });
        result.examIds.push(exam.id);
      }
    }
    return result;
  });
}

export async function undoStudyList(r: StudyImportResult): Promise<void> {
  await db.transaction('rw', [db.classes, db.blocks, db.categories, db.meta, db.exams, db.tasks, db.sessions], async () => {
    for (const id of r.examIds) if (await db.exams.get(id)) await deleteExam(id);
    for (const id of r.classIds) if (await db.classes.get(id)) await deleteClass(id);
    for (const c of r.newCourses) {
      const used = (await db.tasks.where('categoryId').equals(c.id).count()) + (await db.classes.where('categoryId').equals(c.id).count()) + (await db.exams.where('categoryId').equals(c.id).count());
      if (!used) await db.categories.delete(c.id);
    }
    if (r.profileBefore !== undefined) {
      await restoreProfile(r.profileBefore);
      await regenerateAll();
    }
  });
}
