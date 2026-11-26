/**
 * POST /api/ics { url } → the Canvas (BruinLearn) calendar feed at that link.
 *
 * Canvas doesn't send CORS headers on calendar feeds, so the browser can't read them directly.
 * This function fetches one for the app and nothing else: only https Canvas hosts, only the
 * /feeds/calendars/….ics path, no cookies, size- and time-limited, never cached. The link is
 * a private token, so it's sent in the body (not the URL) and never logged.
 *
 * Runs as a Vercel Function (web-standard handler) and, in development, via vite-plugin-api.ts.
 */

const HOST = /^(?:[a-z0-9-]+\.)*(?:instructure\.com|bruinlearn\.ucla\.edu)$/i;
const PATH = /^\/feeds\/calendars\/[\w.-]+\.ics$/i;
const MAX_BYTES = 5 * 1024 * 1024;

const json = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

function allowed(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && HOST.test(u.hostname) && PATH.test(u.pathname) && !u.username && !u.password && !u.port ? u : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: { url?: unknown };
  try {
    body = (await request.json()) as { url?: unknown };
  } catch {
    return json(400, 'Send the feed link as JSON.');
  }
  const url = allowed(body?.url);
  if (!url) return json(400, 'That isn’t a BruinLearn calendar feed link.');

  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'text/calendar' }, redirect: 'follow', signal: AbortSignal.timeout(15_000) });
  } catch {
    return json(504, 'BruinLearn didn’t answer in time. Try again in a minute.');
  }
  // Redirects must stay on Canvas (a bad token usually lands on a login page).
  if (res.url && !HOST.test(new URL(res.url).hostname)) return json(502, 'BruinLearn redirected somewhere unexpected.');
  if (res.status === 401 || res.status === 403 || res.status === 404) return json(404, 'BruinLearn doesn’t recognise that feed link. Copy it again from Calendar → Calendar Feed.');
  if (!res.ok) return json(502, `BruinLearn returned an error (${res.status}).`);
  if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) return json(413, 'That calendar is too large.');

  const text = await res.text();
  if (text.length > MAX_BYTES) return json(413, 'That calendar is too large.');
  if (!/BEGIN:VCALENDAR/i.test(text)) return json(502, 'BruinLearn didn’t return a calendar. Copy the feed link again from Calendar → Calendar Feed.');
  return new Response(text, { status: 200, headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export function GET(): Response {
  return json(405, 'Use POST.');
}
