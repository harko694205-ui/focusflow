import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { CalendarCheck2, Info, Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { durationMinutes } from '@/domain/schedule';
import { taskRef } from '@/domain/constants';
import type { Task } from '@/domain/types';
import { useNow, useTasks } from '@/hooks/data';
import { blockActions } from '@/features/timeline/actions';
import { Button } from '@/ui/Button';
import { Skeleton } from '@/ui/Feedback';
import { explain, type Tone } from './explain';
import { useLivePlan } from './usePlan';

const TONE: Record<Tone, string> = {
  positive: 'bg-positive',
  warning: 'bg-warning',
  negative: 'bg-negative',
  muted: 'bg-fg-faint',
};

/**
 * "When should I do this?" — the scheduler's recommendation for one task, planned around everything
 * else (other tasks get their share of free time too). Accepting it writes the sessions to the
 * timeline in one undoable step.
 */
export function RecommendationSection({ task, stale }: { task: Task; stale: boolean }) {
  const plan = useLivePlan();
  const tasks = useTasks();
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => new Map((tasks ?? []).map((t) => [t.id, t])), [tasks]);
  const rec = plan?.recommendations.get(task.id);
  if (task.status === 'done') return null;

  const ex = rec && byId.has(task.id) ? explain(rec, task, byId, now) : null;
  const accept = async () => {
    if (!rec) return;
    setBusy(true);
    await blockActions.scheduleSessions(task.id, rec.sessions.map((s) => ({ start: s.start, end: s.end })), taskRef(task.seq));
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
          <Sparkles size={12} className="text-accent" />
          Recommended plan
        </span>
        {rec && rec.sessions.length > 0 && (
          <Button size="sm" variant="secondary" icon={CalendarCheck2} onClick={() => void accept()} disabled={busy || stale}>
            Schedule {rec.sessions.length === 1 ? 'it' : `${rec.sessions.length} sessions`}
          </Button>
        )}
      </div>
      {!rec || !ex ? (
        <Skeleton className="h-16" />
      ) : (
        <div className="overflow-hidden rounded-sm border border-line">
          <div className="flex items-start gap-2 px-2.5 py-2 text-xs">
            <span className={cn('mt-[5px] size-1.5 shrink-0 rounded-full', TONE[ex.tone])} />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-fg">{ex.headline}</span>
              {ex.notes.map((n) => (
                <span key={n} className="text-2xs text-fg-subtle">
                  {n}
                </span>
              ))}
            </div>
          </div>
          {rec.sessions.length > 0 && (
            <ul className="border-t border-dashed border-line-strong">
              {rec.sessions.map((s) => (
                <li key={s.id} className="num flex h-7 items-center gap-2 px-2.5 text-xs text-fg-muted">
                  <span className="w-[92px] shrink-0">{format(s.start, 'EEE MMM d')}</span>
                  <span>
                    {format(s.start, 'HH:mm')}–{format(s.end, 'HH:mm')}
                  </span>
                  <span className="text-fg-subtle">{formatDuration(durationMinutes(s), { compact: true })}</span>
                  {s.end > task.deadline && <span className="text-warning">after deadline</span>}
                </li>
              ))}
            </ul>
          )}
          {stale && (
            <div className="flex items-center gap-1.5 border-t border-line bg-[rgb(255_255_255/0.012)] px-2.5 py-1.5 text-2xs text-fg-subtle">
              <Info size={11} />
              Based on the saved task — save your changes to update it.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
