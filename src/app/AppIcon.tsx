import { useId } from 'react';

/**
 * The FocusFlow app icon (same artwork as public/icons): a focus ring around three "flow" bars.
 * Small sizes use the bolder favicon geometry so the mark stays legible.
 */
export function AppIcon({ size = 20, className }: { size?: number; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const bg = `${id}bg`;
  const ring = `${id}ring`;
  const glow = `${id}glow`;
  const small = size < 40;

  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden className={className ?? 'shrink-0'}>
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={small ? '#26244f' : '#211f45'} />
          <stop offset="0.55" stopColor="#12121c" />
          <stop offset="1" stopColor="#0a0a0f" />
        </linearGradient>
        <linearGradient id={ring} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#a3a8ff" />
          <stop offset="0.5" stopColor="#7c83ff" />
          <stop offset="1" stopColor="#3fd1b9" />
        </linearGradient>
        <radialGradient id={glow} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#7c83ff" stopOpacity="0.42" />
          <stop offset="1" stopColor="#7c83ff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill={`url(#${bg})`} />
      <rect x="1.5" y="1.5" width="509" height="509" rx="114.5" fill="none" stroke="#ffffff" strokeOpacity="0.09" strokeWidth={small ? 12 : 3} />
      {small ? (
        <>
          <circle cx="256" cy="256" r="168" fill="none" stroke={`url(#${ring})`} strokeWidth="56" strokeLinecap="round" strokeDasharray="820 1056" transform="rotate(-90 256 256)" />
          <path d="M188 200h136M188 268h88M188 336h32" stroke="#ffffff" strokeWidth="52" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="256" cy="256" r="230" fill={`url(#${glow})`} />
          <circle cx="256" cy="256" r="150" fill="none" stroke="#ffffff" strokeOpacity="0.07" strokeWidth="30" />
          <circle cx="256" cy="256" r="150" fill="none" stroke={`url(#${ring})`} strokeWidth="30" strokeLinecap="round" strokeDasharray="735 943" transform="rotate(-90 256 256)" />
          <circle cx="108.7" cy="227.9" r="9" fill="#ffffff" />
          <path d="M196 204h124M196 256h84M196 308h40" stroke="#f4f4ff" strokeWidth="30" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
