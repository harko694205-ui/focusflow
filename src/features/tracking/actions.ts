/** Time-tracking commands as the UI sees them: toast + undo around the time service. */
import { run } from '@/app/commands';
import type { ID, Minutes, WorkSession } from '@/domain/types';
import { formatDuration } from '@/lib/format';
import * as svc from '@/services/timeService';
import { restoreTasks } from '@/services/taskService';
import { getFocus, pauseFocus, toggleFocus } from '@/services/focusService';

const mins = (s: WorkSession) => Math.round((s.end - s.start) / 60_000);

export const trackingActions = {
  start: (taskId: ID) =>
    run(
      () => svc.startTimer(taskId),
      ({ stopped, taskBefore }) => ({
        message: stopped?.session ? `Timer switched · logged ${formatDuration(mins(stopped.session), { compact: true })} on the previous task` : '',
        undo: {
          label: 'start timer',
          run: async () => {
            await svc.restoreTimer(stopped?.timer ?? null, stopped?.session?.id);
            if (taskBefore) await restoreTasks([taskBefore]);
          },
        },
      }),
    ),

  /** Stop the timer. During a Focus Mode session this pauses the session instead. */
  stop: async () => {
    if (await getFocus()) return run(() => pauseFocus(), () => ({ message: 'Focus session paused' }));
    return trackingActions.stopTimer();
  },

  stopTimer: () =>
    run(
      () => svc.stopTimer(),
      (r) => {
        if (!r) return null;
        return {
          message: r.session ? `Logged ${formatDuration(mins(r.session), { compact: true })} of focus time` : 'Timer stopped · under a minute, not logged',
          undo: { label: 'stop timer', run: () => svc.restoreTimer(r.timer, r.session?.id) },
        };
      },
    ),

  /** Start, or stop if this task's timer is running. */
  toggle: async (taskId: ID) => {
    const focus = await getFocus();
    if (focus?.taskId === taskId) return run(() => toggleFocus(), () => null);
    const active = await svc.getActiveTimer();
    return active?.taskId === taskId ? trackingActions.stop() : trackingActions.start(taskId);
  },

  log: (taskId: ID, minutes: Minutes, label: string) =>
    run(
      () => svc.logTime(taskId, minutes),
      (s) => ({
        message: `Logged ${formatDuration(minutes, { compact: true })} on ${label}`,
        undo: { label: 'log time', run: async () => void (await svc.deleteSessions([s.id])) },
      }),
    ),

  removeSession: (id: ID) =>
    run(
      () => svc.deleteSessions([id]),
      (removed) => (removed.length ? { message: 'Time entry removed', undo: { label: 'remove entry', run: () => svc.restoreSessions(removed) } } : null),
    ),
};
