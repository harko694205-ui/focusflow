/**
 * Break reminders: a soft chime (Web Audio, no asset) and an optional system notification.
 * Browsers only allow audio after a user gesture, so the context is created on the first
 * Focus Mode click (`unlockAudio`).
 */
let ctx: AudioContext | null = null;

export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

/** Two short sine notes: rising for "back to focus", falling for "take a break". */
export function chime(kind: 'break' | 'focus') {
  if (!ctx) return;
  const notes = kind === 'break' ? [784, 587] : [587, 880];
  const t0 = ctx.currentTime + 0.02;
  notes.forEach((freq, i) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = t0 + i * 0.22;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.16, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(t);
    osc.stop(t + 0.65);
  });
}

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;

export const notificationPermission = (): NotificationPermission | 'unsupported' =>
  notificationsSupported() ? Notification.permission : 'unsupported';

/** Ask the browser for permission. Only ever called from the user's own click. */
export async function requestNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

export function notify(title: string, body: string) {
  if (notificationPermission() !== 'granted') return;
  const options: NotificationOptions = { body, tag: 'focusflow-focus', silent: true, icon: '/icons/icon-192.png', badge: '/icons/favicon-32.png' };
  // Through the service worker when there is one: required on Android, and the click handler
  // (in sw.js) brings the app forward even if this tab was closed.
  if (navigator.serviceWorker?.controller) {
    void navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, options)).catch(() => undefined);
    return;
  }
  try {
    const n = new Notification(title, options);
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* some platforms only allow notifications from a service worker */
  }
}
