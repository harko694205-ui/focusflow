import { memo, useMemo } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, Flag } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { blocksByDay, dayKey, layoutBlocks, startOfLocalDay } from '@/domain/schedule';
import type { TaskRisk } from '@/domain/risk';
import type { Category, ID, Task, TimeBlock } from '@/domain/types';
import type { DayMetrics, ScheduleDiff, ScheduleState } from '@/engine';
import { Tooltip } from '@/ui/Tooltip';
import { DayColumn } from '@/features/timeline/DayColumn';
import { GRID_HEIGHT, HOUR_PX, PX_PER_MIN, type CreateDraft, type DragState } from '@/features/timeline/store';

export const SIM_GUTTER = 48;

interface SimCalendarProps {
  label?: React.ReactNode;
  days: Date[];
  state: ScheduleState;
  metrics: DayMetrics[];
  categoryMap: Map<ID, Category>;
  risk: Map<ID, TaskRisk>;
  now: number;
  diff?: ScheduleDiff;
  /** Draw dashed outlines where changed blocks used to be. */
  showGhosts?: boolean;
  readOnly?: boolean;
  selectedId?: ID | null;
  drag?: DragState | null;
  creating?: CreateDraft | null;
  register?: (day: number, el: HTMLElement | null) => void;
  onBlockPointerDown?: (block: TimeBlock, e: React.PointerEvent, mode: 'move' | 'resize-start' | 'resize-end') => void;
  onBackgroundPointerDown?: (day: number, e: React.PointerEvent) => void;
  /** Rendered inside the column for that day (cards). */
  renderInColumn?: (day: number, dayIndex: number) => React.ReactNode;
  showGutter?: boolean;
}

const noop = () => {};

export const SimCalendar = memo(function SimCalendar(p: SimCalendarProps) {
  const { days, state, metrics, now } = p;
  const todayStart = startOfLocalDay(now).getTime();
  const nowMinute = Math.round((now - todayStart) / 60_000);
  const taskMap = useMemo(() => new Map(state.tasks.map((t) => [t.id, t])), [state.tasks]);
  const byDay = useMemo(() => blocksByDay([...state.blocks]), [state.blocks]);
  const deadlines = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of state.tasks) {
      const k = dayKey(t.deadline);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    return m;
  }, [state.tasks]);
  const ghostsByDay = useMemo(() => {
    const m = new Map<string, Array<{ block: TimeBlock; kind: 'moved' | 'resized' | 'removed' }>>();
    if (!p.showGhosts || !p.diff) return m;
    for (const [id, block] of p.diff.originals) {
      const kind = p.diff.blocks.get(id) as 'moved' | 'resized' | 'removed';
      const k = dayKey(block.start);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push({ block, kind });
    }
    return m;
  }, [p.diff, p.showGhosts]);
  const diffMap = p.diff?.blocks;
  const showGutter = p.showGutter ?? true;
  const cols = `${showGutter ? `${SIM_GUTTER}px ` : ''}repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="relative min-w-0 flex-1">
      {/* Header */}
      <div className="sticky top-0 z-[45] border-b border-line bg-canvas/95 backdrop-blur-md">
        {p.label && <div className="flex h-8 items-center gap-2 border-b border-line px-3 text-xs">{p.label}</div>}
        <div className="grid" style={{ gridTemplateColumns: cols }}>
          {showGutter && <div />}
          {days.map((d, i) => {
            const m = metrics.find((x) => x.key === dayKey(d)) ?? metrics[i];
            const isToday = d.getTime() === todayStart;
            const load = m.booked + m.overtime;
            const over = m.overload > 0;
            return (
              <div key={dayKey(d)} className="flex min-w-0 flex-col gap-1 border-l border-line px-2 py-1.5">
                <div className="flex items-center gap-1">
                  <span className={cn('text-2xs font-medium', isToday ? 'text-accent' : 'text-fg-subtle')}>{format(d, 'EEE')}</span>
                  <span className={cn('num text-xs font-medium', isToday ? 'text-accent' : 'text-fg')}>{format(d, 'd')}</span>
                  {m.off && <span className="rounded-xs bg-negative-muted px-1 text-[10px] font-medium text-negative">Off</span>}
                  <span className="ml-auto flex items-center gap-1">
                    {m.conflicts > 0 && (
                      <Tooltip content={`${m.conflicts} overlapping blocks`}>
                        <AlertTriangle size={11} className="text-negative" />
                      </Tooltip>
                    )}
                    {m.due.length > 0 && (
                      <span className="num flex items-center gap-0.5 rounded-xs bg-warning-muted px-0.5 text-[10px] text-warning">
                        <Flag size={8} strokeWidth={2.5} />
                        {m.due.length}
                      </span>
                    )}
                  </span>
                </div>
                <Tooltip
                  content={
                    <span className="num text-2xs">
                      {formatDuration(load)} booked of {formatDuration(m.capacity)}
                      {over ? ` · ${formatDuration(m.overload)} over` : ` · ${formatDuration(m.free)} free`}
                    </span>
                  }
                >
                  <div className="flex items-center gap-1.5">
                    <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-[rgb(255_255_255/0.06)]">
                      <div
                        className={cn('absolute inset-y-0 left-0 rounded-full transition-[width] duration-300', over ? 'bg-negative' : 'bg-fg-muted')}
                        style={{ width: `${m.capacity ? Math.min(100, (load / m.capacity) * 100) : load ? 100 : 0}%` }}
                      />
                    </div>
                    <span className={cn('num shrink-0 text-[10px]', over ? 'text-negative' : 'text-fg-subtle')}>
                      {over ? `+${formatDuration(m.overload, { compact: true })}` : formatDuration(load, { compact: true })}
                    </span>
                  </div>
                </Tooltip>
              </div>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div className="relative grid" style={{ gridTemplateColumns: cols, height: GRID_HEIGHT }}>
        <div
          className="pointer-events-none absolute inset-y-0 right-0"
          style={{
            left: showGutter ? SIM_GUTTER : 0,
            backgroundImage: 'linear-gradient(to bottom, var(--color-line) 1px, transparent 1px)',
            backgroundSize: `100% ${HOUR_PX}px`,
          }}
        />
        {showGutter && (
          <div className="relative">
            {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
              <span key={h} className="num absolute right-1.5 -translate-y-1/2 text-[10px] text-fg-subtle" style={{ top: h * HOUR_PX }}>
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
            {days.some((d) => d.getTime() === todayStart) && (
              <span
                className="num absolute right-0.5 z-30 -translate-y-1/2 rounded-xs bg-accent px-0.5 text-[10px] font-medium text-accent-fg"
                style={{ top: nowMinute * PX_PER_MIN }}
              >
                {format(now, 'HH:mm')}
              </span>
            )}
          </div>
        )}
        {days.map((d, i) => {
          const k = dayKey(d);
          const list = byDay.get(k) ?? [];
          return (
            <DayColumn
              key={k}
              day={d.getTime()}
              isToday={d.getTime() === todayStart}
              isPast={d.getTime() < todayStart}
              nowMinute={nowMinute}
              now={now}
              blocks={list}
              layout={layoutBlocks(list)}
              taskMap={taskMap}
              categoryMap={p.categoryMap}
              risk={p.risk}
              deadlines={deadlines.get(k) ?? []}
              selectedId={p.selectedId ?? null}
              drag={p.readOnly ? null : (p.drag ?? null)}
              creating={p.readOnly ? null : (p.creating ?? null)}
              pending={EMPTY}
              register={p.register ?? noop}
              onBlockPointerDown={p.onBlockPointerDown ?? noop}
              onBackgroundPointerDown={p.onBackgroundPointerDown ?? noop}
              diff={diffMap}
              ghosts={ghostsByDay.get(k)}
              off={metrics.find((m) => m.key === k)?.off}
              readOnly={p.readOnly}
            >
              {p.renderInColumn?.(d.getTime(), i)}
            </DayColumn>
          );
        })}
      </div>
    </div>
  );
});

const EMPTY: Record<ID, unknown> = {};
