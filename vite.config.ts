import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { serviceWorker } from './vite-plugin-sw';
import { devApi } from './vite-plugin-api';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
// `vite preview` serves the same headers as production (vercel.json), so CSP problems show up locally.
const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as { headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }> };
const prodHeaders = Object.fromEntries(vercel.headers.find((h) => h.source === '/(.*)')!.headers.map((h) => [h.key, h.value]));
const nm = (names: string) => new RegExp(`[\\/]node_modules[\\/](${names})[\\/]`);

export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker(), devApi()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 5173 },
  preview: { port: 4173, headers: prodHeaders },
  build: {
    rolldownOptions: {
      output: {
        // Pages are split by route (see main.tsx). Libraries go into a few stable, cacheable
        // chunks instead of many tiny shared ones; charts only load with pages that draw them.
        codeSplitting: {
          groups: [
            { name: 'react', test: nm('react|react-dom|react-router|scheduler'), priority: 30 },
            // Shared with the app itself: must not be captured by the charts group, which pulls in recharts' dependencies.
            { name: 'clsx', test: nm('clsx'), priority: 40 },
            { name: 'charts', test: nm('recharts|d3-[^\\/]+|victory-vendor|@reduxjs|redux|redux-thunk|immer|reselect|decimal\.js-light|internmap|es-toolkit|eventemitter3|use-sync-external-store|react-redux|tiny-invariant'), priority: 25 },
            { name: 'ui', test: nm('radix-ui|@radix-ui|motion|motion-dom|motion-utils|framer-motion|zustand|lucide-react|@floating-ui|aria-hidden|react-remove-scroll|react-remove-scroll-bar|react-style-singleton|use-callback-ref|use-sidecar|get-nonce|tslib|detect-node-es'), priority: 20 },
            { name: 'data', test: nm('dexie|dexie-react-hooks|date-fns'), priority: 20 },
          ],
        },
      },
    },
  },
});
