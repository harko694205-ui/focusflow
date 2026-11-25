import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/* -------------------------------------------------------------------------- */
/* Panel — the one container. Hairline border, no shadow, small radius.        */
/* -------------------------------------------------------------------------- */

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('flex min-w-0 flex-col rounded-md border border-line bg-panel', className)}>{children}</section>;
}

export function PanelHeader({
  title,
  icon: Icon,
  meta,
  actions,
}: {
  title: string;
  icon?: LucideIcon;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line pl-3.5 pr-2">
      {Icon && <Icon size={14} strokeWidth={1.75} className="text-fg-subtle" />}
      <h2 className="text-sm font-medium text-fg">{title}</h2>
      {meta && <span className="truncate text-xs text-fg-subtle">{meta}</span>}
      <div className="ml-auto flex items-center gap-1">{actions}</div>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Stat + Delta                                                               */
/* -------------------------------------------------------------------------- */

type Tone = 'positive' | 'negative' | 'warning' | 'neutral';

const toneText: Record<Tone, string> = {
  positive: 'text-positive',
  negative: 'text-negative',
  warning: 'text-warning',
  neutral: 'text-fg-muted',
};

export function Delta({ value, tone, suffix }: { value: string; tone: Tone; suffix?: string }) {
  const Icon = tone === 'negative' ? ArrowDownRight : ArrowUpRight;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs num', toneText[tone])}>
      {tone !== 'neutral' && <Icon size={12} strokeWidth={2} />}
      {value}
      {suffix && <span className="ml-1 font-sans text-fg-subtle">{suffix}</span>}
    </span>
  );
}

export function Stat({
  label,
  value,
  unit,
  sub,
  className,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <span className="eyebrow truncate">{label}</span>
      <div className="flex items-baseline gap-1">
        <span className="num text-xl font-medium leading-none text-fg">{value}</span>
        {unit && <span className="num text-xs text-fg-subtle">{unit}</span>}
      </div>
      {sub && <div className="min-h-4 truncate">{sub}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tag / Dot                                                                  */
/* -------------------------------------------------------------------------- */

export function Dot({ color, className }: { color: string; className?: string }) {
  return <span className={cn('inline-block size-2 shrink-0 rounded-full', className)} style={{ background: color }} />;
}

const tagTones: Record<Tone | 'accent', string> = {
  neutral: 'bg-raised text-fg-muted border-line-strong',
  positive: 'bg-positive-muted text-positive border-transparent',
  negative: 'bg-negative-muted text-negative border-transparent',
  warning: 'bg-warning-muted text-warning border-transparent',
  accent: 'bg-accent-muted text-accent border-transparent',
};

export function Tag({ tone = 'neutral', children, className }: { tone?: Tone | 'accent'; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-xs border px-1.5 text-2xs font-medium',
        tagTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Marks a panel that still shows illustrative data until the scheduling engine lands. */
export function SampleTag() {
  return (
    <span
      title="Illustrative data — computed from your tasks once the scheduling engine lands (Phase 2)"
      className="inline-flex h-5 shrink-0 cursor-help items-center rounded-xs border border-dashed border-line-strong px-1.5 text-2xs font-medium text-fg-subtle"
    >
      Sample
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Meter— thin load bar with optional over-capacity hatching                */
/* -------------------------------------------------------------------------- */

export function Meter({
  value,
  max,
  color = 'var(--color-accent)',
  className,
  height = 4,
}: {
  value: number;
  max: number;
  color?: string;
  className?: string;
  height?: number;
}) {
  const ratio = max > 0 ? value / max : 0;
  const within = Math.min(ratio, 1);
  const over = Math.max(0, Math.min(ratio - 1, 0.5));
  return (
    <div
      className={cn('relative flex w-full overflow-hidden rounded-full bg-[rgb(255_255_255/0.05)]', className)}
      style={{ height }}
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div className="h-full transition-[width] duration-500 ease-out" style={{ width: `${(within / (1 + over)) * 100}%`, background: color }} />
      {over > 0 && <div className="hatch h-full bg-negative-muted" style={{ width: `${(over / (1 + over)) * 100}%` }} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* SegmentedControl                                                           */
/* -------------------------------------------------------------------------- */

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = 'sm',
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" className="inline-flex items-center rounded-sm border border-line bg-canvas p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'focus-ring whitespace-nowrap rounded-xs px-2 font-medium transition-colors duration-100',
              size === 'sm' ? 'h-5 text-2xs' : 'h-6 text-xs',
              active ? 'bg-active text-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]' : 'text-fg-subtle hover:text-fg-muted',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
