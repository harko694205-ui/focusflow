import { useState } from 'react';
import { format } from 'date-fns';
import { Bar, BarChart, CartesianGrid, ComposedChart, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, Target } from 'lucide-react';
import { formatDuration } from '@/lib/format';
import { Panel, PanelHeader, SampleTag, SegmentedControl } from '@/ui/Data';
import { focusWeek } from '@/data/sample';
import type { DayLoadRow as LoadDay } from '@/domain/forecast';

const axisTick = { fill: 'var(--color-fg-subtle)', fontSize: 11, fontFamily: 'var(--font-mono)' };

const SERIES = [
  { key: 'deep', label: 'Hard', color: 'var(--color-deep)' },
  { key: 'shallow', label: 'Medium', color: 'var(--color-shallow)' },
  { key: 'admin', label: 'Easy', color: 'var(--color-admin)' },
  { key: 'events', label: 'Events', color: 'var(--color-event)' },
] as const;

function TooltipShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-[180px] rounded-sm border border-line-strong bg-raised px-3 py-2 shadow-pop">
      <div className="mb-1.5 text-xs font-medium text-fg">{title}</div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function Row({ color, label, value, strong }: { color?: string; label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {color ? <span className="size-2 rounded-[1px]" style={{ background: color }} /> : <span className="w-2" />}
      <span className={strong ? 'text-fg' : 'text-fg-muted'}>{label}</span>
      <span className={`num ml-auto ${strong ? 'text-fg' : 'text-fg-muted'}`}>{value}</span>
    </div>
  );
}

type LoadRow = LoadDay & { total: number; over: number };

function LoadTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: LoadRow }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <TooltipShell title={format(d.date, 'EEEE, MMM d')}>
      {d.capacity === 0 && d.total === 0 ? (
        <span className="text-xs text-fg-subtle">Non-working day</span>
      ) : (
        <>
          {SERIES.map((s) => (d[s.key] > 0 ? <Row key={s.key} color={s.color} label={s.label} value={formatDuration(d[s.key])} /> : null))}
          <div className="my-1 h-px bg-line" />
          <Row label="Planned" value={formatDuration(d.total)} strong />
          <Row label="Capacity" value={formatDuration(d.capacity)} />
          {d.over > 0 && (
            <div className="flex items-center justify-between text-xs text-negative">
              <span>Over capacity</span>
              <span className="num">{formatDuration(d.over)}</span>
            </div>
          )}
        </>
      )}
    </TooltipShell>
  );
}

/** Capacity marker: a short horizontal rule centered on each bar. */
function CapacityTick(props: { cx?: number; cy?: number; payload?: LoadRow }) {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload || payload.capacity === 0) return <g />;
  const over = payload.over > 0;
  return (
    <line
      x1={cx - 15}
      x2={cx + 15}
      y1={cy}
      y2={cy}
      stroke={over ? 'var(--color-negative)' : 'var(--color-fg-muted)'}
      strokeWidth={1.5}
      strokeDasharray={over ? undefined : '2 2'}
    />
  );
}

function DayTick({ x, y, payload, data }: { x?: number; y?: number; payload?: { value: string; index: number }; data: LoadRow[] }) {
  if (x === undefined || y === undefined || !payload) return null;
  const d = data[payload.index];
  const color = d.isToday ? 'var(--color-accent)' : d.weekend ? 'var(--color-fg-faint)' : 'var(--color-fg-subtle)';
  return (
    <g transform={`translate(${x},${y})`}>
      <text dy={10} textAnchor="middle" fill={color} fontSize={10} fontFamily="var(--font-sans)" fontWeight={500}>
        {d.dow}
      </text>
      <text dy={23} textAnchor="middle" fill={d.isToday ? 'var(--color-fg)' : color} fontSize={11} fontFamily="var(--font-mono)">
        {d.label}
      </text>
    </g>
  );
}

export function LoadForecastPanel({ forecast }: { forecast: LoadDay[] }) {
  const [horizon, setHorizon] = useState<'7' | '14'>('14');
  const data: LoadRow[] = forecast.slice(0, Number(horizon)).map((d) => {
    const total = d.deep + d.shallow + d.admin + d.events;
    return { ...d, total, over: Math.max(0, total - d.capacity) };
  });
  const overDays = data.filter((d) => d.over > 0);
  const totalOver = overDays.reduce((a, d) => a + d.over, 0);
  // Scale to the busiest day (min 10h), in 2h steps.
  const peak = Math.max(600, ...data.map((d) => Math.max(d.total, d.capacity)));
  const yTop = Math.ceil(peak / 120) * 120 + 60;
  const yTicks = Array.from({ length: Math.floor(yTop / 120) + 1 }, (_, i) => i * 120);

  return (
    <Panel>
      <PanelHeader
        title="Load forecast"
        icon={BarChart3}
        meta={
          overDays.length > 0 ? (
            <>
              <span className="text-negative">{overDays.length} days over capacity</span>
              <span className="num"> · {formatDuration(totalOver)} total</span>
            </>
          ) : (
            'Within capacity'
          )
        }
        actions={
          <>
          <SegmentedControl
            value={horizon}
            onChange={setHorizon}
            options={[
              { value: '7', label: '7d' },
              { value: '14', label: '14d' },
            ]}
          />
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3.5 pt-3 text-2xs text-fg-subtle">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="size-2 rounded-[1px]" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <svg width="12" height="2" aria-hidden>
            <line x1="0" x2="12" y1="1" y2="1" stroke="var(--color-fg-muted)" strokeWidth="1.5" strokeDasharray="2 2" />
          </svg>
          Capacity
        </span>
      </div>
      <div className="min-h-[232px] flex-1 px-1.5 pb-1 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="var(--color-line)" />
            <XAxis
              dataKey="key"
              tickLine={false}
              axisLine={{ stroke: 'var(--color-line-strong)' }}
              tick={<DayTick data={data} />}
              height={34}
              interval={0}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={axisTick}
              width={36}
              ticks={yTicks}
              domain={[0, yTop]}
              tickFormatter={(v: number) => `${v / 60}h`}
            />
            <Tooltip content={<LoadTooltip />} cursor={{ fill: 'rgb(255 255 255 / 0.03)' }} isAnimationActive={false} />
            {SERIES.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                stackId="load"
                fill={s.color}
                maxBarSize={26}
                isAnimationActive={false}
                stroke="var(--color-panel)"
                strokeWidth={1}
                radius={i === SERIES.length - 1 ? [2, 2, 0, 0] : 0}
              />
            ))}
            <Scatter dataKey="capacity" shape={<CapacityTick />} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

function FocusTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { dow: string; planned: number; actual: number | null } }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <TooltipShell title={d.dow}>
      <Row color="var(--color-fg-faint)" label="Planned" value={formatDuration(d.planned)} />
      <Row color="var(--color-deep)" label="Actual" value={d.actual === null ? '—' : formatDuration(d.actual)} />
    </TooltipShell>
  );
}

export function FocusWeekPanel() {
  const logged = focusWeek.filter((d) => d.actual !== null);
  const planned = logged.reduce((a, d) => a + d.planned, 0);
  const actual = logged.reduce((a, d) => a + (d.actual ?? 0), 0);

  return (
    <Panel>
      <PanelHeader title="Deep work this week" icon={Target} actions={<SampleTag />} />
      <div className="flex items-end justify-between gap-4 px-3.5 pt-3">
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="num text-xl font-medium leading-none">{formatDuration(actual, { compact: true })}</span>
            <span className="num text-xs text-fg-subtle">/ {formatDuration(planned, { compact: true })} planned</span>
          </div>
          <span className="mt-1.5 block text-xs text-fg-subtle">
            <span className="num text-fg-muted">{Math.round((actual / planned) * 100)}%</span> of planned focus time done so far
          </span>
        </div>
      </div>
      <div className="min-h-[150px] flex-1 px-1.5 pb-1 pt-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={focusWeek} margin={{ top: 12, right: 12, bottom: 0, left: 0 }} barGap={2} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke="var(--color-line)" />
            <XAxis dataKey="dow" tickLine={false} axisLine={{ stroke: 'var(--color-line-strong)' }} tick={{ ...axisTick, fontFamily: 'var(--font-sans)' }} />
            <YAxis tickLine={false} axisLine={false} tick={axisTick} width={36} ticks={[0, 120, 240, 360]} tickFormatter={(v: number) => `${v / 60}h`} />
            <Tooltip content={<FocusTooltip />} cursor={{ fill: 'rgb(255 255 255 / 0.03)' }} isAnimationActive={false} />
            <Bar dataKey="planned" fill="rgb(255 255 255 / 0.09)" radius={[2, 2, 0, 0]} maxBarSize={14} isAnimationActive={false} />
            <Bar dataKey="actual" fill="var(--color-deep)" radius={[2, 2, 0, 0]} maxBarSize={14} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}
