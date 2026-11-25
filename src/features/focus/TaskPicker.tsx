import { useMemo, useState } from 'react';
import { ArrowRight, Crosshair, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { taskRef } from '@/domain/constants';
import { dueLabel } from '@/domain/dates';
import { openDependencies } from '@/domain/dependencies';
import { RISK_ORDER } from '@/domain/risk';
import type { ID, Task } from '@/domain/types';
import { formatDuration } from '@/lib/format';
import { useFocusSettings, useSessions, useWorkspace } from '@/hooks/data';
import { CategorySwatch } from '@/features/tasks/TaskMeta';
import { Skeleton } from '@/ui/Feedback';
import { Kbd } from '@/ui/Kbd';
import { PresetControl } from './FocusSettingsMenu';
import { focusActions } from './actions';

/** "What will you focus on?" — open tasks, the most pressing first. */
export function TaskPicker() {
  const ws = useWorkspace();
  const sessions = useSessions();
  const settings = useFocusSettings();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);

  const tracked = useMemo(() => {
    const m = new Map<ID, number>();
    for (const s of sessions ?? []) m.set(s.taskId, (m.get(s.taskId) ?? 0) + (s.end - s.start) / 60_000);
    return m;
  }, [sessions]);

  const candidates = useMemo(() => {
    const byId = new Map(ws.tasks.map((t) => [t.id, t]));
    const rank = (t: Task) => [
      t.status === 'in_progress' ? 0 : 1,
      openDependencies(t, byId).length ? 1 : 0, // waiting on other work: later
      RISK_ORDER[ws.risk.get(t.id)?.level ?? 'on_track'],
      t.priority,
      t.deadline,
    ];
    const cmp = (a: Task, b: Task) => {
      const ra = rank(a);
      const rb = rank(b);
      for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
      return 0;
    };
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return ws.tasks
      .filter((t) => t.status !== 'done')
      .filter((t) => words.every((w) => `${t.title} ${taskRef(t.seq)}`.toLowerCase().includes(w)))
      .sort(cmp)
      .slice(0, query ? 12 : 7)
      .map((t) => ({ task: t, waiting: openDependencies(t, byId).length > 0 }));
  }, [ws.tasks, ws.risk, query]);

  const sel = Math.min(index, candidates.length - 1);
  const start = (id: ID) => void focusActions.start(id);

  return (
    <div className="flex w-full max-w-[560px] flex-col gap-5">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="grid size-10 place-items-center rounded-full border border-line-strong bg-panel text-accent">
          <Crosshair size={18} />
        </span>
        <h1 className="text-xl font-semibold tracking-tight text-fg">What will you focus on?</h1>
        <p className="text-sm text-fg-subtle">One task, a timer, and nothing else. Time you spend in focus is recorded on the task.</p>
      </div>

      <div className="overflow-hidden rounded-md border border-line bg-panel">
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search size={13} className="text-fg-subtle" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(candidates.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter' && candidates[sel]) {
                e.preventDefault();
                start(candidates[sel].task.id);
              }
            }}
            placeholder="Search open tasks…"
            aria-label="Search open tasks"
            className="h-10 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
          />
          <Kbd keys={['↵']} />
        </div>
        {ws.loading ? (
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        ) : candidates.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-fg-subtle">{query ? 'No open task matches.' : 'No open tasks — create one first.'}</p>
        ) : (
          <ul role="listbox" aria-label="Open tasks" className="py-1">
            {candidates.map(({ task: t, waiting }, i) => {
              const left = Math.max(0, t.estimate - (tracked.get(t.id) ?? 0));
              return (
                <li key={t.id} role="option" aria-selected={i === sel}>
                  <button
                    type="button"
                    onClick={() => start(t.id)}
                    onMouseEnter={() => setIndex(i)}
                    className={cn('group flex h-10 w-full items-center gap-2.5 px-3 text-left', i === sel && 'bg-hover')}
                  >
                    <CategorySwatch category={ws.categoryMap.get(t.categoryId)} />
                    <span className="num w-12 shrink-0 text-2xs text-fg-subtle">{taskRef(t.seq)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">{t.title}</span>
                    {t.status === 'in_progress' && <span className="shrink-0 text-2xs text-accent">In progress</span>}
                    {waiting && <span className="shrink-0 text-2xs text-warning">Waiting</span>}
                    <span className="num hidden w-[76px] shrink-0 whitespace-nowrap text-right text-xs text-fg-subtle sm:inline">{formatDuration(left, { compact: true })} left</span>
                    <span className="num w-16 shrink-0 whitespace-nowrap text-right text-xs text-fg-muted">{dueLabel(t.deadline, ws.now)}</span>
                    <ArrowRight size={13} className={cn('shrink-0 text-fg-subtle', i === sel ? 'opacity-100' : 'opacity-0')} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {settings && (
        <div className="flex items-center justify-center gap-3 text-xs text-fg-subtle">
          <span>Focus / break minutes</span>
          <PresetControl settings={settings} />
        </div>
      )}
    </div>
  );
}
