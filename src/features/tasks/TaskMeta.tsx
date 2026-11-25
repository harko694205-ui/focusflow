/** Small, reusable task attribute renderers. Presentational only. */
import { format } from 'date-fns';
import { AlertTriangle, CalendarClock, CircleAlert, Clock3 } from 'lucide-react';
import type { TaskSchedule } from '@/domain/schedule';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { CATEGORY_COLORS, DIFFICULTIES, PRIORITIES } from '@/domain/constants';
import { dueLabel } from '@/domain/dates';
import type { TaskRisk } from '@/domain/risk';
import type { Category, Difficulty, Priority, Task } from '@/domain/types';
import { Tooltip } from '@/ui/Tooltip';

export function categoryColor(c: Category | undefined) {
  return c ? CATEGORY_COLORS[c.color] : 'var(--color-fg-faint)';
}

export function CategorySwatch({ category, className }: { category?: Category; className?: string }) {
  return <span className={cn('inline-block size-2 shrink-0 rounded-xs', className)} style={{ background: categoryColor(category) }} />;
}

export function CategoryLabel({ category, className }: { category?: Category; className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-xs text-fg-muted', className)}>
      <CategorySwatch category={category} />
      <span className="truncate">{category?.name ?? 'Uncategorized'}</span>
    </span>
  );
}

/** Three ascending bars; urgent is red. */
export function PriorityIcon({ priority, withTooltip = true }: { priority: Priority; withTooltip?: boolean }) {
  const filled = 3 - priority;
  const glyph =
    priority === 0 ? (
      <span className="flex size-3.5 items-center justify-center rounded-[3px] bg-negative text-[9px] font-bold leading-none text-canvas" aria-label="Priority: Urgent">
        !
      </span>
    ) : (
      <span className="flex h-3.5 w-3.5 items-end justify-center gap-[2px] pb-[1px]" aria-label={`Priority: ${PRIORITIES[priority].label}`}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn('w-[3px] rounded-[1px]', i < filled ? 'bg-fg-muted' : 'bg-[rgb(255_255_255/0.12)]')}
            style={{ height: `${4 + i * 3}px` }}
          />
        ))}
      </span>
    );
  return withTooltip ? <Tooltip content={`${PRIORITIES[priority].label} priority`}>{glyph}</Tooltip> : glyph;
}

/** Three dots, filled by difficulty. */
export function DifficultyDots({ difficulty, className }: { difficulty: Difficulty; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-[3px]', className)} aria-label={`Difficulty: ${DIFFICULTIES[difficulty].label}`}>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn('size-[5px] rounded-full', i <= difficulty ? (difficulty === 3 ? 'bg-deep' : 'bg-fg-muted') : 'bg-[rgb(255_255_255/0.12)]')}
        />
      ))}
    </span>
  );
}

export function DifficultyLabel({ difficulty }: { difficulty: Difficulty }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-fg-muted">
      <DifficultyDots difficulty={difficulty} />
      {DIFFICULTIES[difficulty].label}
    </span>
  );
}

export function EstimateLabel({ minutes, className }: { minutes: number; className?: string }) {
  return <span className={cn('num text-xs text-fg-muted', className)}>{formatDuration(minutes, { compact: true })}</span>;
}

const riskText = {
  overdue: 'text-negative',
  late: 'text-negative',
  at_risk: 'text-warning',
  on_track: 'text-fg-muted',
} as const;

/** Deadline with risk coloring and an explanatory tooltip. */
export function DueCell({ task, risk, now }: { task: Task; risk?: TaskRisk; now: number }) {
  const done = task.status === 'done';
  const level = done ? 'on_track' : (risk?.level ?? 'on_track');
  const Icon = level === 'overdue' ? CircleAlert : level === 'late' ? AlertTriangle : level === 'at_risk' ? Clock3 : null;

  const explanation = done
    ? `Completed${task.completedAt ? ` · ${new Date(task.completedAt).toLocaleDateString()}` : ''}`
    : !risk
      ? null
      : level === 'overdue'
        ? `Deadline passed ${dueLabel(task.deadline, now, { withTime: true })}`
        : `${formatDuration(risk.demand)} of work due by then · ${formatDuration(risk.available)} of working time left → ${
            risk.slack < 0 ? `short by ${formatDuration(-risk.slack)}` : `${formatDuration(risk.slack)} slack`
          }`;

  const body = (
    <span className={cn('inline-flex items-center gap-1 text-xs', done ? 'text-fg-subtle' : riskText[level])}>
      {Icon && !done && <Icon size={12} strokeWidth={2} />}
      <span className="num whitespace-nowrap">{dueLabel(task.deadline, now)}</span>
    </span>
  );
  return explanation ? (
    <Tooltip content={<span className="num text-2xs">{explanation}</span>} side="left">
      {body}
    </Tooltip>
  ) : (
    body
  );
}

export function SlackLabel({ risk }: { risk?: TaskRisk }) {
  if (!risk) return <span className="num text-xs text-fg-faint">—</span>;
  const tone = risk.level === 'overdue' || risk.level === 'late' ? 'text-negative' : risk.level === 'at_risk' ? 'text-warning' : 'text-fg-subtle';
  return (
    <span className={cn('num text-xs', tone)}>
      {risk.level === 'overdue' ? 'overdue' : `${risk.slack >= 0 ? '+' : ''}${formatDuration(risk.slack, { compact: true })}`}
    </span>
  );
}

/** Small calendar glyph showing how much of a task's estimate has time blocked on the timeline. */
export function ScheduleBadge({ task, scheduled }: { task: Task; scheduled?: TaskSchedule }) {
  if (!scheduled || scheduled.minutes === 0) return null;
  const full = scheduled.minutes >= task.estimate;
  return (
    <Tooltip
      content={
        <span className="num text-2xs">
          {formatDuration(scheduled.minutes)} of {formatDuration(task.estimate)} scheduled
          {scheduled.next ? ` · next ${format(scheduled.next, 'EEE HH:mm')}` : ''}
        </span>
      }
    >
      <span
        className={cn(
          'inline-flex shrink-0 items-center gap-0.5 rounded-xs px-1 text-2xs',
          full ? 'bg-positive-muted text-positive' : 'bg-[rgb(255_255_255/0.05)] text-fg-subtle',
        )}
      >
        <CalendarClock size={10} strokeWidth={2} />
        <span className="num">{formatDuration(scheduled.minutes, { compact: true })}</span>
      </span>
    </Tooltip>
  );
}
