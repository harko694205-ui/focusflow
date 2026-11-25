/**
 * Build-time service worker for the installable app (no runtime dependencies).
 *
 * After the build is written, this lists every file the app needs (hashed JS/CSS/fonts, the
 * HTML shell, small icons, the manifest) and writes dist/sw.js with that list and a version
 * derived from it. A new deploy therefore changes sw.js byte-for-byte, which is how browsers
 * notice an update; the page then offers "Reload" (see src/pwa/register.ts).
 *
 * Strategy:
 *  - navigations → the cached app shell (index.html), so the app opens offline and instantly;
 *  - /assets/*   → cache first (file names are content-hashed, so they never change);
 *  - other files → stale-while-revalidate.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

/** Public files worth having offline. Large install-time icons are left to the OS to fetch. */
const PUBLIC_PRECACHE = ['/favicon.svg', '/icons/favicon-32.png', '/icons/icon-192.png', '/icons/icon.svg', '/manifest.webmanifest'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'focusflow-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    writeBundle() {
      const assets = walk(join(outDir, 'assets'))
        .map((p) => '/' + relative(outDir, p).split(sep).join('/'))
        .filter((u) => !u.endsWith('.map'))
        .sort();
      const shell = readFileSync(join(outDir, 'index.html'));
      const precache = ['/index.html', ...PUBLIC_PRECACHE, ...assets];
      // Changes whenever the app or the worker's own code changes.
      const version = createHash('sha256').update(SW_SOURCE).update(shell).update(precache.join('\n')).digest('hex').slice(0, 12);
      writeFileSync(join(outDir, 'sw.js'), SW_SOURCE.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache, null, 0)));
      this.info?.(`service worker: ${precache.length} files precached (version ${version})`);
    },
  };
}

const SW_SOURCE = `/* FocusFlow service worker — generated at build time by vite-plugin-sw.ts. */
const VERSION = '__VERSION__';
const CACHE = 'focusflow-' + VERSION;
const PRECACHE = __PRECACHE__;
const SHELL = '/index.html';
// Servers may send "Vary: Origin"; module scripts are requested with an Origin header and the
// precache requests aren't, so honouring Vary would miss every script offline. Files are
// content-hashed, so the variation never matters here.
const MATCH = { ignoreVary: true };

self.addEventListener('install', (event) => {
  // Bypass the HTTP cache so a new version never precaches stale files.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))));
  // No skipWaiting here: an update waits until the page asks (the user clicks "Reload").
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('focusflow-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname === '/sw.js') return;

  if (req.mode === 'navigate') {
    // App shell: every route is the same single-page app.
    event.respondWith(caches.match(SHELL, MATCH).then((hit) => hit || fetch(req)));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req, MATCH).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }
  // Icons, manifest and other public files: serve the cached copy, refresh it in the background.
  event.respondWith(
    caches.open(CACHE).then((c) =>
      c.match(req, MATCH).then((hit) => {
        const fresh = fetch(req)
          .then((res) => {
            if (res.ok) c.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || fresh;
      }),
    ),
  );
});

// Focus Mode reminders shown through the service worker: clicking one brings the app forward.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const win = list.find((c) => 'focus' in c);
      return win ? win.focus() : self.clients.openWindow('/focus');
    }),
  );
});
`;
