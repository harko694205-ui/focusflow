import { create } from 'zustand';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '@/lib/cn';

type Tone = 'success' | 'error' | 'info';

interface ToastAction {
  label: string;
  run: () => void;
}

interface Toast {
  id: number;
  message: string;
  tone: Tone;
  action?: ToastAction;
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, opts?: { tone?: Tone; action?: ToastAction; duration?: number }) => number;
  dismiss: (id: number) => void;
}

let seq = 0;

export const useToast = create<ToastState>((set, get) => ({
  toasts: [],
  push: (message, opts = {}) => {
    const id = ++seq;
    const toast: Toast = { id, message, tone: opts.tone ?? 'success', action: opts.action };
    set((s) => ({ toasts: [...s.toasts.slice(-2), toast] }));
    setTimeout(() => get().dismiss(id), opts.duration ?? (opts.action ? 6000 : 3200));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Imperative helper for non-React modules. */
export const toast = (message: string, opts?: Parameters<ToastState['push']>[1]) => useToast.getState().push(message, opts);

const icons = { success: CheckCircle2, error: AlertCircle, info: Info };
const iconColor = { success: 'text-positive', error: 'text-negative', info: 'text-accent' };

export function Toaster() {
  const toasts = useToast((s) => s.toasts);
  const dismiss = useToast((s) => s.dismiss);
  return (
    <div data-toaster className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = icons[t.tone];
          return (
            <motion.div
              key={t.id}
              layout
              role={t.tone === 'error' ? 'alert' : 'status'}
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, transition: { duration: 0.12 } }}
              transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
              className="group pointer-events-auto flex max-w-[420px] items-center gap-2.5 rounded-md border border-line-strong bg-raised py-2 pl-3 pr-2 text-sm text-fg shadow-pop"
            >
              <Icon size={14} strokeWidth={2} className={cn('shrink-0', iconColor[t.tone])} />
              <span className="min-w-0 flex-1 truncate">{t.message}</span>
              {t.action && (
                <button
                  onClick={() => {
                    t.action!.run();
                    dismiss(t.id);
                  }}
                  className="focus-ring -my-0.5 shrink-0 rounded-sm px-2 py-0.5 text-xs font-medium text-accent transition-colors hover:bg-accent-muted"
                >
                  {t.action.label}
                </button>
              )}
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="focus-ring shrink-0 rounded-xs p-0.5 text-fg-subtle opacity-0 transition-opacity hover:text-fg group-hover:opacity-100 focus-visible:opacity-100"
              >
                <X size={12} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
