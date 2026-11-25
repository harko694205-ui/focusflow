import { useState } from 'react';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { AnimatePresence, motion } from 'motion/react';
import { Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Scatter, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import {
  ArrowRight,
  CalendarMinus,
  CalendarPlus,
  Check,
  CircleSlash,
  GitBranch,
  History,
  Minus,
  MoveRight,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { taskRef } from '@/domain/constants';
import { durationMinutes } from '@/domain/schedule';
import type { Category, ID, Task, TimeBlock } from '@/domain/types';
import { STATUS_LABEL, type ApplyPlan, type DayMetrics, type MetricDelta, type OpResult, type PlanStatus, type RiskChange, type Scenario, type ScheduleDiff, type StoredOp } from '@/engine';
import { Button, IconButton } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { EmptyState } from '@/ui/Feedback';
import { Tooltip } from '@/ui/Tooltip';
import { CardShell, type CardPlacement } from '@/features/timeline/Cards';
import { CategorySwatch } from '@/features/tasks/TaskMeta';

/* -------------------------------------------------------------------------- */
/* Impact strip                                                               */
/* -------------------------------------------------------------------------- */

const METRIC_META: Record<string, { label: string; minutes?: boolean; hint: string }> = {
  lateTasks: { label: 'Late tasks', hint: 'Overdue, or last block ends after the deadline' },
  overloadedDays: { label: 'Overloaded days', hint: 'Days booked beyond working hours' },
  conflicts: { label: 'Overlaps', hint: 'Blocks that overlap another block' },
  unscheduledMinutes: { label: 'Unscheduled work', minutes: true, hint: 'Estimate not yet covered by any block' },
  scheduledTaskMinutes: { label: 'Scheduled', minutes: true, hint: 'Task time on the calendar in this range' },
  freeMinutes: { label: 'Free time', minutes: true, hint: 'Unbooked working time from now on' },
};

const fmtMetric = (key: string, v: number) => (METRIC_META[key]?.minutes ? formatDuration(v, { compact: true }) : String(v));

export function ImpactStrip({ deltas }: { deltas: MetricDelta[] }) {
  return (
    <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-line bg-line xl:grid-cols-6">
      {deltas.map((d) => {
        const meta = METRIC_META[d.key];
        const tone = d.verdict === 'better' ? 'text-positive' : d.verdict === 'worse' ? 'text-negative' : 'text-fg-subtle';
        return (
          <Tooltip key={d.key} content={meta.hint}>
            <div className="flex min-w-0 cursor-default flex-col gap-1 bg-panel px-3.5 py-2.5">
              <span className="eyebrow truncate">{meta.label}</span>
              <div className="flex items-baseline gap-1.5">
                <span className="num text-xs text-fg-subtle">{fmtMetric(d.key, d.before)}</span>
                <ArrowRight size={11} className="shrink-0 self-center text-fg-faint" />
                <motion.span key={d.after} initial={{ opacity: 0.4, y: -2 }} animate={{ opacity: 1, y: 0 }} className="num text-lg font-medium leading-none text-fg">
                  {fmtMetric(d.key, d.after)}
                </motion.span>
              </div>
              <span className={cn('num text-2xs', tone)}>
                {d.delta === 0 ? 'no change' : `${d.delta > 0 ? '+' : '−'}${fmtMetric(d.key, Math.abs(d.delta))}`}
              </span>
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Load comparison chart                                                      */
/* -------------------------------------------------------------------------- */

interface LoadRow {
  label: string;
  before: number;
  after: number;
  capacity: number;
  over: boolean;
}

function CapTick(props: { cx?: number; cy?: number; payload?: LoadRow }) {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload?.capacity) return <g />;
  return <line x1={cx - 14} x2={cx + 14} y1={cy} y2={cy} stroke="var(--color-fg-muted)" strokeWidth={1.25} strokeDasharray="2 2" />;
}

export function LoadCompareChart({ before, after }: { before: DayMetrics[]; after: DayMetrics[] }) {
  const data: LoadRow[] = after.map((d, i) => {
    const b = before[i];
    return { label: d.label, before: b.booked + b.overtime, after: d.booked + d.overtime, capacity: d.capacity, over: d.overload > 0 };
  });
  const peak = Math.max(480, ...data.map((d) => Math.max(d.before, d.after, d.capacity)));
  const top = Math.ceil(peak / 120) * 120 + 60;
  return (
    <div className="h-[170px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: -12 }} barGap={1} barCategoryGap="24%">
          <CartesianGrid vertical={false} stroke="var(--color-line)" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--color-line-strong)' }} tick={{ fill: 'var(--color-fg-subtle)', fontSize: 10 }} interval={0} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={36}
            domain={[0, top]}
            ticks={Array.from({ length: Math.floor(top / 240) + 1 }, (_, i) => i * 240)}
            tick={{ fill: 'var(--color-fg-subtle)', fontSize: 10, fontFamily: 'var(--font-mono)' }}
            tickFormatter={(v: number) => `${v / 60}h`}
          />
          <RTooltip
            cursor={{ fill: 'rgb(255 255 255 / 0.03)' }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0].payload as LoadRow;
              return (
                <div className="rounded-sm border border-line-strong bg-raised px-2.5 py-1.5 text-2xs shadow-pop">
                  <div className="mb-1 font-medium text-fg">{r.label}</div>
                  <div className="num text-fg-subtle">Original {formatDuration(r.before)}</div>
                  <div className={cn('num', r.over ? 'text-negative' : 'text-fg')}>Proposed {formatDuration(r.after)}</div>
                  <div className="num text-fg-subtle">Capacity {formatDuration(r.capacity)}</div>
                </div>
              );
            }}
          />
          <Bar dataKey="before" fill="rgb(255 255 255 / 0.13)" radius={[2, 2, 0, 0]} maxBarSize={12} isAnimationActive={false} />
          <Bar
            dataKey="after"
            radius={[2, 2, 0, 0]}
            maxBarSize={12}
            animationDuration={260}
            shape={(props: { x?: number; y?: number; width?: number; height?: number; payload?: LoadRow }) => (
              <rect
                x={props.x}
                y={props.y}
                width={props.width}
                height={Math.max(0, props.height ?? 0)}
                rx={2}
                fill={props.payload?.over ? 'var(--color-negative)' : 'var(--color-accent)'}
              />
            )}
          />
          <Scatter dataKey="capacity" shape={<CapTick />} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Deadline risk changes                                                      */
/* -------------------------------------------------------------------------- */

const statusTone: Record<PlanStatus, string> = {
  overdue: 'text-negative',
  late: 'text-negative',
  short: 'text-warning',
  on_track: 'text-positive',
  done: 'text-fg-subtle',
};

export function RiskChanges({
  changes,
  taskMap,
  categoryMap,
  onFocus,
}: {
  changes: RiskChange[];
  taskMap: Map<ID, Task>;
  categoryMap: Map<ID, Category>;
  onFocus: (taskId: ID) => void;
}) {
  if (!changes.length)
    return <p className="px-1 py-3 text-xs text-fg-subtle">No deadline outcomes change yet. Move, resize or auto-plan work to see the impact here.</p>;
  return (
    <ul className="flex flex-col gap-1">
      {changes.slice(0, 12).map((c) => {
        const t = taskMap.get(c.taskId);
        if (!t) return null;
        return (
          <li key={c.taskId}>
            <button
              onClick={() => onFocus(c.taskId)}
              className="focus-ring flex w-full flex-col gap-1 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-hover"
            >
              <span className="flex min-w-0 items-center gap-1.5 text-xs">
                <span className={cn('size-1.5 shrink-0 rounded-full', c.verdict === 'better' ? 'bg-positive' : c.verdict === 'worse' ? 'bg-negative' : 'bg-fg-faint')} />
                <span className="truncate text-fg">{t.title}</span>
              </span>
              <span className="flex flex-wrap items-center gap-1 pl-3 text-2xs">
                <CategorySwatch category={categoryMap.get(t.categoryId)} className="size-1.5" />
                <span className="num text-fg-subtle">{taskRef(t.seq)}</span>
                {c.before !== c.after ? (
                  <>
                    <span className={statusTone[c.before]}>{STATUS_LABEL[c.before]}</span>
                    <MoveRight size={10} className="text-fg-faint" />
                    <span className={statusTone[c.after]}>{STATUS_LABEL[c.after]}</span>
                  </>
                ) : (
                  <span className={statusTone[c.after]}>{STATUS_LABEL[c.after]}</span>
                )}
                {c.finishShift ? (
                  <span className="num text-fg-subtle">
                    · finishes {formatDuration(Math.abs(c.finishShift), { compact: true })} {c.finishShift > 0 ? 'later' : 'earlier'}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Change log                                                                 */
/* -------------------------------------------------------------------------- */

const opIcon: Record<string, typeof Plus> = {
  move: MoveRight,
  add: CalendarPlus,
  remove: CalendarMinus,
  estimate: History,
  deadline: History,
  priority: History,
  clearDay: CircleSlash,
  autoplan: Sparkles,
};

export function ChangeLog({
  ops,
  results,
  readOnly,
  onRemove,
}: {
  ops: StoredOp[];
  results: OpResult[];
  readOnly: boolean;
  onRemove: (opId: ID) => void;
}) {
  if (!ops.length)
    return (
      <EmptyState
        compact
        icon={GitBranch}
        title="No changes yet"
        description="Drag blocks, resize them, schedule tasks from the Unscheduled tab, or use Auto-plan. Your real schedule stays untouched."
      />
    );
  return (
    <ol className="flex flex-col gap-0.5">
      <AnimatePresence initial={false}>
        {ops.map((o, i) => {
          const r = results[i];
          const Icon = opIcon[o.op.type] ?? History;
          return (
            <motion.li
              key={o.id}
              layout="position"
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, height: 0 }}
              className="group flex items-start gap-2 rounded-sm px-2 py-1.5 hover:bg-hover"
            >
              <span className="num mt-0.5 w-4 shrink-0 text-right text-2xs text-fg-faint">{i + 1}</span>
              <Icon size={12} className={cn('mt-0.5 shrink-0', r?.skipped ? 'text-warning' : 'text-fg-subtle')} />
              <div className="min-w-0 flex-1">
                <p className={cn('text-xs leading-4', r?.skipped ? 'text-fg-subtle line-through' : 'text-fg')}>{r?.label}</p>
                {r?.skipped && <p className="text-2xs text-warning">Skipped — {r.skipped}</p>}
                <p className="text-2xs text-fg-faint">{formatDistanceToNowStrict(o.at, { addSuffix: true })}</p>
              </div>
              {!readOnly && (
                <IconButton
                  icon={X}
                  label="Remove this change"
                  size="sm"
                  className="-mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => onRemove(o.id)}
                />
              )}
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}

/* -------------------------------------------------------------------------- */
/* Scenario rail                                                              */
/* -------------------------------------------------------------------------- */

export function ScenarioRail({
  scenarios,
  activeId,
  lateDelta,
  onSelect,
  onNew,
  onRestore,
  onDelete,
}: {
  scenarios: Scenario[];
  activeId: ID | null;
  lateDelta: Map<ID, number>;
  onSelect: (id: ID) => void;
  onNew: () => void;
  onRestore: (id: ID) => void;
  onDelete: (id: ID) => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const drafts = scenarios.filter((s) => s.status === 'draft');
  const history = scenarios.filter((s) => s.status !== 'draft');

  const item = (s: Scenario) => {
    const d = lateDelta.get(s.id) ?? 0;
    const active = s.id === activeId;
    return (
      <li key={s.id} className="group relative">
        <button
          onClick={() => onSelect(s.id)}
          className={cn(
            'focus-ring flex w-full flex-col gap-0.5 rounded-sm px-2.5 py-2 text-left transition-colors',
            active ? 'bg-active' : 'hover:bg-hover',
          )}
        >
          <span className="flex items-center gap-1.5">
            {s.status === 'applied' ? (
              <Check size={12} className="shrink-0 text-positive" />
            ) : s.status === 'discarded' ? (
              <Trash2 size={12} className="shrink-0 text-fg-faint" />
            ) : (
              <GitBranch size={12} className={cn('shrink-0', active ? 'text-accent' : 'text-fg-subtle')} />
            )}
            <span className={cn('truncate text-sm', s.status === 'draft' ? 'text-fg' : 'text-fg-subtle')}>{s.name}</span>
          </span>
          <span className="flex items-center gap-1.5 pl-[18px] text-2xs text-fg-subtle">
            <span className="num">
              {s.ops.length} change{s.ops.length === 1 ? '' : 's'}
            </span>
            {s.status === 'draft' && d !== 0 && (
              <span className={cn('num', d > 0 ? 'text-negative' : 'text-positive')}>
                · {d > 0 ? '+' : '−'}
                {Math.abs(d)} late
              </span>
            )}
            {s.status === 'applied' && s.appliedAt && <span>· applied {format(s.appliedAt, 'MMM d')}</span>}
          </span>
        </button>
        {s.status !== 'draft' && (
          <span className="absolute right-1 top-1.5 hidden items-center gap-0.5 group-hover:flex">
            <IconButton icon={RotateCcw} label="Reopen as draft" size="sm" onClick={() => onRestore(s.id)} />
            <IconButton icon={Trash2} label="Delete permanently" size="sm" onClick={() => onDelete(s.id)} />
          </span>
        )}
      </li>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line pl-3.5 pr-2">
        <span className="text-sm font-medium">Scenarios</span>
        <Tooltip content="New scenario from current schedule">
          <IconButton icon={Plus} label="New scenario" size="sm" onClick={onNew} />
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <h3 className="eyebrow px-2 pb-1 pt-1">Drafts</h3>
        {drafts.length ? <ul className="flex flex-col gap-px">{drafts.map(item)}</ul> : <p className="px-2 py-2 text-xs text-fg-subtle">No drafts.</p>}
        {history.length > 0 && (
          <>
            <button onClick={() => setShowHistory((v) => !v)} className="eyebrow mt-4 flex w-full items-center gap-1 px-2 pb-1 hover:text-fg-muted">
              History · {history.length}
              <ArrowRight size={10} className={cn('transition-transform', showHistory && 'rotate-90')} />
            </button>
            {showHistory && <ul className="flex flex-col gap-px">{history.map(item)}</ul>}
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Selected block (scenario)                                                  */
/* -------------------------------------------------------------------------- */

export function ScenarioBlockCard({
  block,
  task,
  category,
  original,
  change,
  placement,
  onClose,
  onEstimate,
  onDeadline,
  onRevert,
  onRemove,
}: {
  block: TimeBlock;
  task?: Task;
  category?: Category;
  original?: TimeBlock;
  change?: ScheduleDiff['blocks'] extends Map<ID, infer C> ? C : never;
  placement: CardPlacement;
  onClose: () => void;
  onEstimate: (minutes: number) => void;
  onDeadline: (deadline: number) => void;
  onRevert: () => void;
  onRemove: () => void;
}) {
  const mins = durationMinutes(block);
  const top = ((block.start - new Date(block.start).setHours(0, 0, 0, 0)) / 60_000) * (48 / 60);
  return (
    <CardShell top={top} placement={placement} label="Scenario block">
      <div className="flex items-start gap-2 px-3 pb-2 pt-2.5">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-1.5 text-2xs text-fg-subtle">
            {task ? (
              <>
                <CategorySwatch category={category} className="size-1.5" />
                <span className="num">{taskRef(task.seq)}</span>
              </>
            ) : (
              'Event · fixed'
            )}
            {change && change !== 'removed' && (
              <span className={cn('rounded-xs px-1 text-[10px] font-medium', change === 'added' ? 'bg-positive-muted text-positive' : 'bg-accent-muted text-accent')}>
                {change === 'added' ? 'New in scenario' : change === 'moved' ? 'Moved' : 'Resized'}
              </span>
            )}
          </div>
          <div className="line-clamp-2 text-sm font-medium text-fg">{task?.title ?? block.title}</div>
          <div className="num mt-1 text-xs text-fg-muted">
            {format(block.start, 'EEE MMM d · HH:mm')}–{format(block.end, 'HH:mm')} <span className="text-fg-subtle">({formatDuration(mins, { compact: true })})</span>
          </div>
          {original && (
            <div className="num mt-0.5 text-2xs text-fg-subtle">
              Originally {format(original.start, 'EEE HH:mm')}–{format(original.end, 'HH:mm')}
            </div>
          )}
        </div>
        <IconButton icon={X} label="Close" size="sm" onClick={onClose} className="-mr-1 -mt-0.5" />
      </div>

      {task && (
        <div className="flex flex-col gap-2 border-t border-line px-3 py-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-fg-subtle">Task estimate</span>
            <span className="flex items-center gap-1">
              <IconButton icon={Minus} label="Decrease estimate by 30 minutes" size="sm" variant="secondary" onClick={() => onEstimate(Math.max(15, task.estimate - 30))} />
              <span className="num w-12 text-center text-fg">{formatDuration(task.estimate, { compact: true })}</span>
              <IconButton icon={Plus} label="Increase estimate by 30 minutes" size="sm" variant="secondary" onClick={() => onEstimate(task.estimate + 30)} />
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-fg-subtle">Deadline</span>
            <span className="flex items-center gap-1">
              <IconButton icon={Minus} label="Deadline one day earlier" size="sm" variant="secondary" onClick={() => onDeadline(task.deadline - 86_400_000)} />
              <span className="num w-[88px] text-center text-fg">{format(task.deadline, 'EEE d · HH:mm')}</span>
              <IconButton icon={Plus} label="Deadline one day later" size="sm" variant="secondary" onClick={() => onDeadline(task.deadline + 86_400_000)} />
            </span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1 border-t border-line px-2 py-2">
        {change && change !== 'removed' && (
          <Button size="sm" variant="ghost" icon={Undo2} onClick={onRevert}>
            {change === 'added' ? 'Undo add' : 'Revert'}
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={Trash2} onClick={onRemove} className="ml-auto hover:text-negative">
          Remove in scenario
        </Button>
      </div>
    </CardShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Apply dialog                                                               */
/* -------------------------------------------------------------------------- */

export function ApplyDialog({
  open,
  onOpenChange,
  scenario,
  diff,
  plan,
  taskMap,
  busy,
  onApply,
  onRebase,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  scenario: Scenario;
  diff: ScheduleDiff;
  plan: ApplyPlan;
  taskMap: Map<ID, Task>;
  busy: boolean;
  onApply: (skipConflicts: boolean) => void;
  onRebase: () => void;
}) {
  const c = diff.counts;
  const rows = [
    [c.moved, 'blocks moved'],
    [c.resized, 'blocks resized'],
    [c.added, 'blocks added'],
    [c.removed, 'blocks removed'],
    [c.tasks, 'tasks re-estimated or re-dated'],
  ].filter(([n]) => (n as number) > 0) as Array<[number, string]>;
  const conflicts = plan.conflicts;
  const clean = plan.changeCount;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Apply “${scenario.name}”?`}
      description="This writes the proposed changes to your real schedule. You can undo it afterwards."
      width="md"
      footer={
        <>
          {conflicts.length > 0 && (
            <Button variant="ghost" onClick={onRebase} className="mr-auto">
              Rebase on current schedule
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || clean === 0} onClick={() => onApply(conflicts.length > 0)}>
            {conflicts.length ? `Apply ${clean} safe change${clean === 1 ? '' : 's'}` : 'Apply to schedule'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 px-4 py-4">
        <ul className="flex flex-col gap-1.5 text-sm">
          {rows.map(([n, label]) => (
            <li key={label} className="flex items-center gap-2 text-fg-muted">
              <Check size={13} className="text-positive" />
              <span className="num text-fg">{n}</span> {label}
            </li>
          ))}
        </ul>
        {conflicts.length > 0 && (
          <div className="rounded-sm border border-[rgb(217_164_65/0.35)] bg-warning-muted px-3 py-2.5 text-xs">
            <p className="mb-1.5 font-medium text-warning">
              {conflicts.length} change{conflicts.length === 1 ? '' : 's'} can’t be applied safely
            </p>
            <p className="mb-2 text-fg-muted">
              Your schedule was edited after this scenario was created. These items are skipped so your newer edits aren’t overwritten:
            </p>
            <ul className="flex max-h-32 flex-col gap-1 overflow-y-auto">
              {conflicts.map((x) => {
                const t = x.kind === 'task' ? taskMap.get(x.id) : undefined;
                return (
                  <li key={x.kind + x.id} className="text-fg-muted">
                    · {t ? `${taskRef(t.seq)} ${t.title}` : 'A scheduled block'} — {x.reason}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  );
}
