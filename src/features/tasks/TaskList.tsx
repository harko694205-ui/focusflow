import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import type { TaskGroup } from '@/domain/query';
import type { TaskRisk } from '@/domain/risk';
import type { TaskSchedule } from '@/domain/schedule';
import type { Category, ID } from '@/domain/types';
import { Skeleton } from '@/ui/Feedback';
import { TASK_GRID, TaskRow } from './TaskRow';
import { CategorySwatch } from './TaskMeta';

interface TaskListProps {
  groups: TaskGroup[];
  categoryMap: Map<ID, Category>;
  risk: Map<ID, TaskRisk>;
  schedule: Map<ID, TaskSchedule>;
  now: number;
  selectedId: ID | null;
  onSelect: (id: ID) => void;
  onOpen: (id: ID) => void;
  showGroupHeaders: boolean;
}

export function TaskListHeader() {
  return (
    <div className={cn(TASK_GRID, 'sticky top-0 z-10 h-8 border-b border-line bg-panel px-4')} role="row">
      <span />
      <span />
      <span className="eyebrow hidden md:block">ID</span>
      <span className="eyebrow">Task</span>
      <span className="eyebrow hidden md:block">Category</span>
      <span className="eyebrow hidden lg:block">Diff.</span>
      <span className="eyebrow text-right">Est.</span>
      <span className="eyebrow text-right">Due</span>
      <span />
    </div>
  );
}

export function TaskList({ groups, categoryMap, risk, schedule, now, selectedId, onSelect, onOpen, showGroupHeaders }: TaskListProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <div role="grid" aria-label="Tasks">
      {groups.map((g) => {
        const isCollapsed = collapsed.has(g.key);
        const total = g.tasks.reduce((a, t) => a + t.estimate, 0);
        return (
          <div key={g.key} role="rowgroup">
            {showGroupHeaders && (
              <button
                type="button"
                onClick={() => toggle(g.key)}
                aria-expanded={!isCollapsed}
                className="focus-ring flex h-8 w-full items-center gap-2 border-b border-line bg-[rgb(255_255_255/0.015)] px-4 text-left transition-colors hover:bg-hover"
              >
                <ChevronRight
                  size={12}
                  className={cn('text-fg-subtle transition-transform duration-150', !isCollapsed && 'rotate-90')}
                />
                {g.categoryId && <CategorySwatch category={categoryMap.get(g.categoryId)} />}
                <span className={cn('text-xs font-medium', g.key === 'overdue' ? 'text-negative' : 'text-fg')}>{g.label}</span>
                <span className="num text-2xs text-fg-subtle">{g.tasks.length}</span>
                <span className="num ml-auto text-2xs text-fg-subtle">{formatDuration(total, { compact: true })}</span>
              </button>
            )}
            {!isCollapsed && (
              <AnimatePresence initial={false}>
                {g.tasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    category={categoryMap.get(t.categoryId)}
                    risk={risk.get(t.id)}
                    scheduled={schedule.get(t.id)}
                    now={now}
                    selected={t.id === selectedId}
                    onSelect={() => onSelect(t.id)}
                    onOpen={() => onOpen(t.id)}
                  />
                ))}
              </AnimatePresence>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function TaskListSkeleton({ rows = 9 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading tasks">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={cn(TASK_GRID, 'h-9 border-b border-line px-4')}>
          <Skeleton className="size-4 rounded-full" />
          <Skeleton className="size-3.5" />
          <Skeleton className="hidden h-2.5 w-10 md:block" />
          <Skeleton className="h-3" style={{ width: `${45 + ((i * 37) % 40)}%` }} />
          <Skeleton className="hidden h-2.5 w-20 md:block" />
          <Skeleton className="hidden h-2 w-6 lg:block" />
          <Skeleton className="ml-auto h-2.5 w-8" />
          <Skeleton className="ml-auto h-2.5 w-12" />
          <span />
        </div>
      ))}
    </div>
  );
}
