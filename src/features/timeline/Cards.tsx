import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { format } from 'date-fns';
import { AlertTriangle, CalendarPlus, CalendarX2, Check, ExternalLink, RotateCcw, Trash2, Users, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatClock, formatDuration } from '@/lib/format';
import { taskRef } from '@/domain/constants';
import type { TaskRisk } from '@/domain/risk';
import { durationMinutes, endMinuteOfDay, minuteOfDay, type TaskSchedule } from '@/domain/schedule';
import type { Category, ID, Task, TimeBlock } from '@/domain/types';
import { Button, IconButton } from '@/ui/Button';
import { Kbd } from '@/ui/Kbd';
import { CategorySwatch, DueCell, PriorityIcon } from '@/features/tasks/TaskMeta';
import { PX_PER_MIN } from './store';

export type CardPlacement = 'right' | 'left' | 'inside';

function CardShell({
  top,
  placement,
  children,
  label,
}: {
  top: number;
  placement: CardPlacement;
  children: React.ReactNode;
  label: string;
}) {
  const pos: React.CSSProperties =
    placement === 'right' ? { left: 'calc(100% + 6px)' } : placement === 'left' ? { right: 'calc(100% + 6px)' } : { right: 8 };
  return (
    <motion.div
      role="group"
      aria-label={label}
      initial={{ opacity: 0, x: placement === 'left' ? 6 : -6, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute z-40 w-[288px] rounded-md border border-line-strong bg-raised shadow-pop"
      style={{ top: Math.max(4, top), ...pos }}
    >
      {children}
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* Selected block                                                             */
/* -------------------------------------------------------------------------- */

interface BlockCardProps {
  block: TimeBlock;
  task?: Task;
  category?: Category;
  risk?: TaskRisk;
  schedule?: TaskSchedule;
  overlaps: TimeBlock[];
  taskMap: Map<ID, Task>;
  placement: CardPlacement;
  now: number;
  onClose: () => void;
  onOpenTask: (id: ID) => void;
  onToggleComplete: (id: ID) => void;
  onRemove: () => void;
  onRename: (title: string) => void;
}

export function BlockCard(p: BlockCardProps) {
  const { block, task } = p;
  const start = minuteOfDay(block.start);
  const end = endMinuteOfDay(block.start, block.end);
  const isEvent = block.kind === 'event';
  const [title, setTitle] = useState(block.title);
  useEffect(() => setTitle(block.title), [block.title]);
  const afterDeadline = task && task.status !== 'done' && block.end > task.deadline;
  const done = task?.status === 'done';

  const conflictNames = p.overlaps.map((o) => (o.kind === 'event' ? o.title : (p.taskMap.get(o.taskId ?? '')?.title ?? 'block')));

  return (
    <CardShell top={start * PX_PER_MIN} placement={p.placement} label={isEvent ? 'Event details' : 'Scheduled block details'}>
      <div className="flex items-start gap-2 px-3 pb-2 pt-2.5">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-1.5 text-2xs text-fg-subtle">
            {isEvent ? (
              <>
                <Users size={11} /> Event · fixed
              </>
            ) : (
              <>
                <CategorySwatch category={p.category} className="size-1.5" />
                <span className="num">{task ? taskRef(task.seq) : '—'}</span>
                <span>·</span>
                <span className="truncate">{p.category?.name}</span>
              </>
            )}
          </div>
          {isEvent ? (
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title.trim() && title.trim() !== block.title && p.onRename(title)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') {
                  setTitle(block.title);
                  (e.target as HTMLInputElement).blur();
                }
              }}
              aria-label="Event title"
              className="-mx-1 w-[calc(100%+8px)] rounded-xs bg-transparent px-1 text-sm font-medium text-fg outline-none hover:bg-hover focus:bg-canvas focus:ring-1 focus:ring-line-focus"
            />
          ) : (
            <div className={cn('line-clamp-2 text-sm font-medium', done ? 'text-fg-subtle line-through' : 'text-fg')}>{task?.title}</div>
          )}
        </div>
        <IconButton icon={X} label="Close" size="sm" onClick={p.onClose} className="-mr-1 -mt-0.5" />
      </div>

      <dl className="flex flex-col gap-1.5 border-t border-line px-3 py-2.5 text-xs">
        <div className="flex items-center justify-between">
          <dt className="text-fg-subtle">When</dt>
          <dd className="num text-fg">
            {format(block.start, 'EEE MMM d')} · {formatClock(start)}–{formatClock(end)}{' '}
            <span className="text-fg-subtle">({formatDuration(durationMinutes(block), { compact: true })})</span>
          </dd>
        </div>
        {task && (
          <>
            <div className="flex items-center justify-between">
              <dt className="text-fg-subtle">Due</dt>
              <dd>
                <DueCell task={task} risk={p.risk} now={p.now} />
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-fg-subtle">Scheduled</dt>
              <dd className="num text-fg-muted">
                {formatDuration(p.schedule?.minutes ?? 0, { compact: true })} of {formatDuration(task.estimate, { compact: true })}
                {p.schedule && p.schedule.blockCount > 1 && <span className="text-fg-subtle"> · {p.schedule.blockCount} blocks</span>}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-fg-subtle">Priority</dt>
              <dd>
                <PriorityIcon priority={task.priority} />
              </dd>
            </div>
          </>
        )}
      </dl>

      {(conflictNames.length > 0 || afterDeadline) && (
        <div className="flex flex-col gap-1 border-t border-line px-3 py-2 text-xs">
          {conflictNames.length > 0 && (
            <div className="flex items-start gap-1.5 text-negative">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>
                Overlaps <span className="text-fg">{conflictNames.join(', ')}</span>
              </span>
            </div>
          )}
          {afterDeadline && (
            <div className="flex items-start gap-1.5 text-warning">
              <CalendarX2 size={12} className="mt-0.5 shrink-0" />
              <span>Ends after the deadline ({format(task!.deadline, 'EEE HH:mm')})</span>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-1 border-t border-line px-2 py-2">
        {task && (
          <>
            <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => p.onOpenTask(task.id)} trailing={<Kbd keys={['E']} className="ml-1" />}>
              Open
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={done ? RotateCcw : Check}
              onClick={() => p.onToggleComplete(task.id)}
              trailing={<Kbd keys={['X']} className="ml-1" />}
            >
              {done ? 'Reopen' : 'Done'}
            </Button>
          </>
        )}
        <Button size="sm" variant="ghost" icon={Trash2} onClick={p.onRemove} className="ml-auto hover:text-negative">
          {isEvent ? 'Delete' : 'Unschedule'}
        </Button>
      </div>
    </CardShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Create                                                                     */
/* -------------------------------------------------------------------------- */

interface CreateCardProps {
  day: number;
  start: number;
  end: number;
  placement: CardPlacement;
  candidates: Task[];
  categoryMap: Map<ID, Category>;
  schedule: Map<ID, TaskSchedule>;
  onScheduleTask: (task: Task) => void;
  onCreateEvent: (title: string) => void;
  onCancel: () => void;
}

export function CreateCard(p: CreateCardProps) {
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const items = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const tasks = p.candidates
      .filter((t) => words.every((w) => `${t.title} ${taskRef(t.seq)}`.toLowerCase().includes(w)))
      .slice(0, 6)
      .map((t) => ({ kind: 'task' as const, task: t }));
    return q.trim() ? [{ kind: 'event' as const }, ...tasks] : tasks;
  }, [q, p.candidates]);

  useEffect(() => setIndex(0), [q]);

  const choose = (i: number) => {
    const it = items[i];
    if (!it) return;
    if (it.kind === 'event') p.onCreateEvent(q.trim());
    else p.onScheduleTask(it.task);
  };

  return (
    <CardShell top={p.start * PX_PER_MIN} placement={p.placement} label="Add to timeline">
      <div className="flex items-center justify-between px-3 pt-2.5">
        <span className="eyebrow flex items-center gap-1.5">
          <CalendarPlus size={11} /> {format(p.day, 'EEE MMM d')}
        </span>
        <span className="num text-2xs text-fg-muted">
          {formatClock(p.start)}–{formatClock(p.end)} · {formatDuration(p.end - p.start, { compact: true })}
        </span>
      </div>
      <div className="px-2 pb-1 pt-2">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, items.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              choose(index);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              p.onCancel();
            }
          }}
          placeholder="Event title, or search tasks to schedule…"
          aria-label="Event title or task search"
          className="h-8 w-full rounded-sm border border-line-strong bg-canvas px-2.5 text-sm text-fg placeholder:text-fg-subtle focus:border-line-focus focus:outline-none"
        />
      </div>
      <div className="max-h-[240px] overflow-y-auto px-1 pb-1" role="listbox" aria-label="Options">
        {items.length === 0 && <div className="px-2 py-3 text-center text-xs text-fg-subtle">Type a title to add an event.</div>}
        {items.map((it, i) => (
          <div
            key={it.kind === 'event' ? '__event' : it.task.id}
            role="option"
            aria-selected={i === index}
            onMouseMove={() => setIndex(i)}
            onClick={() => choose(i)}
            className={cn('flex h-8 cursor-default items-center gap-2 rounded-sm px-2 text-sm', i === index ? 'bg-hover text-fg' : 'text-fg-muted')}
          >
            {it.kind === 'event' ? (
              <>
                <Users size={13} className="shrink-0 text-fg-subtle" />
                <span className="truncate">
                  Add event “<span className="text-fg">{q.trim()}</span>”
                </span>
              </>
            ) : (
              <>
                <CategorySwatch category={p.categoryMap.get(it.task.categoryId)} />
                <span className="truncate">{it.task.title}</span>
                <span className="num ml-auto shrink-0 text-2xs text-fg-subtle">
                  {formatDuration(Math.max(0, it.task.estimate - (p.schedule.get(it.task.id)?.minutes ?? 0)), { compact: true })} left
                </span>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 border-t border-line px-3 py-1.5 text-2xs text-fg-subtle">
        <span className="flex items-center gap-1">
          <Kbd keys={['↵']} /> add
        </span>
        <span className="flex items-center gap-1">
          <Kbd keys={['Esc']} /> cancel
        </span>
      </div>
    </CardShell>
  );
}
