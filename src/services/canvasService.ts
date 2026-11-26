/**
 * BruinLearn / Canvas import. A calendar (.ics file or feed) is turned into a preview —
 * which assignments are new, which changed, which course each belongs to — and the chosen
 * rows become ordinary tasks tagged with their calendar UID, so importing again updates them
 * instead of adding duplicates. The course mapping is remembered for the next sync.
 */
import { db } from '@/db/db';
import { canvasItems, canvasNotes, matchCourse, normalizeFeedUrl, parseIcs, suggestCourseName, type CanvasItem } from '@/domain/canvas';
import type { Category, Difficulty, ID, Minutes, Task } from '@/domain/types';
import { createCategory, createTask, restoreTasks } from './taskService';
import { getProfile } from './settingsService';
import { closeTimer, dropFocusFor } from './timeService';

export const CANVAS_KEY = 'canvas';

export interface CanvasState {
  /** Saved calendar feed link, synced on demand. */
  feedUrl: string | null;
  lastSync: number | null;
  /** Canvas course name → course id, or 'skip'. */
  courses: Record<string, ID | 'skip'>;
  /** Every UID ever imported, so assignments you deleted aren't offered as new again. */
  imported: string[];
}


export function readCanvasState(v: unknown): CanvasState {
  const s = (v ?? {}) as Partial<CanvasState>;
  return {
    feedUrl: typeof s.feedUrl === 'string' ? s.feedUrl : null,
    lastSync: typeof s.lastSync === 'number' ? s.lastSync : null,
    courses: s.courses && typeof s.courses === 'object' ? s.courses : {},
    imported: Array.isArray(s.imported) ? s.imported.filter((x) => typeof x === 'string') : [],
  };
}

export async function getCanvasState(): Promise<CanvasState> {
  return readCanvasState((await db.meta.get(CANVAS_KEY))?.value);
}

/* -------------------------------------------------------------------------- */
/* Preview                                                                    */
/* -------------------------------------------------------------------------- */

export type RowStatus =
  /** Not imported yet. */
  | 'new'
  /** Imported before; its due date or title changed in BruinLearn. */
  | 'changed'
  /** Imported and unchanged. */
  | 'same'
  /** Imported and since marked done here. */
  | 'done'
  /** Imported, then deleted here. */
  | 'deleted'
  /** Due date already passed. */
  | 'past';

export interface PreviewRow {
  item: CanvasItem;
  status: RowStatus;
  /** The task it updates, for 'changed' / 'same' / 'done'. */
  taskId?: ID;
  /** Its current deadline, for 'changed'. */
  oldDue?: number;
  /** Ticked by default. */
  selected: boolean;
}

export interface PreviewCourse {
  /** The Canvas course name ("" for items without one). */
  name: string;
  /** Existing course, 'new' or 'skip'. */
  target: ID | 'new' | 'skip';
  /** Name for a new course. */
  newName: string;
  count: number;
}

export interface CanvasPreview {
  rows: PreviewRow[];
  courses: PreviewCourse[];
}

export async function previewCanvas(ics: string, now = Date.now()): Promise<CanvasPreview> {
  const events = parseIcs(ics);
  const [profile, state, categories, tasks] = await Promise.all([getProfile(), getCanvasState(), db.categories.orderBy('order').toArray(), db.tasks.toArray()]);
  const items = canvasItems(events, profile.dueTime);
  if (!items.length) throw new Error('No assignments or events in that calendar.');
  const byUid = new Map(tasks.filter((t) => t.sourceUid).map((t) => [t.sourceUid!, t]));
  const imported = new Set(state.imported);
  const ids = new Set(categories.map((c) => c.id));

  const rows: PreviewRow[] = items.map((item) => {
    const task = byUid.get(item.uid);
    if (task) {
      if (task.status === 'done') return { item, status: 'done', taskId: task.id, selected: false };
      const changed = task.deadline !== item.due || task.title !== item.title;
      return changed ? { item, status: 'changed', taskId: task.id, oldDue: task.deadline, selected: true } : { item, status: 'same', taskId: task.id, selected: false };
    }
    if (imported.has(item.uid)) return { item, status: 'deleted', selected: false };
    if (item.due < now) return { item, status: 'past', selected: false };
    return { item, status: 'new', selected: item.kind === 'assignment' && !item.exam };
  });

  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.item.course ?? '', (counts.get(r.item.course ?? '') ?? 0) + 1);
  const courses: PreviewCourse[] = [...counts].map(([name, count]) => {
    const remembered = state.courses[name];
    const target = remembered && (remembered === 'skip' || ids.has(remembered)) ? remembered : (matchCourse(name || 'Imported', categories) ?? 'new');
    return { name, target, newName: name ? suggestCourseName(name) : 'BruinLearn', count };
  });
  courses.sort((a, b) => a.name.localeCompare(b.name));
  return { rows, courses };
}

/* -------------------------------------------------------------------------- */
/* Apply                                                                      */
/* -------------------------------------------------------------------------- */

export interface ImportChoice {
  item: CanvasItem;
  /** Update this task instead of adding one. */
  taskId?: ID;
  estimate: Minutes;
  difficulty: Difficulty;
}

export interface ImportResult {
  added: Task[];
  /** Tasks as they were before being updated. */
  updatedBefore: Task[];
  newCourses: Category[];
  stateBefore: unknown;
}

export async function applyCanvasImport(choices: ImportChoice[], courses: PreviewCourse[], feedUrl?: string | null, now = Date.now()): Promise<ImportResult> {
  return db.transaction('rw', [db.tasks, db.categories, db.meta, db.blocks], async () => {
    const stateRow = await db.meta.get(CANVAS_KEY);
    const state = readCanvasState(stateRow?.value);
    const target = new Map<string, ID | 'skip'>();
    const newCourses: Category[] = [];
    for (const c of courses) {
      if (c.target === 'new') {
        const existed = new Set((await db.categories.toArray()).map((x) => x.id));
        const cat = await createCategory(c.newName || suggestCourseName(c.name) || 'BruinLearn');
        if (!existed.has(cat.id)) newCourses.push(cat);
        target.set(c.name, cat.id);
      } else {
        if (c.target !== 'skip' && !(await db.categories.get(c.target))) throw new Error('A chosen course no longer exists.');
        target.set(c.name, c.target);
      }
    }

    const added: Task[] = [];
    const updatedBefore: Task[] = [];
    for (const ch of choices) {
      const categoryId = target.get(ch.item.course ?? '');
      if (!categoryId || categoryId === 'skip') continue;
      if (ch.taskId) {
        const before = await db.tasks.get(ch.taskId);
        if (!before) continue;
        updatedBefore.push(before);
        await db.tasks.put({
          ...before,
          title: ch.item.title,
          deadline: ch.item.due,
          updatedAt: now, // the course moved it: not counted as you postponing
        });
        continue;
      }
      added.push(
        await createTask({
          title: ch.item.title,
          notes: canvasNotes(ch.item),
          categoryId,
          priority: 2,
          difficulty: ch.difficulty,
          estimate: ch.estimate,
          deadline: ch.item.due,
          sourceUid: ch.item.uid,
        }),
      );
    }

    const next: CanvasState = {
      feedUrl: feedUrl === undefined ? state.feedUrl : feedUrl,
      lastSync: now,
      courses: { ...state.courses, ...Object.fromEntries(target) },
      imported: [...new Set([...state.imported, ...added.map((t) => t.sourceUid!)])],
    };
    await db.meta.put({ key: CANVAS_KEY, value: next });
    return { added, updatedBefore, newCourses, stateBefore: stateRow?.value ?? null };
  });
}

/** Undo an import: remove what it added (and any schedule/time already attached), restore updates. */
export async function undoCanvasImport(r: ImportResult): Promise<void> {
  const ids = r.added.map((t) => t.id);
  await db.transaction('rw', [db.tasks, db.categories, db.meta, db.blocks, db.sessions], async () => {
    for (const id of ids) await closeTimer(Date.now(), id);
    await dropFocusFor(ids);
    await db.blocks.where('taskId').anyOf(ids).delete();
    await db.sessions.where('taskId').anyOf(ids).delete();
    await db.tasks.bulkDelete(ids);
    await restoreTasks(r.updatedBefore);
    for (const c of r.newCourses) if (!(await db.tasks.where('categoryId').equals(c.id).count())) await db.categories.delete(c.id);
    if (r.stateBefore === null) await db.meta.delete(CANVAS_KEY);
    else await db.meta.put({ key: CANVAS_KEY, value: r.stateBefore });
  });
}

/* -------------------------------------------------------------------------- */
/* Feed                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Download a Canvas calendar feed. Canvas doesn't allow browsers to read it directly (no CORS),
 * so it goes through FocusFlow's own /api/ics, which only fetches Canvas calendar feeds. POST keeps
 * the private link out of server logs and the service worker cache.
 */
export async function fetchFeed(raw: string): Promise<string> {
  const url = normalizeFeedUrl(raw);
  if (!url) throw new Error('That isn’t a BruinLearn calendar feed link. It should look like https://bruinlearn.ucla.edu/feeds/calendars/user_….ics');
  let res: Response;
  try {
    res = await fetch('/api/ics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
  } catch {
    throw new Error('Couldn’t reach BruinLearn. Check your connection, or import a downloaded .ics file instead.');
  }
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 404 && !text.startsWith('{')) throw new Error('Feed sync isn’t available here. Import a downloaded .ics file instead.');
    let msg = 'BruinLearn didn’t return the calendar.';
    try {
      msg = (JSON.parse(text) as { error?: string }).error ?? msg;
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  return text;
}

/** Forget the saved feed link (the course mapping and import history stay). */
export async function setFeedUrl(url: string | null): Promise<{ before: unknown }> {
  return db.transaction('rw', db.meta, async () => {
    const row = await db.meta.get(CANVAS_KEY);
    await db.meta.put({ key: CANVAS_KEY, value: { ...readCanvasState(row?.value), feedUrl: url } });
    return { before: row?.value ?? null };
  });
}

export async function restoreCanvasState(before: unknown): Promise<void> {
  if (before === null) await db.meta.delete(CANVAS_KEY);
  else await db.meta.put({ key: CANVAS_KEY, value: before });
}

