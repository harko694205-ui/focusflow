import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Coffee, Crosshair, Pause, Play, Square } from 'lucide-react';
import { cn } from '@/lib/cn';
import * as F from '@/domain/focus';
import { useFocusSession } from '@/hooks/data';
import { focusActions } from '@/features/focus/actions';
import { useUI } from '@/app/store';
import { taskRef } from '@/domain/constants';
import { useActiveTimer, useTask } from '@/hooks/data';
import { Tooltip } from '@/ui/Tooltip';
import { trackingActions } from './actions';

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Ticks every second while mounted. */
export function useElapsed(start: number | null | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!start) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [start]);
  return start ? now - start : 0;
}

/** Running focus timer, shown in the header on every page. */
export function TimerChip() {
  const focus = useFocusSession();
  if (focus) return <FocusChip session={focus} />;
  return <PlainTimerChip />;
}

function PlainTimerChip() {
  const timer = useActiveTimer();
  const task = useTask(timer?.taskId);
  const elapsed = useElapsed(timer?.start);
  const openEdit = useUI((s) => s.openEdit);
  if (!timer || !task) return null;

  return (
    <div className="flex h-7 shrink-0 items-center overflow-hidden whitespace-nowrap rounded-sm border border-line-strong bg-panel text-xs">
      <Tooltip content={`Focus timer · ${task.title}`}>
        <button
          type="button"
          onClick={() => openEdit(task.id)}
          className="focus-ring flex h-full min-w-0 items-center gap-2 pl-2 pr-2 hover:bg-hover"
          aria-label={`Focus timer running on ${task.title}`}
        >
          <span className="relative flex size-2 shrink-0">
            <span className="absolute inset-0 animate-ping rounded-full bg-positive opacity-40" />
            <span className="relative size-2 rounded-full bg-positive" />
          </span>
          <span className="num hidden text-fg-subtle md:inline">{taskRef(task.seq)}</span>
          <span className="hidden max-w-[140px] truncate text-fg-muted xl:inline">{task.title}</span>
          <span className="num text-fg tabular-nums">{formatElapsed(elapsed)}</span>
        </button>
      </Tooltip>
      <Tooltip content="Stop and log time">
        <button
          type="button"
          onClick={() => void trackingActions.stop()}
          aria-label="Stop focus timer"
          className="focus-ring flex h-full items-center border-l border-line px-2 text-fg-subtle hover:bg-hover hover:text-fg"
        >
          <Square size={10} fill="currentColor" />
        </button>
      </Tooltip>
    </div>
  );
}

const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Focus Mode session in the header: countdown, back to Focus Mode, start/pause. */
function FocusChip({ session: s }: { session: F.FocusSession }) {
  const task = useTask(s.taskId);
  const navigate = useNavigate();
  const running = F.isRunning(s);
  useElapsed(running ? s.startedAt : null); // tick every second while running
  const onBreak = F.isBreak(s.phase);
  const Icon = onBreak ? Coffee : Crosshair;
  const state = running ? mmss(F.remaining(s, Date.now())) : F.isPaused(s) ? 'Paused' : 'Ready';
  if (!task) return null;

  return (
    <div className="flex h-7 shrink-0 items-center overflow-hidden whitespace-nowrap rounded-sm border border-line-strong bg-panel text-xs">
      <Tooltip content={`Focus Mode · ${F.PHASE_LABEL[s.phase]} · ${task.title}`}>
        <button
          type="button"
          onClick={() => navigate('/focus')}
          className="focus-ring flex h-full min-w-0 items-center gap-2 px-2 hover:bg-hover"
          aria-label={`Open Focus Mode: ${F.PHASE_LABEL[s.phase]}, ${state}`}
        >
          <Icon size={12} className={cn('shrink-0', onBreak ? 'text-positive' : 'text-accent', !running && 'opacity-60')} />
          <span className="num hidden text-fg-subtle md:inline">{onBreak ? F.PHASE_LABEL[s.phase] : taskRef(task.seq)}</span>
          {!onBreak && <span className="hidden max-w-[140px] truncate text-fg-muted xl:inline">{task.title}</span>}
          <span className={cn('num tabular-nums', running ? 'text-fg' : 'text-fg-subtle')}>{state}</span>
        </button>
      </Tooltip>
      <Tooltip content={running ? 'Pause' : 'Start'}>
        <button
          type="button"
          onClick={() => void focusActions.toggle()}
          aria-label={running ? 'Pause focus session' : 'Start focus session'}
          className="focus-ring flex h-full items-center border-l border-line px-2 text-fg-subtle hover:bg-hover hover:text-fg"
        >
          {running ? <Pause size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" />}
        </button>
      </Tooltip>
    </div>
  );
}
