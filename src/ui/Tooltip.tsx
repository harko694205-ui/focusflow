import type { ReactNode } from 'react';
import { Tooltip as T } from 'radix-ui';
import { Kbd } from './Kbd';

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <T.Provider delayDuration={450} skipDelayDuration={200}>
    {children}
  </T.Provider>
);

interface TooltipProps {
  content: ReactNode;
  shortcut?: string[];
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactNode;
  disabled?: boolean;
}

export function Tooltip({ content, shortcut, side = 'top', children, disabled }: TooltipProps) {
  if (disabled) return <>{children}</>;
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-50 flex items-center gap-2 rounded-sm border border-line-strong bg-raised px-2 py-1 text-xs text-fg shadow-pop animate-pop-in"
        >
          {content}
          {shortcut && <Kbd keys={shortcut} />}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
