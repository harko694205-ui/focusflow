/**
 * Pointer-driven drag engine for the timeline (move, resize, drag-in from the tray,
 * drag-to-create). Pure pointer events — works with mouse, pen and touch, and with
 * synthetic events in tests. The hook only tracks the gesture; the page decides what
 * a finished gesture means (commit, click, open popover…).
 */
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { clamp, DAY_MINUTES, MIN_BLOCK, snap } from '@/domain/schedule';
import { PX_PER_MIN, useTimeline, type DragState } from './store';

const MOVE_THRESHOLD = 4; // px before a press becomes a drag
const EDGE = 56; // px from the scroll edge where auto-scroll kicks in
const MAX_SPEED = 14; // px per frame

export type DragInit = Pick<DragState, 'mode' | 'blockId' | 'taskId' | 'label' | 'color' | 'duration' | 'grabOffset' | 'originDay' | 'originStart' | 'originEnd'>;

export function useDragController(
  columns: RefObject<Map<number, HTMLElement>>,
  scroller: RefObject<HTMLElement | null>,
  onEnd: (final: DragState) => void,
) {
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  return useCallback(
    (e: React.PointerEvent, init: DragInit) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      cleanupRef.current?.();

      const startPointer = { x: e.clientX, y: e.clientY };
      let pointer = startPointer;
      let raf = 0;

      const compute = (): DragState => {
        const prev = useTimeline.getState().drag!;
        const moved = prev.moved || Math.hypot(pointer.x - startPointer.x, pointer.y - startPointer.y) > MOVE_THRESHOLD;

        // Which column is under the pointer?
        const cols = [...columns.current!.entries()];
        const lockToOrigin = init.mode === 'resize-start' || init.mode === 'resize-end' || init.mode === 'create';
        let target = cols.find(([day]) => day === init.originDay) ?? null;
        if (!lockToOrigin) {
          const inside = cols.find(([, el]) => {
            const r = el.getBoundingClientRect();
            return pointer.x >= r.left && pointer.x < r.right;
          });
          if (inside) target = inside;
          else if (init.mode === 'move' && cols.length) {
            // Outside the columns while moving: stick to the nearest one.
            target = cols.reduce((best, c) => {
              const d = Math.abs(c[1].getBoundingClientRect().left - pointer.x);
              return d < Math.abs(best[1].getBoundingClientRect().left - pointer.x) ? c : best;
            });
          } else target = null;
        }
        // Tray drags only target a column while the pointer is inside the visible grid.
        if (init.mode === 'tray' && target && scroller.current) {
          const sr = scroller.current.getBoundingClientRect();
          if (pointer.y < sr.top || pointer.y > sr.bottom) target = null;
        }

        if (!target) return { ...prev, pointer, moved, day: null };

        const rect = target[1].getBoundingClientRect();
        const minute = (pointer.y - rect.top) / PX_PER_MIN;
        let { start, end } = prev;

        switch (init.mode) {
          case 'move':
          case 'tray':
            start = clamp(snap(minute - init.grabOffset), 0, DAY_MINUTES - init.duration);
            end = start + init.duration;
            break;
          case 'resize-end':
            start = init.originStart;
            end = clamp(snap(minute), init.originStart + MIN_BLOCK, DAY_MINUTES);
            break;
          case 'resize-start':
            end = init.originEnd;
            start = clamp(snap(minute), 0, init.originEnd - MIN_BLOCK);
            break;
          case 'create': {
            const a = init.originStart;
            const m = clamp(minute, 0, DAY_MINUTES);
            start = Math.min(a, snap(Math.floor(m / 15) * 15));
            end = Math.max(a + MIN_BLOCK, snap(Math.ceil(m / 15) * 15));
            break;
          }
        }
        return { ...prev, pointer, moved, day: target[0], start, end };
      };

      const update = () => useTimeline.getState().setDrag(compute());

      // Auto-scroll near the top/bottom edge of the grid.
      const tick = () => {
        const el = scroller.current;
        if (el) {
          const r = el.getBoundingClientRect();
          let dy = 0;
          if (pointer.y < r.top + EDGE) dy = -MAX_SPEED * Math.min(1, (r.top + EDGE - pointer.y) / EDGE);
          else if (pointer.y > r.bottom - EDGE) dy = MAX_SPEED * Math.min(1, (pointer.y - (r.bottom - EDGE)) / EDGE);
          if (dy && pointer.x >= r.left && pointer.x <= r.right) {
            el.scrollTop += dy;
            update();
          }
        }
        raf = requestAnimationFrame(tick);
      };

      const onMove = (ev: PointerEvent) => {
        pointer = { x: ev.clientX, y: ev.clientY };
        update();
      };
      const finish = (cancelled: boolean) => {
        cleanup();
        const final = useTimeline.getState().drag;
        if (cancelled || !final) useTimeline.getState().setDrag(null);
        else onEndRef.current(final);
      };
      const onUp = () => finish(false);
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          ev.stopPropagation();
          finish(true);
        }
      };
      const cleanup = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        window.removeEventListener('keydown', onKey, true);
        document.body.style.removeProperty('cursor');
        document.body.style.removeProperty('user-select');
        cleanupRef.current = null;
      };

      useTimeline.getState().setDrag({
        ...init,
        day: init.mode === 'tray' ? null : init.originDay,
        start: init.originStart,
        end: init.originEnd,
        pointer,
        startPointer,
        moved: false,
      });

      document.body.style.cursor = init.mode.startsWith('resize') ? 'ns-resize' : init.mode === 'create' ? 'crosshair' : 'grabbing';
      document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      window.addEventListener('keydown', onKey, true);
      raf = requestAnimationFrame(tick);
      cleanupRef.current = cleanup;
    },
    [columns, scroller],
  );
}
