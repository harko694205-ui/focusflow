import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { FEED } from '@/test/canvasFeed';
import { POST } from '../../../api/ics';
import * as canvas from '../canvasService';
import * as tasks from '../taskService';
import { setProfile } from '../settingsService';

const NOW = new Date('2026-10-01T12:00').getTime();
const all = (p: canvas.CanvasPreview) => p.rows.filter((r) => r.selected).map((r) => ({ item: r.item, taskId: r.taskId, estimate: r.item.estimate, difficulty: r.item.difficulty }));
const imported = () => db.tasks.filter((t) => !!t.sourceUid).toArray();

beforeEach(async () => {
  db.close();
  await db.delete();
  db.seedOnCreate = false;
  await db.open();
  await db.categories.bulkAdd([
    { id: 'cs31', name: 'CS 31', color: 'iris', order: 0, createdAt: 0 },
    { id: 'math', name: 'MATH 33A', color: 'teal', order: 1, createdAt: 0 },
  ]);
  await setProfile({ mode: 'student' });
});

describe('BruinLearn import', () => {
  it('previews: matches courses, proposes new ones, ticks only upcoming assignments', async () => {
    const p = await canvas.previewCanvas(FEED, NOW);
    expect(Object.fromEntries(p.courses.map((c) => [c.name, c.target]))).toEqual({
      'COM SCI 31 - Lec 1 - Fall 2026': 'cs31',
      '26F-ENGCOMP3-4': 'new',
      'MATH 33A Linear Algebra - Fall 2026': 'math',
    });
    expect(p.courses.find((c) => c.target === 'new')?.newName).toBe('ENGCOMP 3');
    const sel = Object.fromEntries(p.rows.map((r) => [r.item.title, r.selected]));
    expect(sel).toEqual({ 'Homework 3': true, 'Reading Response 2': true, 'Office hours': false, 'Midterm 1': false });
  });

  it('imports tasks into the right courses and remembers the mapping', async () => {
    const p = await canvas.previewCanvas(FEED, NOW);
    const r = await canvas.applyCanvasImport(all(p), p.courses, undefined, NOW);
    expect(r.added).toHaveLength(2);
    expect(r.newCourses.map((c) => c.name)).toEqual(['ENGCOMP 3']);
    const hw = (await imported()).find((t) => t.title === 'Homework 3')!;
    expect(hw).toMatchObject({ categoryId: 'cs31', estimate: 120, deadline: Date.UTC(2026, 9, 17, 6, 59), sourceUid: 'event-assignment-501' });
    expect(hw.notes).toMatch(/^From BruinLearn: https:/);
    const state = await canvas.getCanvasState();
    expect(state.courses['26F-ENGCOMP3-4']).toBe(r.newCourses[0].id);
    expect(state.imported.sort()).toEqual(['event-assignment-501', 'event-assignment-502']);
  });

  it('syncing again updates changed due dates instead of duplicating', async () => {
    const p1 = await canvas.previewCanvas(FEED, NOW);
    await canvas.applyCanvasImport(all(p1), p1.courses, undefined, NOW);

    const moved = FEED.replace('DTSTART:20261017T065900Z', 'DTSTART:20261019T065900Z');
    const p2 = await canvas.previewCanvas(moved, NOW);
    const hw = p2.rows.find((r) => r.item.uid === 'event-assignment-501')!;
    expect(hw).toMatchObject({ status: 'changed', selected: true, oldDue: Date.UTC(2026, 9, 17, 6, 59) });
    expect(p2.rows.find((r) => r.item.uid === 'event-assignment-502')).toMatchObject({ status: 'same', selected: false });
    // The new course is remembered, so the second sync needs no choices.
    expect(p2.courses.every((c) => c.target !== 'new')).toBe(true);

    const r = await canvas.applyCanvasImport(all(p2), p2.courses, undefined, NOW);
    expect(r.added).toHaveLength(0);
    expect(await imported()).toHaveLength(2);
    expect((await db.tasks.get(hw.taskId!))?.deadline).toBe(Date.UTC(2026, 9, 19, 6, 59));
    await canvas.undoCanvasImport(r);
    expect((await db.tasks.get(hw.taskId!))?.deadline).toBe(Date.UTC(2026, 9, 17, 6, 59));
  });

  it('assignments you deleted or finished aren’t offered again', async () => {
    const p1 = await canvas.previewCanvas(FEED, NOW);
    await canvas.applyCanvasImport(all(p1), p1.courses, undefined, NOW);
    const [a, b] = await imported();
    await tasks.deleteTasks([a.id]);
    await tasks.setStatus(b.id, 'done');
    const p2 = await canvas.previewCanvas(FEED, NOW);
    expect(p2.rows.find((r) => r.item.uid === a.sourceUid)).toMatchObject({ status: 'deleted', selected: false });
    expect(p2.rows.find((r) => r.item.uid === b.sourceUid)).toMatchObject({ status: 'done', selected: false });
  });

  it('after clearing all tasks, assignments are offered as new again', async () => {
    const p1 = await canvas.previewCanvas(FEED, NOW);
    await canvas.applyCanvasImport(all(p1), p1.courses, undefined, NOW);
    await tasks.clearTasks();
    const p2 = await canvas.previewCanvas(FEED, NOW);
    expect(p2.rows.filter((r) => r.selected).map((r) => r.status)).toEqual(['new', 'new']);
  });

  it('past items are off; skipped courses import nothing', async () => {
    const p = await canvas.previewCanvas(FEED, new Date('2026-10-18T12:00').getTime());
    expect(p.rows.find((r) => r.item.title === 'Homework 3')).toMatchObject({ status: 'past', selected: false });
    const courses = p.courses.map((c) => ({ ...c, target: 'skip' as const }));
    const r = await canvas.applyCanvasImport(all(p), courses);
    expect(r.added).toHaveLength(0);
    expect((await canvas.getCanvasState()).courses['26F-ENGCOMP3-4']).toBe('skip');
  });

  it('undo removes the import, the new course and the remembered state', async () => {
    const p = await canvas.previewCanvas(FEED, NOW);
    const r = await canvas.applyCanvasImport(all(p), p.courses, undefined, NOW);
    await canvas.undoCanvasImport(r);
    expect(await imported()).toHaveLength(0);
    expect(await db.categories.count()).toBe(2);
    expect(await db.meta.get(canvas.CANVAS_KEY)).toBeUndefined();
  });

  it('rejects files that aren’t calendars', async () => {
    await expect(canvas.previewCanvas('hello', NOW)).rejects.toThrow(/calendar/);
    await expect(canvas.fetchFeed('https://example.com/feed.ics')).rejects.toThrow(/feed link/);
  });
});

describe('background sync', () => {
  const FEED_URL = 'https://bruinlearn.ucla.edu/feeds/calendars/user_test.ics';
  const LATER = NOW + 4 * 60 * 60 * 1000;
  const extra = (uid: string, start: string, summary: string) => `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART:${start}\r\nSUMMARY:${summary}\r\nEND:VEVENT\r\nEND:VCALENDAR`;
  // A week later: one new homework in a matched course, one from a course never seen before.
  const NEXT = FEED.replace('DTSTART:20261017T065900Z', 'DTSTART:20261018T065900Z').replace(
    'END:VCALENDAR',
    extra('event-assignment-601', '20261024T065900Z', 'Homework 4 [COM SCI 31 - Lec 1 - Fall 2026]').replace('END:VCALENDAR', extra('event-assignment-602', '20261025T065900Z', 'Lab 1 [PHYSICS 4AL - Fall 2026]')),
  );

  async function connected() {
    const p = await canvas.previewCanvas(FEED, NOW);
    await canvas.applyCanvasImport(all(p), p.courses, FEED_URL, NOW);
  }

  it('does nothing without a feed, when switched off, or when synced recently', async () => {
    expect(await canvas.autoSync(NOW, async () => NEXT)).toBeNull();
    await connected();
    expect(await canvas.autoSync(NOW + 60_000, async () => NEXT)).toBeNull();
    await canvas.setAutoSync(false);
    expect(await canvas.autoSync(LATER, async () => NEXT)).toBeNull();
  });

  it('adds new assignments from matched courses and updates due dates; new courses wait', async () => {
    await connected();
    const r = (await canvas.autoSync(LATER, async () => NEXT))!;
    expect(r.result.added.map((t) => t.title)).toEqual(['Homework 4']);
    expect(r.result.added[0].categoryId).toBe('cs31');
    expect(r.result.updatedBefore.map((t) => t.title)).toEqual(['Homework 3']);
    expect(r.result.newCourses).toEqual([]);
    expect(r.unmatched).toBe(1); // PHYSICS 4AL Lab 1
    expect(await imported()).toHaveLength(3);
    expect((await canvas.getCanvasState()).lastSync).toBe(LATER);
  });

  it('undoing a background sync doesn’t bring the same items back next time', async () => {
    await connected();
    const r = (await canvas.autoSync(LATER, async () => NEXT))!;
    await canvas.undoCanvasImport(r.result, { forget: false });
    expect(await imported()).toHaveLength(2);
    const again = (await canvas.autoSync(LATER + 4 * 60 * 60 * 1000, async () => NEXT))!;
    expect(again.result.added).toHaveLength(0);
  });

  it('remembers why a sync failed', async () => {
    await connected();
    expect(
      await canvas.autoSync(LATER, async () => {
        throw new Error('BruinLearn doesn’t recognise that feed link.');
      }),
    ).toBeNull();
    expect((await canvas.getCanvasState()).lastError).toMatch(/recognise/);
    await canvas.autoSync(LATER * 2, async () => NEXT);
    expect((await canvas.getCanvasState()).lastError).toBeNull();
  });
});

describe('feed proxy', () => {
  const post = (body: unknown) => POST(new Request('http://localhost/api/ics', { method: 'POST', body: JSON.stringify(body) }));

  it('only fetches Canvas calendar feeds', async () => {
    for (const url of ['https://example.com/feeds/calendars/user_1.ics', 'http://bruinlearn.ucla.edu/feeds/calendars/user_1.ics', 'https://bruinlearn.ucla.edu/api/v1/users/self', 'https://bruinlearn.ucla.edu:8443/feeds/calendars/user_1.ics', 42]) {
      const res = await post({ url });
      expect(res.status).toBe(400);
    }
    expect((await POST(new Request('http://localhost/api/ics', { method: 'POST', body: 'nope' }))).status).toBe(400);
  });
});
