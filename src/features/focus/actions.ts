/** Focus Mode commands as the UI sees them: toasts (and undo where it makes sense). */
import { run } from '@/app/commands';
import type { FocusSettings } from '@/domain/focus';
import type { ID } from '@/domain/types';
import { formatDuration } from '@/lib/format';
import * as svc from '@/services/focusService';
import { restoreTasks } from '@/services/taskService';
import { unlockAudio } from './reminders';

const mins = (ms: number) => Math.round(ms / 60_000);

export const focusActions = {
  start: (taskId: ID) => {
    unlockAudio();
    return run(
      () => svc.startFocus(taskId),
      ({ ended }) =>
        ended && ended.focusMs >= 60_000 ? { message: `Ended the previous focus session · ${formatDuration(mins(ended.focusMs), { compact: true })} of focus` } : null,
    );
  },

  toggle: () => {
    unlockAudio();
    return run(() => svc.toggleFocus(), () => null);
  },

  pause: () => run(() => svc.pauseFocus(), () => null),

  skip: () => {
    unlockAudio();
    return run(() => svc.skipPhase(), () => null);
  },

  end: () =>
    run(
      () => svc.endFocus(),
      (summary) => (summary && summary.focusMs >= 60_000 ? { message: `Focus session ended · ${formatDuration(mins(summary.focusMs), { compact: true })} of focus` } : null),
    ),

  complete: (label: string) =>
    run(
      () => svc.completeFocusTask(),
      (r) =>
        r && {
          message: `Completed ${label}`,
          undo: { label: 'complete task', run: () => restoreTasks([r.taskBefore]) },
        },
    ),

  settings: (patch: Partial<FocusSettings>) => run(() => svc.updateFocusSettings(patch), () => null),
};

/** Start (or return to) Focus Mode on a task and open it. */
export async function focusOn(taskId: ID, navigate: (to: string) => void) {
  const r = await focusActions.start(taskId);
  if (r) navigate('/focus');
}
