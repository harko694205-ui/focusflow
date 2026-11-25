import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const base =
  'relative inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm font-medium select-none ' +
  'transition-[background-color,border-color,color,box-shadow,transform] duration-100 ease-out ' +
  'focus-ring disabled:pointer-events-none disabled:opacity-40 active:translate-y-px';

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-fg hover:bg-accent-hover ' +
    'shadow-[inset_0_1px_0_rgb(255_255_255/0.22),0_0_0_1px_rgb(124_131_255/0.6)]',
  secondary:
    'bg-raised text-fg border border-line-strong hover:bg-hover hover:border-[rgb(255_255_255/0.14)] ' +
    'shadow-[inset_0_1px_0_rgb(255_255_255/0.03)]',
  ghost: 'text-fg-muted hover:text-fg hover:bg-hover',
  danger:
    'bg-negative-muted text-negative border border-[rgb(229_83_75/0.25)] hover:bg-[rgb(229_83_75/0.2)]',
};

const sizes: Record<Size, string> = {
  sm: 'h-6 px-2 text-xs',
  md: 'h-7 px-2.5 text-sm',
  lg: 'h-8 px-3 text-sm',
};

const iconSizes: Record<Size, number> = { sm: 13, md: 14, lg: 15 };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  trailing?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, trailing, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cn(base, variants[variant], sizes[size], className)} {...rest}>
      {Icon && <Icon size={iconSizes[size]} strokeWidth={1.75} className="-ml-0.5 shrink-0" />}
      {children}
      {trailing}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  size?: Size;
  variant?: Exclude<Variant, 'primary'>;
  active?: boolean;
}

const squareSizes: Record<Size, string> = { sm: 'size-6', md: 'size-7', lg: 'size-8' };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, size = 'md', variant = 'ghost', active, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={cn(
        base,
        variants[variant],
        squareSizes[size],
        'px-0',
        active && 'bg-active text-fg',
        className,
      )}
      {...rest}
    >
      <Icon size={iconSizes[size]} strokeWidth={1.75} />
    </button>
  );
});
