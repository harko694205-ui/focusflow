import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Circular countdown. `progress` 0–1 is how much of the phase has elapsed. */
export function FocusRing({ progress, color, dim, children, size = 300 }: { progress: number; color: string; dim?: boolean; children: ReactNode; size?: number }) {
  const stroke = 6;
  const r = (size - stroke) / 2 - 4;
  const c = 2 * Math.PI * r;
  const left = Math.max(0, Math.min(1, 1 - progress));
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden>
        {/* 60 minute ticks, faint */}
        {Array.from({ length: 60 }, (_, i) => {
          const a = (i / 60) * 2 * Math.PI;
          const r1 = r + stroke / 2 + 4;
          const r2 = r1 + (i % 5 === 0 ? 5 : 2.5);
          const cx = size / 2;
          return (
            <line
              key={i}
              x1={cx + r1 * Math.cos(a)}
              y1={cx + r1 * Math.sin(a)}
              x2={cx + r2 * Math.cos(a)}
              y2={cx + r2 * Math.sin(a)}
              stroke="rgb(255 255 255 / 0.08)"
              strokeWidth={1}
            />
          );
        })}
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(255 255 255 / 0.05)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - left)}
          className={cn('transition-[stroke-dashoffset,opacity] duration-1000 ease-linear', dim && 'opacity-40')}
        />
      </svg>
      <div className="relative flex flex-col items-center">{children}</div>
    </div>
  );
}
