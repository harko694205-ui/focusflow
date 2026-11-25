import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Hourglass, Play, Plus, Square, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { taskRef } from '@/domain/constants';
import { accuracyRows, calibrationFor, groupByTask, type Calibration } from '@/domain/insights';
import { parseEstimate } from '@/domain/validation';
import type { Difficulty, ID, Task } from '@/domain/types';
import { useActiveTimer, useBlocks, useSessions, useTaskSessions, useTasks } from '@/hooks/data';
import { Button, IconButton } from '@/ui/Button';
import { Skeleton } from '@/ui/Feedback';
import { trackingActions } from './actions';
import { formatElapsed, useElapsed } from './TimerChip';

/** Tracked time for a task: timer control, manual logging and the session list. */
export function TimeSection({ task }: { task: Task }) {
  const sessions = useTaskSessions(task.id);
  const timer = useActiveTimer();
  const running = timer?.taskId === task.id;
  const elapsed = useElapsed(running ? timer!.start : null);
  const [text, setText] = useState('');
  const minutes = parseEstimate(text);
  const tracked = (sessions ?? []).reduce((a, s) => a + Math.round((s.end - s.start) / 60_000), 0) + (running ? Math.floor(elapsed / 60_000) : 0);
  const over = tracked > task.estimate;

  const log = async () => {
    if (!minutes) return;
    const ok = await trackingActions.log(task.id, minutes, taskRef(task.seq));
    if (ok) setText('');
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-fg-muted">Time tracked</span>
        <span className={cn('num text-2xs', over ? 'text-warning' : 'text-fg-subtle')}>
          {formatDuration(tracked, { compact: true })} of {formatDuration(task.estimate, { compact: true })} estimate
        </span>
      </div>
      <div className="overflow-hidden rounded-sm border border-line">
        <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
          {task.status !== 'done' && (
            <Button
              size="sm"
              variant={running ? 'secondary' : 'ghost'}
              icon={running ? Square : Play}
              onClick={() => void (running ? trackingActions.stop() : trackingActions.start(task.id))}
            >
              {running ? (
                <span className="flex items-center gap-1.5">
                  Stop <span className="num text-positive">{formatElapsed(elapsed)}</span>
                </span>
              ) : (
                'Start timer'
              )}
            </Button>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                  e.preventDefault();
                  e.stopPropagation();
                  void log();
                }
              }}
              placeholder="Log time, e.g. 45m"
              aria-label="Time to log"
              className="focus-ring num h-6 w-[136px] rounded-xs border border-line bg-canvas px-2 text-xs text-fg placeholder:text-fg-faint"
            />
            <Button size="sm" variant="ghost" icon={Plus} disabled={!minutes} onClick={() => void log()}>
              Log
            </Button>
          </div>
        </div>
        {sessions === undefined ? (
          <Skeleton className="m-2 h-6" />
        ) : (
          sessions.length > 0 && (
            <ul className="max-h-[132px] overflow-y-auto border-t border-line">
              {sessions.map((s) => (
                <li key={s.id} className="group num flex h-7 items-center gap-2 px-2.5 text-xs text-fg-muted hover:bg-hover">
                  <Hourglass size={11} className="shrink-0 text-fg-subtle" />
                  <span className="w-[92px] shrink-0">{format(s.start, 'EEE MMM d')}</span>
                  <span>
                    {format(s.start, 'HH:mm')}–{format(s.end, 'HH:mm')}
                  </span>
                  <span className="text-fg-subtle">{formatDuration(Math.round((s.end - s.start) / 60_000), { compact: true })}</span>
                  <span className="text-2xs text-fg-faint">{s.source === 'timer' ? 'timer' : 'logged'}</span>
                  <IconButton
                    icon={X}
                    size="sm"
                    label="Remove time entry"
                    className="ml-auto opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => void trackingActions.removeSession(s.id)}
                  />
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </div>
  );
}

/** How long similar finished work really took, from all history. */
export function useCalibration(categoryId: ID, difficulty: Difficulty, taskId?: ID): Calibration | null {
  const tasks = useTasks();
  const sessions = useSessions();
  const blocks = useBlocks();
  const rows = useMemo(
    () => (tasks && sessions && blocks ? accuracyRows(tasks, groupByTask(sessions), groupByTask(blocks)) : []),
    [tasks, sessions, blocks],
  );
  return useMemo(() => calibrationFor(rows, categoryId, difficulty, taskId), [rows, categoryId, difficulty, taskId]);
}

const BASIS: Record<Calibration['basis'], string> = {
  'category+difficulty': 'similar tasks',
  difficulty: 'tasks of this difficulty',
  category: 'tasks in this category',
};

/** "Similar tasks took 1.4× your estimate — use 2h06?" Shown under the estimate field. */
export function EstimateHint({
  categoryId,
  difficulty,
  estimate,
  taskId,
  onUse,
}: {
  categoryId: ID;
  difficulty: Difficulty;
  estimate: number | null;
  taskId?: ID;
  onUse: (minutes: number) => void;
}) {
  const cal = useCalibration(categoryId, difficulty, taskId);
  if (!cal || !estimate) return null;
  const off = Math.abs(cal.factor - 1);
  if (off < 0.1) return <span className="text-2xs text-fg-subtle">Your estimates for {BASIS[cal.basis]} are usually spot on.</span>;
  const suggested = Math.max(5, Math.round((estimate * cal.factor) / 5) * 5);
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 text-2xs text-fg-subtle">
      <span>
        {BASIS[cal.basis][0].toUpperCase() + BASIS[cal.basis].slice(1)} usually take{' '}
        <span className={cn('num', cal.factor > 1 ? 'text-warning' : 'text-positive')}>{cal.factor.toFixed(1)}×</span> the estimate ({cal.n} done).
      </span>
      {suggested !== estimate && (
        <button type="button" onClick={() => onUse(suggested)} className="focus-ring num rounded-xs text-accent hover:underline">
          Use {formatDuration(suggested, { compact: true })}
        </button>
      )}
    </span>
  );
}
