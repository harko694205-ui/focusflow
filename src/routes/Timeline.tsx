import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { addDays, format, isSameMonth, isSameYear, startOfWeek } from 'date-fns';
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Flag, PanelRight, Sparkles } from 'lucide-react';
import { isModalOpen, useUI } from '@/app/store';
import { cn } from '@/lib/cn';
import { formatClock, formatDuration, minutesNow } from '@/lib/format';
import { useHotkeys } from '@/lib/hotkeys';
import { taskRef } from '@/domain/constants';
import {
  atMinute,
  blocksByDay,
  clamp,
  dayKey,
  dayLoad,
  DAY_MINUTES,
  endMinuteOfDay,
  freeIntervals,
  layoutBlocks,
  minuteOfDay,
  SNAP,
  startOfLocalDay,
  type BlockLayout,
} from '@/domain/schedule';
import type { ID, Task, TimeBlock } from '@/domain/types';
import { useNow, useWorkspace } from '@/hooks/data';
import { Button, IconButton } from '@/ui/Button';
import { SegmentedControl, Meter } from '@/ui/Data';
import { Tooltip } from '@/ui/Tooltip';
import { Kbd } from '@/ui/Kbd';
import { taskActions } from '@/features/tasks/actions';
import { categoryColor } from '@/features/tasks/TaskMeta';
import { blockActions } from '@/features/timeline/actions';
import { scenarioActions } from '@/features/simulator/actions';
import { useSim } from '@/features/simulator/store';
import { DayColumn } from '@/features/timeline/DayColumn';
import { BlockCard, CreateCard, type CardPlacement } from '@/features/timeline/Cards';
import { DragChip, Tray } from '@/features/timeline/Tray';
import { useDragController } from '@/features/timeline/useDragController';
import { GRID_HEIGHT, HOUR_PX, PX_PER_MIN, useTimeline, type DragState } from '@/features/timeline/store';

const GUTTER = 56;

function rangeLabel(days: Date[]): string {
  const a = days[0];
  const b = days[days.length - 1];
  if (days.length === 1) return format(a, 'EEEE, MMMM d, yyyy');
  if (isSameMonth(a, b)) return `${format(a, 'MMM d')} – ${format(b, 'd, yyyy')}`;
  if (isSameYear(a, b)) return `${format(a, 'MMM d')} – ${format(b, 'MMM d, yyyy')}`;
  return `${format(a, 'MMM d, yyyy')} – ${format(b, 'MMM d, yyyy')}`;
}

export function TimelinePage() {
  const ws = useWorkspace();
  const { tasks, categoryMap, risk, schedule } = ws;
  const now = useNow(30_000);
  const nowMinute = minutesNow(new Date(now));
  const todayStart = startOfLocalDay(now).getTime();

  const view = useTimeline((s) => s.view);
  const anchor = useTimeline((s) => s.anchor);
  const navDir = useTimeline((s) => s.navDir);
  const trayOpen = useTimeline((s) => s.trayOpen);
  const selectedId = useTimeline((s) => s.selectedId);
  const creating = useTimeline((s) => s.creating);
  const drag = useTimeline((s) => s.drag);
  const pending = useTimeline((s) => s.pending);
  const { setView, goTo, setTrayOpen, select, setCreating, setDrag, setPending } = useTimeline.getState();
  const openEdit = useUI((s) => s.openEdit);

  const scrollRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef(new Map<number, HTMLElement>());
  const register = useCallback((day: number, el: HTMLElement | null) => {
    if (el) columnsRef.current.set(day, el);
    else columnsRef.current.delete(day);
  }, []);

  /* ---- Visible range ---------------------------------------------------- */

  const days = useMemo(() => {
    if (view === 'day') return [startOfLocalDay(anchor)];
    const first = startOfWeek(anchor, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => addDays(first, i));
  }, [view, anchor]);
  const rangeKey = dayKey(days[0]) + view;

  const routerNavigate = useNavigate();
  // Auto-schedule never writes to the real timeline directly: it opens the plan as a scenario to review and apply.
  const autoSchedule = async () => {
    const t = Date.now();
    const s = await scenarioActions.create('Auto-schedule · next 2 weeks', [
      { type: 'autoplan', from: startOfLocalDay(t).getTime(), days: 14, strategy: 'deadline', now: t },
    ]);
    if (s) {
      useSim.getState().set({ scenarioId: s.id, selectedBlockId: null, creating: null, anchor: t, mode: 'edit' });
      routerNavigate('/simulator');
    }
  };
  const navigate = (dir: number) => goTo(addDays(anchor, dir * (view === 'week' ? 7 : 1)).getTime(), dir);
  const goToday = () => goTo(Date.now(), Math.sign(todayStart - startOfLocalDay(anchor).getTime()) || 0);

  /* ---- Data ---------------------------------------------------------------- */

  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  // Apply optimistic positions for blocks whose move is still being written.
  const effective = useMemo(
    () => ws.blocks.map((b) => (pending[b.id] ? { ...b, ...pending[b.id] } : b)),
    [ws.blocks, pending],
  );
  const blockMap = useMemo(() => new Map(effective.map((b) => [b.id, b])), [effective]);
  const byDay = useMemo(() => blocksByDay(effective), [effective]);
  const layouts = useMemo(() => {
    const m = new Map<string, Map<ID, BlockLayout>>();
    for (const d of days) m.set(dayKey(d), layoutBlocks(byDay.get(dayKey(d)) ?? []));
    return m;
  }, [days, byDay]);

  const deadlinesByDay = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      const k = dayKey(t.deadline);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    for (const list of m.values()) list.sort((a, b) => a.deadline - b.deadline);
    return m;
  }, [tasks]);

  // Clear optimistic entries once the database reflects them (or after a timeout).
  useEffect(() => {
    for (const [id, span] of Object.entries(pending)) {
      const real = ws.blocks.find((b) => b.id === id);
      if (!real || (real.start === span.start && real.end === span.end)) setPending(id, null);
    }
  }, [ws.blocks, pending, setPending]);

  /* ---- Initial scroll + deep links -------------------------------------- */

  const [params, setParams] = useSearchParams();
  const didScroll = useRef(false);
  useLayoutEffect(() => {
    if (didScroll.current || !scrollRef.current) return;
    didScroll.current = true;
    const target = Math.max(7 * 60, nowMinute - 90);
    scrollRef.current.scrollTop = target * PX_PER_MIN;
  }, [nowMinute]);

  useEffect(() => {
    const date = params.get('date');
    const block = params.get('block');
    if (!date && !block) return;
    if (date) {
      const [y, m, d] = date.split('-').map(Number);
      if (y && m && d) goTo(new Date(y, m - 1, d).getTime());
    }
    if (block) {
      const b = ws.blocks.find((x) => x.id === block);
      if (!b) {
        if (ws.loading) return; // wait for data
      } else {
        goTo(b.start);
        select(b.id);
        requestAnimationFrame(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, minuteOfDay(b.start) * PX_PER_MIN - 120);
        });
      }
    }
    setParams({}, { replace: true });
  }, [params, setParams, ws.blocks, ws.loading, goTo, select]);

  // Clear transient state when leaving the page.
  useEffect(
    () => () => {
      useTimeline.setState({ selectedId: null, creating: null, drag: null });
    },
    [],
  );

  /* ---- Drag commit -------------------------------------------------------- */

  const lastClick = useRef<{ id: ID; t: number } | null>(null);

  const onDragEnd = useCallback(
    async (d: DragState) => {
      if (d.mode === 'move' || d.mode === 'resize-start' || d.mode === 'resize-end') {
        const id = d.blockId!;
        if (!d.moved) {
          setDrag(null);
          const prev = lastClick.current;
          const t = Date.now();
          lastClick.current = { id, t };
          select(id);
          if (prev && prev.id === id && t - prev.t < 350) {
            const b = blockMap.get(id);
            if (b?.taskId) openEdit(b.taskId);
          }
          return;
        }
        if (d.day === null) return setDrag(null);
        const start = atMinute(d.day, d.start);
        const end = atMinute(d.day, d.end);
        const b = blockMap.get(id);
        setDrag(null);
        if (!b || (b.start === start && b.end === end)) return;
        setPending(id, { start, end });
        const ok = await blockActions.move(id, start, end);
        if (!ok) setPending(id, null);
        return;
      }

      if (d.mode === 'tray') {
        if (!d.moved || d.day === null) return setDrag(null);
        await blockActions.schedule(d.taskId!, atMinute(d.day, d.start), atMinute(d.day, d.end), d.label.length > 32 ? `${d.label.slice(0, 30)}…` : d.label);
        // Let the live query deliver the new block before the preview disappears (avoids a flash).
        requestAnimationFrame(() => setDrag(null));
        return;
      }

      if (d.mode === 'create') {
        setDrag(null);
        if (d.day === null) return;
        if (!d.moved) {
          const start = clamp(Math.floor(d.originStart / 30) * 30, 0, DAY_MINUTES - 60);
          setCreating({ day: d.day, start, end: start + 60 });
        } else setCreating({ day: d.day, start: d.start, end: d.end });
      }
    },
    [blockMap, openEdit, select, setCreating, setDrag, setPending],
  );

  const begin = useDragController(columnsRef, scrollRef, onDragEnd);

  const onBlockPointerDown = useCallback(
    (block: TimeBlock, e: React.PointerEvent, mode: 'move' | 'resize-start' | 'resize-end') => {
      if (useTimeline.getState().creating) setCreating(null);
      const task = block.taskId ? taskMap.get(block.taskId) : undefined;
      const start = minuteOfDay(block.start);
      const end = endMinuteOfDay(block.start, block.end);
      const col = columnsRef.current.get(startOfLocalDay(block.start).getTime());
      const grab = col ? (e.clientY - col.getBoundingClientRect().top) / PX_PER_MIN - start : 0;
      begin(e, {
        mode,
        blockId: block.id,
        label: block.kind === 'event' ? block.title : (task?.title ?? 'Block'),
        color: block.kind === 'event' ? 'var(--color-fg-faint)' : categoryColor(task ? categoryMap.get(task.categoryId) : undefined),
        duration: end - start,
        grabOffset: grab,
        originDay: startOfLocalDay(block.start).getTime(),
        originStart: start,
        originEnd: end,
      });
    },
    [begin, taskMap, categoryMap, setCreating],
  );

  const onBackgroundPointerDown = useCallback(
    (day: number, e: React.PointerEvent) => {
      const s = useTimeline.getState();
      if (s.selectedId || s.creating) {
        // First click on empty space just dismisses the open card.
        select(null);
        setCreating(null);
        return;
      }
      const col = columnsRef.current.get(day);
      if (!col) return;
      const minute = clamp((e.clientY - col.getBoundingClientRect().top) / PX_PER_MIN, 0, DAY_MINUTES - SNAP);
      const start = Math.floor(minute / SNAP) * SNAP;
      begin(e, { mode: 'create', label: '', color: 'var(--color-accent)', duration: SNAP, grabOffset: 0, originDay: day, originStart: start, originEnd: start + SNAP });
    },
    [begin, select, setCreating],
  );

  const onTrayDragStart = useCallback(
    (e: React.PointerEvent, task: Task, remaining: number) => {
      const duration = clamp(Math.ceil(Math.min(remaining, 240) / SNAP) * SNAP, SNAP, 240);
      begin(e, {
        mode: 'tray',
        taskId: task.id,
        label: task.title,
        color: categoryColor(categoryMap.get(task.categoryId)),
        duration,
        grabOffset: 15,
        originDay: todayStart,
        originStart: 0,
        originEnd: duration,
      });
    },
    [begin, categoryMap, todayStart],
  );

  /* ---- Keyboard --------------------------------------------------------- */

  const selected = selectedId ? blockMap.get(selectedId) : undefined;

  const nudge = (deltaMin: number, mode: 'move' | 'resize' | 'day') => {
    if (!selected) return;
    const s = minuteOfDay(selected.start);
    const e = endMinuteOfDay(selected.start, selected.end);
    let day = startOfLocalDay(selected.start).getTime();
    let ns = s;
    let ne = e;
    if (mode === 'move') {
      ns = clamp(s + deltaMin, 0, DAY_MINUTES - (e - s));
      ne = ns + (e - s);
    } else if (mode === 'resize') ne = clamp(e + deltaMin, s + SNAP, DAY_MINUTES);
    else {
      day = addDays(day, deltaMin).getTime();
      const visible = days.some((d) => d.getTime() === day);
      if (!visible) goTo(day, deltaMin);
    }
    const start = atMinute(day, ns);
    const end = atMinute(day, ne);
    if (start === selected.start && end === selected.end) return;
    setPending(selected.id, { start, end });
    void blockActions.move(selected.id, start, end).then((ok) => !ok && setPending(selected.id, null));
  };

  useHotkeys(
    {
      t: goToday,
      d: () => setView('day'),
      w: () => setView('week'),
      arrowleft: () => (selected ? nudge(-1, 'day') : navigate(-1)),
      arrowright: () => (selected ? nudge(1, 'day') : navigate(1)),
      arrowup: () => nudge(-SNAP, 'move'),
      arrowdown: () => nudge(SNAP, 'move'),
      'shift+arrowup': () => nudge(-SNAP, 'resize'),
      'shift+arrowdown': () => nudge(SNAP, 'resize'),
      e: () => selected?.taskId && openEdit(selected.taskId),
      enter: () => selected?.taskId && openEdit(selected.taskId),
      x: () => selected?.taskId && void taskActions.toggleComplete(selected.taskId),
      delete: () => selected && removeSelected(),
      backspace: () => selected && removeSelected(),
      escape: () => {
        select(null);
        setCreating(null);
      },
    },
    () => !isModalOpen() && !useTimeline.getState().drag,
  );

  function removeSelected() {
    if (!selected) return;
    const task = selected.taskId ? taskMap.get(selected.taskId) : undefined;
    select(null);
    void blockActions.remove([selected.id], selected.kind === 'event' ? `“${selected.title}”` : task ? taskRef(task.seq) : 'block');
  }

  /* ---- Summary ---------------------------------------------------------- */

  const summary = useMemo(() => {
    let scheduled = 0;
    let conflicts = 0;
    let free = 0;
    for (const d of days) {
      const list = byDay.get(dayKey(d)) ?? [];
      scheduled += list.filter((b) => b.kind === 'task').reduce((a, b) => a + (b.end - b.start) / 60_000, 0);
      const lay = layouts.get(dayKey(d))!;
      conflicts += [...lay.values()].filter((l) => l.overlaps.length).length;
      if (d.getTime() >= todayStart)
        free += freeIntervals(d, list, { fromMinute: d.getTime() === todayStart ? nowMinute : undefined }).reduce((a, i) => a + i.end - i.start, 0);
    }
    return { scheduled, conflicts, free };
  }, [days, byDay, layouts, todayStart, nowMinute]);

  const candidates = useMemo(
    () =>
      tasks
        .filter((t) => t.status !== 'done')
        .sort(
          (a, b) =>
            Number(a.estimate - (schedule.get(a.id)?.minutes ?? 0) <= 0) - Number(b.estimate - (schedule.get(b.id)?.minutes ?? 0) <= 0) ||
            a.deadline - b.deadline,
        ),
    [tasks, schedule],
  );

  const placementFor = (dayIndex: number): CardPlacement => (view === 'day' ? 'inside' : dayIndex >= 5 ? 'left' : 'right');

  /* ---- Render ----------------------------------------------------------- */

  const cols = `${GUTTER}px repeat(${days.length}, minmax(0, 1fr))`;
  const todayVisible = days.some((d) => d.getTime() === todayStart);

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 md:px-6">
        <div className="flex items-center gap-1">
          <Tooltip content="Today" shortcut={['T']}>
            <Button onClick={goToday}>
              Today
            </Button>
          </Tooltip>
          <Tooltip content={view === 'week' ? 'Previous week' : 'Previous day'} shortcut={['←']}>
            <IconButton icon={ChevronLeft} label="Previous" onClick={() => navigate(-1)} />
          </Tooltip>
          <Tooltip content={view === 'week' ? 'Next week' : 'Next day'} shortcut={['→']}>
            <IconButton icon={ChevronRight} label="Next" onClick={() => navigate(1)} />
          </Tooltip>
        </div>
        <h1 className="min-w-0 truncate text-base font-semibold tracking-[-0.01em]" aria-live="polite">
          {rangeLabel(days)}
        </h1>

        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
          {!ws.loading && (
            <div className="hidden items-center gap-3 text-xs text-fg-subtle xl:flex">
              <span>
                <span className="num text-fg-muted">{formatDuration(summary.scheduled, { compact: true })}</span> scheduled
              </span>
              <span>
                <span className="num text-positive">{formatDuration(summary.free, { compact: true })}</span> free
              </span>
              {summary.conflicts > 0 && (
                <span className="flex items-center gap-1 text-negative">
                  <AlertTriangle size={12} />
                  <span className="num">{summary.conflicts}</span> overlapping
                </span>
              )}
            </div>
          )}
          <Tooltip content="Plan all unscheduled work around your commitments — opens as a scenario to review before applying">
            <Button icon={Sparkles} onClick={() => void autoSchedule()}>
              Auto-schedule
            </Button>
          </Tooltip>
          <SegmentedControl
            size="md"
            value={view}
            onChange={setView}
            options={[
              { value: 'day', label: 'Day' },
              { value: 'week', label: 'Week' },
            ]}
          />
          <Tooltip content={trayOpen ? 'Hide tray' : 'Show tasks to schedule'}>
            <IconButton icon={PanelRight} label="Toggle task tray" active={trayOpen} onClick={() => setTrayOpen(!trayOpen)} />
          </Tooltip>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {/* Grid */}
        <div ref={scrollRef} className="relative min-w-0 flex-1 overflow-auto [scrollbar-gutter:stable]" aria-label="Timeline">
          <AnimatePresence mode="popLayout" initial={false} custom={navDir}>
            <motion.div
              key={rangeKey}
              custom={navDir}
              variants={{
                enter: (dir: number) => ({ opacity: 0, x: dir * 28 }),
                center: { opacity: 1, x: 0 },
                exit: (dir: number) => ({ opacity: 0, x: dir * -28 }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
              className={cn('relative', view === 'week' && 'min-w-[880px]')}
            >
              {/* Day headers */}
              <div className="sticky top-0 z-[45] grid border-b border-line bg-canvas/95 backdrop-blur-md" style={{ gridTemplateColumns: cols }}>
                <div className="flex items-end justify-center pb-1.5">
                  <span className="text-[10px] text-fg-faint">{format(now, 'O')}</span>
                </div>
                {days.map((d) => {
                  const k = dayKey(d);
                  const list = byDay.get(k) ?? [];
                  const load = dayLoad(d, list);
                  const isToday = d.getTime() === todayStart;
                  const due = (deadlinesByDay.get(k) ?? []).filter((t) => t.status !== 'done');
                  const overlaps = [...(layouts.get(k)?.values() ?? [])].filter((l) => l.overlaps.length).length;
                  const over = load.booked + load.overtime > load.capacity && load.capacity > 0;
                  return (
                    <div key={k} className="flex min-w-0 flex-col gap-1.5 border-l border-line px-2.5 pb-2 pt-2">
                      <div className="flex items-baseline gap-1.5">
                        <span className={cn('text-xs font-medium', isToday ? 'text-accent' : 'text-fg-subtle')}>{format(d, view === 'day' ? 'EEEE' : 'EEE')}</span>
                        <span
                          className={cn(
                            'num flex h-6 min-w-6 items-center justify-center rounded-sm px-1 text-md font-medium',
                            isToday ? 'bg-accent text-accent-fg' : 'text-fg',
                          )}
                        >
                          {format(d, 'd')}
                        </span>
                        <span className="ml-auto flex items-center gap-1.5">
                          {overlaps > 0 && (
                            <Tooltip content={`${overlaps} overlapping blocks`}>
                              <AlertTriangle size={12} className="text-negative" />
                            </Tooltip>
                          )}
                          {due.length > 0 && (
                            <Tooltip
                              content={
                                <span className="flex flex-col gap-1">
                                  {due.map((t) => (
                                    <span key={t.id} className="flex items-center gap-2 text-2xs">
                                      <span className="num text-fg-subtle">{formatClock(minuteOfDay(t.deadline))}</span>
                                      <span className="max-w-[220px] truncate">{t.title}</span>
                                    </span>
                                  ))}
                                </span>
                              }
                            >
                              <span className="num flex items-center gap-0.5 rounded-xs bg-warning-muted px-1 text-2xs text-warning">
                                <Flag size={9} strokeWidth={2.5} />
                                {due.length}
                              </span>
                            </Tooltip>
                          )}
                        </span>
                      </div>
                      {load.capacity > 0 ? (
                        <div className="flex items-center gap-2">
                          <Meter
                            value={load.booked + load.overtime}
                            max={load.capacity}
                            height={3}
                            className="flex-1"
                            color={over ? 'var(--color-negative)' : 'var(--color-fg-muted)'}
                          />
                          <span className={cn('num shrink-0 text-2xs', over ? 'text-negative' : 'text-fg-subtle')}>
                            {formatDuration(load.free, { compact: true })} free
                          </span>
                        </div>
                      ) : (
                        <span className="text-2xs text-fg-faint">Non-working day</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Body */}
              <div className="relative grid" style={{ gridTemplateColumns: cols, height: GRID_HEIGHT }}>
                {/* Hour lines */}
                <div
                  className="pointer-events-none absolute inset-y-0 right-0"
                  style={{
                    left: GUTTER,
                    backgroundImage: `linear-gradient(to bottom, var(--color-line) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.025) 1px, transparent 1px)`,
                    backgroundSize: `100% ${HOUR_PX}px, 100% ${HOUR_PX / 2}px`,
                  }}
                />

                {/* Gutter */}
                <div className="relative">
                  {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
                    <span key={h} className="num absolute right-2 -translate-y-1/2 text-2xs text-fg-subtle" style={{ top: h * HOUR_PX }}>
                      {String(h).padStart(2, '0')}:00
                    </span>
                  ))}
                  {todayVisible && (
                    <span
                      className="num absolute right-1 z-30 -translate-y-1/2 rounded-xs bg-accent px-1 py-px text-2xs font-medium text-accent-fg"
                      style={{ top: nowMinute * PX_PER_MIN }}
                    >
                      {formatClock(nowMinute)}
                    </span>
                  )}
                </div>

                {days.map((d, i) => {
                  const k = dayKey(d);
                  const day = d.getTime();
                  const list = byDay.get(k) ?? [];
                  const lay = layouts.get(k)!;
                  const sel = selected && dayKey(selected.start) === k ? selected : undefined;
                  const selTask = sel?.taskId ? taskMap.get(sel.taskId) : undefined;
                  return (
                    <DayColumn
                      key={k}
                      day={day}
                      isToday={day === todayStart}
                      isPast={day < todayStart}
                      nowMinute={nowMinute}
                      now={now}
                      blocks={list}
                      layout={lay}
                      taskMap={taskMap}
                      categoryMap={categoryMap}
                      risk={risk}
                      deadlines={deadlinesByDay.get(k) ?? []}
                      selectedId={selectedId}
                      drag={drag}
                      creating={creating}
                      pending={pending}
                      register={register}
                      onBlockPointerDown={onBlockPointerDown}
                      onBackgroundPointerDown={onBackgroundPointerDown}
                    >
                      <AnimatePresence>
                        {sel && !drag?.moved && (
                          <BlockCard
                            key={sel.id}
                            block={sel}
                            task={selTask}
                            category={selTask ? categoryMap.get(selTask.categoryId) : undefined}
                            risk={selTask ? risk.get(selTask.id) : undefined}
                            schedule={selTask ? schedule.get(selTask.id) : undefined}
                            overlaps={(lay.get(sel.id)?.overlaps ?? []).map((id) => blockMap.get(id)!).filter(Boolean)}
                            taskMap={taskMap}
                            placement={placementFor(i)}
                            now={now}
                            onClose={() => select(null)}
                            onOpenTask={openEdit}
                            onToggleComplete={(id) => void taskActions.toggleComplete(id)}
                            onRemove={removeSelected}
                            onRename={(title) => void blockActions.rename(sel.id, title)}
                          />
                        )}
                        {creating && creating.day === day && (
                          <CreateCard
                            key={`create-${creating.start}`}
                            day={day}
                            start={creating.start}
                            end={creating.end}
                            placement={placementFor(i)}
                            candidates={candidates}
                            categoryMap={categoryMap}
                            schedule={schedule}
                            onCancel={() => setCreating(null)}
                            onCreateEvent={async (title) => {
                              setCreating(null);
                              await blockActions.createEvent(title, atMinute(day, creating.start), atMinute(day, creating.end));
                            }}
                            onScheduleTask={async (task) => {
                              setCreating(null);
                              await blockActions.schedule(task.id, atMinute(day, creating.start), atMinute(day, creating.end), taskRef(task.seq));
                            }}
                          />
                        )}
                      </AnimatePresence>
                    </DayColumn>
                  );
                })}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Tray */}
        <AnimatePresence initial={false}>
          {trayOpen && (
            <motion.aside
              key="tray"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 288, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
              className="shrink-0 overflow-hidden border-l border-line max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-50 max-lg:shadow-dialog"
            >
              <div className="h-full w-[288px]">
                <Tray
                  tasks={tasks}
                  categoryMap={categoryMap}
                  risk={risk}
                  schedule={schedule}
                  now={now}
                  loading={ws.loading}
                  onClose={() => setTrayOpen(false)}
                  onDragStart={onTrayDragStart}
                  onOpen={openEdit}
                />
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {/* Footer hints */}
      <div className="hidden shrink-0 items-center gap-4 border-t border-line px-6 py-1.5 text-2xs text-fg-subtle md:flex">
        <span className="flex items-center gap-1">
          <CalendarDays size={11} /> Drag on empty space to add an event or schedule a task
        </span>
        <span className="ml-auto flex items-center gap-1">
          <Kbd keys={['↑']} />
          <Kbd keys={['↓']} /> move
        </span>
        <span className="flex items-center gap-1">
          <Kbd keys={['Shift', '↓']} /> resize
        </span>
        <span className="flex items-center gap-1">
          <Kbd keys={['←']} />
          <Kbd keys={['→']} /> day
        </span>
        <span className="flex items-center gap-1">
          <Kbd keys={['Del']} /> remove
        </span>
      </div>

      <DragChip />
    </div>
  );
}

