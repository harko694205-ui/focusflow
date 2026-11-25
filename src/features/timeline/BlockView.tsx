import { memo } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, CalendarX2, Check, Users } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatClock, formatDuration } from '@/lib/format';
import { taskRef } from '@/domain/constants';
import { endMinuteOfDay, minuteOfDay, type BlockLayout } from '@/domain/schedule';
import type { Category, Task, TimeBlock } from '@/domain/types';
import { categoryColor } from '@/features/tasks/TaskMeta';
import { PX_PER_MIN } from './store';

export interface BlockViewProps {
  block: TimeBlock;
  task?: Task;
  category?: Category;
  layout: BlockLayout;
  selected: boolean;
  /** This block is the source of an active move/resize — show it as a faded placeholder. */
  ghosted: boolean;
  /** Skip the position animation (e.g. it was just dropped here). */
  instant: boolean;
  afterDeadline: boolean;
  past: boolean;
  /** Scenario diff highlight. */
  highlight?: 'added' | 'moved' | 'resized';
  /** Read-only rendering (no drag/resize handles). */
  readOnly?: boolean;
  onPointerDown: (e: React.PointerEvent, mode: 'move' | 'resize-start' | 'resize-end') => void;
  /** Keyboard: Tab to a block selects it, then arrow keys move it (see the page's hotkeys). */
  onSelect?: () => void;
}

export const BlockView = memo(function BlockView({
  block,
  task,
  category,
  layout,
  selected,
  ghosted,
  instant,
  afterDeadline,
  past,
  highlight,
  readOnly,
  onPointerDown,
  onSelect,
}: BlockViewProps) {
  const start = minuteOfDay(block.start);
  const end = endMinuteOfDay(block.start, block.end);
  const minutes = end - start;
  const isEvent = block.kind === 'event';
  const done = task?.status === 'done';
  const conflict = layout.overlaps.length > 0;
  const color = isEvent ? 'var(--color-fg-faint)' : categoryColor(category);
  const title = isEvent ? block.title : (task?.title ?? 'Deleted task');
  const compact = minutes < 45;
  const tiny = minutes < 30;

  const gap = 2;
  const width = `calc(${100 / layout.lanes}% - ${gap + (layout.lane === layout.lanes - 1 ? gap : 0)}px)`;
  const left = `calc(${(layout.lane * 100) / layout.lanes}% + ${gap}px)`;

  return (
    <motion.div
      data-block-id={block.id}
      role="button"
      tabIndex={readOnly || !onSelect ? -1 : 0}
      onFocus={() => !selected && onSelect?.()}
      aria-label={`${title}, ${formatClock(start)} to ${formatClock(end)}${conflict ? ', overlaps another block' : ''}`}
      aria-pressed={selected}
      initial={false}
      animate={{ top: start * PX_PER_MIN, height: Math.max(minutes * PX_PER_MIN - 1, 10), opacity: ghosted ? 0.35 : 1 }}
      transition={instant ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 42, mass: 0.8 }}
      style={{
        left,
        width,
        borderLeftColor: color,
        background: isEvent
          ? 'repeating-linear-gradient(-45deg, rgb(255 255 255 / 0.055) 0 3px, rgb(255 255 255 / 0.025) 3px 7px), var(--color-raised)'
          : `color-mix(in oklab, ${color} ${done ? 9 : 20}%, var(--color-panel))`,
      }}
      onPointerDown={(e) => !readOnly && onPointerDown(e, 'move')}
      className={cn(
        'group/block focus-ring absolute z-10 cursor-grab overflow-hidden rounded-xs border-l-2 text-left',
        'shadow-[0_1px_2px_rgb(0_0_0/0.4)] transition-[box-shadow,filter] duration-100 hover:brightness-110',
        isEvent && 'border border-l-2 border-line-strong',
        selected && 'z-20 ring-1 ring-accent shadow-[0_0_0_1px_var(--color-accent),0_6px_18px_-6px_rgb(0_0_0/0.7)]',
        conflict && !selected && 'ring-1 ring-[rgb(229_83_75/0.65)]',
        (past || done) && !selected && 'saturate-50',
        readOnly && 'cursor-default',
        highlight === 'added' && !selected && 'ring-1 ring-positive',
        (highlight === 'moved' || highlight === 'resized') && !selected && 'ring-1 ring-accent',
      )}
    >
      {/* Resize handles */}
      {!tiny && !readOnly && (
        <span
          onPointerDown={(e) => onPointerDown(e, 'resize-start')}
          className="absolute inset-x-0 top-0 z-10 h-1.5 cursor-ns-resize"
          aria-hidden
        />
      )}
      {!readOnly && (
        <span
          onPointerDown={(e) => onPointerDown(e, 'resize-end')}
          className="absolute inset-x-0 bottom-0 z-10 flex h-2 cursor-ns-resize items-end justify-center pb-px"
          aria-hidden
        >
          <span className="h-0.5 w-5 rounded-full bg-[rgb(255_255_255/0.35)] opacity-0 transition-opacity group-hover/block:opacity-100" />
        </span>
      )}

      <div className={cn('flex h-full min-w-0 flex-col px-1.5', tiny ? 'justify-center py-0' : 'py-1')}>
        <div className="flex min-w-0 items-center gap-1">
          {isEvent && !compact && <Users size={11} className="shrink-0 text-fg-subtle" />}
          {done && <Check size={11} strokeWidth={2.5} className="shrink-0 text-positive" />}
          <span
            className={cn(
              'truncate text-xs font-medium leading-4',
              done ? 'text-fg-subtle line-through decoration-fg-faint' : 'text-fg',
            )}
          >
            {title}
          </span>
          {tiny && <span className="num ml-auto shrink-0 text-2xs leading-4 text-fg-subtle">{formatClock(start)}</span>}
        </div>
        {!tiny && (
          <span className="num flex min-w-0 items-center gap-1 truncate text-2xs leading-4 text-fg-subtle">
            {formatClock(start)}–{formatClock(end)}
            {!compact && <span className="text-fg-subtle">· {formatDuration(minutes, { compact: true })}</span>}
          </span>
        )}
        {minutes >= 75 && task && (
          <span className="num mt-auto truncate text-2xs leading-4 text-fg-subtle">
            {taskRef(task.seq)} · {category?.name}
          </span>
        )}
      </div>

      {(conflict || afterDeadline) && (
        <span
          className="absolute right-1 top-1 flex items-center gap-0.5"
          title={[conflict && 'Overlaps another block', afterDeadline && 'Scheduled after the deadline'].filter(Boolean).join(' · ')}
        >
          {conflict && <AlertTriangle size={11} strokeWidth={2.25} className="text-negative" />}
          {afterDeadline && <CalendarX2 size={11} strokeWidth={2.25} className="text-warning" />}
        </span>
      )}
    </motion.div>
  );
});
