import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { CalendarClock, CheckCircle2, Clock3, Flame, PieChart, Repeat2, Scale, Timer } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { DIFFICULTIES, taskRef } from '@/domain/constants';
import type { AccuracyStats, AllocationStats, CompletionStats, HourStats, PostponedStats, WeekLoad } from '@/domain/insights';
import type { Category, Difficulty, ID } from '@/domain/types';
import { useUI } from '@/app/store';
import { categoryColor } from '@/features/tasks/TaskMeta';
import { Panel, PanelHeader, Tag } from '@/ui/Data';
import { EmptyState } from '@/ui/Feedback';

const axisTick = { fill: 'var(--color-fg-subtle)', fontSize: 11, fontFamily: 'var(--font-mono)' };
const hours = (v: number) => `${Math.round(v / 60)}h`;
const DIFF_COLOR: Record<Difficulty, string> = { 1: 'var(--color-admin)', 2: 'var(--color-shallow)', 3: 'var(--color-deep)' };
/** Whole-hour axis ticks (in minutes) up to at least `max`, about 4–6 of them. */
function hourTicks(max: number): number[] {
  const h = Math.max(1, max / 60);
  const step = [1, 2, 5, 10, 20, 50].find((s) => h / s <= 5) ?? 100;
  const top = Math.ceil(h / step) * step;
  return Array.from({ length: top / step + 1 }, (_, i) => i * step * 60);
}
const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-[180px] rounded-sm border border-line-strong bg-raised px-3 py-2 shadow-pop">
      <div className="mb-1.5 text-xs font-medium text-fg">{title}</div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}
function Row({ color, label, value }: { color?: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {color && <span className="size-2 rounded-[2px]" style={{ background: color }} />}
      <span className="flex-1 text-fg-muted">{label}</span>
      <span className="num text-fg">{value}</span>
    </div>
  );
}
function Legend({ items }: { items: Array<{ color: string; label: string; line?: boolean }> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-subtle">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className={i.line ? 'h-px w-3' : 'size-2 rounded-[2px]'} style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}
function Empty({ icon, title, description }: { icon: typeof Timer; title: string; description: string }) {
  return <EmptyState compact icon={icon} title={title} description={description} className="flex-1 py-8" />;
}

/* -------------------------------------------------------------------------- */
/* Weekly workload                                                            */
/* -------------------------------------------------------------------------- */

export function WorkloadPanel({ weeks }: { weeks: WeekLoad[] }) {
  const yTicks = hourTicks(Math.max(...weeks.map((w) => Math.max(w.capacity, w.tracked, w.scheduled, w.events)), 60));
  const data = weeks.map((w) => ({ ...w, label: w.current ? 'This wk' : w.label }));
  const any = weeks.some((w) => w.tracked || w.scheduled);
  return (
    <Panel>
      <PanelHeader
        title="Weekly workload"
        icon={CalendarClock}
        actions={
          <Legend
            items={[
              { color: 'rgb(255 255 255 / 0.12)', label: 'Scheduled' },
              { color: 'var(--color-accent)', label: 'Tracked' },
              { color: 'var(--color-event)', label: 'Meetings' },
              { color: 'var(--color-fg-faint)', label: 'Capacity', line: true },
            ]}
          />
        }
      />
      {!any ? (
        <Empty icon={CalendarClock} title="No workload yet" description="Scheduled blocks and tracked time will show up here week by week." />
      ) : (
        <div className="h-[240px] px-1.5 pb-1 pt-3">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barGap={2} barCategoryGap="24%">
              <CartesianGrid vertical={false} stroke="var(--color-line)" />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--color-line-strong)' }} tick={{ ...axisTick, fontFamily: 'var(--font-sans)' }} />
              <YAxis tickLine={false} axisLine={false} tick={axisTick} width={36} tickFormatter={hours} ticks={yTicks} domain={[0, yTicks[yTicks.length - 1]]} />
              <Tooltip
                cursor={{ fill: 'rgb(255 255 255 / 0.03)' }}
                isAnimationActive={false}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const w = payload[0].payload as WeekLoad;
                  return (
                    <Shell title={`Week of ${format(w.start, 'MMM d')}`}>
                      <Row color="rgb(255 255 255 / 0.25)" label="Scheduled" value={formatDuration(w.scheduled)} />
                      <Row color="var(--color-accent)" label="Tracked" value={formatDuration(w.tracked)} />
                      <Row color="var(--color-event)" label="Meetings" value={formatDuration(w.events)} />
                      <Row label="Capacity" value={formatDuration(w.capacity)} />
                      <Row label="Estimates finished" value={formatDuration(w.completedEstimate)} />
                    </Shell>
                  );
                }}
              />
              <Bar dataKey="scheduled" fill="rgb(255 255 255 / 0.1)" radius={[2, 2, 0, 0]} maxBarSize={18} isAnimationActive={false} />
              <Bar dataKey="tracked" fill="var(--color-accent)" radius={[2, 2, 0, 0]} maxBarSize={18} isAnimationActive={false} />
              <Bar dataKey="events" fill="var(--color-event)" radius={[2, 2, 0, 0]} maxBarSize={18} isAnimationActive={false} />
              <Line dataKey="capacity" type="step" stroke="var(--color-fg-faint)" strokeDasharray="3 3" dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Completion                                                                 */
/* -------------------------------------------------------------------------- */

export function CompletionPanel({ stats }: { stats: CompletionStats }) {
  return (
    <Panel>
      <PanelHeader title="Completion" icon={CheckCircle2} meta={<span className="num">{stats.due} due</span>} />
      {stats.due === 0 && stats.weekly.every((w) => !w.finished) ? (
        <Empty icon={CheckCircle2} title="Nothing due yet" description="Deadlines that pass in this period are scored here." />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-px border-b border-line bg-line">
            {[
              { label: 'On time', value: stats.onTime, color: 'text-positive' },
              { label: 'Late', value: stats.late, color: 'text-warning' },
              { label: 'Missed', value: stats.missed, color: 'text-negative' },
            ].map((x) => (
              <div key={x.label} className="bg-panel px-3.5 py-2.5">
                <div className="eyebrow">{x.label}</div>
                <div className={cn('num mt-1 text-lg leading-none', x.color)}>{x.value}</div>
              </div>
            ))}
          </div>
          <div className="h-[168px] px-1.5 pb-1 pt-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.weekly} margin={{ top: 4, right: 12, bottom: 0, left: 0 }} barCategoryGap="28%">
                <CartesianGrid vertical={false} stroke="var(--color-line)" />
                <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--color-line-strong)' }} tick={{ ...axisTick, fontSize: 10, fontFamily: 'var(--font-sans)' }} interval="preserveStartEnd" />
                <YAxis tickLine={false} axisLine={false} tick={axisTick} width={24} allowDecimals={false} />
                <Tooltip
                  cursor={{ fill: 'rgb(255 255 255 / 0.03)' }}
                  isAnimationActive={false}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const w = payload[0].payload as CompletionStats['weekly'][number];
                    return (
                      <Shell title={`Due week of ${w.label}`}>
                        <Row color="var(--color-positive)" label="On time" value={String(w.onTime)} />
                        <Row color="var(--color-warning)" label="Late" value={String(w.late)} />
                        <Row color="var(--color-negative)" label="Missed" value={String(w.missed)} />
                        <Row label="Finished that week" value={String(w.finished)} />
                      </Shell>
                    );
                  }}
                />
                <Bar dataKey="onTime" stackId="a" fill="var(--color-positive)" maxBarSize={16} isAnimationActive={false} />
                <Bar dataKey="late" stackId="a" fill="var(--color-warning)" maxBarSize={16} isAnimationActive={false} />
                <Bar dataKey="missed" stackId="a" fill="var(--color-negative)" radius={[2, 2, 0, 0]} maxBarSize={16} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Estimate vs actual                                                         */
/* -------------------------------------------------------------------------- */

function RatioBar({ ratio }: { ratio: number | null }) {
  if (ratio === null) return <span className="text-fg-faint">—</span>;
  // Centered at 1×; ±100% fills the half.
  const d = Math.max(-1, Math.min(1, ratio - 1));
  const over = d > 0;
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-24 rounded-full bg-[rgb(255_255_255/0.05)]">
        <span className="absolute inset-y-[-2px] left-1/2 w-px bg-line-strong" />
        <span
          className={cn('absolute inset-y-0 rounded-full', over ? 'bg-warning' : 'bg-positive')}
          style={over ? { left: '50%', width: `${d * 50}%` } : { right: '50%', width: `${-d * 50}%` }}
        />
      </div>
      <span className={cn('num w-10 text-right text-xs', Math.abs(ratio - 1) < 0.1 ? 'text-fg-muted' : over ? 'text-warning' : 'text-positive')}>
        {ratio.toFixed(2)}×
      </span>
    </div>
  );
}

export function AccuracyPanel({ stats, categories }: { stats: AccuracyStats; categories: ReadonlyMap<ID, Category> }) {
  const openEdit = useUI((s) => s.openEdit);
  const points = useMemo(
    () => stats.rows.map((r) => ({ x: r.estimate, y: r.actual, taskId: r.task.id, name: r.task.title, code: taskRef(r.task.seq), difficulty: r.task.difficulty, source: r.source })),
    [stats.rows],
  );
  const ticks = hourTicks(Math.max(60, ...points.map((p) => Math.max(p.x, p.y))));
  const top = ticks[ticks.length - 1];

  return (
    <Panel>
      <PanelHeader
        title="Estimated vs actual"
        icon={Scale}
        meta={
          stats.rows.length > 0 && (
            <span className="num">
              {stats.rows.length} tasks · {stats.tracked} tracked{stats.scheduled ? ` · ${stats.scheduled} from schedule` : ''}
            </span>
          )
        }
        actions={<Legend items={([1, 2, 3] as Difficulty[]).map((d) => ({ color: DIFF_COLOR[d], label: DIFFICULTIES[d].label }))} />}
      />
      {stats.rows.length === 0 ? (
        <Empty icon={Scale} title="No finished work with time yet" description="Finish tasks you've tracked time on (or scheduled) to compare estimates with reality." />
      ) : (
        <div className="grid flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="h-[260px] px-1.5 pb-1 pt-3">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid stroke="var(--color-line)" />
                <XAxis
                  type="number"
                  dataKey="x"
                  name="Estimate"
                  domain={[0, top]}
                  ticks={ticks}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--color-line-strong)' }}
                  tick={axisTick}
                  tickFormatter={hours}
                  label={{ value: 'Estimate', position: 'insideBottomRight', offset: -4, fill: 'var(--color-fg-subtle)', fontSize: 10 }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name="Actual"
                  domain={[0, top]}
                  ticks={ticks}
                  tickLine={false}
                  axisLine={false}
                  tick={axisTick}
                  width={36}
                  tickFormatter={hours}
                />
                <ZAxis range={[36, 36]} />
                <ReferenceLine
                  segment={[
                    { x: 0, y: 0 },
                    { x: top, y: top },
                  ]}
                  stroke="var(--color-fg-faint)"
                  strokeDasharray="4 4"
                  ifOverflow="hidden"
                />
                <Tooltip
                  isAnimationActive={false}
                  cursor={{ strokeDasharray: '3 3', stroke: 'var(--color-line-strong)' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload as (typeof points)[number];
                    return (
                      <Shell title={`${p.code} · ${p.name}`}>
                        <Row label="Estimate" value={formatDuration(p.x)} />
                        <Row label={p.source === 'tracked' ? 'Tracked' : 'Scheduled'} value={formatDuration(p.y)} />
                        <Row label="Ratio" value={`${(p.y / p.x).toFixed(2)}×`} />
                      </Shell>
                    );
                  }}
                />
                {([1, 2, 3] as Difficulty[]).map((d) => (
                  <Scatter
                    key={d}
                    data={points.filter((p) => p.difficulty === d)}
                    fill={DIFF_COLOR[d]}
                    fillOpacity={0.75}
                    isAnimationActive={false}
                    onClick={(p: { taskId?: string; payload?: { taskId: string } }) => {
                      const id = p.payload?.taskId ?? p.taskId;
                      if (id) openEdit(id);
                    }}
                    className="cursor-pointer"
                  />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-col gap-3 border-t border-line px-3.5 py-3 lg:border-l lg:border-t-0">
            <div className="flex items-baseline justify-between">
              <span className="eyebrow">Overall</span>
              <span className="text-2xs text-fg-subtle">{pct(stats.withinBand)} within ±20%</span>
            </div>
            <RatioBar ratio={stats.ratio} />
            <span className="eyebrow pt-1">By difficulty</span>
            <ul className="flex flex-col gap-1.5">
              {stats.byDifficulty.map((g) => (
                <li key={g.key} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex items-center gap-1.5 text-fg-muted">
                    <span className="size-2 rounded-[2px]" style={{ background: DIFF_COLOR[g.key] }} />
                    {DIFFICULTIES[g.key].label}
                    <span className="num text-2xs text-fg-subtle">{g.n}</span>
                  </span>
                  <RatioBar ratio={g.ratio} />
                </li>
              ))}
            </ul>
            <span className="eyebrow pt-1">By category</span>
            <ul className="flex flex-col gap-1.5">
              {stats.byCategory.slice(0, 5).map((g) => {
                const c = categories.get(g.key);
                return (
                  <li key={g.key} className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex min-w-0 items-center gap-1.5 text-fg-muted">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: categoryColor(c) }} />
                      <span className="truncate">{c?.name ?? 'Deleted category'}</span>
                      <span className="num text-2xs text-fg-subtle">{g.n}</span>
                    </span>
                    <RatioBar ratio={g.ratio} />
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </Panel>
  );
}

/** Tasks that ran furthest over (or under) their estimate. */
export function MissesPanel({ stats }: { stats: AccuracyStats }) {
  const openEdit = useUI((s) => s.openEdit);
  const rows = [...stats.rows].sort((a, b) => Math.abs(b.actual - b.estimate) - Math.abs(a.actual - a.estimate)).slice(0, 7);
  return (
    <Panel>
      <PanelHeader title="Biggest misses" icon={Clock3} />
      {rows.length === 0 ? (
        <Empty icon={Clock3} title="No misses to show" description="Tasks that run far over or under their estimate appear here." />
      ) : (
        <ul className="flex flex-col">
          {rows.map((r) => {
            const diff = r.actual - r.estimate;
            return (
              <li key={r.task.id}>
                <button
                  type="button"
                  onClick={() => openEdit(r.task.id)}
                  className="focus-ring flex h-9 w-full items-center gap-2 border-b border-line px-3.5 text-left text-xs last:border-0 hover:bg-hover"
                >
                  <span className="num w-10 shrink-0 text-2xs text-fg-subtle">{taskRef(r.task.seq)}</span>
                  <span className="min-w-0 flex-1 truncate text-fg-muted">{r.task.title}</span>
                  <span className="num shrink-0 text-2xs text-fg-subtle">
                    {formatDuration(r.estimate, { compact: true })} → {formatDuration(r.actual, { compact: true })}
                  </span>
                  <span className={cn('num w-12 shrink-0 text-right', diff > 0 ? 'text-warning' : 'text-positive')}>
                    {diff > 0 ? '+' : '−'}
                    {formatDuration(Math.abs(diff), { compact: true })}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Productive hours                                                           */
/* -------------------------------------------------------------------------- */

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function HoursPanel({ stats }: { stats: HourStats }) {
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  const showWeekend = stats.byWeekday[5] + stats.byWeekday[6] > 0;
  const days = showWeekend ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4];
  const active = stats.byHour.map((m, h) => (m > 0 ? h : -1)).filter((h) => h >= 0);
  const lo = Math.min(7, ...active);
  const hi = Math.max(19, ...active);
  const cols = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const max = Math.max(1, ...stats.grid.flat());
  const peak = stats.peak;

  return (
    <Panel>
      <PanelHeader
        title="Most productive hours"
        icon={Flame}
        meta={peak && <span className="num">peak {String(peak.startHour).padStart(2, '0')}:00–{String(peak.startHour + 2).padStart(2, '0')}:00</span>}
      />
      {stats.total === 0 ? (
        <Empty icon={Timer} title="No tracked time yet" description="Start a focus timer on a task (S in the task list) or log time to see when you do your best work." />
      ) : (
        <div className="flex flex-col gap-3 px-3.5 py-3">
          <div className="overflow-x-auto">
            <div className="grid min-w-[480px] gap-[3px]" style={{ gridTemplateColumns: `32px repeat(${cols.length}, minmax(0, 1fr))` }}>
              <span />
              {cols.map((h) => (
                <span key={h} className="num text-center text-[10px] text-fg-subtle">
                  {h % 2 === 0 ? String(h).padStart(2, '0') : ''}
                </span>
              ))}
              {days.map((d) => (
                <div key={d} className="contents">
                  <span className="text-2xs leading-[18px] text-fg-subtle">{DAYS[d]}</span>
                  {cols.map((h) => {
                    const v = stats.grid[d][h];
                    const inPeak = peak && (h === peak.startHour || h === peak.startHour + 1);
                    return (
                      <span
                        key={h}
                        onMouseEnter={() => setHover({ d, h })}
                        onMouseLeave={() => setHover(null)}
                        className={cn('h-[18px] rounded-[2px] transition-[outline]', hover?.d === d && hover.h === h && 'outline outline-1 outline-fg-muted')}
                        style={{
                          background: v
                            ? `color-mix(in srgb, var(--color-accent) ${Math.round(15 + (v / max) * 85)}%, transparent)`
                            : inPeak
                              ? 'rgb(255 255 255 / 0.05)'
                              : 'rgb(255 255 255 / 0.025)',
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 text-2xs text-fg-subtle">
            <span className="num min-h-4">
              {hover
                ? `${DAYS[hover.d]} ${String(hover.h).padStart(2, '0')}:00–${String(hover.h + 1).padStart(2, '0')}:00 · ${formatDuration(stats.grid[hover.d][hover.h])} tracked`
                : `${formatDuration(stats.total, { compact: true })} tracked · hover a cell for detail`}
            </span>
            <span className="flex items-center gap-1">
              less
              {[0.15, 0.4, 0.65, 1].map((x) => (
                <span key={x} className="size-2.5 rounded-[2px]" style={{ background: `color-mix(in srgb, var(--color-accent) ${x * 100}%, transparent)` }} />
              ))}
              more
            </span>
          </div>
        </div>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Category allocation                                                        */
/* -------------------------------------------------------------------------- */

export function AllocationPanel({ stats, categories }: { stats: AllocationStats; categories: ReadonlyMap<ID, Category> }) {
  return (
    <Panel>
      <PanelHeader
        title="Time by category"
        icon={PieChart}
        meta={stats.total > 0 && <span className="num">{formatDuration(stats.total, { compact: true })} {stats.basis}</span>}
      />
      {stats.total === 0 ? (
        <Empty icon={PieChart} title="No time yet" description="Tracked (or scheduled) time is split by category here." />
      ) : (
        <div className="flex flex-col gap-3 px-3.5 py-3">
          <div className="flex h-2 overflow-hidden rounded-full">
            {stats.rows.map((r) => (
              <span key={r.categoryId} style={{ width: `${r.share * 100}%`, background: categoryColor(categories.get(r.categoryId)) }} />
            ))}
          </div>
          <ul className="flex flex-col gap-2">
            {stats.rows.map((r) => {
              const c = categories.get(r.categoryId);
              return (
                <li key={r.categoryId} className="flex items-center gap-2 text-xs">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: categoryColor(c) }} />
                  <span className="min-w-0 flex-1 truncate text-fg-muted">{c?.name ?? 'Deleted category'}</span>
                  <span className="num text-fg">{formatDuration(stats.basis === 'tracked' ? r.tracked : r.scheduled, { compact: true })}</span>
                  <span className="num w-10 text-right text-fg-subtle">{Math.round(r.share * 100)}%</span>
                </li>
              );
            })}
          </ul>
          {stats.basis === 'scheduled' && <p className="text-2xs text-fg-subtle">Based on scheduled time — nothing tracked in this period yet.</p>}
        </div>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Frequently postponed                                                       */
/* -------------------------------------------------------------------------- */

export function PostponedPanel({ stats, categories }: { stats: PostponedStats; categories: ReadonlyMap<ID, Category> }) {
  const openEdit = useUI((s) => s.openEdit);
  const rows = stats.rows.slice(0, 8);
  return (
    <Panel>
      <PanelHeader
        title="Frequently postponed"
        icon={Repeat2}
        meta={stats.rate !== null && <span className="num">{pct(stats.rate)} of recent tasks pushed at least once</span>}
      />
      {rows.length === 0 ? (
        <Empty icon={Repeat2} title="Nothing postponed" description="Pushing a deadline to a later day, or moving scheduled work to a later day, is counted here." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead>
              <tr className="h-8 border-b border-line text-left">
                {['Task', 'Category', 'Pushed', 'Moved', 'Slipped', 'Status'].map((h, i) => (
                  <th key={h} className={cn('eyebrow whitespace-nowrap px-3.5 font-normal', i >= 2 && i <= 4 && 'text-right')}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const c = categories.get(r.task.categoryId);
                return (
                  <tr key={r.task.id} onClick={() => openEdit(r.task.id)} className="h-9 cursor-pointer border-b border-line last:border-0 hover:bg-hover">
                    <td className="max-w-[320px] px-3.5">
                      <span className="flex items-center gap-2">
                        <span className="num shrink-0 text-2xs text-fg-subtle">{taskRef(r.task.seq)}</span>
                        <span className="truncate text-fg-muted">{r.task.title}</span>
                      </span>
                    </td>
                    <td className="px-3.5">
                      <span className="flex items-center gap-1.5 whitespace-nowrap text-fg-subtle">
                        <span className="size-2 shrink-0 rounded-full" style={{ background: categoryColor(c) }} />
                        {c?.name ?? '—'}
                      </span>
                    </td>
                    <td className="num px-3.5 text-right text-fg">{r.postponed ? `${r.postponed}×` : '—'}</td>
                    <td className="num px-3.5 text-right text-fg">{r.rescheduled ? `${r.rescheduled}×` : '—'}</td>
                    <td className="num px-3.5 text-right text-fg-muted">{r.slipDays ? `${r.slipDays}d` : '—'}</td>
                    <td className="px-3.5">
                      {r.task.status === 'done' ? <Tag tone="positive">Done</Tag> : <Tag tone={r.total >= 3 ? 'warning' : 'neutral'}>Open</Tag>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
