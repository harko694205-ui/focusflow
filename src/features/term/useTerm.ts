import { useMemo } from 'react';
import { useProfile } from '@/hooks/data';
import { finalsCountdown, termWeek, type Term, type TermWeek } from '@/domain/term';

export interface TermStatus {
  term: Term;
  week: TermWeek;
  /** "Finals start Mon Dec 7 · in 2 weeks", or null. */
  finals: string | null;
}

/** Where `at` falls in the current academic term — only in Student mode with a term set. */
export function useTermStatus(at: number): TermStatus | null {
  const profile = useProfile();
  return useMemo(() => {
    if (profile.mode !== 'student' || !profile.term) return null;
    return { term: profile.term, week: termWeek(profile.term, at), finals: finalsCountdown(profile.term, at) };
  }, [profile, at]);
}

/** Term week for any date (e.g. the Timeline's visible week), or null outside Student mode. */
export function useTermWeekFor(): ((at: number | Date) => TermWeek | null) {
  const profile = useProfile();
  return useMemo(() => {
    const term = profile.mode === 'student' ? profile.term : null;
    return (at: number | Date) => (term ? termWeek(term, at) : null);
  }, [profile]);
}
