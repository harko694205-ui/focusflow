import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { CheckCheck, Database, ListChecks, Plus, SearchX } from 'lucide-react';
import { isModalOpen, useUI } from '@/app/store';
import { formatDuration } from '@/lib/format';
import { useHotkeys } from '@/lib/hotkeys';
import { activeFilterCount, filterTasks, groupTasks, sortTasks } from '@/domain/query';
import { dueBucket } from '@/domain/dates';
import type { ID, Priority } from '@/domain/types';
import { useWorkspace, useActiveTimer } from '@/hooks/data';
import { trackingActions } from '@/features/tracking/actions';
import { openDependencies } from '@/domain/dependencies';
import { taskRef } from '@/domain/constants';
import { Button } from '@/ui/Button';
import { Panel } from '@/ui/Data';
import { EmptyState } from '@/ui/Feedback';
import { Kbd } from '@/ui/Kbd';
import { taskActions } from '@/features/tasks/actions';
import { useTaskView } from '@/features/tasks/viewStore';
import { TaskToolbar } from '@/features/tasks/TaskToolbar';
import { TaskList, TaskListHeader, TaskListSkeleton } from '@/features/tasks/TaskList';
import { Page, PageHeader } from './PageHeader';

export function TasksPage() {
  const { tasks, categories, categoryMap, risk, schedule, now, loading } = useWorkspace();
  // Open tasks still waiting on unfinished dependencies → "FF-3, FF-7".
  const waiting = useMemo(() => {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const m = new Map<ID, string>();
    for (const t of tasks) {
      if (t.status === 'done') continue;
      const open = openDependencies(t, byId);
      if (open.length) m.set(t.id, open.map((d) => taskRef(byId.get(d)!.seq)).join(', '));
    }
    return m;
  }, [tasks]);
  const { filter, sort, group, setFilter, clearFacets } = useTaskView();
  const timer = useActiveTimer();
  const openCreate = useUI((s) => s.openCreate);
  const openEdit = useUI((s) => s.openEdit);
  const [selectedId, setSelectedId] = useState<ID | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [params, setParams] = useSearchParams();

  // Deep link from the sidebar: /tasks?category=<id>
  useEffect(() => {
    const cat = params.get('category');
    if (cat) {
      setFilter({ categories: [cat], status: 'open' });
      setParams({}, { replace: true });
    }
  }, [params, setFilter, setParams]);

  const visible = useMemo(() => sortTasks(filterTasks(tasks, filter, now), sort, risk), [tasks, filter, now, sort, risk]);
  const groups = useMemo(() => groupTasks(visible, group, categories, now), [visible, group, categories, now]);
  const flat = useMemo(() => groups.flatMap((g) => g.tasks), [groups]);

  const counts = useMemo(() => {
    const done = tasks.filter((t) => t.status === 'done').length;
    return { open: tasks.length - done, done, all: tasks.length };
  }, [tasks]);

  const openWork = tasks.filter((t) => t.status !== 'done');
  const openMinutes = openWork.reduce((a, t) => a + t.estimate, 0);
  const dueSoon = openWork.filter((t) => ['overdue', 'today', 'tomorrow', 'this_week'].includes(dueBucket(t.deadline, now))).length;
  const late = openWork.filter((t) => ['late', 'overdue'].includes(risk.get(t.id)?.level ?? '')).length;

  // Keep selection valid as the list changes. A freshly created/duplicated task can be selected
  // before the live query delivers it, so only drop a selection that was visible and then vanished.
  const seenSelected = useRef(false);
  useEffect(() => {
    seenSelected.current = false; // new selection: not yet confirmed visible (runs before the check below)
  }, [selectedId]);
  useEffect(() => {
    const present = !!selectedId && flat.some((t) => t.id === selectedId);
    if (present) seenSelected.current = true;
    else if (selectedId && seenSelected.current) {
      seenSelected.current = false;
      setSelectedId(null);
    }
  }, [flat, selectedId]);

  // Scroll the selected row into view.
  useEffect(() => {
    if (selectedId) document.querySelector(`[data-task-id="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const index = selectedId ? flat.findIndex((t) => t.id === selectedId) : -1;
  const move = (delta: number) => {
    if (!flat.length) return;
    const next = index === -1 ? (delta > 0 ? 0 : flat.length - 1) : Math.min(flat.length - 1, Math.max(0, index + delta));
    setSelectedId(flat[next].id);
  };
  /** After an action that may remove the row from view, select its neighbour. */
  const neighbour = () => (index >= 0 ? (flat[index + 1] ?? flat[index - 1])?.id ?? null : null);

  const withSelected = (fn: (id: ID) => void) => () => {
    if (selectedId) fn(selectedId);
  };

  useHotkeys(
    {
      j: () => move(1),
      arrowdown: () => move(1),
      k: () => move(-1),
      arrowup: () => move(-1),
      home: () => flat.length && setSelectedId(flat[0].id),
      end: () => flat.length && setSelectedId(flat[flat.length - 1].id),
      enter: withSelected(openEdit),
      e: withSelected(openEdit),
      s: withSelected((id) => void trackingActions.toggle(id)),
      x: withSelected((id) => {
        const willHide = filter.status !== 'all';
        if (willHide) setSelectedId(neighbour());
        void taskActions.toggleComplete(id);
      }),
      'mod+d': withSelected(async (id) => {
        const copy = await taskActions.duplicate(id);
        if (copy) setSelectedId(copy.id);
      }),
      delete: withSelected((id) => {
        setSelectedId(neighbour());
        void taskActions.remove([id]);
      }),
      backspace: withSelected((id) => {
        setSelectedId(neighbour());
        void taskActions.remove([id]);
      }),
      ...Object.fromEntries(
        ([0, 1, 2, 3] as Priority[]).map((p) => [String(p + 1), withSelected((id) => void taskActions.setPriority(id, p))]),
      ),
      '/': () => searchRef.current?.focus(),
      escape: () => setSelectedId(null),
    },
    () => !isModalOpen(),
  );

  const facetCount = activeFilterCount(filter);
  const filtered = facetCount > 0 || filter.search.trim() !== '';
  const createDefaults = filter.categories.length === 1 ? { categoryId: filter.categories[0] } : undefined;

  let body: React.ReactNode;
  if (loading) {
    body = <TaskListSkeleton />;
  } else if (tasks.length === 0) {
    body = (
      <EmptyState
        icon={ListChecks}
        title="No tasks yet"
        description="Capture what's on your plate — each task's estimate and deadline feed the timeline, risk and simulator."
        actions={
          <>
            <Button variant="primary" icon={Plus} onClick={() => openCreate()} trailing={<Kbd keys={['C']} className="ml-1" />}>
              Create task
            </Button>
            <Button icon={Database} onClick={() => taskActions.loadDemo()}>
              Load demo workspace
            </Button>
          </>
        }
      />
    );
  } else if (visible.length === 0 && filtered) {
    body = (
      <EmptyState
        icon={SearchX}
        title="No tasks match"
        description={filter.search ? `Nothing matches “${filter.search}” with the current filters.` : 'Try removing a filter.'}
        actions={
          <Button
            onClick={() => {
              clearFacets();
              setFilter({ search: '' });
            }}
          >
            Clear search & filters
          </Button>
        }
      />
    );
  } else if (visible.length === 0) {
    body =
      filter.status === 'done' ? (
        <EmptyState icon={CheckCheck} title="Nothing completed yet" description="Completed tasks will collect here." />
      ) : (
        <EmptyState
          icon={CheckCheck}
          title="All clear"
          description="Every task is done. Enjoy the slack — or plan what's next."
          actions={
            <Button icon={Plus} onClick={() => openCreate(createDefaults)}>
              New task
            </Button>
          }
        />
      );
  } else {
    body = (
      <>
        <TaskListHeader />
        <TaskList
          groups={groups}
          categoryMap={categoryMap}
          risk={risk}
          schedule={schedule}
          now={now}
          waiting={waiting}
          timingId={timer?.taskId ?? null}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onOpen={openEdit}
          showGroupHeaders={group !== 'none'}
        />
      </>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Tasks"
        meta={
          loading ? (
            <span>Loading…</span>
          ) : (
            <>
              <span>
                <span className="num text-fg-muted">{counts.open}</span> open
              </span>
              <span className="text-fg-faint">·</span>
              <span>
                <span className="num text-fg-muted">{formatDuration(openMinutes, { compact: true })}</span> of work
              </span>
              <span className="text-fg-faint">·</span>
              <span>
                <span className="num text-fg-muted">{dueSoon}</span> due within 7 days
              </span>
              {late > 0 && (
                <>
                  <span className="text-fg-faint">·</span>
                  <span className="text-negative">
                    <span className="num">{late}</span> projected late
                  </span>
                </>
              )}
            </>
          )
        }
        actions={
          <Button variant="primary" icon={Plus} onClick={() => openCreate(createDefaults)}>
            New task
          </Button>
        }
      />

      <div className="flex flex-col gap-3">
        <TaskToolbar ref={searchRef} categories={categories} counts={counts} />
        <Panel className="overflow-hidden">
          {body}
          {!loading && visible.length > 0 && (
            <div className="flex items-center justify-between px-4 py-2 text-2xs text-fg-subtle">
              <span className="num">
                {visible.length} {visible.length === 1 ? 'task' : 'tasks'} ·{' '}
                {formatDuration(visible.reduce((a, t) => a + t.estimate, 0), { compact: true })}
              </span>
              <span className="hidden items-center gap-3 sm:flex">
                <span className="flex items-center gap-1">
                  <Kbd keys={['J']} />
                  <Kbd keys={['K']} /> move
                </span>
                <span className="flex items-center gap-1">
                  <Kbd keys={['X']} /> complete
                </span>
                <span className="flex items-center gap-1">
                  <Kbd keys={['E']} /> edit
                </span>
                <span className="flex items-center gap-1">
                  <Kbd keys={['?']} /> all shortcuts
                </span>
              </span>
            </div>
          )}
        </Panel>
      </div>
    </Page>
  );
}
