import type { ReactNode } from 'react';
import { Dialog as D } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton } from './Button';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg';
  /** Hide the title row (e.g. for a command palette). Title is still announced. */
  bare?: boolean;
  className?: string;
}

const widths = { sm: 'max-w-[400px]', md: 'max-w-[520px]', lg: 'max-w-[640px]' };

export function Dialog({ open, onOpenChange, title, description, children, footer, width = 'md', bare, className }: DialogProps) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-[rgb(4_4_6/0.62)] backdrop-blur-[2px] animate-fade-in" />
        <D.Content
          className={cn(
            // Tall content scrolls inside the dialog; children with min-h-0 can keep a fixed footer.
            'fixed left-1/2 top-[14vh] z-50 flex max-h-[calc(86dvh-16px)] w-[calc(100vw-32px)] -translate-x-1/2 flex-col overflow-y-auto',
            'rounded-md border border-line-strong bg-panel shadow-dialog animate-pop-in focus:outline-none',
            widths[width],
            className,
          )}
          // Toasts (e.g. "Undo") stay clickable while a dialog is open.
          onInteractOutside={(e) => {
            if ((e.target as Element | null)?.closest?.('[data-toaster]')) e.preventDefault();
          }}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          {bare ? (
            <>
              <D.Title className="sr-only">{title}</D.Title>
              {description && <D.Description className="sr-only">{description}</D.Description>}
            </>
          ) : (
            <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
              <div className="min-w-0">
                <D.Title className="text-base font-medium text-fg">{title}</D.Title>
                {description && <D.Description className="mt-0.5 text-xs text-fg-subtle">{description}</D.Description>}
              </div>
              <D.Close asChild>
                <IconButton icon={X} label="Close" size="sm" className="-mr-1 -mt-0.5" />
              </D.Close>
            </div>
          )}
          {children}
          {footer && (
            <div className="flex items-center justify-end gap-2 border-t border-line bg-[rgb(255_255_255/0.012)] px-4 py-3">
              {footer}
            </div>
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
