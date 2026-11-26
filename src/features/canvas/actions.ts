/** BruinLearn import commands: toast + undo around the Canvas service. */
import { useLiveQuery } from 'dexie-react-hooks';
import { run } from '@/app/commands';
import { toast } from '@/app/toast';
import { db } from '@/db/db';
import * as svc from '@/services/canvasService';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const canvasActions = {
  import: (choices: svc.ImportChoice[], courses: svc.PreviewCourse[], feedUrl?: string | null) =>
    run(
      () => svc.applyCanvasImport(choices, courses, feedUrl),
      (r) => {
        const parts = [r.added.length && `Added ${plural(r.added.length, 'assignment')}`, r.updatedBefore.length && `${plural(r.updatedBefore.length, 'due date')} updated`, r.newCourses.length && `${plural(r.newCourses.length, 'new course')}`].filter(Boolean);
        return { message: parts.length ? `${parts.join(' · ')} from BruinLearn` : 'BruinLearn is up to date', undo: { label: 'BruinLearn import', run: () => svc.undoCanvasImport(r) } };
      },
    ),

  disconnect: () =>
    run(
      () => svc.setFeedUrl(null),
      ({ before }) => ({ message: 'BruinLearn feed disconnected', undo: { label: 'disconnect feed', run: () => svc.restoreCanvasState(before) } }),
    ),
};

let syncing = false;

/**
 * Background sync (on opening the app / coming back to it). Quiet unless something changed;
 * then one toast says what came in, with Undo. Assignments from courses that still need
 * matching are left for Settings, and the toast points there.
 */
export async function autoSyncCanvas(openSettings: () => void): Promise<void> {
  if (syncing || !navigator.onLine) return;
  syncing = true;
  try {
    let unmatched = 0;
    await run(
      () => svc.autoSync(),
      (r) => {
        if (!r) return null;
        unmatched = r.unmatched;
        const { added, updatedBefore } = r.result;
        if (!added.length && !updatedBefore.length) return null;
        const what =
          added.length === 1 ? `added “${added[0].title}”` : added.length ? `added ${plural(added.length, 'assignment')}` : '';
        const moved = updatedBefore.length ? `${plural(updatedBefore.length, 'due date')} changed` : '';
        return {
          message: `BruinLearn: ${[what, moved].filter(Boolean).join(' · ')}`,
          undo: { label: 'BruinLearn sync', run: () => svc.undoCanvasImport(r.result, { forget: false }) },
        };
      },
    );
    if (unmatched) toast(`BruinLearn: ${plural(unmatched, 'assignment')} from a new course`, { tone: 'info', action: { label: 'Review', run: openSettings }, duration: 8000 });
  } finally {
    syncing = false;
  }
}

export function useCanvasState(): svc.CanvasState | undefined {
  return useLiveQuery(async () => svc.readCanvasState((await db.meta.get(svc.CANVAS_KEY))?.value), []);
}
