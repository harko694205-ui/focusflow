import { describe, expect, it } from 'vitest';
import { accuracyRows, accuracyStats, groupByTask } from '@/domain/insights';
import { layoutBlocks } from '@/domain/schedule';
import { buildDemoHistory } from '../history';

const NOW = new Date(2026, 10, 25, 12).getTime();
const CATS = ['cat-product', 'cat-client', 'cat-planning', 'cat-hiring', 'cat-personal'];

describe('demo history', () => {
  const h = buildDemoHistory(NOW, 20, CATS);

  it('is deterministic apart from ids', () => {
    const strip = (x: typeof h) => x.tasks.map((t) => [t.title, t.estimate, t.deadline, t.completedAt]);
    expect(strip(buildDemoHistory(NOW, 20, CATS))).toEqual(strip(h));
  });

  it('only contains finished past work, without overlapping sessions', () => {
    expect(h.tasks.length).toBeGreaterThan(20);
    expect(h.tasks.every((t) => t.status === 'done' && t.completedAt! < NOW - 2 * 86_400_000)).toBe(true);
    expect(h.tasks.map((t) => t.seq)).toEqual(h.tasks.map((_, i) => 21 + i));
    const asBlocks = h.sessions.map((s) => ({ ...s, kind: 'task' as const, title: '', updatedAt: 0 }));
    expect([...layoutBlocks(asBlocks).values()].every((l) => l.overlaps.length === 0)).toBe(true);
  });

  it('has the patterns Insights should find: hard work overruns more than easy work', () => {
    const s = accuracyStats(accuracyRows(h.tasks, groupByTask(h.sessions), groupByTask(h.blocks)));
    const hard = s.byDifficulty.find((g) => g.key === 3)!.ratio!;
    const easy = s.byDifficulty.find((g) => g.key === 1)!.ratio!;
    expect(hard).toBeGreaterThan(1.2);
    expect(easy).toBeLessThan(hard);
    expect(h.tasks.some((t) => (t.postponed ?? 0) > 0)).toBe(true);
  });

  it('maps templates onto whatever categories exist', () => {
    const custom = buildDemoHistory(NOW, 0, ['a', 'b']);
    expect(new Set(custom.tasks.map((t) => t.categoryId))).toEqual(new Set(['a', 'b']));
    expect(buildDemoHistory(NOW, 0, []).tasks).toEqual([]);
  });
});
