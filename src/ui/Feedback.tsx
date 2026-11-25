import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/* -------------------------------------------------------------------------- */
/* Skeleton — shimmering placeholder used while IndexedDB loads               */
/* -------------------------------------------------------------------------- */

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <span
      aria-hidden
      style={style}
      className={cn(
        'rounded-xs bg-[linear-gradient(90deg,rgb(255_255_255/0.04)_0%,rgb(255_255_255/0.08)_50%,rgb(255_255_255/0.04)_100%)] bg-[length:200%_100%] animate-shimmer',
        className,
      )}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* EmptyState                                                                 */
/* -------------------------------------------------------------------------- */

export function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
  className,
  compact,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
      className={cn('flex flex-col items-center justify-center text-center', compact ? 'gap-2 px-6 py-8' : 'gap-3 px-6 py-16', className)}
    >
      <div
        className={cn(
          'relative flex items-center justify-center rounded-md border border-line-strong bg-raised',
          'shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]',
          compact ? 'size-8' : 'size-10',
        )}
      >
        <Icon size={compact ? 15 : 17} strokeWidth={1.75} className="text-fg-muted" />
      </div>
      <div className="flex max-w-[360px] flex-col gap-1">
        <h3 className={cn('font-medium text-fg', compact ? 'text-sm' : 'text-base')}>{title}</h3>
        {description && <p className="text-sm text-fg-subtle">{description}</p>}
      </div>
      {actions && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* TaskCheckbox — the completion control                                      */
/* -------------------------------------------------------------------------- */

export function TaskCheckbox({
  checked,
  inProgress,
  onToggle,
  label,
  size = 16,
}: {
  checked: boolean;
  inProgress?: boolean;
  onToggle: () => void;
  label: string;
  size?: number;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        'focus-ring group/check relative flex shrink-0 items-center justify-center rounded-full border transition-[background-color,border-color] duration-150',
        checked
          ? 'border-positive bg-positive'
          : 'border-fg-faint hover:border-fg-muted',
      )}
      style={{ width: size, height: size }}
    >
      {inProgress && !checked && (
        // Half-filled ring signals "in progress"
        <span className="absolute inset-[3px] overflow-hidden rounded-full">
          <span className="absolute inset-y-0 left-0 w-1/2 bg-warning" />
        </span>
      )}
      <motion.svg
        viewBox="0 0 16 16"
        className="relative"
        width={size - 4}
        height={size - 4}
        initial={false}
        animate={{ opacity: checked ? 1 : 0 }}
      >
        <motion.path
          d="M4 8.5 7 11l5-6"
          fill="none"
          stroke="var(--color-canvas)"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={{ pathLength: checked ? 1 : 0 }}
          transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
        />
      </motion.svg>
      {!checked && (
        <svg viewBox="0 0 16 16" width={size - 4} height={size - 4} className="absolute opacity-0 transition-opacity group-hover/check:opacity-60">
          <path d="M4 8.5 7 11l5-6" fill="none" stroke="var(--color-fg-muted)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
