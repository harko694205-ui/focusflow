import { useEffect, useRef } from 'react';
import { toast } from '@/app/toast';
import { db } from '@/db/db';
import { focusSinceBreak, isBreak, needsBreak, PHASE_LABEL, dueAt, type FocusEvent, type FocusSession } from '@/domain/focus';
import { formatDuration } from '@/lib/format';
import { useFocusSession } from '@/hooks/data';
import { settleFocus } from '@/services/focusService';
import { reportError } from '@/app/commands';
import { chime, notify } from './reminders';

const SLACK_MS = 60; // fire just after the phase ends so settle() sees it as due
const POLL_MS = 30_000; // background tabs throttle timers; re-check regularly

/**
 * Keeps the Focus Mode session moving whatever page is open: ends each phase on time (so its
 * focus time is recorded) and gives break reminders. Mounted once, above every route.
 */
export function FocusDriver() {
  const session = useFocusSession();
  const ref = useRef<FocusSession | null | undefined>(session);
  ref.current = session;
  const nudged = useRef<string | null>(null);

  // Settle on a timer at the phase end, on a slow poll, and whenever the tab regains attention.
  useEffect(() => {
    if (!session) return;
    const tick = () => void settleFocus().then((events) => remind(events)).catch(reportError);
    tick();
    const due = dueAt(session);
    const timers: number[] = [window.setInterval(tick, POLL_MS)];
    if (due !== null) timers.push(window.setTimeout(tick, Math.max(0, due - Date.now()) + SLACK_MS));
    const onWake = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    return () => {
      timers.forEach((t) => (window.clearTimeout(t), window.clearInterval(t)));
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, [session]);

  // Nudge once per streak when breaks keep getting skipped.
  useEffect(() => {
    if (!session || session.phase !== 'focus' || session.runStart === null) return;
    const key = `${session.startedAt}:${session.skippedBreaks}:${session.completed}`;
    const check = () => {
      const s = ref.current;
      if (!s || nudged.current === key || !needsBreak(s, Date.now())) return;
      nudged.current = key;
      const msg = `${formatDuration(Math.round(focusSinceBreak(s, Date.now()) / 60_000), { compact: true })} of focus without a break — consider stepping away`;
      toast(msg, { tone: 'info', duration: 10_000 });
      if (s.settings.notifications && document.hidden) notify('Time for a break', msg);
    };
    check();
    const t = window.setInterval(check, POLL_MS);
    return () => window.clearInterval(t);
  }, [session]);

  return null;
}

/** Reminders for the transitions that just happened while someone was watching. */
async function remind(events: FocusEvent[]) {
  const live = events.filter((e) => e.live);
  const e = live[live.length - 1];
  if (!e) return;
  const s = (await db.meta.get('focusSession'))?.value as FocusSession | undefined;
  if (!s) return;
  const task = await db.tasks.get(s.taskId);
  const started = s.runStart !== null;
  let title: string;
  let body: string;
  if (e.type === 'focus_done') {
    const brk = PHASE_LABEL[e.next].toLowerCase();
    title = `Focus interval ${s.completed} done`;
    body = started ? `Your ${brk} has started — step away from the screen.` : `Time for a ${brk}.`;
  } else {
    title = 'Break’s over';
    body = started ? `Back to focus${task ? ` · ${task.title}` : ''}` : `Ready when you are${task ? ` · ${task.title}` : ''}`;
  }
  if (s.settings.sound) chime(isBreak(e.next) ? 'break' : 'focus');
  if (s.settings.notifications && document.hidden) notify(title, body);
  // The toast is short; the system notification (tab in the background) carries the detail.
  toast(`${title} · ${e.type === 'focus_done' ? (started ? 'break started' : 'take a break') : started ? 'back to focus' : 'ready when you are'}`, { tone: 'info', duration: 8_000 });
}
