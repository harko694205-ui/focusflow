import { memo, useCallback } from 'react';
import { motion } from 'motion/react';
import { Flag } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatClock, formatDuration } from '@/lib/format';
import { taskRef } from '@/domain/constants';
import type { TaskRisk } from '@/domain/risk';
import { DAY_MINUTES, endMinuteOfDay, freeIntervals, minuteOfDay, workIntervals, type BlockLayout, subtractIntervals } from '@/domain/schedule';
import type { Category, ID, Task, TimeBlock } from '@/domain/types';
import type { WorkWeek } from '@/domain/constants';
import { Tooltip } from '@/ui/Tooltip';
import { BlockView } from './BlockView';
import { PX_PER_MIN, type CreateDraft, type DragState } from './store';

export interface DayColumnProps {
  day: number; // local midnight instant
  isToday: boolean;
  isPast: boolean;
  nowMinute: number;
  now: number;
  blocks: TimeBlock[];
  layout: Map<ID, BlockLayout>;
  taskMap: Map<ID, Task>;
  categoryMap: Map<ID, Category>;
  risk: Map<ID, TaskRisk>;
  deadlines: Task[];
  selectedId: ID | null;
  drag: DragState | null;
  creating: CreateDraft | null;
  pending: Record<ID, unknown>;
  register: (day: number, el: HTMLElement | null) => void;
  onBlockPointerDown: (block: TimeBlock, e: React.PointerEvent, mode: 'move' | 'resize-start' | 'resize-end') => void;
  onBackgroundPointerDown: (day: number, e: React.PointerEvent) => void;
  /** Select a block from the keyboard (focus). */
  onSelectBlock?: (id: ID) => void;
  /** Scenario diff: highlight changed blocks. */
  diff?: Map<ID, 'added' | 'moved' | 'resized' | 'removed'>;
  /** Original positions of changed/removed blocks, drawn as dashed outlines. */
  ghosts?: Array<{ block: TimeBlock; kind: 'moved' | 'resized' | 'removed' }>;
  /** Day off (scenario): no working hours, no free time. */
  off?: boolean;
  /** Working hours (default: the built-in week). */
  week?: WorkWeek;
  readOnly?: boolean;
  children?: React.ReactNode;
}

const riskLine: Record<string, string> = {
  overdue: 'var(--color-negative)',
  late: 'var(--color-negative)',
  at_risk: 'var(--color-warning)',
  on_track: 'var(--color-fg-muted)',
  done: 'var(--color-fg-faint)',
};

export const DayColumn = memo(function DayColumn(p: DayColumnProps) {
  const { day, isToday, isPast, nowMinute, blocks, layout, drag } = p;
  const work = p.off ? [] : workIntervals(day, p.week);
  const off = subtractIntervals([{ start: 0, end: DAY_MINUTES }], work);
  const showFree = !isPast && !p.off;
  const free = showFree ? freeIntervals(day, blocks, { week: p.week, fromMinute: isToday ? nowMinute : undefined, minLength: 30 }) : [];
  const dragging = !!drag?.moved;

  const ref = useCallback((el: HTMLDivElement | null) => p.register(day, el), [p.register, day]); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = drag && drag.moved && drag.day === day && drag.mode !== 'create' ? drag : null;
  const createPreview =
    (drag && drag.mode === 'create' && drag.day === day ? { start: drag.start, end: drag.end } : null) ??
    (p.creating && p.creating.day === day ? p.creating : null);

  return (
    <div
      ref={ref}
      onPointerDown={(e) => p.onBackgroundPointerDown(day, e)}
      className={cn('relative border-l border-line', isToday && 'bg-[rgb(124_131_255/0.025)]')}
      style={{ height: DAY_MINUTES * PX_PER_MIN }}
      data-day={day}
    >
      {/* Off-hours */}
      {off.map((i) => (
        <div
          key={`off-${i.start}`}
          className="pointer-events-none absolute inset-x-0 bg-[rgb(0_0_0/0.32)]"
          style={{ top: i.start * PX_PER_MIN, height: (i.end - i.start) * PX_PER_MIN }}
        />
      ))}

      {/* Past time today */}
      {isToday && (
        <div className="pointer-events-none absolute inset-x-0 top-0 bg-[rgb(0_0_0/0.18)]" style={{ height: nowMinute * PX_PER_MIN }} />
      )}
      {isPast && <div className="pointer-events-none absolute inset-0 bg-[rgb(0_0_0/0.18)]" />}

      {/* Available time */}
      {free.map((i) => {
        const h = (i.end - i.start) * PX_PER_MIN;
        return (
          <div
            key={`free-${i.start}`}
            className={cn(
              'pointer-events-none absolute inset-x-1 rounded-xs border border-dashed transition-[background-color,border-color] duration-200',
              dragging ? 'border-[rgb(61_184_139/0.45)] bg-[rgb(61_184_139/0.07)]' : 'border-[rgb(61_184_139/0.16)] bg-[rgb(61_184_139/0.025)]',
            )}
            style={{ top: i.start * PX_PER_MIN + 1, height: h - 2 }}
          >
            {h >= 26 && (
              <span className="num absolute left-1.5 top-1 text-2xs text-[rgb(61_184_139/0.8)]">{formatDuration(i.end - i.start, { compact: true })} free</span>
            )}
          </div>
        );
      })}

      {/* Scenario ghosts: where changed blocks used to be */}
      {p.ghosts?.map(({ block: g, kind }) => {
        const s = minuteOfDay(g.start);
        const e = endMinuteOfDay(g.start, g.end);
        const t = g.taskId ? p.taskMap.get(g.taskId) : undefined;
        return (
          <div
            key={`ghost-${g.id}`}
            className={cn(
              'pointer-events-none absolute inset-x-1 z-[5] overflow-hidden rounded-xs border border-dashed px-1.5 py-0.5',
              kind === 'removed' ? 'border-[rgb(229_83_75/0.55)] bg-negative-muted' : 'border-[rgb(124_131_255/0.45)] bg-[rgb(124_131_255/0.05)]',
            )}
            style={{ top: s * PX_PER_MIN, height: Math.max((e - s) * PX_PER_MIN - 1, 10) }}
          >
            {(e - s) * PX_PER_MIN >= 20 && (
              <span className={cn('block truncate text-2xs', kind === 'removed' ? 'text-negative line-through' : 'text-fg-subtle')}>
                {kind === 'removed' ? 'Removed · ' : 'Was here · '}
                {g.kind === 'event' ? g.title : (t?.title ?? '')}
              </span>
            )}
          </div>
        );
      })}

      {/* Blocks */}
      {blocks.map((b) => {
        const task = b.taskId ? p.taskMap.get(b.taskId) : undefined;
        const change = p.diff?.get(b.id);
        return (
          <BlockView
            key={b.id}
            block={b}
            task={task}
            category={task ? p.categoryMap.get(task.categoryId) : undefined}
            layout={layout.get(b.id) ?? { lane: 0, lanes: 1, overlaps: [] }}
            selected={p.selectedId === b.id}
            ghosted={!!drag?.moved && drag.blockId === b.id}
            instant={b.id in p.pending}
            afterDeadline={!!task && task.status !== 'done' && b.end > task.deadline}
            past={b.end <= p.now}
            highlight={change === 'removed' ? undefined : change}
            readOnly={p.readOnly}
            onPointerDown={(e, mode) => p.onBlockPointerDown(b, e, mode)}
            onSelect={p.onSelectBlock ? () => p.onSelectBlock!(b.id) : undefined}
          />
        );
      })}

      {/* Deadline markers */}
      {p.deadlines.map((t, i) => {
        const m = minuteOfDay(t.deadline);
        const level = t.status === 'done' ? 'done' : (p.risk.get(t.id)?.level ?? 'on_track');
        const color = riskLine[level];
        return (
          <div
            key={`dl-${t.id}`}
            className="pointer-events-none absolute inset-x-0 z-[15]"
            style={{ top: m * PX_PER_MIN - 1 }}
          >
            <div className="h-0 border-t-[1.5px] border-dashed" style={{ borderColor: color, opacity: 0.85 }} />
            <Tooltip
              content={
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">{t.title}</span>
                  <span className="num text-2xs text-fg-subtle">
                    {taskRef(t.seq)} due {formatClock(m)}
                    {level === 'late' ? ' · projected late' : level === 'overdue' ? ' · overdue' : level === 'at_risk' ? ' · at risk' : ''}
                  </span>
                </span>
              }
            >
              <span
                className="pointer-events-auto absolute right-0.5 flex h-4 -translate-y-1/2 cursor-default items-center gap-0.5 rounded-xs px-1 text-[10px] font-medium leading-none text-canvas shadow-[0_1px_2px_rgb(0_0_0/0.5)]"
                style={{ background: color, top: i % 2 ? 9 : 0 }}
              >
                <Flag size={9} strokeWidth={2.5} />
                <span className="num">{taskRef(t.seq)}</span>
              </span>
            </Tooltip>
          </div>
        );
      })}

      {/* Now line */}
      {isToday && (
        <div className="pointer-events-none absolute inset-x-0 z-30" style={{ top: nowMinute * PX_PER_MIN }}>
          <div className="h-0.5 -translate-y-1/2 bg-accent shadow-[0_0_8px_rgb(124_131_255/0.6)]" />
          <span className="absolute -left-[5px] top-0 size-2.5 -translate-y-1/2 rounded-full border-2 border-canvas bg-accent" />
        </div>
      )}

      {/* Move / resize / tray preview */}
      {preview && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.12 }}
          className="pointer-events-none absolute inset-x-1 z-30 rounded-xs border border-accent bg-accent-muted shadow-[0_8px_24px_-8px_rgb(0_0_0/0.8)]"
          style={{ top: preview.start * PX_PER_MIN, height: (preview.end - preview.start) * PX_PER_MIN - 1, borderLeft: `3px solid ${preview.color}` }}
        >
          <div className="flex h-full flex-col overflow-hidden px-1.5 py-1">
            <span className="truncate text-xs font-medium text-fg">{preview.label}</span>
            <span className="num text-2xs text-fg-muted">
              {formatClock(preview.start)}–{formatClock(preview.end)} · {formatDuration(preview.end - preview.start, { compact: true })}
            </span>
          </div>
        </motion.div>
      )}

      {/* Create selection */}
      {createPreview && (
        <div
          className="pointer-events-none absolute inset-x-1 z-30 rounded-xs border border-dashed border-accent bg-accent-muted"
          style={{ top: createPreview.start * PX_PER_MIN, height: (createPreview.end - createPreview.start) * PX_PER_MIN - 1 }}
        >
          <span className="num block px-1.5 pt-1 text-2xs text-fg">
            {formatClock(createPreview.start)}–{formatClock(createPreview.end)}
          </span>
        </div>
      )}

      {p.children}
    </div>
  );
});
