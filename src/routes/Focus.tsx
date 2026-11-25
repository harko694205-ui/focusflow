import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Check, CheckCircle2, Coffee, Crosshair, Pause, Play, SkipForward, Square, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Toaster } from '@/app/toast';
import { useUI } from '@/app/store';
import { taskRef } from '@/domain/constants';
import { dueLabel } from '@/domain/dates';
import * as F from '@/domain/focus';
import type { ID, Instant, Task } from '@/domain/types';
import { formatDuration } from '@/lib/format';
import { useHotkeys } from '@/lib/hotkeys';
import { useCategories, useCategoryMap, useFocusSession, useTask, useTaskSessions } from '@/hooks/data';
import { focusActions } from '@/features/focus/actions';
import { FocusRing } from '@/features/focus/FocusRing';
import { FocusSettingsMenu } from '@/features/focus/FocusSettingsMenu';
import { TaskPicker } from '@/features/focus/TaskPicker';
import { CategoryLabel } from '@/features/tasks/TaskMeta';
import { Button, IconButton } from '@/ui/Button';
import { Meter } from '@/ui/Data';
import { Skeleton } from '@/ui/Feedback';
import { Kbd } from '@/ui/Kbd';
import { Tooltip } from '@/ui/Tooltip';

interface Summary {
  taskId: ID;
  startedAt: Instant;
  endedAt: Instant;
  completed: number;
  focusMs: number;
  done: boolean;
}

const MIN = 60_000;
const clock = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const dur = (ms: number) => formatDuration(Math.floor(ms / MIN), { compact: true });

function useTicker(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Focus Mode: a full-screen, minimal workspace for one task. */
export function FocusPage() {
  const session = useFocusSession();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<Summary | null>(null);
  const last = useRef<F.FocusSession | null>(null);
  const ended = useRef(false);

  // The session ending outside this page (task finished elsewhere, timer moved to another task)
  // still gets a summary.
  useEffect(() => {
    if (session) {
      last.current = session;
      ended.current = false;
      setSummary(null);
    } else if (session === null && last.current && !ended.current) {
      const s = last.current;
      last.current = null;
      const at = Date.now();
      setSummary({ taskId: s.taskId, startedAt: s.startedAt, endedAt: at, completed: s.completed, focusMs: F.focusTime(s, at), done: false });
    }
  }, [session]);

  const exit = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/');
  };

  const finish = async (how: 'end' | 'complete', label = '') => {
    ended.current = true;
    if (how === 'end') {
      const r = await focusActions.end();
      if (r) setSummary({ ...r, done: false });
    } else {
      const r = await focusActions.complete(label);
      if (r) setSummary({ ...r.summary, done: true });
    }
    last.current = null;
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
      <header className="flex h-12 shrink-0 items-center gap-2 px-3 md:px-4">
        <Tooltip content="Back to FocusFlow" shortcut={['Esc']}>
          <IconButton icon={ArrowLeft} label="Back to FocusFlow" onClick={exit} />
        </Tooltip>
        <span className="flex items-center gap-1.5 text-sm font-medium text-fg-muted">
          <Crosshair size={14} className="text-accent" /> Focus
        </span>
        <div className="flex-1" />
        <FocusSettingsMenu />
        {session && (
          <Button variant="ghost" icon={Square} onClick={() => void finish('end')}>
            End session
          </Button>
        )}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center px-4 py-8">
          {session === undefined ? (
            <Skeleton className="size-[300px] rounded-full" />
          ) : session ? (
            <ActiveFocus session={session} onExit={exit} onComplete={(label) => void finish('complete', label)} />
          ) : summary ? (
            <SessionSummary summary={summary} onAgain={() => setSummary(null)} onExit={exit} />
          ) : (
            <PickerScreen onExit={exit} />
          )}
        </div>
      </main>
      <Toaster />
    </div>
  );
}

function PickerScreen({ onExit }: { onExit: () => void }) {
  useHotkeys({ escape: onExit }, noPopover);
  return <TaskPicker />;
}

const noPopover = () => !document.querySelector('[role="dialog"]');

const BREAK_TIPS = ['Stand up and stretch.', 'Get some water.', 'Look at something far away for a minute.', 'Step outside, if you can.', 'Close your eyes and breathe slowly.'];

function ActiveFocus({ session: s, onExit, onComplete }: { session: F.FocusSession; onExit: () => void; onComplete: (label: string) => void }) {
  const now = useTicker();
  const task = useTask(s.taskId);
  const categoryMap = useCategoryMap(useCategories());
  const sessions = useTaskSessions(s.taskId);

  const onBreak = F.isBreak(s.phase);
  const running = F.isRunning(s);
  const waiting = F.isWaiting(s);
  const paused = F.isPaused(s);
  const left = F.remaining(s, now);
  const color = onBreak ? 'var(--color-positive)' : 'var(--color-accent)';

  // Tracked on the task: recorded sessions, plus the stretch in progress (not yet a session).
  const timerRecorded = sessions?.some((x) => x.start === s.runStart) ?? false;
  const trackedMs = (sessions ?? []).reduce((a, x) => a + (x.end - x.start), 0) + (s.phase === 'focus' && s.runStart !== null && !timerRecorded ? now - s.runStart : 0);

  useEffect(() => {
    const prev = document.title;
    return () => void (document.title = prev);
  }, []);
  useEffect(() => {
    const what = onBreak ? 'Break' : task?.title ?? 'Focus';
    document.title = running ? `${clock(left)} · ${what}` : `${paused ? 'Paused' : 'Ready'} · ${what}`;
  }, [left, running, paused, onBreak, task?.title]);

  const label = task ? taskRef(task.seq) : 'task';
  useHotkeys(
    {
      ' ': () => void focusActions.toggle(),
      n: () => void focusActions.skip(),
      x: () => onComplete(label),
      escape: onExit,
    },
    noPopover,
  );

  if (task === undefined) return <Skeleton className="size-[300px] rounded-full" />;
  if (!task) return null; // gone: the driver ends the session

  const status = waiting
    ? onBreak
      ? 'Break ready'
      : 'Ready when you are'
    : paused
      ? 'Paused'
      : onBreak
        ? 'of break left'
        : 'until your break';
  const cycleDone = s.completed % s.settings.longEvery || (s.completed > 0 && s.phase === 'long_break' ? s.settings.longEvery : 0);
  const trackedMin = trackedMs / MIN;
  const plannedIntervals = s.completed + F.intervalsLeft(task.estimate, trackedMin, s.settings.focus);

  return (
    <div className="flex w-full max-w-[640px] flex-col items-center gap-7">
      {/* Phase */}
      <div className="flex flex-col items-center gap-2">
        <span
          className={cn(
            'inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium',
            onBreak ? 'border-[rgb(61_184_139/0.3)] bg-positive-muted text-positive' : 'border-[rgb(124_131_255/0.3)] bg-accent-muted text-accent',
          )}
        >
          {onBreak ? <Coffee size={12} /> : <Crosshair size={12} />}
          {F.PHASE_LABEL[s.phase]}
          {!onBreak && <span className="num font-normal opacity-80">· interval {s.completed + 1}</span>}
        </span>
      </div>

      {/* Timer */}
      <FocusRing progress={F.progress(s, now)} color={color} dim={!running}>
        <span className={cn('num text-[64px] font-light leading-none tracking-tight tabular-nums', running ? 'text-fg' : 'text-fg-muted')}>{clock(left)}</span>
        <span className="mt-3 text-sm text-fg-subtle">{status}</span>
        <div className="mt-4 flex items-center gap-1.5" aria-label={`${cycleDone} of ${s.settings.longEvery} intervals before a long break`}>
          {Array.from({ length: s.settings.longEvery }, (_, i) => (
            <span key={i} className={cn('size-1.5 rounded-full', i < cycleDone ? 'bg-accent' : 'bg-active')} />
          ))}
        </div>
      </FocusRing>

      {/* Controls */}
      <div className="flex items-center gap-5">
        <Tooltip content={onBreak ? 'Skip break' : 'Take a break now'} shortcut={['N']}>
          <RoundButton label={onBreak ? 'Skip break' : 'Take a break now'} onClick={() => void focusActions.skip()}>
            {onBreak ? <SkipForward size={16} /> : <Coffee size={16} />}
          </RoundButton>
        </Tooltip>
        <Tooltip content={running ? 'Pause' : waiting ? (onBreak ? 'Start break' : 'Start focus') : 'Resume'} shortcut={['Space']}>
          <button
            type="button"
            onClick={() => void focusActions.toggle()}
            aria-label={running ? 'Pause' : 'Start'}
            className={cn(
              'focus-ring grid size-16 place-items-center rounded-full text-accent-fg transition-[transform,background-color] active:scale-95',
              onBreak ? 'bg-positive hover:brightness-110' : 'bg-accent hover:bg-accent-hover',
              'shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_8px_24px_-8px_rgb(0_0_0/0.6)]',
            )}
          >
            {running ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" className="translate-x-px" />}
          </button>
        </Tooltip>
        <Tooltip content="Mark task complete" shortcut={['X']}>
          <RoundButton label="Mark task complete" onClick={() => onComplete(label)}>
            <Check size={17} />
          </RoundButton>
        </Tooltip>
      </div>

      <AnimatePresence initial={false}>
        {F.needsBreak(s, now) && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex w-full max-w-[480px] items-center gap-2.5 rounded-md border border-[rgb(217_164_65/0.25)] bg-warning-muted px-3 py-2 text-xs text-warning"
            role="status"
          >
            <TriangleAlert size={13} className="shrink-0" />
            <span className="flex-1">{dur(F.focusSinceBreak(s, now))} of focus without a break. A short pause keeps the next stretch sharp.</span>
            <Button size="sm" variant="secondary" icon={Coffee} onClick={() => void focusActions.skip()}>
              Take a break
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Task */}
      <section aria-label="Current task" className="flex w-full max-w-[480px] flex-col items-center gap-1.5 text-center">
        {onBreak ? (
          <p className="text-sm text-fg-muted">{BREAK_TIPS[s.completed % BREAK_TIPS.length]} Up next: {task.title}</p>
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs text-fg-subtle">
              <CategoryLabel category={categoryMap.get(task.categoryId)} />
              <span className="text-fg-faint">·</span>
              <span className="num">{taskRef(task.seq)}</span>
              <span className="text-fg-faint">·</span>
              <span className={cn('num', task.deadline < now && 'text-negative')}>Due {dueLabel(task.deadline, now, { withTime: true })}</span>
            </div>
            <h1 className="text-balance text-xl font-semibold tracking-tight text-fg">{task.title}</h1>
            {task.notes && <p className="line-clamp-3 whitespace-pre-line text-sm text-fg-subtle">{task.notes}</p>}
          </>
        )}
      </section>

      {/* Session */}
      <TaskProgress task={task} trackedMs={trackedMs} />
      <dl className="grid w-full max-w-[480px] grid-cols-3 gap-px overflow-hidden rounded-md border border-line bg-line text-center">
        <StatCell label="Focus this session" value={dur(F.focusTime(s, now))} />
        <StatCell label="Session length" value={dur(now - s.startedAt)} />
        <StatCell
          label="Intervals"
          value={
            <>
              {s.completed}
              <span className="text-fg-subtle"> / ~{plannedIntervals}</span>
            </>
          }
        />
      </dl>
      <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-2xs text-fg-faint">
        <span className="flex items-center gap-1">
          <Kbd keys={['Space']} /> start / pause
        </span>
        <span className="flex items-center gap-1">
          <Kbd keys={['N']} /> {onBreak ? 'skip break' : 'break now'}
        </span>
        <span className="flex items-center gap-1">
          <Kbd keys={['X']} /> complete
        </span>
        <span className="flex items-center gap-1">
          <Kbd keys={['Esc']} /> leave (keeps running)
        </span>
      </p>
    </div>
  );
}

function TaskProgress({ task, trackedMs }: { task: Task; trackedMs: number }) {
  const tracked = trackedMs / MIN;
  const over = tracked > task.estimate;
  return (
    <div className="flex w-full max-w-[480px] flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-fg-subtle">Actual time on this task</span>
        <span className="num text-fg-muted">
          <span className={over ? 'text-warning' : 'text-fg'}>{formatDuration(Math.floor(tracked), { compact: true })}</span> of{' '}
          {formatDuration(task.estimate, { compact: true })} estimated
        </span>
      </div>
      <Meter value={tracked} max={task.estimate} height={4} />
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 bg-panel px-3 py-2.5">
      <dt className="text-2xs text-fg-subtle">{label}</dt>
      <dd className="num text-base text-fg">{value}</dd>
    </div>
  );
}

function RoundButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="focus-ring grid size-11 place-items-center rounded-full border border-line-strong bg-panel text-fg-muted transition-colors hover:bg-hover hover:text-fg active:scale-95"
    >
      {children}
    </button>
  );
}

function SessionSummary({ summary: r, onAgain, onExit }: { summary: Summary; onAgain: () => void; onExit: () => void }) {
  const task = useTask(r.taskId);
  const sessions = useTaskSessions(r.taskId);
  const openEdit = useUI((s) => s.openEdit);
  const navigate = useNavigate();
  const tracked = useMemo(() => (sessions ?? []).reduce((a, x) => a + (x.end - x.start), 0) / MIN, [sessions]);
  const done = r.done || task?.status === 'done';
  useHotkeys({ escape: onExit, enter: onAgain }, noPopover);

  return (
    <div className="flex w-full max-w-[440px] flex-col items-center gap-5 text-center">
      <span className={cn('grid size-12 place-items-center rounded-full', done ? 'bg-positive-muted text-positive' : 'bg-accent-muted text-accent')}>
        {done ? <CheckCircle2 size={22} /> : <Crosshair size={20} />}
      </span>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-fg">{done ? 'Task complete' : 'Session ended'}</h1>
        {task && <p className="text-sm text-fg-muted">{task.title}</p>}
      </div>
      <dl className="grid w-full grid-cols-3 gap-px overflow-hidden rounded-md border border-line bg-line">
        <StatCell label="Focus time" value={dur(r.focusMs)} />
        <StatCell label="Intervals" value={r.completed} />
        <StatCell label="Session" value={dur(r.endedAt - r.startedAt)} />
      </dl>
      {task && (
        <p className="text-xs text-fg-subtle">
          <span className="num text-fg-muted">{formatDuration(Math.round(tracked), { compact: true })}</span> tracked on this task in total, against an estimate of{' '}
          <span className="num text-fg-muted">{formatDuration(task.estimate, { compact: true })}</span>
          {tracked > 0 && (
            <>
              {' '}
              ({tracked > task.estimate ? `${Math.round((tracked / task.estimate - 1) * 100)}% over` : `${Math.round((1 - tracked / task.estimate) * 100)}% under`})
            </>
          )}
          . Insights uses this to calibrate future estimates.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="primary" icon={Crosshair} onClick={onAgain} trailing={<Kbd keys={['↵']} />}>
          {done ? 'Focus on another task' : 'Start another session'}
        </Button>
        {task && (
          <Button
            variant="secondary"
            onClick={() => {
              navigate('/tasks');
              openEdit(task.id);
            }}
          >
            Open task
          </Button>
        )}
        <Button variant="ghost" onClick={onExit}>
          Back to FocusFlow
        </Button>
      </div>
    </div>
  );
}
