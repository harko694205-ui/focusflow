/**
 * Installable-app support: service worker registration, the browser's install prompt and
 * "new version available" updates. State lives in a small store the UI reads (Settings,
 * command palette); the service worker itself is generated at build time (vite-plugin-sw.ts).
 */
import { create } from 'zustand';
import { toast } from '@/app/toast';

/** Chrome/Edge's install prompt event (not in the TS DOM lib). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type Platform = 'ios' | 'android' | 'desktop';

interface PwaState {
  /** Running as the installed app (its own window / home-screen app). */
  installed: boolean;
  /** The browser offered installation; call install() to show its dialog. */
  canInstall: boolean;
  /** A new version is downloaded and waiting. */
  updateReady: boolean;
  /** The app's files are saved for offline use (a service worker controls the page). */
  offlineReady: boolean;
  platform: Platform;
}

export const usePwa = create<PwaState>(() => ({
  installed: false,
  canInstall: false,
  updateReady: false,
  offlineReady: false,
  platform: 'desktop',
}));

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let waiting: ServiceWorker | null = null;

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac with touch.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

/** Show the browser's install dialog. Returns true when the user accepted. */
export async function install(): Promise<boolean> {
  if (!deferredPrompt) return false;
  const prompt = deferredPrompt;
  deferredPrompt = null;
  usePwa.setState({ canInstall: false });
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  return outcome === 'accepted';
}

/** Activate the waiting version; the page reloads once it takes over. */
export function applyUpdate() {
  if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
  else window.location.reload();
}

function announceUpdate(worker: ServiceWorker) {
  waiting = worker;
  if (usePwa.getState().updateReady) return;
  usePwa.setState({ updateReady: true });
  toast('A new version of FocusFlow is ready', { tone: 'info', duration: 60 * 60_000, action: { label: 'Reload', run: applyUpdate } });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.register('/sw.js');
  usePwa.setState({ offlineReady: !!navigator.serviceWorker.controller });

  // An update downloaded on a previous visit is still waiting.
  if (reg.waiting && navigator.serviceWorker.controller) announceUpdate(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const next = reg.installing;
    next?.addEventListener('statechange', () => {
      if (next.state !== 'installed') return;
      // First install: the app is now available offline. Otherwise it's an update.
      if (navigator.serviceWorker.controller) announceUpdate(next);
      else usePwa.setState({ offlineReady: true });
    });
  });

  // Reload once when the new version takes over (after "Reload").
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    usePwa.setState({ offlineReady: true });
    if (waiting && !reloading) {
      reloading = true;
      window.location.reload();
    }
  });

  // Look for new versions when the app comes back to the foreground, and hourly.
  const check = () => void reg.update().catch(() => undefined);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
  setInterval(check, 60 * 60_000);
}

/** Call once at startup. */
export function initPwa() {
  usePwa.setState({ installed: isStandalone(), platform: detectPlatform() });
  window.matchMedia('(display-mode: standalone)').addEventListener('change', (e) => usePwa.setState({ installed: e.matches }));

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // keep it for our own Install button instead of the mini-infobar
    deferredPrompt = e as BeforeInstallPromptEvent;
    usePwa.setState({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    usePwa.setState({ canInstall: false, installed: true });
    toast('FocusFlow is installed — find it in your apps');
  });

  // Development builds change constantly; the service worker only runs in production.
  if (import.meta.env.PROD) {
    if (document.readyState === 'complete') void registerServiceWorker();
    else window.addEventListener('load', () => void registerServiceWorker(), { once: true });
  }
}
