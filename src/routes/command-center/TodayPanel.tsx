import { useEffect, useState } from 'react';
import { CalendarClock, Users } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatClock, formatDuration, minutesNow } from '@/lib/format';
import { Meter, Panel, PanelHeader, SegmentedControl, Tag } from '@/ui/Data';
import { Tooltip } from '@/ui/Tooltip';
import type { SampleBlock } from '@/data/sample';

export interface Workday {
  start: number;
  end: number;
  lunch: { start: number; end: number };
}

const RANGE = { start: 8 * 60, end: 19 * 60 };
const SPAN = RANGE.end - RANGE.start;
const clamp = (m: number) => Math.min(Math.max(m, RANGE.start), RANGE.end);
const pos = (m: number) => `${((clamp(m) - RANGE.start) / SPAN) * 100}%`;
const len = (a: number, b: number) => `${((clamp(b) - clamp(a)) / SPAN) * 100}%`;

const energyLabel = { deep: 'Hard', shallow: 'Medium', admin: 'Easy' } as const;

function useNowMinutes() {
  const [now, setNow] = useState(() => minutesNow());
  useEffect(() => {
    const t = setInterval(() => setNow(minutesNow()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function blockColor(b: SampleBlock) {
  return b.color ?? 'var(--color-fg-subtle)';
}

/* -------------------------------------------------------------------------- */

function Block({ b, now, dimmed }: { b: SampleBlock; now: number; dimmed: boolean }) {
  const past = b.end <= now;
  const current = b.start <= now && now < b.end;
  const color = blockColor(b);
  const isEvent = b.kind === 'event';
  const project = b.category ? { name: b.category } : undefined;
  const minutes = b.end - b.start;
  const showLabel = minutes >= 45;

  return (
    <Tooltip
      content={
        <div className="flex flex-col gap-0.5 py-0.5">
          <span className="font-medium">{b.title}</span>
          <span className="num text-2xs text-fg-subtle">
            {formatClock(b.start)}–{formatClock(b.end)} · {formatDuration(minutes)}
            {project ? ` · ${project.name}` : ' · Fixed'}
          </span>
        </div>
      }
    >
      <div
        tabIndex={0}
        aria-label={`${b.title}, ${formatClock(b.start)} to ${formatClock(b.end)}`}
        className={cn(
          'focus-ring absolute inset-y-0 flex min-w-0 cursor-default flex-col justify-center overflow-hidden rounded-xs px-1.5',
          'transition-[filter,opacity] duration-150 hover:brightness-125',
          !isEvent && 'border-l-2',
          isEvent && 'border border-line-strong',
          (past || dimmed) && 'opacity-40',
          current && 'ring-1 ring-[rgb(255_255_255/0.2)]',
        )}
        style={{
          left: `calc(${pos(b.start)} + 1px)`,
          width: `calc(${len(b.start, b.end)} - 2px)`,
          borderLeftColor: isEvent ? undefined : color,
          background: isEvent
            ? 'repeating-linear-gradient(-45deg, rgb(255 255 255 / 0.05) 0 3px, rgb(255 255 255 / 0.02) 3px 7px)'
            : `color-mix(in oklab, ${color} 18%, var(--color-canvas))`,
        }}
      >
        {showLabel && (
          <>
            <span className="truncate text-xs font-medium leading-4 text-fg">{b.title}</span>
            {!isEvent && (
              <span className="num truncate text-2xs leading-4 text-fg-subtle">
                {formatClock(b.start)} · {formatDuration(minutes, { compact: true })}
              </span>
            )}
          </>
        )}
      </div>
    </Tooltip>
  );
}

function Lane({ label, height, children }: { label: string; height: string; children: React.ReactNode }) {
  return (
    <div className="flex items-stretch">
      <span className="eyebrow flex w-16 shrink-0 items-center">{label}</span>
      <div className={cn('relative flex-1', height)}>{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function NowNextCard({ label, block, now, empty }: { label: string; block?: SampleBlock; now: number; empty: string }) {
  if (!block) {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-2 px-3.5 py-3">
        <span className="eyebrow">{label}</span>
        <span className="text-sm text-fg-subtle">{empty}</span>
      </div>
    );
  }
  const live = block.start <= now && now < block.end;
  const project = block.category ? { name: block.category } : undefined;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 px-3.5 py-3">
      <div className="flex items-center gap-2">
        <span className="eyebrow">{label}</span>
        {live && (
          <span className="flex items-center gap-1 text-2xs font-medium text-accent">
            <span className="relative flex size-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative size-1.5 rounded-full bg-accent" />
            </span>
            Live
          </span>
        )}
        <span className="num ml-auto text-xs text-fg-subtle">
          {formatClock(block.start)}–{formatClock(block.end)}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {block.kind === 'event' ? (
          <Users size={14} strokeWidth={1.75} className="shrink-0 text-fg-subtle" />
        ) : (
          <span className="size-2 shrink-0 rounded-xs" style={{ background: blockColor(block) }} />
        )}
        <span className="truncate text-base font-medium">{block.title}</span>
      </div>
      <div className="flex items-center gap-2 text-xs text-fg-subtle">
        {project ? <span className="truncate">{project.name}</span> : <span>Meeting · fixed</span>}
        {block.energy && <Tag>{energyLabel[block.energy]}</Tag>}
        <span className="num ml-auto shrink-0">
          {live ? `${formatDuration(block.end - now)} left` : `in ${formatDuration(block.start - now)}`}
        </span>
      </div>
      {live && <Meter value={now - block.start} max={block.end - block.start} height={3} color={blockColor(block)} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function TodayPanel({ todayBlocks, workday }: { todayBlocks: SampleBlock[]; workday: Workday }) {
  const now = useNowMinutes();
  const [view, setView] = useState<'all' | 'focus'>('all');

  const capacity = workday.end - workday.start - (workday.lunch.end - workday.lunch.start);
  const sum = (bs: SampleBlock[]) => bs.reduce((a, b) => a + (b.end - b.start), 0);
  const events = todayBlocks.filter((b) => b.kind === 'event');
  const taskBlocks = todayBlocks.filter((b) => b.kind === 'task');
  const booked = sum(todayBlocks);
  const current = todayBlocks.find((b) => b.start <= now && now < b.end);
  const next = todayBlocks.find((b) => b.start > now);
  const hours = Array.from({ length: SPAN / 60 + 1 }, (_, i) => RANGE.start + i * 60);
  const nowVisible = now >= RANGE.start && now <= RANGE.end;

  const mix = [
    { key: 'deep', label: 'Hard', color: 'var(--color-deep)', min: sum(taskBlocks.filter((b) => b.energy === 'deep')) },
    { key: 'shallow', label: 'Medium', color: 'var(--color-shallow)', min: sum(taskBlocks.filter((b) => b.energy === 'shallow')) },
    { key: 'admin', label: 'Easy', color: 'var(--color-admin)', min: sum(taskBlocks.filter((b) => b.energy === 'admin')) },
    { key: 'events', label: 'Events', color: 'var(--color-fg-faint)', min: sum(events) },
    { key: 'free', label: 'Unbooked', color: 'rgb(255 255 255 / 0.06)', min: Math.max(0, capacity - booked) },
  ];
  const mixTotal = mix.reduce((a, m) => a + m.min, 0);

  /** Background layers shared by both lanes: off-hours, lunch, gridlines. */
  const track = (
    <>
      <div className="absolute inset-y-0 left-0 rounded-l-xs bg-[rgb(0_0_0/0.4)]" style={{ width: pos(workday.start) }} />
      <div className="absolute inset-y-0 right-0 rounded-r-xs bg-[rgb(0_0_0/0.4)]" style={{ left: pos(workday.end) }} />
      <div
        className="absolute inset-y-0 bg-[rgb(0_0_0/0.25)]"
        style={{ left: pos(workday.lunch.start), width: len(workday.lunch.start, workday.lunch.end) }}
      />
      {hours.slice(1, -1).map((h) => (
        <div key={h} className="absolute inset-y-0 w-px bg-line" style={{ left: pos(h) }} />
      ))}
    </>
  );

  return (
    <Panel>
      <PanelHeader
        title="Today"
        icon={CalendarClock}
        meta={`${formatDuration(booked)} booked of ${formatDuration(capacity)} · ${events.length} meetings`}
        actions={
          <>
          <SegmentedControl
            value={view}
            onChange={setView}
            options={[
              { value: 'all', label: 'All' },
              { value: 'focus', label: 'Hard only' },
            ]}
          />
          </>
        }
      />

      {/* Day strip */}
      <div className="overflow-x-auto px-3.5 pb-3.5 pt-3">
        <div className="relative min-w-[600px]">
          {/* Hour labels */}
          <div className="ml-16 relative h-4">
            {hours.map((h, i) => (
              <span
                key={h}
                className={cn(
                  'num absolute top-0 text-2xs text-fg-subtle',
                  i === 0 ? '' : i === hours.length - 1 ? '-translate-x-full' : '-translate-x-1/2',
                )}
                style={{ left: pos(h) }}
              >
                {formatClock(h)}
              </span>
            ))}
          </div>

          <div className="mt-1.5 flex flex-col gap-1">
            <Lane label="Fixed" height="h-7">
              <div className="absolute inset-0 rounded-xs bg-canvas ring-1 ring-line">{track}</div>
              <div className="absolute inset-0.5">
                {events.map((b) => (
                  <Block key={b.id} b={b} now={now} dimmed={view === 'focus'} />
                ))}
              </div>
            </Lane>
            <Lane label="Tasks" height="h-12">
              <div className="absolute inset-0 rounded-xs bg-canvas ring-1 ring-line">{track}</div>
              <div className="absolute inset-0.5">
                {taskBlocks.map((b) => (
                  <Block key={b.id} b={b} now={now} dimmed={view === 'focus' && b.energy !== 'deep'} />
                ))}
              </div>
            </Lane>
          </div>

          {/* Now line spans both lanes */}
          {nowVisible && (
            <div className="pointer-events-none absolute bottom-0 left-16 right-0 top-5">
              <div className="absolute -bottom-1 top-0 z-10 w-px bg-accent" style={{ left: pos(now) }}>
                <span className="absolute -top-1 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-accent" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Today's mix */}
      <div className="border-t border-line px-3.5 py-3">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="eyebrow">Capacity mix</span>
          <span className="num text-2xs text-fg-subtle">
            {nowVisible ? (
              <>
                now <span className="text-fg-muted">{formatClock(now)}</span>
              </>
            ) : (
              `${formatClock(workday.start)}–${formatClock(workday.end)}`
            )}
          </span>
        </div>
        <div className="flex h-1.5 gap-px overflow-hidden rounded-full">
          {mix.map((m) => (
            <div key={m.key} style={{ width: `${(m.min / mixTotal) * 100}%`, background: m.color }} />
          ))}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5">
          {mix.map((m) => (
            <div key={m.key} className="flex items-center gap-1.5 text-xs">
              <span className="size-2 shrink-0 rounded-[1px] ring-1 ring-inset ring-line" style={{ background: m.color }} />
              <span className="text-fg-subtle">{m.label}</span>
              <span className="num text-fg-muted">{formatDuration(m.min, { compact: true })}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Now / Next */}
      <div className="mt-auto flex flex-col divide-y divide-line border-t border-line sm:flex-row sm:divide-x sm:divide-y-0">
        <NowNextCard
          label="Now"
          block={current}
          now={now}
          empty={now < workday.start ? 'Workday hasn’t started.' : now >= workday.end ? 'Workday complete.' : 'Unscheduled time.'}
        />
        <NowNextCard label="Up next" block={next} now={now} empty="Nothing else scheduled today." />
      </div>
    </Panel>
  );
}
