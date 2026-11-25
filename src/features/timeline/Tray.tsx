import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CalendarCheck2, GripVertical, Inbox, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { taskRef } from '@/domain/constants';
import type { TaskRisk } from '@/domain/risk';
import type { TaskSchedule } from '@/domain/schedule';
import type { Category, ID, Task } from '@/domain/types';
import { IconButton } from '@/ui/Button';
import { EmptyState, Skeleton } from '@/ui/Feedback';
import { CategorySwatch, DueCell, PriorityIcon, categoryColor } from '@/features/tasks/TaskMeta';
import { createPortal } from 'react-dom';
import { useTimeline } from './store';

interface TrayProps {
  tasks: Task[];
  categoryMap: Map<ID, Category>;
  risk: Map<ID, TaskRisk>;
  schedule: Map<ID, TaskSchedule>;
  now: number;
  loading: boolean;
  onClose: () => void;
  onDragStart: (e: React.PointerEvent, task: Task, remaining: number) => void;
  onOpen: (id: ID) => void;
}

export function Tray({ tasks, categoryMap, risk, schedule, now, loading, onClose, onDragStart, onOpen }: TrayProps) {
  const [q, setQ] = useState('');
  const dragTaskId = useTimeline((s) => (s.drag?.mode === 'tray' && s.drag.moved ? s.drag.taskId : undefined));

  const items = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return tasks
      .filter((t) => t.status !== 'done')
      .map((t) => ({ task: t, scheduled: schedule.get(t.id)?.minutes ?? 0 }))
      .filter(({ task, scheduled }) => task.estimate - scheduled > 0)
      .filter(({ task }) => words.every((w) => `${task.title} ${taskRef(task.seq)}`.toLowerCase().includes(w)))
      .sort((a, b) => a.task.deadline - b.task.deadline || a.task.priority - b.task.priority);
  }, [tasks, schedule, q]);

  const total = items.reduce((a, i) => a + i.task.estimate - i.scheduled, 0);
  const openCount = tasks.filter((t) => t.status !== 'done').length;

  return (
    <div className="flex h-full w-full flex-col bg-panel">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line pl-3.5 pr-2">
        <Inbox size={14} className="text-fg-subtle" />
        <h2 className="text-sm font-medium">To schedule</h2>
        {!loading && (
          <span className="num text-2xs text-fg-subtle">
            {items.length} · {formatDuration(total, { compact: true })}
          </span>
        )}
        <IconButton icon={X} label="Hide tray" size="sm" className="ml-auto" onClick={onClose} />
      </div>
      <div className="shrink-0 px-2.5 py-2">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (setQ(''), e.currentTarget.blur())}
            placeholder="Filter tasks…"
            aria-label="Filter unscheduled tasks"
            className="h-7 w-full rounded-sm border border-line bg-canvas pl-7 pr-2 text-xs text-fg placeholder:text-fg-subtle focus:border-line-focus focus:outline-none"
          />
        </div>
        <p className="mt-2 text-2xs text-fg-subtle">Drag a task onto the calendar to block time for it.</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-[68px] w-full rounded-sm" />
            ))}
          </div>
        ) : items.length === 0 ? (
          q ? (
            <EmptyState compact icon={Search} title="No matches" description={`Nothing unscheduled matches “${q}”.`} />
          ) : (
            <EmptyState
              compact
              icon={CalendarCheck2}
              title={openCount ? 'Everything is scheduled' : 'No open tasks'}
              description={openCount ? 'Every open task has time blocked for its full estimate.' : 'Create a task to plan it here.'}
            />
          )
        ) : (
          <ul className="flex flex-col gap-1.5">
            <AnimatePresence initial={false}>
              {items.map(({ task, scheduled }) => {
                const remaining = task.estimate - scheduled;
                const c = categoryMap.get(task.categoryId);
                const dragging = dragTaskId === task.id;
                return (
                  <motion.li
                    key={task.id}
                    layout="position"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: dragging ? 0.4 : 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0, transition: { duration: 0.18 } }}
                    transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
                  >
                    <div
                      onPointerDown={(e) => onDragStart(e, task, remaining)}
                      onDoubleClick={() => onOpen(task.id)}
                      onKeyDown={(e) => e.key === 'Enter' && onOpen(task.id)}
                      tabIndex={0}
                      aria-label={`${task.title}, ${formatDuration(remaining)} left to schedule. Drag onto the calendar.`}
                      className={cn(
                        'focus-ring group relative flex cursor-grab touch-none select-none gap-2 rounded-sm border border-line bg-raised p-2 pl-1.5',
                        'transition-[border-color,background-color] hover:border-line-strong hover:bg-hover active:cursor-grabbing',
                      )}
                      style={{ boxShadow: `inset 2px 0 0 ${categoryColor(c)}` }}
                    >
                      <GripVertical size={13} className="mt-0.5 shrink-0 text-fg-faint group-hover:text-fg-subtle" />
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <div className="flex items-start gap-1.5">
                          <span className="line-clamp-2 flex-1 text-xs font-medium leading-4 text-fg">{task.title}</span>
                          <PriorityIcon priority={task.priority} withTooltip={false} />
                        </div>
                        <div className="flex items-center gap-1.5 text-2xs text-fg-subtle">
                          <CategorySwatch category={c} className="size-1.5" />
                          <span className="num">{taskRef(task.seq)}</span>
                          <span className="ml-auto">
                            <DueCell task={task} risk={risk.get(task.id)} now={now} />
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-[rgb(255_255_255/0.06)]">
                            <div className="h-full rounded-full bg-fg-muted" style={{ width: `${(scheduled / task.estimate) * 100}%` }} />
                          </div>
                          <span className="num shrink-0 text-2xs text-fg-muted">{formatDuration(remaining, { compact: true })} left</span>
                        </div>
                      </div>
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </div>
  );
}

/** Follows the pointer while a tray task is dragged outside the grid. */
export function DragChip() {
  const drag = useTimeline((s) => s.drag);
  if (!drag || drag.mode !== 'tray' || !drag.moved || drag.day !== null) return null;
  return createPortal(
    <div
      className="pointer-events-none fixed z-[70] flex max-w-[240px] items-center gap-2 rounded-sm border border-line-strong bg-raised px-2.5 py-1.5 text-xs text-fg shadow-pop"
      style={{ left: drag.pointer.x + 12, top: drag.pointer.y + 12, boxShadow: `inset 2px 0 0 ${drag.color}` }}
    >
      <span className="truncate">{drag.label}</span>
      <span className="num shrink-0 text-fg-subtle">{formatDuration(drag.duration, { compact: true })}</span>
    </div>,
    document.body,
  );
}
