import { useMemo } from 'react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router';
import { ArrowRight, CheckCheck, FolderKanban, ListOrdered, ListPlus, MoreHorizontal, Radar } from 'lucide-react';
import { useUI } from '@/app/store';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { taskRef } from '@/domain/constants';
import { dueLabel } from '@/domain/dates';
import { RISK_ORDER, type TaskRisk } from '@/domain/risk';
import { categoryStats, type WorkloadSummary } from '@/domain/stats';
import type { Category, ID, Task } from '@/domain/types';
import { Meter, Panel, PanelHeader, Stat } from '@/ui/Data';
import { Button, IconButton } from '@/ui/Button';
import { EmptyState, Skeleton, TaskCheckbox } from '@/ui/Feedback';
import { Tooltip } from '@/ui/Tooltip';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/ui/Menu';
import { useTaskView } from '@/features/tasks/viewStore';
import { taskActions } from '@/features/tasks/actions';
import { CategorySwatch, DifficultyDots, DueCell, PriorityIcon, SlackLabel } from '@/features/tasks/TaskMeta';
import { useTerms } from '@/hooks/data';

export interface WorkspaceProps {
  tasks: Task[];
  categories: Category[];
  categoryMap: Map<ID, Category>;
  risk: Map<ID, TaskRisk>;
  now: number;
  loading: boolean;
}

function RowsSkeleton({ rows, height = 'h-12' }: { rows: number; height?: string }) {
  return (
    <div className="flex flex-col py-1" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={cn('flex items-center gap-3 px-3.5', height)}>
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3" style={{ width: `${55 + ((i * 29) % 35)}%` }} />
            <Skeleton className="h-2 w-24" />
          </div>
          <Skeleton className="h-2.5 w-10" />
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* KPI strip                                                                  */
/* -------------------------------------------------------------------------- */

export function KpiStrip({ summary, loading }: { summary: WorkloadSummary; loading: boolean }) {
  const s = summary;
  const util = Number.isFinite(s.utilization7d) ? Math.round(s.utilization7d * 100) : null;
  const trouble = s.overdueCount + s.lateCount;

  const cells = [
    {
      label: 'Open work',
      value: formatDuration(s.openMinutes, { compact: true }),
      unit: `${s.openCount} tasks`,
      sub: <span className="text-xs text-fg-subtle">{s.inProgressCount} in progress</span>,
    },
    {
      label: 'Due in 7 days',
      value: String(s.dueSoonCount),
      unit: s.dueSoonCount === 1 ? 'task' : 'tasks',
      sub: <span className="num text-xs text-fg-subtle">{formatDuration(s.dueSoonMinutes)} of work</span>,
    },
    {
      label: 'Projected late',
      value: String(trouble),
      unit: trouble === 1 ? 'task' : 'tasks',
      sub:
        trouble > 0 ? (
          <span className="text-xs text-negative">
            {s.overdueCount} overdue · {s.lateCount} can’t fit
          </span>
        ) : s.atRiskCount > 0 ? (
          <span className="text-xs text-warning">{s.atRiskCount} at risk</span>
        ) : (
          <span className="text-xs text-positive">All deadlines reachable</span>
        ),
    },
    {
      label: '7-day load',
      value: util === null ? '—' : String(util),
      unit: util === null ? undefined : '%',
      sub: (
        <div className="flex items-center gap-2">
          <Meter
            value={s.dueSoonMinutes}
            max={Math.max(s.capacity7d, 1)}
            height={3}
            className="w-16"
            color={util !== null && util > 100 ? 'var(--color-negative)' : undefined}
          />
          <span className="num text-xs text-fg-subtle">of {formatDuration(s.capacity7d, { compact: true })}</span>
        </div>
      ),
    },
    {
      label: 'Done this week',
      value: String(s.completedThisWeek),
      unit: s.completedThisWeek === 1 ? 'task' : 'tasks',
      sub: <span className="num text-xs text-positive">{formatDuration(s.completedThisWeekMinutes)} shipped</span>,
    },
  ];

  return (
    <section aria-label="Key metrics" className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line lg:grid-cols-5">
      {cells.map((c, i) => (
        <div key={c.label} className={cn('bg-panel px-4 py-3.5', i === cells.length - 1 && 'col-span-2 lg:col-span-1')}>
          {loading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="h-6 w-16" />
              <Skeleton className="h-2.5 w-24" />
            </div>
          ) : (
            <Stat label={c.label} value={c.value} unit={c.unit} sub={c.sub} />
          )}
        </div>
      ))}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Deadline risk                                                              */
/* -------------------------------------------------------------------------- */

const SLACK_RANGE = 360;

function SlackBar({ risk }: { risk: TaskRisk }) {
  const ratio = risk.level === 'overdue' ? -1 : Math.max(-1, Math.min(1, risk.slack / SLACK_RANGE));
  const tone =
    risk.level === 'overdue' || risk.level === 'late'
      ? 'var(--color-negative)'
      : risk.level === 'at_risk'
        ? 'var(--color-warning)'
        : 'var(--color-positive)';
  return (
    <div className="relative h-1 w-20 rounded-full bg-[rgb(255_255_255/0.05)]">
      <div className="absolute inset-y-[-2px] left-1/2 w-px bg-line-strong" />
      <div
        className="absolute inset-y-0 rounded-full transition-all duration-300"
        style={{ background: tone, left: ratio < 0 ? `${50 + ratio * 50}%` : '50%', width: `${Math.max(Math.abs(ratio) * 50, 2)}%` }}
      />
    </div>
  );
}

export function DeadlineRadar({ tasks, categoryMap, risk, now, loading }: WorkspaceProps) {
  const openEdit = useUI((s) => s.openEdit);
  const navigate = useNavigate();
  const list = useMemo(
    () =>
      tasks
        .filter((t) => risk.has(t.id))
        .sort((a, b) => {
          const ra = risk.get(a.id)!;
          const rb = risk.get(b.id)!;
          return RISK_ORDER[ra.level] - RISK_ORDER[rb.level] || ra.slack - rb.slack;
        }),
    [tasks, risk],
  );
  const flagged = list.filter((t) => risk.get(t.id)!.level !== 'on_track').length;

  return (
    <Panel>
      <PanelHeader
        title="Deadline risk"
        icon={Radar}
        meta={loading ? undefined : flagged ? `${flagged} need attention` : 'Lowest slack first'}
        actions={
          <Menu>
            <MenuTrigger asChild>
              <IconButton icon={MoreHorizontal} label="Deadline risk options" size="sm" />
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem
                onSelect={() => {
                  useTaskView.getState().setSort({ key: 'risk', dir: 'asc' });
                  useTaskView.getState().setFilter({ status: 'open' });
                  navigate('/tasks');
                }}
              >
                View all by risk
              </MenuItem>
              <MenuItem onSelect={() => navigate('/simulator')}>Open in Simulator</MenuItem>
            </MenuContent>
          </Menu>
        }
      />
      {loading ? (
        <RowsSkeleton rows={6} />
      ) : list.length === 0 ? (
        <EmptyState compact icon={CheckCheck} title="No open deadlines" description="Tasks you add will be ranked here by schedule risk." />
      ) : (
        <ul className="flex flex-col py-1">
          {list.slice(0, 6).map((t) => {
            const r = risk.get(t.id)!;
            return (
              <li key={t.id}>
                <button
                  onClick={() => openEdit(t.id)}
                  className="focus-ring flex h-12 w-full items-center gap-3 px-3.5 text-left transition-colors hover:bg-hover"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm text-fg">{t.title}</span>
                    <span className="flex items-center gap-1.5 text-2xs text-fg-subtle">
                      <CategorySwatch category={categoryMap.get(t.categoryId)} className="size-1.5" />
                      <span className="num">{taskRef(t.seq)}</span>
                      <span className="text-fg-faint">·</span>
                      <span>Due {dueLabel(t.deadline, now, { withTime: true })}</span>
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <SlackLabel risk={r} />
                    <SlackBar risk={r} />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-auto flex items-center justify-between border-t border-line px-3.5 py-2 text-2xs text-fg-subtle">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-negative" />
            Late
          </span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-warning" />
            &lt; 2h slack
          </span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-positive" />
            On track
          </span>
        </span>
        {!loading && <span className="num">{list.length} open</span>}
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Categories                                                                 */
/* -------------------------------------------------------------------------- */

export function CategoriesPanel({ tasks, categories, risk, loading }: WorkspaceProps) {
  const terms = useTerms();
  const navigate = useNavigate();
  const stats = useMemo(() => categoryStats(tasks, categories, risk), [tasks, categories, risk]);

  return (
    <Panel>
      <PanelHeader title={terms.many} icon={FolderKanban} meta="Remaining work · progress" />
      {loading ? (
        <RowsSkeleton rows={5} height="h-14" />
      ) : stats.length === 0 ? (
        <EmptyState compact icon={FolderKanban} title={`No ${terms.lowerMany}`} description="Create one from the task editor." />
      ) : (
        <ul className="flex flex-col py-1">
          {stats.map((s) => {
            const total = s.openMinutes + s.doneMinutes;
            return (
              <li key={s.category.id}>
                <button
                  onClick={() => navigate(`/tasks?category=${s.category.id}`)}
                  className="focus-ring flex w-full flex-col gap-2 px-3.5 py-2.5 text-left transition-colors hover:bg-hover"
                >
                  <div className="flex w-full items-center gap-2">
                    <CategorySwatch category={s.category} />
                    <span className="min-w-0 flex-1 truncate text-sm">{s.category.name}</span>
                    {s.troubleCount > 0 ? (
                      <span className="num shrink-0 text-xs text-negative">{s.troubleCount} late</span>
                    ) : s.openCount === 0 ? (
                      <span className="shrink-0 text-xs text-positive">Clear</span>
                    ) : (
                      <span className="num shrink-0 text-xs text-fg-muted">{s.openCount} open</span>
                    )}
                  </div>
                  <div className="flex w-full items-center gap-3 pl-4">
                    <Meter value={s.doneMinutes} max={Math.max(total, 1)} height={3} color="var(--color-fg-muted)" className="flex-1" />
                    <span className="num shrink-0 whitespace-nowrap text-right text-2xs text-fg-subtle">
                      {formatDuration(s.openMinutes, { compact: true })} left
                      {s.nextDeadline ? ` · next ${format(s.nextDeadline, 'MMM d')}` : ''}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Queue                                                                      */
/* -------------------------------------------------------------------------- */

export function QueuePanel({ tasks, categoryMap, risk, now, loading }: WorkspaceProps) {
  const navigate = useNavigate();
  const openEdit = useUI((s) => s.openEdit);
  const openCreate = useUI((s) => s.openCreate);
  // Earliest-deadline-first is the order the engine will work through (Phase 2).
  const queue = useMemo(
    () =>
      tasks
        .filter((t) => t.status !== 'done')
        .sort((a, b) => a.deadline - b.deadline || a.priority - b.priority)
        .slice(0, 7),
    [tasks],
  );

  return (
    <Panel>
      <PanelHeader
        title="Queue"
        icon={ListOrdered}
        meta="Earliest deadline first"
        actions={
          <Button size="sm" variant="ghost" trailing={<ArrowRight size={12} />} onClick={() => navigate('/tasks')}>
            All tasks
          </Button>
        }
      />
      {loading ? (
        <RowsSkeleton rows={6} height="h-10" />
      ) : queue.length === 0 ? (
        <EmptyState
          compact
          icon={ListPlus}
          title="Queue is empty"
          description="Add a task to see it here."
          actions={
            <Button size="sm" onClick={() => openCreate()}>
              New task
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="h-8 border-b border-line text-left">
                <th className="w-8 pl-3.5" aria-label="Complete" />
                <th className="w-6" aria-label="Priority" />
                <th className="eyebrow font-medium">Task</th>
                <th className="eyebrow hidden w-[52px] font-medium md:table-cell">Diff.</th>
                <th className="eyebrow w-[60px] pr-4 text-right font-medium">Est.</th>
                <th className="eyebrow w-[64px] pr-4 text-right font-medium">Slack</th>
                <th className="eyebrow w-[84px] pr-3.5 text-right font-medium">Due</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((t) => {
                const c = categoryMap.get(t.categoryId);
                return (
                  <tr
                    key={t.id}
                    onClick={() => openEdit(t.id)}
                    className="h-10 cursor-default border-b border-line transition-colors last:border-0 hover:bg-hover"
                  >
                    <td className="pl-3.5">
                      <TaskCheckbox
                        checked={false}
                        inProgress={t.status === 'in_progress'}
                        onToggle={() => taskActions.toggleComplete(t.id)}
                        label={`Complete ${t.title}`}
                      />
                    </td>
                    <td>
                      <PriorityIcon priority={t.priority} />
                    </td>
                    <td className="max-w-0 pr-4">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="num w-[44px] shrink-0 text-2xs text-fg-subtle">{taskRef(t.seq)}</span>
                        <span className="truncate text-fg">{t.title}</span>
                        <Tooltip content={c?.name ?? 'Uncategorized'}>
                          <span className="hidden shrink-0 lg:inline-flex">
                            <CategorySwatch category={c} />
                          </span>
                        </Tooltip>
                      </div>
                    </td>
                    <td className="hidden md:table-cell">
                      <DifficultyDots difficulty={t.difficulty} />
                    </td>
                    <td className="num pr-4 text-right text-xs text-fg-muted">{formatDuration(t.estimate, { compact: true })}</td>
                    <td className="pr-4 text-right">
                      <SlackLabel risk={risk.get(t.id)} />
                    </td>
                    <td className="pr-3.5 text-right">
                      <DueCell task={t} risk={risk.get(t.id)} now={now} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
