import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { format, getISOWeek } from 'date-fns';
import { FlaskConical } from 'lucide-react';
import { summarize } from '@/domain/stats';
import { buildLoadForecast, todayStrip, workdayEnvelope } from '@/domain/forecast';
import { categoryColor } from '@/features/tasks/TaskMeta';
import { useSessions, useWorkspace } from '@/hooks/data';
import { Button } from '@/ui/Button';
import { Page, PageHeader } from './PageHeader';
import { TodayPanel } from './command-center/TodayPanel';
import { CategoriesPanel, DeadlineRadar, KpiStrip, QueuePanel } from './command-center/Panels';
import { FocusWeekPanel, LoadForecastPanel } from './command-center/Charts';
import { useTermStatus } from '@/features/term/useTerm';

export function CommandCenter() {
  const navigate = useNavigate();
  const ws = useWorkspace();
  const term = useTermStatus(ws.now);
  const sessions = useSessions();
  const summary = useMemo(() => summarize(ws.tasks, ws.risk, ws.now, ws.week), [ws.tasks, ws.risk, ws.now, ws.week]);
  const taskMap = useMemo(() => new Map(ws.tasks.map((t) => [t.id, t])), [ws.tasks]);
  const forecast = useMemo(() => buildLoadForecast(ws.blocks, taskMap, ws.now, 14, ws.week), [ws.blocks, taskMap, ws.now, ws.week]);
  const today = useMemo(
    () =>
      todayStrip(
        ws.blocks,
        taskMap,
        (t) => categoryColor(ws.categoryMap.get(t.categoryId)),
        (t) => ws.categoryMap.get(t.categoryId)?.name,
        ws.now,
      ),
    [ws.blocks, taskMap, ws.categoryMap, ws.now],
  );
  const workday = useMemo(() => workdayEnvelope(ws.now, ws.week), [ws.now, ws.week]);

  return (
    <Page>
      <PageHeader
        title="Command Center"
        meta={
          <>
            <span>{format(ws.now, 'EEEE, MMMM d')}</span>
            <span className="text-fg-faint">·</span>
            {term ? (
              <>
                <span className="text-fg-muted">
                  {term.term.name} · {term.week.label}
                </span>
                {term.finals && (
                  <>
                    <span className="text-fg-faint">·</span>
                    <span>{term.finals}</span>
                  </>
                )}
              </>
            ) : (
              <span className="num">W{getISOWeek(ws.now)}</span>
            )}
          </>
        }
        actions={
          <Button icon={FlaskConical} onClick={() => navigate('/simulator')}>
            Simulate changes
          </Button>
        }
      />

      <div className="flex flex-col gap-4">
        <KpiStrip summary={summary} loading={ws.loading} />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="flex min-w-0 xl:col-span-8 [&>*]:flex-1">
            <TodayPanel todayBlocks={today} workday={workday} />
          </div>
          <div className="flex min-w-0 xl:col-span-4 [&>*]:flex-1">
            <DeadlineRadar {...ws} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="flex min-w-0 xl:col-span-8 [&>*]:flex-1">
            <QueuePanel {...ws} />
          </div>
          <div className="flex min-w-0 xl:col-span-4 [&>*]:flex-1">
            <CategoriesPanel {...ws} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="flex min-w-0 xl:col-span-8 [&>*]:flex-1">
            <LoadForecastPanel forecast={forecast} />
          </div>
          <div className="flex min-w-0 xl:col-span-4 [&>*]:flex-1">
            <FocusWeekPanel blocks={ws.blocks} sessions={sessions ?? []} now={ws.now} />
          </div>
        </div>
      </div>
    </Page>
  );
}
