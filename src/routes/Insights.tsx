import { useMemo, useState } from 'react';
import { ChartNoAxesCombined, History, Lightbulb, Timer, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { computeInsights, type Insights } from '@/domain/insights';
import { useSessions, useWorkspace } from '@/hooks/data';
import { Button } from '@/ui/Button';
import { SegmentedControl, Stat } from '@/ui/Data';
import { EmptyState, Skeleton } from '@/ui/Feedback';
import { Kbd } from '@/ui/Kbd';
import { taskActions } from '@/features/tasks/actions';
import { findings, type Finding } from '@/features/insights/findings';
import { AccuracyPanel, AllocationPanel, CompletionPanel, HoursPanel, MissesPanel, PostponedPanel, WorkloadPanel } from '@/features/insights/Panels';
import { Page, PageHeader } from './PageHeader';

type Weeks = '4' | '8' | '12';
const pct = (x: number | null) => (x === null ? '—' : String(Math.round(x * 100)));

export function InsightsPage() {
  const ws = useWorkspace();
  const sessions = useSessions();
  const [weeks, setWeeks] = useState<Weeks>('8');
  const loading = ws.loading || sessions === undefined;

  const insights = useMemo(
    () => (loading ? null : computeInsights({ tasks: ws.tasks, blocks: ws.blocks, sessions: sessions!, now: ws.now, weeks: Number(weeks) })),
    [loading, ws.tasks, ws.blocks, sessions, ws.now, weeks],
  );
  const facts = useMemo(() => (insights ? findings(insights, ws.categoryMap) : []), [insights, ws.categoryMap]);
  const hasHistory = !!insights && (insights.trackedTotal > 0 || insights.completion.due > 0 || insights.accuracy.rows.length > 0);

  return (
    <Page>
      <PageHeader
        title="Insights"
        meta={
          insights && (
            <>
              <span>Last {weeks} weeks</span>
              <span className="text-fg-faint">·</span>
              <span className="num">{formatDuration(insights.trackedTotal, { compact: true })} tracked</span>
              <span className="text-fg-faint">·</span>
              <span className="num">{insights.completion.weekly.reduce((a, w) => a + w.finished, 0)} tasks finished</span>
            </>
          )
        }
        actions={
          <SegmentedControl
            size="md"
            value={weeks}
            onChange={setWeeks}
            options={[
              { value: '4', label: '4 weeks' },
              { value: '8', label: '8 weeks' },
              { value: '12', label: '12 weeks' },
            ]}
          />
        }
      />

      {loading || !insights ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-[86px]" />
          <Skeleton className="h-[300px]" />
          <Skeleton className="h-[300px]" />
        </div>
      ) : !hasHistory ? (
        <div className="rounded-md border border-line bg-panel">
          <EmptyState
            icon={ChartNoAxesCombined}
            title="Insights build up as you work"
            description={
              <span className="flex flex-col items-center gap-1.5">
                <span>Track time with the focus timer and finish tasks — FocusFlow learns how long your work really takes, when you focus best and what keeps slipping.</span>
                <span className="flex items-center gap-1.5 text-2xs">
                  Select a task and press <Kbd keys={['S']} /> to start the timer.
                </span>
              </span>
            }
            actions={
              <Button icon={History} onClick={() => void taskActions.addSampleHistory()}>
                Add sample history
              </Button>
            }
            className="py-16"
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <KpiStrip insights={insights} />
          {insights.trackedTotal === 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed border-line-strong px-3.5 py-2.5 text-xs text-fg-subtle">
              <Timer size={13} className="shrink-0" />
              <span className="min-w-0 flex-1">
                No tracked time in this period, so estimate accuracy and focus hours are limited. Select a task and press <Kbd keys={['S']} /> to start a focus timer, or log time in the task editor.
              </span>
              <Button size="sm" icon={History} onClick={() => void taskActions.addSampleHistory()}>
                Add sample history
              </Button>
            </div>
          )}
          {facts.length > 0 && <Findings items={facts} />}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="flex min-w-0 xl:col-span-8 [&>*]:flex-1">
              <WorkloadPanel weeks={insights.workload} />
            </div>
            <div className="flex min-w-0 xl:col-span-4 [&>*]:flex-1">
              <CompletionPanel stats={insights.completion} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="flex min-w-0 xl:col-span-8 [&>*]:flex-1">
              <AccuracyPanel stats={insights.accuracy} categories={ws.categoryMap} />
            </div>
            <div className="flex min-w-0 xl:col-span-4 [&>*]:flex-1">
              <MissesPanel stats={insights.accuracy} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="flex min-w-0 xl:col-span-8 [&>*]:flex-1">
              <HoursPanel stats={insights.hours} />
            </div>
            <div className="flex min-w-0 xl:col-span-4 [&>*]:flex-1">
              <AllocationPanel stats={insights.allocation} categories={ws.categoryMap} />
            </div>
          </div>

          <PostponedPanel stats={insights.postponed} categories={ws.categoryMap} />
        </div>
      )}
    </Page>
  );
}

function KpiStrip({ insights: i }: { insights: Insights }) {
  const c = i.completion;
  const a = i.accuracy;
  const past = i.workload.filter((w) => !w.current);
  const avgTracked = past.length ? past.reduce((s, w) => s + w.tracked, 0) / past.length : 0;
  const avgScheduled = past.length ? past.reduce((s, w) => s + w.scheduled, 0) / past.length : 0;
  const peak = i.hours.peak;
  const hh = (h: number) => String(h).padStart(2, '0');

  const cells = [
    {
      label: 'Completion rate',
      value: pct(c.rate),
      unit: c.rate === null ? undefined : '%',
      sub: (
        <span className="num text-xs text-fg-subtle">
          {c.completed} of {c.due} due{c.missed ? <span className="text-negative"> · {c.missed} open</span> : ''}
        </span>
      ),
    },
    {
      label: 'On time',
      value: pct(c.onTimeRate),
      unit: c.onTimeRate === null ? undefined : '%',
      sub: (
        <span className="num text-xs text-fg-subtle">
          {c.late ? `${c.late} late${c.medianLateBy !== null ? ` · ~${formatDuration(c.medianLateBy, { compact: true })} over` : ''}` : 'None late'}
        </span>
      ),
    },
    {
      label: 'Actual vs estimate',
      value: a.ratio === null ? '—' : a.ratio.toFixed(2),
      unit: a.ratio === null ? undefined : '×',
      sub:
        a.ratio === null ? (
          <span className="text-xs text-fg-subtle">No finished work with time</span>
        ) : (
          <span className={cn('flex items-center gap-1 text-xs', a.ratio > 1.1 ? 'text-warning' : a.ratio < 0.9 ? 'text-positive' : 'text-fg-subtle')}>
            {a.ratio > 1 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {a.ratio > 1 ? `${Math.round((a.ratio - 1) * 100)}% longer` : `${Math.round((1 - a.ratio) * 100)}% shorter`} than planned
          </span>
        ),
    },
    {
      label: 'Focus per week',
      value: formatDuration(avgTracked, { compact: true }),
      sub: <span className="num text-xs text-fg-subtle">of {formatDuration(avgScheduled, { compact: true })} scheduled</span>,
    },
    {
      label: 'Peak hours',
      value: peak ? `${hh(peak.startHour)}–${hh(peak.startHour + 2)}` : '—',
      sub: peak ? (
        <span className="num text-xs text-fg-subtle">{Math.round(peak.share * 100)}% of tracked time</span>
      ) : (
        <span className="flex items-center gap-1 text-xs text-fg-subtle">
          <Timer size={11} /> Track time to find them
        </span>
      ),
    },
  ];

  return (
    <section aria-label="Key metrics" className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line lg:grid-cols-5">
      {cells.map((c, idx) => (
        <div key={c.label} className={cn('bg-panel px-4 py-3.5', idx === cells.length - 1 && 'col-span-2 lg:col-span-1')}>
          <Stat label={c.label} value={c.value} unit={c.unit} sub={c.sub} />
        </div>
      ))}
    </section>
  );
}

const TONE: Record<Finding['tone'], string> = { positive: 'bg-positive', warning: 'bg-warning', neutral: 'bg-accent' };

function Findings({ items }: { items: Finding[] }) {
  return (
    <section aria-label="Findings" className="overflow-hidden rounded-md border border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        <Lightbulb size={13} className="text-fg-subtle" />
        <span className="text-xs font-medium text-fg">What the data says</span>
      </div>
      {/* Cells draw their own right/bottom borders; the list overhangs by 1px so outer edges are hidden. */}
      <ul className="-mb-px -mr-px flex flex-wrap">
        {items.slice(0, 6).map((f) => (
          <li key={f.id} className="flex min-w-[280px] flex-1 basis-[30%] gap-2.5 border-b border-r border-line px-3.5 py-3">
            <span className={cn('mt-[5px] size-1.5 shrink-0 rounded-full', TONE[f.tone])} />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm text-fg">{f.title}</span>
              <span className="text-xs text-fg-subtle">{f.detail}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
