import type { ReactNode } from 'react';

/** Page title row used at the top of every route. */
export function PageHeader({ title, meta, actions }: { title: string; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-5">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-[-0.02em] text-fg">{title}</h1>
        {meta && <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-fg-subtle">{meta}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Standard page gutter + max width. */
export function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[1480px] px-4 py-5 md:px-6 md:py-6 xl:px-8">{children}</div>;
}
