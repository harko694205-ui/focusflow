/**
 * Scenario op replay. `applyOps(baseline, ops)` returns a brand-new state; the baseline arrays and
 * records are never mutated (enforced in tests by deep-freezing the input). Ops that no longer make
 * sense — a block that's gone, an invalid span — are skipped and reported, never half-applied.
 */
import { format } from 'date-fns';
import { LIMITS, PRIORITIES, taskRef, type WorkWeek } from '@/domain/constants';
import { dayKey, durationMinutes, validateSpan } from '@/domain/schedule';
import { formatDuration } from '@/lib/format';
import type { Task, TimeBlock } from '@/domain/types';
import { autoplan } from './autoplan';
import type { OpResult, ScenarioOp, ScheduleState, StoredOp } from './types';

interface Working {
  tasks: Map<string, Task>;
  blocks: Map<string, TimeBlock>;
  offDays: Set<string>;
}

const when = (t: number) => format(t, 'EEE HH:mm');
const span = (s: number, e: number) => `${format(s, 'EEE HH:mm')}–${format(e, 'HH:mm')}`;

function blockLabel(w: Working, b: TimeBlock): string {
  if (b.kind === 'event') return `“${b.title}”`;
  const t = b.taskId ? w.tasks.get(b.taskId) : undefined;
  return t ? taskRef(t.seq) : 'block';
}

function applyOne(w: Working, stored: StoredOp, week?: WorkWeek): OpResult {
  const { id, op } = stored;
  const skip = (label: string, reason: string): OpResult => ({ id, label, skipped: reason, affected: 0 });

  switch (op.type) {
    case 'move': {
      const b = w.blocks.get(op.blockId);
      if (!b) return skip('Move block', 'The block no longer exists.');
      const err = validateSpan(op.start, op.end);
      if (err) return skip(`Move ${blockLabel(w, b)}`, err);
      const resized = durationMinutes(b) !== Math.round((op.end - op.start) / 60_000);
      const moved = b.start !== op.start;
      w.blocks.set(b.id, { ...b, start: op.start, end: op.end });
      const label =
        resized && !moved
          ? `Resized ${blockLabel(w, b)} to ${formatDuration(Math.round((op.end - op.start) / 60_000), { compact: true })}`
          : `Moved ${blockLabel(w, b)} to ${span(op.start, op.end)}`;
      return { id, label, affected: 1 };
    }
    case 'add': {
      const b = op.block;
      const err = validateSpan(b.start, b.end);
      if (err) return skip('Add block', err);
      if (w.blocks.has(b.id)) return skip('Add block', 'Duplicate block.');
      if (b.kind === 'task') {
        const t = b.taskId ? w.tasks.get(b.taskId) : undefined;
        if (!t) return skip('Schedule task', 'The task no longer exists.');
        if (t.status === 'done') return skip(`Schedule ${taskRef(t.seq)}`, 'The task is already done.');
      }
      w.blocks.set(b.id, { ...b });
      return { id, label: `Scheduled ${blockLabel(w, b)} · ${span(b.start, b.end)}`, affected: 1 };
    }
    case 'remove': {
      const b = w.blocks.get(op.blockId);
      if (!b) return skip('Remove block', 'The block no longer exists.');
      w.blocks.delete(b.id);
      return { id, label: `Removed ${blockLabel(w, b)} · ${span(b.start, b.end)}`, affected: 1 };
    }
    case 'estimate': {
      const t = w.tasks.get(op.taskId);
      if (!t) return skip('Change estimate', 'The task no longer exists.');
      if (!Number.isFinite(op.estimate) || op.estimate < LIMITS.estimateMin || op.estimate > LIMITS.estimateMax)
        return skip(`Re-estimate ${taskRef(t.seq)}`, 'Estimate out of range.');
      w.tasks.set(t.id, { ...t, estimate: Math.round(op.estimate) });
      return {
        id,
        label: `Re-estimated ${taskRef(t.seq)} ${formatDuration(t.estimate, { compact: true })} → ${formatDuration(op.estimate, { compact: true })}`,
        affected: 1,
      };
    }
    case 'deadline': {
      const t = w.tasks.get(op.taskId);
      if (!t) return skip('Change deadline', 'The task no longer exists.');
      if (!Number.isFinite(op.deadline)) return skip(`Move deadline of ${taskRef(t.seq)}`, 'Invalid deadline.');
      w.tasks.set(t.id, { ...t, deadline: op.deadline });
      return { id, label: `Moved ${taskRef(t.seq)} deadline ${when(t.deadline)} → ${when(op.deadline)}`, affected: 1 };
    }
    case 'priority': {
      const t = w.tasks.get(op.taskId);
      if (!t) return skip('Change priority', 'The task no longer exists.');
      w.tasks.set(t.id, { ...t, priority: op.priority });
      return { id, label: `${taskRef(t.seq)} priority → ${PRIORITIES[op.priority].label}`, affected: 1 };
    }
    case 'clearDay': {
      const k = dayKey(op.day);
      const ids = [...w.blocks.values()].filter((b) => b.kind === 'task' && dayKey(b.start) === k).map((b) => b.id);
      for (const bid of ids) w.blocks.delete(bid);
      w.offDays.add(k);
      return { id, label: `Took ${format(op.day, 'EEEE')} off · ${ids.length} block${ids.length === 1 ? '' : 's'} unscheduled`, affected: ids.length };
    }
    case 'autoplan': {
      const placed = autoplan(
        { tasks: [...w.tasks.values()], blocks: [...w.blocks.values()], offDays: [...w.offDays] },
        { from: op.from, days: op.days, strategy: op.strategy, now: op.now, idPrefix: id, week },
      );
      for (const b of placed) w.blocks.set(b.id, b);
      const mins = placed.reduce((a, b) => a + durationMinutes(b), 0);
      return {
        id,
        label: `Auto-planned ${new Set(placed.map((b) => b.taskId)).size} tasks · ${formatDuration(mins, { compact: true })} (${op.strategy === 'priority' ? 'priority first' : 'deadline first'})`,
        affected: placed.length,
      };
    }
  }
}

/** `week`: working hours for any auto-planning op (default: the built-in week). */
export function applyOps(base: ScheduleState, ops: readonly StoredOp[], week?: WorkWeek): { state: ScheduleState; results: OpResult[] } {
  const w: Working = {
    tasks: new Map(base.tasks.map((t) => [t.id, t])),
    blocks: new Map(base.blocks.map((b) => [b.id, b])),
    offDays: new Set(base.offDays ?? []),
  };
  const results = ops.map((o) => applyOne(w, o, week));
  return { state: { tasks: [...w.tasks.values()], blocks: [...w.blocks.values()], offDays: [...w.offDays].sort() }, results };
}

/** Convenience for building an op record. */
export function makeOp(op: ScenarioOp, id: string, at: number): StoredOp {
  return { id, at, op };
}
