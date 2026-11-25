/**
 * Plain-language takeaways from the numbers ("Hard tasks take 1.5× your estimate"). Pure, ranked
 * by how actionable they are; each only appears when there's enough data behind it.
 */
import { DIFFICULTIES } from '@/domain/constants';
import type { Insights } from '@/domain/insights';
import type { Category, ID } from '@/domain/types';
import { formatDuration } from '@/lib/format';

export type FindingTone = 'positive' | 'warning' | 'neutral';

export interface Finding {
  id: string;
  tone: FindingTone;
  title: string;
  detail: string;
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function findings(i: Insights, categories: ReadonlyMap<ID, Category>): Finding[] {
  const out: Finding[] = [];
  const name = (id: ID) => categories.get(id)?.name ?? 'Uncategorised';

  // Estimates — the most actionable: biggest systematic miss by difficulty or category.
  const groups = [
    ...i.accuracy.byDifficulty.map((g) => ({ label: `${DIFFICULTIES[g.key].label} tasks`, ...g })),
    ...i.accuracy.byCategory.map((g) => ({ label: name(g.key), ...g })),
  ].filter((g) => g.n >= 3 && g.ratio !== null);
  const worst = groups.sort((a, b) => Math.abs(b.ratio! - 1) - Math.abs(a.ratio! - 1))[0];
  if (worst && Math.abs(worst.ratio! - 1) >= 0.15) {
    const over = worst.ratio! > 1;
    out.push({
      id: 'estimate',
      tone: 'warning',
      title: `${worst.label} take ${worst.ratio!.toFixed(1)}× your estimate`,
      detail: over
        ? `Across ${worst.n} finished tasks. Pad new estimates by about ${pct(worst.ratio! - 1)} — the task editor suggests a calibrated estimate.`
        : `Across ${worst.n} finished tasks you finish ${pct(1 - worst.ratio!)} faster than estimated — you can plan these tighter.`,
    });
  } else if (i.accuracy.rows.length >= 5 && i.accuracy.ratio !== null) {
    out.push({
      id: 'estimate',
      tone: 'positive',
      title: 'Your estimates are well calibrated',
      detail: `Finished work took ${i.accuracy.ratio.toFixed(2)}× the estimate overall, across ${i.accuracy.rows.length} tasks.`,
    });
  }

  // Focus hours.
  if (i.hours.peak && i.hours.total >= 180) {
    const best = i.hours.bestWeekday;
    out.push({
      id: 'peak',
      tone: 'neutral',
      title: `You focus best ${hh(i.hours.peak.startHour)}–${hh(i.hours.peak.startHour + 2)}`,
      detail: `${pct(i.hours.peak.share)} of tracked time falls in those two hours${best !== null ? `; ${WEEKDAYS[best]} is your most productive day` : ''}. Protect them for hard work.`,
    });
  }

  // Deadlines.
  const c = i.completion;
  if (c.due >= 5 && c.onTimeRate !== null) {
    out.push(
      c.onTimeRate >= 0.85
        ? { id: 'deadlines', tone: 'positive', title: `${pct(c.onTimeRate)} of deadlines met on time`, detail: `${c.onTime} of ${c.due} tasks due in this period.` }
        : {
            id: 'deadlines',
            tone: 'warning',
            title: `Only ${pct(c.onTimeRate)} of deadlines met on time`,
            detail: `${c.late} finished late${c.medianLateBy !== null ? ` (typically ${formatDuration(c.medianLateBy, { compact: true })} over)` : ''} and ${c.missed} still open past due.`,
          },
    );
  }

  // Postponements.
  const p = i.postponed.byCategory[0];
  if (p && p.total >= 3) {
    out.push({
      id: 'postponed',
      tone: 'warning',
      title: `${name(p.categoryId)} gets pushed back most`,
      detail: `${p.total} postponements across ${p.tasks} task${p.tasks === 1 ? '' : 's'}. Consider smaller tasks or earlier slots for it.`,
    });
  }

  // Load vs capacity.
  const past = i.workload.filter((w) => !w.current);
  if (past.length >= 2) {
    const avg = past.reduce((a, w) => a + w.tracked, 0) / past.length;
    const cap = past.reduce((a, w) => a + w.capacity, 0) / past.length;
    if (avg > 0 && cap > 0)
      out.push({
        id: 'load',
        tone: 'neutral',
        title: `${formatDuration(avg, { compact: true })} of tracked focus a week`,
        detail: `About ${pct(avg / cap)} of your working hours. Plan around that, not your full capacity.`,
      });
  }
  return out;
}
