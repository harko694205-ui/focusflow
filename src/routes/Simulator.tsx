import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { addDays, format, startOfWeek } from 'date-fns';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  CalendarX2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  GitBranch,
  PenLine,
  RefreshCw,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import { isModalOpen } from '@/app/store';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { useHotkeys } from '@/lib/hotkeys';
import { computeRisk } from '@/domain/risk';
import { atMinute, clamp, DAY_MINUTES, endMinuteOfDay, minuteOfDay, scheduleByTask, SNAP, startOfLocalDay } from '@/domain/schedule';
import type { ID, Task, TimeBlock } from '@/domain/types';
import { planApply, type ScenarioOp } from '@/engine';
import { useNow, useWorkspace } from '@/hooks/data';
import { Button, IconButton } from '@/ui/Button';
import { SegmentedControl } from '@/ui/Data';
import { EmptyState, Skeleton } from '@/ui/Feedback';
import { Tooltip } from '@/ui/Tooltip';
import { Kbd } from '@/ui/Kbd';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/ui/Menu';
import { categoryColor } from '@/features/tasks/TaskMeta';
import { CreateCard, type CardPlacement } from '@/features/timeline/Cards';
import { DragChip, Tray } from '@/features/timeline/Tray';
import { useDragController } from '@/features/timeline/useDragController';
import { PX_PER_MIN, useTimeline, type DragState } from '@/features/timeline/store';
import { scenarioActions } from '@/features/simulator/actions';
import { scenarioLateDelta, useScenarioModel, useScenarios } from '@/features/simulator/model';
import { useSim, type SidePanel } from '@/features/simulator/store';
import { SimCalendar } from '@/features/simulator/SimCalendar';
import { ApplyDialog, ChangeLog, ImpactStrip, LoadCompareChart, RiskChanges, ScenarioBlockCard, ScenarioRail } from '@/features/simulator/Panels';

/* -------------------------------------------------------------------------- */
/* Presets                                                                    */
/* -------------------------------------------------------------------------- */

function thisWeek(now: number) {
  return startOfWeek(now, { weekStartsOn: 1 }).getTime();
}

function presets(now: number) {
  const week = thisWeek(now);
  const friday = addDays(week, 4).getTime();
  return [
    {
      key: 'autoplan',
      icon: Sparkles,
      title: 'Auto-plan the next two weeks',
      description: 'Fill free working time with everything not yet scheduled, earliest deadline first.',
      name: 'Auto-plan · next 2 weeks',
      ops: [{ type: 'autoplan', from: startOfLocalDay(now).getTime(), days: 14, strategy: 'deadline', now } as ScenarioOp],
    },
    {
      key: 'friday',
      icon: CalendarX2,
      title: 'What if I lose Friday?',
      description: 'Unschedule Friday’s work and re-plan it into the remaining time — see which deadlines slip.',
      name: 'Lose Friday',
      ops: [
        { type: 'clearDay', day: friday } as ScenarioOp,
        { type: 'autoplan', from: startOfLocalDay(now).getTime(), days: 14, strategy: 'deadline', now } as ScenarioOp,
      ],
    },
    {
      key: 'blank',
      icon: PenLine,
      title: 'Start from my current schedule',
      description: 'A blank copy. Drag, resize and re-estimate freely — nothing touches your real schedule until you apply.',
      name: '',
      ops: [] as ScenarioOp[],
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export function SimulatorPage() {
  const ws = useWorkspace();
  const now = useNow(30_000);
  const scenarios = useScenarios();
  const sim = useSim();
  const drag = useTimeline((s) => s.drag);

  // Pick a scenario: the remembered one if it still exists, else the newest draft.
  const scenario = useMemo(() => {
    if (!scenarios) return undefined;
    return scenarios.find((s) => s.id === sim.scenarioId) ?? scenarios.find((s) => s.status === 'draft') ?? scenarios[0];
  }, [scenarios, sim.scenarioId]);
  const readOnly = !scenario || scenario.status !== 'draft';

  const days = useMemo(() => {
    const first = startOfWeek(sim.anchor, { weekStartsOn: 1 });
    return Array.from({ length: sim.weekends ? 7 : 5 }, (_, i) => addDays(first, i));
  }, [sim.anchor, sim.weekends]);
  const range = useMemo(() => ({ from: days[0].getTime(), days: days.length }), [days]);

  const live = useMemo(() => (ws.loading ? undefined : { tasks: ws.tasks, blocks: ws.blocks }), [ws.loading, ws.tasks, ws.blocks]);
  const model = useScenarioModel(scenario, live, range, now);

  const lateDelta = useMemo(() => new Map((scenarios ?? []).filter((s) => s.status === 'draft').map((s) => [s.id, scenarioLateDelta(s, now)])), [scenarios, now]);

  /* ---- Scenario lifecycle -------------------------------------------- */

  const create = async (name: string, ops: ScenarioOp[]) => {
    const s = await scenarioActions.create(name, ops);
    if (s) sim.set({ scenarioId: s.id, selectedBlockId: null, creating: null, anchor: Date.now() });
  };
  const edit = useCallback(
    (op: ScenarioOp) => {
      if (scenario && scenario.status === 'draft') void scenarioActions.edit(scenario.id, op);
    },
    [scenario],
  );

  const [applyOpen, setApplyOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const applyPlan = useMemo(
    () => (scenario && model && live ? planApply(scenario.baseline, model.proposed, live, now) : null),
    [scenario, model, live, now],
  );

  /* ---- Drag & edit ------------------------------------------------------ */

  const scrollRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef(new Map<number, HTMLElement>());
  const register = useCallback((day: number, el: HTMLElement | null) => {
    if (el) columnsRef.current.set(day, el);
    else columnsRef.current.delete(day);
  }, []);

  const proposedBlocks = useMemo(() => new Map((model?.proposed.blocks ?? []).map((b) => [b.id, b])), [model]);
  const taskMap = model?.taskMap ?? new Map<ID, Task>();

  const onDragEnd = useCallback(
    (d: DragState) => {
      useTimeline.getState().setDrag(null);
      if (d.mode === 'move' || d.mode === 'resize-start' || d.mode === 'resize-end') {
        if (!d.moved) return useSim.getState().set({ selectedBlockId: d.blockId!, creating: null });
        if (d.day === null) return;
        const b = proposedBlocks.get(d.blockId!);
        const start = atMinute(d.day, d.start);
        const end = atMinute(d.day, d.end);
        if (b && (b.start !== start || b.end !== end)) edit({ type: 'move', blockId: b.id, start, end });
        return;
      }
      if (d.mode === 'tray') {
        if (!d.moved || d.day === null) return;
        edit({ type: 'add', block: newBlock('task', d.taskId!, '', atMinute(d.day, d.start), atMinute(d.day, d.end)) });
        return;
      }
      if (d.mode === 'create' && d.day !== null) {
        const start = d.moved ? d.start : clamp(Math.floor(d.originStart / 30) * 30, 0, DAY_MINUTES - 60);
        const end = d.moved ? d.end : start + 60;
        useSim.getState().set({ creating: { day: d.day, start, end }, selectedBlockId: null });
      }
    },
    [proposedBlocks, edit],
  );
  const begin = useDragController(columnsRef, scrollRef, onDragEnd);

  const onBlockPointerDown = useCallback(
    (block: TimeBlock, e: React.PointerEvent, mode: 'move' | 'resize-start' | 'resize-end') => {
      if (readOnly) return;
      const task = block.taskId ? taskMap.get(block.taskId) : undefined;
      const start = minuteOfDay(block.start);
      const end = endMinuteOfDay(block.start, block.end);
      const day = startOfLocalDay(block.start).getTime();
      const col = columnsRef.current.get(day);
      begin(e, {
        mode,
        blockId: block.id,
        label: block.kind === 'event' ? block.title : (task?.title ?? 'Block'),
        color: block.kind === 'event' ? 'var(--color-fg-faint)' : categoryColor(task ? ws.categoryMap.get(task.categoryId) : undefined),
        duration: end - start,
        grabOffset: col ? (e.clientY - col.getBoundingClientRect().top) / PX_PER_MIN - start : 0,
        originDay: day,
        originStart: start,
        originEnd: end,
      });
    },
    [begin, readOnly, taskMap, ws.categoryMap],
  );

  const onBackgroundPointerDown = useCallback(
    (day: number, e: React.PointerEvent) => {
      const s = useSim.getState();
      if (s.selectedBlockId || s.creating) return s.set({ selectedBlockId: null, creating: null });
      if (readOnly) return;
      const col = columnsRef.current.get(day);
      if (!col) return;
      const minute = clamp((e.clientY - col.getBoundingClientRect().top) / PX_PER_MIN, 0, DAY_MINUTES - SNAP);
      const start = Math.floor(minute / SNAP) * SNAP;
      begin(e, { mode: 'create', label: '', color: 'var(--color-accent)', duration: SNAP, grabOffset: 0, originDay: day, originStart: start, originEnd: start + SNAP });
    },
    [begin, readOnly],
  );

  const onTrayDragStart = useCallback(
    (e: React.PointerEvent, task: Task, remaining: number) => {
      if (readOnly) return;
      const duration = clamp(Math.ceil(Math.min(remaining, 240) / SNAP) * SNAP, SNAP, 240);
      begin(e, {
        mode: 'tray',
        taskId: task.id,
        label: task.title,
        color: categoryColor(ws.categoryMap.get(task.categoryId)),
        duration,
        grabOffset: 15,
        originDay: startOfLocalDay(now).getTime(),
        originStart: 0,
        originEnd: duration,
      });
    },
    [begin, readOnly, ws.categoryMap, now],
  );

  /* ---- Keyboard ------------------------------------------------------- */

  const selected = sim.selectedBlockId ? proposedBlocks.get(sim.selectedBlockId) : undefined;
  const nudge = (delta: number, mode: 'move' | 'resize' | 'day') => {
    if (!selected || readOnly) return;
    const s = minuteOfDay(selected.start);
    const e = endMinuteOfDay(selected.start, selected.end);
    let day = startOfLocalDay(selected.start).getTime();
    let ns = s;
    let ne = e;
    if (mode === 'move') {
      ns = clamp(s + delta, 0, DAY_MINUTES - (e - s));
      ne = ns + (e - s);
    } else if (mode === 'resize') ne = clamp(e + delta, s + SNAP, DAY_MINUTES);
    else day = addDays(day, delta).getTime();
    edit({ type: 'move', blockId: selected.id, start: atMinute(day, ns), end: atMinute(day, ne) });
  };

  useHotkeys(
    {
      arrowup: () => nudge(-SNAP, 'move'),
      arrowdown: () => nudge(SNAP, 'move'),
      'shift+arrowup': () => nudge(-SNAP, 'resize'),
      'shift+arrowdown': () => nudge(SNAP, 'resize'),
      arrowleft: () => (selected ? nudge(-1, 'day') : sim.set({ anchor: addDays(sim.anchor, -7).getTime() })),
      arrowright: () => (selected ? nudge(1, 'day') : sim.set({ anchor: addDays(sim.anchor, 7).getTime() })),
      delete: () => selected && !readOnly && (edit({ type: 'remove', blockId: selected.id }), sim.set({ selectedBlockId: null })),
      backspace: () => selected && !readOnly && (edit({ type: 'remove', blockId: selected.id }), sim.set({ selectedBlockId: null })),
      escape: () => sim.set({ selectedBlockId: null, creating: null }),
      v: () => sim.set({ mode: sim.mode === 'edit' ? 'compare' : 'edit' }),
    },
    () => !isModalOpen() && !useTimeline.getState().drag,
  );

  // Initial scroll to the working day; keep selection valid.
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 8 * 60 * PX_PER_MIN - 8;
  }, [sim.mode, scenario?.id]);
  useEffect(() => {
    if (sim.selectedBlockId && model && !proposedBlocks.has(sim.selectedBlockId)) sim.set({ selectedBlockId: null });
  }, [model, proposedBlocks, sim]);
  useEffect(
    () => () => {
      useSim.getState().set({ selectedBlockId: null, creating: null });
      useTimeline.getState().setDrag(null);
    },
    [],
  );

  /* ---- Derived for rendering ----------------------------------------- */

  const risk = useMemo(() => (model ? computeRisk([...model.proposed.tasks], now) : new Map()), [model, now]);
  const riskBefore = useMemo(() => (model ? computeRisk([...model.original.tasks], now) : new Map()), [model, now]);
  const proposedSchedule = useMemo(() => (model ? scheduleByTask([...model.proposed.blocks], now) : new Map()), [model, now]);
  const candidates = useMemo(
    () =>
      model
        ? [...model.proposed.tasks]
            .filter((t) => t.status !== 'done')
            .sort((a, b) => Number(a.estimate - (proposedSchedule.get(a.id)?.minutes ?? 0) <= 0) - Number(b.estimate - (proposedSchedule.get(b.id)?.minutes ?? 0) <= 0) || a.deadline - b.deadline)
        : [],
    [model, proposedSchedule],
  );
  const placementFor = (i: number): CardPlacement => (i >= days.length - 2 ? 'left' : 'right');

  /* ---- Render ------------------------------------------------------------ */

  if (scenarios === undefined || ws.loading) {
    return (
      <div className="flex h-[calc(100dvh-3rem)] gap-4 p-6">
        <Skeleton className="h-full w-60" />
        <div className="flex flex-1 flex-col gap-4">
          <Skeleton className="h-10 w-1/3" />
          <Skeleton className="h-20" />
          <Skeleton className="flex-1" />
        </div>
      </div>
    );
  }

  if (!scenario || !model) {
    return <SimulatorEmpty now={now} onCreate={create} />;
  }

  const changeCount = model.diff.counts.added + model.diff.counts.moved + model.diff.counts.resized + model.diff.counts.removed + model.diff.counts.tasks;

  return (
    <div className="flex h-[calc(100dvh-3rem)]">
      {/* Scenario rail */}
      <aside className="hidden w-60 shrink-0 border-r border-line bg-panel xl:block">
        <ScenarioRail
          scenarios={scenarios}
          activeId={scenario.id}
          lateDelta={lateDelta}
          onSelect={(id) => sim.set({ scenarioId: id, selectedBlockId: null, creating: null })}
          onNew={() => create('', [])}
          onRestore={(id) => void scenarioActions.restore(id)}
          onDelete={(id) => void scenarioActions.remove(id)}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2.5 md:px-5">
          <FlaskConical size={15} className="shrink-0 text-accent" />
          <ScenarioName key={scenario.id} name={scenario.name} readOnly={readOnly} onRename={(n) => void scenarioActions.rename(scenario.id, n)} />
          <span className="hidden text-xs text-fg-subtle md:inline">
            Forked from your schedule {format(scenario.baseline.takenAt, 'EEE MMM d, HH:mm')} ·{' '}
            <span className="num">{changeCount}</span> change{changeCount === 1 ? '' : 's'}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <NewScenarioMenu
              now={now}
              onCreate={create}
              drafts={scenarios.filter((s) => s.status === 'draft')}
              activeId={scenario.id}
              onSelect={(id) => sim.set({ scenarioId: id, selectedBlockId: null, creating: null })}
            />
            {!readOnly && (
              <>
                <Button variant="ghost" icon={Trash2} onClick={() => void scenarioActions.discard(scenario.id, scenario.name)}>
                  Discard
                </Button>
                <Tooltip content={changeCount ? 'Review and write these changes to your real schedule' : 'Make a change first'}>
                  <span>
                    <Button variant="primary" disabled={!changeCount} onClick={() => setApplyOpen(true)}>
                      Apply to schedule
                    </Button>
                  </span>
                </Tooltip>
              </>
            )}
          </div>
        </div>

        {/* Banners */}
        {scenario.status !== 'draft' && (
          <div className="flex shrink-0 items-center gap-2 border-b border-line bg-[rgb(255_255_255/0.02)] px-5 py-2 text-xs text-fg-muted">
            {scenario.status === 'applied' ? (
              <>
                <span className="size-1.5 rounded-full bg-positive" /> Applied to your schedule {scenario.appliedAt && format(scenario.appliedAt, 'MMM d, HH:mm')}. This
                scenario is read-only.
              </>
            ) : (
              <>
                <span className="size-1.5 rounded-full bg-fg-faint" /> Discarded — read-only.
              </>
            )}
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void scenarioActions.restore(scenario.id)}>
              Reopen as draft
            </Button>
          </div>
        )}
        {scenario.status === 'draft' && model.drift > 0 && (
          <div className="flex shrink-0 items-center gap-2 border-b border-line bg-warning-muted px-5 py-2 text-xs text-warning">
            <AlertTriangle size={13} />
            <span>
              Your real schedule changed since this scenario was created (<span className="num">{model.drift}</span> edit{model.drift === 1 ? '' : 's'}). Results here
              use the snapshot.
            </span>
            <Button size="sm" variant="ghost" icon={RefreshCw} className="ml-auto text-warning" onClick={() => void scenarioActions.rebase(scenario.id)}>
              Rebase on current schedule
            </Button>
          </div>
        )}

        {/* Impact */}
        <div className="shrink-0 px-4 pt-3 md:px-5">
          <ImpactStrip deltas={model.deltas} />
        </div>

        {/* Toolbar */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-2.5 md:px-5">
          <Button onClick={() => sim.set({ anchor: Date.now() })}>This week</Button>
          <IconButton icon={ChevronLeft} label="Previous week" onClick={() => sim.set({ anchor: addDays(sim.anchor, -7).getTime() })} />
          <IconButton icon={ChevronRight} label="Next week" onClick={() => sim.set({ anchor: addDays(sim.anchor, 7).getTime() })} />
          <span className="text-sm font-medium">
            {format(days[0], 'MMM d')} – {format(days[days.length - 1], 'MMM d')}
          </span>
          <SegmentedControl
            value={sim.weekends ? '7' : '5'}
            onChange={(v) => sim.set({ weekends: v === '7' })}
            options={[
              { value: '5', label: 'Mon–Fri' },
              { value: '7', label: 'Full week' },
            ]}
          />

          <div className="ml-auto flex items-center gap-2">
            {!readOnly && sim.mode === 'edit' && (
              <>
                <Menu>
                  <MenuTrigger asChild>
                    <Button icon={CalendarX2} trailing={<ChevronDown size={12} className="text-fg-subtle" />}>
                      Take day off
                    </Button>
                  </MenuTrigger>
                  <MenuContent align="end">
                    <MenuLabel>Unschedule its work and plan without it</MenuLabel>
                    {days.map((d) => (
                      <MenuItem key={d.getTime()} onSelect={() => edit({ type: 'clearDay', day: d.getTime() })}>
                        {format(d, 'EEEE, MMM d')}
                      </MenuItem>
                    ))}
                  </MenuContent>
                </Menu>
                <div className="flex">
                  <Button
                    icon={Wand2}
                    className="rounded-r-none"
                    onClick={() => edit({ type: 'autoplan', from: Math.max(days[0].getTime(), startOfLocalDay(now).getTime()), days: 14, strategy: sim.strategy, now })}
                  >
                    Auto-plan
                  </Button>
                  <Menu>
                    <MenuTrigger asChild>
                      <IconButton icon={ChevronDown} label="Auto-plan strategy" variant="secondary" className="-ml-px rounded-l-none" />
                    </MenuTrigger>
                    <MenuContent align="end">
                      <MenuLabel>Auto-plan order</MenuLabel>
                      <MenuItem onSelect={() => sim.set({ strategy: 'deadline' })}>{sim.strategy === 'deadline' ? '✓ ' : ''}Earliest deadline first</MenuItem>
                      <MenuItem onSelect={() => sim.set({ strategy: 'priority' })}>{sim.strategy === 'priority' ? '✓ ' : ''}Highest priority first</MenuItem>
                      <MenuSeparator />
                      <MenuLabel>Fills free working time over the next 14 days</MenuLabel>
                    </MenuContent>
                  </Menu>
                </div>
              </>
            )}
            <SegmentedControl
              size="md"
              value={sim.mode}
              onChange={(mode) => sim.set({ mode, selectedBlockId: null, creating: null })}
              options={[
                { value: 'edit', label: 'Edit' },
                { value: 'compare', label: 'Side by side' },
              ]}
            />
          </div>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 border-t border-line">
          <div ref={scrollRef} className="relative min-w-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={sim.mode + scenario.id + range.from}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.14 }}
                className={cn('flex', sim.mode === 'compare' ? 'min-w-[740px]' : 'min-w-[640px]')}
              >
                {sim.mode === 'edit' ? (
                  <SimCalendar
                    label={
                      <>
                        <span className="font-medium text-fg">Proposed schedule</span>
                        <span className="text-fg-subtle">· dashed outlines show where changed blocks were</span>
                        <span className="ml-auto flex items-center gap-3 text-2xs text-fg-subtle">
                          <Legend className="ring-1 ring-accent" label="Moved / resized" />
                          <Legend className="ring-1 ring-positive" label="Added" />
                          <Legend className="border border-dashed border-[rgb(229_83_75/0.55)] bg-negative-muted" label="Removed" />
                        </span>
                      </>
                    }
                    days={days}
                    state={model.proposed}
                    metrics={model.after.days}
                    categoryMap={ws.categoryMap}
                    risk={risk}
                    now={now}
                    diff={model.diff}
                    showGhosts
                    readOnly={readOnly}
                    selectedId={sim.selectedBlockId}
                    drag={drag}
                    creating={sim.creating}
                    register={register}
                    onBlockPointerDown={onBlockPointerDown}
                    onBackgroundPointerDown={onBackgroundPointerDown}
                    renderInColumn={(day, i) => (
                      <AnimatePresence>
                        {selected && startOfLocalDay(selected.start).getTime() === day && !drag?.moved && (
                          <ScenarioBlockCard
                            key={selected.id}
                            block={selected}
                            task={selected.taskId ? taskMap.get(selected.taskId) : undefined}
                            category={selected.taskId ? ws.categoryMap.get(taskMap.get(selected.taskId)?.categoryId ?? '') : undefined}
                            original={model.originalBlockMap.get(selected.id)}
                            change={model.diff.blocks.get(selected.id)}
                            placement={placementFor(i)}
                            onClose={() => sim.set({ selectedBlockId: null })}
                            onEstimate={(m) => selected.taskId && edit({ type: 'estimate', taskId: selected.taskId, estimate: m })}
                            onDeadline={(dl) => selected.taskId && edit({ type: 'deadline', taskId: selected.taskId, deadline: dl })}
                            onRevert={() => {
                              const o = model.originalBlockMap.get(selected.id);
                              if (o) edit({ type: 'move', blockId: selected.id, start: o.start, end: o.end });
                              else edit({ type: 'remove', blockId: selected.id });
                            }}
                            onRemove={() => {
                              edit({ type: 'remove', blockId: selected.id });
                              sim.set({ selectedBlockId: null });
                            }}
                          />
                        )}
                        {sim.creating && sim.creating.day === day && (
                          <CreateCard
                            key={`create-${sim.creating.start}`}
                            day={day}
                            start={sim.creating.start}
                            end={sim.creating.end}
                            placement={placementFor(i)}
                            candidates={candidates}
                            categoryMap={ws.categoryMap}
                            schedule={proposedSchedule}
                            onCancel={() => sim.set({ creating: null })}
                            onCreateEvent={(title) => {
                              const c = sim.creating!;
                              sim.set({ creating: null });
                              edit({ type: 'add', block: newBlock('event', null, title, atMinute(day, c.start), atMinute(day, c.end)) });
                            }}
                            onScheduleTask={(task) => {
                              const c = sim.creating!;
                              sim.set({ creating: null });
                              edit({ type: 'add', block: newBlock('task', task.id, '', atMinute(day, c.start), atMinute(day, c.end)) });
                            }}
                          />
                        )}
                      </AnimatePresence>
                    )}
                  />
                ) : (
                  <>
                    <SimCalendar
                      label={
                        <>
                          <span className="font-medium text-fg">Original</span>
                          <span className="text-fg-subtle">· snapshot {format(scenario.baseline.takenAt, 'MMM d, HH:mm')} · read-only</span>
                        </>
                      }
                      days={days}
                      state={model.original}
                      metrics={model.before.days}
                      categoryMap={ws.categoryMap}
                      risk={riskBefore}
                      now={now}
                      readOnly
                    />
                    <div className="w-px shrink-0 bg-line-strong" />
                    <SimCalendar
                      label={
                        <>
                          <span className="font-medium text-accent">Proposed</span>
                          <span className="text-fg-subtle">· {scenario.name}</span>
                        </>
                      }
                      days={days}
                      state={model.proposed}
                      metrics={model.after.days}
                      categoryMap={ws.categoryMap}
                      risk={risk}
                      now={now}
                      diff={model.diff}
                      readOnly
                      showGutter={false}
                    />
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Side panel */}
          <aside className={cn('hidden w-[300px] shrink-0 flex-col border-l border-line bg-panel', sim.mode === 'compare' ? 'xl:flex' : 'md:flex')}>
            <div className="shrink-0 border-b border-line p-2">
              <SegmentedControl<SidePanel>
                size="md"
                value={sim.panel}
                onChange={(panel) => sim.set({ panel })}
                options={[
                  { value: 'impact', label: 'Impact' },
                  { value: 'changes', label: `Changes ${scenario.ops.length}` },
                  { value: 'unscheduled', label: 'Unscheduled' },
                ]}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {sim.panel === 'impact' && (
                <div className="flex flex-col gap-4 p-3">
                  <section>
                    <h3 className="eyebrow mb-1 flex items-center justify-between">
                      Daily load
                      <span className="flex items-center gap-2 normal-case tracking-normal">
                        <Legend className="bg-[rgb(255_255_255/0.13)]" label="Original" />
                        <Legend className="bg-accent" label="Proposed" />
                      </span>
                    </h3>
                    <LoadCompareChart before={model.before.days} after={model.after.days} />
                    <OverloadList metrics={model.after.days} />
                  </section>
                  <section>
                    <h3 className="eyebrow mb-1">Deadline outcomes</h3>
                    <RiskChanges
                      changes={model.risks}
                      taskMap={taskMap}
                      categoryMap={ws.categoryMap}
                      onFocus={(taskId) => {
                        const b = model.proposed.blocks.filter((x) => x.taskId === taskId).sort((a, c) => a.start - c.start)[0];
                        if (b) sim.set({ anchor: b.start, selectedBlockId: sim.mode === 'edit' ? b.id : null });
                      }}
                    />
                  </section>
                </div>
              )}
              {sim.panel === 'changes' && (
                <div className="p-2">
                  <ChangeLog ops={scenario.ops} results={model.results} readOnly={readOnly} onRemove={(opId) => void scenarioActions.removeOp(scenario.id, opId)} />
                  {!readOnly && scenario.ops.length > 0 && (
                    <p className="flex items-center gap-1.5 px-2 pt-3 text-2xs text-fg-subtle">
                      <Kbd keys={['Ctrl', 'Z']} /> undoes the last change
                    </p>
                  )}
                </div>
              )}
              {sim.panel === 'unscheduled' && (
                <div className="h-full">
                  <Tray
                    tasks={[...model.proposed.tasks]}
                    categoryMap={ws.categoryMap}
                    risk={risk}
                    schedule={proposedSchedule}
                    now={now}
                    loading={false}
                    onClose={() => sim.set({ panel: 'impact' })}
                    onDragStart={onTrayDragStart}
                    onOpen={() => {}}
                  />
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>

      {applyPlan && (
        <ApplyDialog
          open={applyOpen}
          onOpenChange={setApplyOpen}
          scenario={scenario}
          diff={model.diff}
          plan={applyPlan}
          taskMap={taskMap}
          busy={applying}
          onRebase={async () => {
            setApplyOpen(false);
            await scenarioActions.rebase(scenario.id);
          }}
          onApply={async (skip) => {
            setApplying(true);
            const r = await scenarioActions.apply(scenario.id, scenario.name, { skipConflicts: skip });
            setApplying(false);
            if (r.ok) setApplyOpen(false);
          }}
        />
      )}
      <DragChip />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */

function newBlock(kind: 'task' | 'event', taskId: ID | null, title: string, start: number, end: number): TimeBlock {
  const t = Date.now();
  return { id: crypto.randomUUID(), kind, taskId, title, start, end, createdAt: t, updatedAt: t };
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn('h-2 w-3 rounded-[2px]', className)} />
      {label}
    </span>
  );
}

function OverloadList({ metrics }: { metrics: Array<{ key: string; label: string; overload: number; conflicts: number }> }) {
  const flagged = metrics.filter((m) => m.overload > 0 || m.conflicts > 0);
  if (!flagged.length) return <p className="mt-1 text-2xs text-positive">No overloaded days or overlaps in this range.</p>;
  return (
    <ul className="mt-1 flex flex-col gap-1">
      {flagged.map((m) => (
        <li key={m.key} className="flex items-center gap-2 text-2xs">
          <AlertTriangle size={11} className="shrink-0 text-negative" />
          <span className="text-fg">{m.label}</span>
          <span className="num ml-auto text-negative">
            {m.overload > 0 && `+${formatDuration(m.overload, { compact: true })} over`}
            {m.overload > 0 && m.conflicts > 0 && ' · '}
            {m.conflicts > 0 && `${m.conflicts} overlapping`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ScenarioName({ name, readOnly, onRename }: { name: string; readOnly: boolean; onRename: (n: string) => void }) {
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);
  return (
    <input
      value={value}
      readOnly={readOnly}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => value.trim() && value.trim() !== name && onRename(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setValue(name);
          e.currentTarget.blur();
        }
      }}
      aria-label="Scenario name"
      maxLength={80}
      className="min-w-0 max-w-[320px] flex-shrink rounded-xs bg-transparent px-1 text-base font-semibold tracking-[-0.01em] text-fg outline-none hover:bg-hover focus:bg-canvas focus:ring-1 focus:ring-line-focus read-only:hover:bg-transparent"
      style={{ width: `${Math.max(8, value.length + 1)}ch` }}
    />
  );
}

function NewScenarioMenu({
  now,
  onCreate,
  drafts,
  activeId,
  onSelect,
}: {
  now: number;
  onCreate: (name: string, ops: ScenarioOp[]) => void;
  drafts: Array<{ id: ID; name: string }>;
  activeId: ID;
  onSelect: (id: ID) => void;
}) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button icon={GitBranch} trailing={<ChevronDown size={12} className="text-fg-subtle" />}>
          Scenarios
        </Button>
      </MenuTrigger>
      <MenuContent align="end" className="w-72">
        {drafts.length > 1 && (
          <>
            <MenuLabel>Open draft</MenuLabel>
            {drafts.map((d) => (
              <MenuItem key={d.id} onSelect={() => onSelect(d.id)}>
                {d.id === activeId ? '✓ ' : ''}
                {d.name}
              </MenuItem>
            ))}
            <MenuSeparator />
          </>
        )}
        <MenuLabel>New — fork your current schedule</MenuLabel>
        {presets(now).map((p) => (
          <MenuItem key={p.key} icon={p.icon} onSelect={() => onCreate(p.name, p.ops)}>
            {p.title}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

function SimulatorEmpty({ now, onCreate }: { now: number; onCreate: (name: string, ops: ScenarioOp[]) => void }) {
  return (
    <div className="mx-auto flex max-w-[760px] flex-col items-center px-6 py-16">
      <EmptyState
        icon={FlaskConical}
        title="Try changes before you commit to them"
        description="A scenario is a private copy of your schedule. Move blocks, change estimates or let FocusFlow re-plan — then compare the outcome side by side and apply it only if it’s better."
      />
      <div className="mt-2 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
        {presets(now).map((p, i) => (
          <motion.button
            key={p.key}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * i, duration: 0.2 }}
            onClick={() => onCreate(p.name, p.ops)}
            className="focus-ring group flex flex-col gap-2 rounded-md border border-line bg-panel p-4 text-left transition-colors hover:border-line-strong hover:bg-raised"
          >
            <p.icon size={16} className="text-accent" />
            <span className="text-sm font-medium text-fg">{p.title}</span>
            <span className="text-xs text-fg-subtle">{p.description}</span>
          </motion.button>
        ))}
      </div>
      <p className="mt-6 text-2xs text-fg-subtle">Scenarios never change your real schedule until you press Apply.</p>
    </div>
  );
}

