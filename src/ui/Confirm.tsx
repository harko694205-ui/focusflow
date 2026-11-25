import { useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';

interface ConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  /** Extra footer button, left of Cancel (e.g. "Export first"). */
  secondary?: ReactNode;
  disabled?: boolean;
  onConfirm: () => Promise<unknown> | unknown;
}

/** A small confirmation dialog for actions that can't be undone. */
export function ConfirmDialog({ open, onOpenChange, title, description, children, confirmLabel, tone = 'primary', secondary, disabled, onConfirm }: ConfirmProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={title}
      description={description}
      width="sm"
      footer={
        <>
          {secondary && <div className="mr-auto">{secondary}</div>}
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            disabled={busy || disabled}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children && <div className="px-4 py-3.5 text-sm text-fg-muted">{children}</div>}
    </Dialog>
  );
}
