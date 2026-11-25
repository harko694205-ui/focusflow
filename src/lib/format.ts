/** Durations are minutes throughout the app. */
export function formatDuration(min: number, opts: { compact?: boolean } = {}): string {
  const sign = min < 0 ? '−' : '';
  const m = Math.abs(Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (opts.compact) {
    if (h === 0) return `${sign}${r}m`;
    if (r === 0) return `${sign}${h}h`;
    return `${sign}${h}h${String(r).padStart(2, '0')}`;
  }
  if (h === 0) return `${sign}${r}m`;
  return `${sign}${h}h ${String(r).padStart(2, '0')}m`;
}

/** Minutes-from-midnight → "09:30" */
export function formatClock(minOfDay: number): string {
  const h = Math.floor(minOfDay / 60) % 24;
  const m = minOfDay % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatPercent(ratio: number, digits = 0): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function minutesNow(d = new Date()): number {
  return d.getHours() * 60 + d.getMinutes();
}
