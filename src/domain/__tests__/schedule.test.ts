import { describe, expect, it } from 'vitest';
import {
  atMinute,
  dayLoad,
  endMinuteOfDay,
  freeIntervals,
  layoutBlocks,
  minuteOfDay,
  scheduleByTask,
  subtractIntervals,
  validateSpan,
} from '../schedule';
import { buildLoadForecast } from '../forecast';
import { makeTask } from '@/test/factory';
import type { TimeBlock } from '../types';

const MON = new Date(2026, 10, 23); // Monday
const at = (d: Date, h: number, m = 0) => atMinute(d, h * 60 + m);
let n = 0;
const block = (start: number, end: number, over: Partial<TimeBlock> = {}): TimeBlock => ({
  id: `b${++n}`,
  kind: 'task',
  taskId: 't1',
  title: '',
  start,
  end,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe('wall-clock helpers', () => {
  it('round-trips minutes of day', () => {
    expect(minuteOfDay(at(MON, 9, 30))).toBe(570);
    expect(endMinuteOfDay(at(MON, 23), atMinute(MON, 24 * 60))).toBe(1440); // midnight end
  });

  it('validates spans', () => {
    expect(validateSpan(at(MON, 9), at(MON, 9, 10))).toMatch(/at least/);
    expect(validateSpan(at(MON, 23), at(new Date(2026, 10, 24), 1))).toMatch(/midnight/);
    expect(validateSpan(at(MON, 23), atMinute(MON, 1440))).toBeNull(); // ending exactly at midnight is fine
    expect(validateSpan(at(MON, 9), at(MON, 10))).toBeNull();
  });
});

describe('layoutBlocks', () => {
  it('puts non-overlapping blocks in a single lane', () => {
    const a = block(at(MON, 9), at(MON, 10));
    const b = block(at(MON, 10), at(MON, 11)); // back-to-back is not an overlap
    const l = layoutBlocks([a, b]);
    expect(l.get(a.id)).toEqual({ lane: 0, lanes: 1, overlaps: [] });
    expect(l.get(b.id)).toEqual({ lane: 0, lanes: 1, overlaps: [] });
  });

  it('splits overlapping blocks into lanes and reports conflicts', () => {
    const a = block(at(MON, 9), at(MON, 11));
    const b = block(at(MON, 10), at(MON, 12));
    const c = block(at(MON, 11), at(MON, 13)); // overlaps b only; reuses a's lane
    const l = layoutBlocks([c, b, a]);
    expect(l.get(a.id)!.lane).toBe(0);
    expect(l.get(b.id)!.lane).toBe(1);
    expect(l.get(c.id)!.lane).toBe(0);
    expect(l.get(a.id)!.lanes).toBe(2);
    expect(l.get(a.id)!.overlaps).toEqual([b.id]);
    expect(l.get(b.id)!.overlaps.sort()).toEqual([a.id, c.id].sort());
  });

  it('starts a new cluster after a gap', () => {
    const a = block(at(MON, 9), at(MON, 10));
    const b = block(at(MON, 9, 30), at(MON, 10, 30));
    const c = block(at(MON, 14), at(MON, 15));
    const l = layoutBlocks([a, b, c]);
    expect(l.get(c.id)).toEqual({ lane: 0, lanes: 1, overlaps: [] });
  });
});

describe('availability', () => {
  it('subtracts busy intervals', () => {
    expect(subtractIntervals([{ start: 0, end: 100 }], [{ start: 20, end: 30 }, { start: 90, end: 120 }])).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 90 },
    ]);
  });

  it('computes free working time around blocks and from "now"', () => {
    // Work: 08:30–12:30, 13:15–18:00
    const blocks = [block(at(MON, 9), at(MON, 11)), block(at(MON, 13, 15), at(MON, 15))];
    expect(freeIntervals(MON, blocks)).toEqual([
      { start: 510, end: 540 },
      { start: 660, end: 750 },
      { start: 900, end: 1080 },
    ]);
    expect(freeIntervals(MON, blocks, { fromMinute: 16 * 60 })).toEqual([{ start: 960, end: 1080 }]);
    expect(freeIntervals(MON, blocks, { minLength: 60 })).toEqual([
      { start: 660, end: 750 },
      { start: 900, end: 1080 },
    ]);
  });

  it('measures day load, counting overlaps once and overtime separately', () => {
    const blocks = [block(at(MON, 9), at(MON, 11)), block(at(MON, 10), at(MON, 11)), block(at(MON, 19), at(MON, 20))];
    const load = dayLoad(MON, blocks);
    expect(load.capacity).toBe(525);
    expect(load.booked).toBe(120);
    expect(load.free).toBe(405);
    expect(load.overtime).toBe(60);
  });

  it('treats weekends as zero capacity', () => {
    expect(dayLoad(new Date(2026, 10, 28), []).capacity).toBe(0);
    expect(freeIntervals(new Date(2026, 10, 28), [])).toEqual([]);
  });
});

describe('scheduleByTask', () => {
  it('totals minutes and finds the next upcoming block', () => {
    const now = at(MON, 12);
    const blocks = [
      block(at(MON, 9), at(MON, 10), { taskId: 'x' }),
      block(at(MON, 14), at(MON, 15, 30), { taskId: 'x' }),
      block(at(MON, 16), at(MON, 17), { kind: 'event', taskId: null, title: 'Sync' }),
    ];
    const s = scheduleByTask(blocks, now).get('x')!;
    expect(s.minutes).toBe(150);
    expect(s.blockCount).toBe(2);
    expect(s.next).toBe(at(MON, 14));
  });
});

describe('buildLoadForecast', () => {
  it('splits scheduled minutes by difficulty and events', () => {
    const hard = makeTask({ id: 'h', difficulty: 3 });
    const easy = makeTask({ id: 'e', difficulty: 1 });
    const taskMap = new Map([hard, easy].map((t) => [t.id, t]));
    const blocks = [
      block(at(MON, 9), at(MON, 11), { taskId: 'h' }),
      block(at(MON, 11), at(MON, 11, 30), { taskId: 'e' }),
      block(at(MON, 14), at(MON, 15), { kind: 'event', taskId: null, title: 'Sync' }),
    ];
    const [mon, tue] = buildLoadForecast(blocks, taskMap, MON.getTime(), 2);
    expect([mon.deep, mon.shallow, mon.admin, mon.events, mon.capacity]).toEqual([120, 0, 30, 60, 525]);
    expect(tue.deep + tue.events).toBe(0);
  });
});
