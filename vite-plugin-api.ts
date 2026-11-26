/** Serves the Vercel Functions in /api during `vite` and `vite preview`, so feed sync works locally. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { POST as icsPost } from './api/ics';

async function handle(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const out = await icsPost(new Request('http://localhost/api/ics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: Buffer.concat(chunks) }));
  res.statusCode = out.status;
  out.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(await out.text());
}

export function devApi(): Plugin {
  // Returns nothing: a function returned from configureServer would run as a post hook.
  const mount = (server: { middlewares: { use: (path: string, fn: (req: IncomingMessage, res: ServerResponse) => void) => unknown } }): void => {
    server.middlewares.use('/api/ics', (req, res) => void handle(req, res));
  };
  return { name: 'focusflow-dev-api', configureServer: mount, configurePreviewServer: mount };
}
