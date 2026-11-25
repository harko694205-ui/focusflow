import { cn } from '@/lib/cn';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Platform-aware modifier label: ⌘ on macOS, Ctrl elsewhere. */
export const MOD = isMac ? '⌘' : 'Ctrl';

export function Kbd({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {keys.map((k) => (
        <kbd
          key={k}
          className={cn(
            'inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-xs border border-line-strong bg-raised px-1',
            'font-sans text-2xs font-medium leading-none text-fg-muted',
            'shadow-[inset_0_-1px_0_rgb(255_255_255/0.04)]',
          )}
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}
