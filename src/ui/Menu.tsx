import type { ReactNode } from 'react';
import { DropdownMenu as D } from 'radix-ui';
import { Check, ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Kbd } from './Kbd';

export const popoverSurface =
  'z-50 min-w-[180px] overflow-hidden rounded-md border border-line-strong bg-raised p-1 shadow-pop animate-pop-in ' +
  'origin-[var(--radix-dropdown-menu-content-transform-origin)]';

const itemBase =
  'relative flex h-7 cursor-default select-none items-center gap-2 rounded-sm px-2 text-sm text-fg-muted outline-none ' +
  'data-[highlighted]:bg-hover data-[highlighted]:text-fg data-[disabled]:pointer-events-none data-[disabled]:opacity-40';

export const Menu = D.Root;
export const MenuTrigger = D.Trigger;

export function MenuContent({
  children,
  align = 'start',
  side = 'bottom',
  className,
}: {
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}) {
  return (
    <D.Portal>
      <D.Content align={align} side={side} sideOffset={4} collisionPadding={8} className={cn(popoverSurface, className)}>
        {children}
      </D.Content>
    </D.Portal>
  );
}

interface MenuItemProps {
  icon?: LucideIcon;
  shortcut?: string[];
  onSelect?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  children: ReactNode;
}

export function MenuItem({ icon: Icon, shortcut, onSelect, destructive, disabled, children }: MenuItemProps) {
  return (
    <D.Item
      onSelect={onSelect}
      disabled={disabled}
      className={cn(itemBase, destructive && 'text-negative data-[highlighted]:text-negative data-[highlighted]:bg-negative-muted')}
    >
      {Icon && <Icon size={14} strokeWidth={1.75} className="shrink-0 opacity-80" />}
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <Kbd keys={shortcut} />}
    </D.Item>
  );
}

export function MenuCheckboxItem({
  checked,
  onCheckedChange,
  children,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <D.CheckboxItem
      checked={checked}
      onCheckedChange={onCheckedChange}
      onSelect={(e) => e.preventDefault()}
      className={cn(itemBase, 'pl-7')}
    >
      <D.ItemIndicator className="absolute left-2 inline-flex">
        <Check size={13} strokeWidth={2} className="text-accent" />
      </D.ItemIndicator>
      {children}
    </D.CheckboxItem>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <D.Label className="eyebrow px-2 pb-1 pt-1.5">{children}</D.Label>;
}

export function MenuSeparator() {
  return <D.Separator className="-mx-1 my-1 h-px bg-line" />;
}

export function MenuSub({ label, icon: Icon, children }: { label: string; icon?: LucideIcon; children: ReactNode }) {
  return (
    <D.Sub>
      <D.SubTrigger className={cn(itemBase, 'data-[state=open]:bg-hover data-[state=open]:text-fg')}>
        {Icon && <Icon size={14} strokeWidth={1.75} className="shrink-0 opacity-80" />}
        <span className="flex-1">{label}</span>
        <ChevronRight size={13} className="text-fg-subtle" />
      </D.SubTrigger>
      <D.Portal>
        <D.SubContent sideOffset={6} alignOffset={-4} className={popoverSurface}>
          {children}
        </D.SubContent>
      </D.Portal>
    </D.Sub>
  );
}
