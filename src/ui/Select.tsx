import type { ReactNode } from 'react';
import { Select as S } from 'radix-ui';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { fieldBase } from './Input';

export interface SelectOption {
  value: string;
  label: string;
  /** Leading adornment: a color dot, icon, etc. */
  leading?: ReactNode;
  hint?: string;
}

interface SelectProps {
  id?: string;
  value: string;
  onValueChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function Select({ id, value, onValueChange, options, placeholder, size = 'md', className }: SelectProps) {
  return (
    <S.Root value={value} onValueChange={onValueChange}>
      <S.Trigger
        id={id}
        className={cn(
          fieldBase,
          'flex items-center justify-between gap-2 text-left',
          'data-[state=open]:border-line-focus data-[placeholder]:text-fg-subtle',
          size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-sm',
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          <S.Value placeholder={placeholder} />
        </span>
        <S.Icon>
          <ChevronsUpDown size={13} className="shrink-0 text-fg-subtle" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className={cn(
            'z-50 max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)]',
            'overflow-hidden rounded-md border border-line-strong bg-raised shadow-pop animate-pop-in',
          )}
        >
          <S.Viewport className="p-1">
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                className={cn(
                  'relative flex h-7 cursor-default select-none items-center gap-2 rounded-sm pl-2 pr-7 text-sm text-fg-muted outline-none',
                  'data-[highlighted]:bg-hover data-[highlighted]:text-fg data-[state=checked]:text-fg',
                )}
              >
                {o.leading}
                <S.ItemText>{o.label}</S.ItemText>
                {o.hint && <span className="ml-auto text-xs text-fg-subtle">{o.hint}</span>}
                <S.ItemIndicator className="absolute right-2 inline-flex">
                  <Check size={13} strokeWidth={2} className="text-accent" />
                </S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
