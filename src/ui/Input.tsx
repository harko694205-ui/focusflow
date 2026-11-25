import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export const fieldBase =
  'w-full rounded-sm bg-raised text-fg border border-line-strong placeholder:text-fg-subtle ' +
  'transition-[border-color,box-shadow,background-color] duration-100 ease-out ' +
  'hover:border-[rgb(255_255_255/0.14)] ' +
  'focus:outline-none focus:border-line-focus focus:shadow-[0_0_0_3px_rgb(124_131_255/0.15)] ' +
  'disabled:opacity-50 disabled:pointer-events-none ' +
  'aria-[invalid=true]:border-[rgb(229_83_75/0.6)]';

const inputSizes = {
  sm: 'h-6 text-xs px-2',
  md: 'h-7 text-sm px-2.5',
  lg: 'h-8 text-sm px-2.5',
};

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: keyof typeof inputSizes;
  icon?: LucideIcon;
  /** Right-aligned adornment, e.g. a unit ("min") or a <Kbd>. */
  suffix?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = 'md', icon: Icon, suffix, className, ...rest },
  ref,
) {
  return (
    <div className={cn('relative flex items-center', className)}>
      {Icon && (
        <Icon size={14} strokeWidth={1.75} className="pointer-events-none absolute left-2 text-fg-subtle" />
      )}
      <input
        ref={ref}
        className={cn(fieldBase, inputSizes[size], Icon && 'pl-7', suffix ? 'pr-12' : undefined)}
        {...rest}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-2 flex items-center text-xs text-fg-subtle">{suffix}</span>
      )}
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 3, ...rest }, ref) {
    return (
      <textarea ref={ref} rows={rows} className={cn(fieldBase, 'resize-none px-2.5 py-1.5 text-sm', className)} {...rest} />
    );
  },
);

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: (id: string) => ReactNode;
}

/** Label + control + hint/error, with ids wired for accessibility. */
export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId();
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs font-medium text-fg-muted">
        {label}
      </label>
      {children(id)}
      {(error || hint) && (
        <p className={cn('text-xs', error ? 'text-negative' : 'text-fg-subtle')}>{error ?? hint}</p>
      )}
    </div>
  );
}
