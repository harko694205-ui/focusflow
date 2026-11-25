import { useEffect, useState } from 'react';
import { Square } from 'lucide-react';
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
