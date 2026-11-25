import { useMemo, useState } from 'react';
import { addDays, format, isSameDay } from 'date-fns';
import { ChevronDown, GraduationCap, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { examProgress, type PrepProgress } from '@/domain/exam';
import { startOfLocalDay } from '@/domain/schedule';
import type { Exam, ID, Task } from '@/domain/types';
import { formatDuration } from '@/lib/format';
import { useExams, useSessions, useTerms, useWorkspace } from '@/hooks/data';
import { ExamCard, countdown } from '@/features/exams/ExamCard';
import { ExamEditor } from '@/features/exams/ExamEditor';
import { useExamEditor } from '@/features/exams/store';
import { useTermWeekFor } from '@/features/term/useTerm';
import { categoryColor } from '@/features/tasks/TaskMeta';
import { Button } from '@/ui/Button';
import { EmptyState, Skeleton } from '@/ui/Feedback';
import { Tooltip } from '@/ui/Tooltip';
import { Page, PageHeader } from './PageHeader';

const DAYS = 14;
const HEAVY = 4 * 60; // a day with more study than this is flagged

interface Row {
  exam: Exam;
  progress: PrepProgress;
  sessions: Task[];
}

export function ExamsPage() {
  const ws = useWorkspace();
  const exams = useExams();
  const allSessions = useSessions();
  const terms = useTerms();
  const openEditor = useExamEditor((s) => s.open);
  const [showPast, setShowPast] = useState(false);
  const loading = ws.loading || !exams || !allSessions;

  const rows = useMemo<Row[]>(() => {
    if (loading) return [];
    const tracked = new Map<ID, number>();
    for (const s of allSessions!) tracked.set(s.taskId, (tracked.get(s.taskId) ?? 0) + (s.end - s.start) / 60_000);
    const byExam = new Map<ID, Task[]>();
    for (const t of ws.tasks) if (t.examId) byExam.set(t.examId, [...(byExam.get(t.examId) ?? []), t]);
    return exams!.map((exam) => {
      const sessions = (byExam.get(exam.id) ?? []).sort((a, b) => a.deadline - b.deadline);
      return { exam, sessions, progress: examProgress(exam, sessions, tracked, ws.now) };
    });
  }, [loading, exams, allSessions, ws.tasks, ws.now]);

  const upcoming = rows.filter((r) => r.exam.start + r.exam.duration * 60_000 > ws.now);
  const past = rows.filter((r) => !upcoming.includes(r)).reverse();
  const next = upcoming[0];

  return (
    <Page>
      <PageHeader
        title="Exams"
        meta={
          loading ? undefined : upcoming.length ? (
            <>
              <span>{upcoming.length} upcoming</span>
              <span className="text-fg-faint">·</span>
              <span>
                Next: <span className="text-fg-muted">{next.exam.title}</span> {countdown(next.exam.start, ws.now)}
              </span>
            </>
          ) : (
            <span>Plan your midterms and finals</span>
          )
        }
        actions={
          <Button variant="primary" icon={Plus} onClick={() => openEditor({ mode: 'create' })} disabled={!ws.categories.length}>
            Add exam
          </Button>
        }
      />

      {loading ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-[112px]" />
          <Skeleton className="h-[220px]" />
        </div>
      ) : !rows.length ? (
        <div className="rounded-md border border-line bg-panel">
          <EmptyState
            icon={GraduationCap}
            title="No exams yet"
            description={`Add your midterms and finals with the topics they cover. FocusFlow spreads review sessions over the days before each one — weak topics more often, a practice exam, and a light last day — and puts them on your timeline around your other ${terms.lowerMany}.`}
            actions={
              <Button variant="primary" icon={Plus} onClick={() => openEditor({ mode: 'create' })} disabled={!ws.categories.length}>
                Add your first exam
              </Button>
            }
            className="py-16"
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {upcoming.length > 0 && <CrunchStrip rows={upcoming} tasks={ws.tasks} now={ws.now} categoryColorOf={(id) => categoryColor(ws.categoryMap.get(id))} />}

          {upcoming.length === 0 && (
            <p className="rounded-md border border-dashed border-line-strong px-4 py-6 text-center text-sm text-fg-subtle">No upcoming exams. Nice — or add the next one.</p>
          )}
          <div className="grid gap-3 xl:grid-cols-2">
            {upcoming.map((r) => (
              <ExamCard key={r.exam.id} exam={r.exam} category={ws.categoryMap.get(r.exam.categoryId)} progress={r.progress} sessions={r.sessions} schedule={ws.schedule} now={ws.now} />
            ))}
          </div>

          {past.length > 0 && (
            <section aria-label="Past exams" className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setShowPast((x) => !x)}
                aria-expanded={showPast}
                className="focus-ring flex w-fit items-center gap-1 rounded-xs text-xs font-medium text-fg-subtle hover:text-fg-muted"
              >
                <ChevronDown size={12} className={cn('transition-transform', !showPast && '-rotate-90')} />
                Past exams ({past.length})
              </button>
              {showPast && (
                <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-md border border-line bg-panel">
                  {past.map((r) => (
                    <li key={r.exam.id} className="flex items-center gap-3 px-3.5 py-2 text-sm">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: categoryColor(ws.categoryMap.get(r.exam.categoryId)) }} />
                      <span className="min-w-0 flex-1 truncate text-fg">{r.exam.title}</span>
                      <span className="text-xs text-fg-subtle">{ws.categoryMap.get(r.exam.categoryId)?.name}</span>
                      <span className="num w-24 text-right text-xs text-fg-subtle">{format(r.exam.start, 'MMM d')}</span>
                      <span className="num w-28 text-right text-xs text-fg-muted">
                        {formatDuration(r.progress.done, { compact: true })} of {formatDuration(r.progress.target, { compact: true })} prep
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
      <ExamEditor />
    </Page>
  );
}

/** The next two weeks at a glance: study time per day and where the exams fall. */
function CrunchStrip({ rows, tasks, now, categoryColorOf }: { rows: Row[]; tasks: Task[]; now: number; categoryColorOf: (id: ID) => string }) {
  const termWeekFor = useTermWeekFor();
  const days = Array.from({ length: DAYS }, (_, i) => addDays(startOfLocalDay(now), i));
  const studyByDay = days.map((d) => tasks.filter((t) => t.examId && t.status !== 'done' && isSameDay(t.deadline, d)).reduce((a, t) => a + t.estimate, 0));
  const max = Math.max(HEAVY, ...studyByDay);
  const examsIn = rows.filter((r) => r.exam.start < days[DAYS - 1].getTime() + 86_400_000);

  return (
    <section aria-label="Next two weeks" className="overflow-x-auto rounded-md border border-line bg-panel">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3.5 py-2.5">
        <span className="text-xs font-medium text-fg">Next two weeks</span>
        <span className="text-2xs text-fg-subtle">
          Bars: planned study per day{examsIn.length < rows.length ? ` · ${rows.length - examsIn.length} more exam${rows.length - examsIn.length === 1 ? '' : 's'} later` : ''}
        </span>
      </div>
      <ol className="grid min-w-[760px] grid-cols-[repeat(14,minmax(0,1fr))]">
        {days.map((d, i) => {
          const examsToday = rows.filter((r) => isSameDay(r.exam.start, d));
          const minutes = studyByDay[i];
          const heavy = minutes > HEAVY;
          const week = d.getDay() === 1 || i === 0 ? termWeekFor(d) : null;
          return (
            <li key={i} className={cn('flex min-h-[132px] flex-col gap-1.5 border-l border-line px-1.5 py-2 first:border-l-0', i === 0 && 'bg-[rgb(124_131_255/0.05)]')}>
              <div className="flex flex-col items-center leading-tight">
                <span className={cn('text-2xs', i === 0 ? 'text-accent' : 'text-fg-subtle')}>{i === 0 ? 'Today' : format(d, 'EEE')}</span>
                <span className="num text-xs text-fg">{format(d, 'd')}</span>
                <span className="h-3 text-[10px] text-fg-subtle">{week?.short ?? ''}</span>
              </div>
              <Tooltip content={minutes ? `${formatDuration(minutes, { compact: true })} of study planned${heavy ? ' — a heavy day' : ''}` : 'No study planned'}>
                <div className="relative mx-auto flex h-12 w-3 items-end overflow-hidden rounded-full bg-active" aria-label={`${format(d, 'EEEE')}: ${formatDuration(minutes, { compact: true })} planned`}>
                  <span className={cn('w-full rounded-full', heavy ? 'bg-warning' : 'bg-accent')} style={{ height: `${(minutes / max) * 100}%` }} />
                </div>
              </Tooltip>
              <span className="num text-center text-[10px] text-fg-subtle">{minutes ? formatDuration(minutes, { compact: true }) : ''}</span>
              {examsToday.map((r) => (
                <Tooltip key={r.exam.id} content={`${r.exam.title} · ${format(r.exam.start, 'HH:mm')}`}>
                  <span
                    className="truncate rounded-xs px-1 py-0.5 text-center text-[10px] font-medium text-canvas"
                    style={{ background: categoryColorOf(r.exam.categoryId) }}
                  >
                    {r.exam.title}
                  </span>
                </Tooltip>
              ))}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
