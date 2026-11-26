/**
 * Calendar import from Canvas (BruinLearn). Canvas publishes each student's calendar as an
 * iCalendar feed: assignments are VEVENTs whose UID starts with "event-assignment-" and whose
 * SUMMARY ends with the course in brackets — "Homework 3 [COM SCI 31 - Lec 1]". Pure functions.
 */
import { LIMITS } from './constants';
import type { Category, Difficulty, ID, Minutes } from './types';

/* -------------------------------------------------------------------------- */
/* iCalendar                                                                  */
/* -------------------------------------------------------------------------- */

export interface IcsEvent {
  uid: string;
  summary: string;
  /** Epoch ms. For all-day events, local midnight of the date. */
  start: number;
  allDay: boolean;
  description: string;
  url: string;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parseLine(line: string): Prop | null {
  // NAME;PARAM=a;PARAM2="b:c":value — a colon inside a quoted parameter isn't the separator.
  let i = 0;
  let quoted = false;
  for (; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ':' && !quoted) break;
  }
  if (i >= line.length) return null;
  const [name, ...rawParams] = line.slice(0, i).split(';');
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
}

const unescapeText = (s: string) => s.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));

/** Offset of a time zone from UTC at an instant, in ms. Throws for unknown zones. */
function zoneOffset(t: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(t / 1000) * 1000;
}

/** Wall-clock time in a zone → epoch ms. */
export function zonedTime(y: number, mo: number, d: number, h: number, mi: number, s: number, timeZone: string): number {
  const wall = Date.UTC(y, mo, d, h, mi, s);
  let t = wall - zoneOffset(wall, timeZone);
  // Near a DST change the first guess can be an hour off; one correction settles it.
  t = wall - zoneOffset(t, timeZone);
  return t;
}

/** DTSTART value → instant. Handles UTC ("Z"), TZID-local, floating and DATE values. */
export function parseIcsDate(value: string, params: Record<string, string> = {}): { t: number; allDay: boolean } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  if (m[4] === undefined || params.VALUE === 'DATE') return { t: new Date(y, mo, d).getTime(), allDay: true };
  const [h, mi, s] = [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  if (m[7]) return { t: Date.UTC(y, mo, d, h, mi, s), allDay: false };
  if (params.TZID) {
    try {
      return { t: zonedTime(y, mo, d, h, mi, s, params.TZID), allDay: false };
    } catch {
      /* unknown zone (e.g. a Windows name): treat as local time */
    }
  }
  return { t: new Date(y, mo, d, h, mi, s).getTime(), allDay: false };
}

/** Parse an .ics file's events. Throws if it isn't a calendar. */
export function parseIcs(text: string): IcsEvent[] {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('That isn’t a calendar (.ics) file.');
  // Unfold: a line starting with a space or tab continues the previous one.
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events: IcsEvent[] = [];
  let cur: Partial<IcsEvent> | null = null;
  let depth = 0; // nested components inside a VEVENT (VALARM) are ignored
  for (const line of lines) {
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      if (p.value.toUpperCase() === 'VEVENT' && !cur) cur = {};
      else if (cur) depth++;
      continue;
    }
    if (p.name === 'END') {
      if (cur && depth > 0) depth--;
      else if (cur && p.value.toUpperCase() === 'VEVENT') {
        if (cur.uid && cur.start !== undefined) events.push({ summary: '', description: '', url: '', allDay: false, ...cur } as IcsEvent);
        cur = null;
      }
      continue;
    }
    if (!cur || depth > 0) continue;
    switch (p.name) {
      case 'UID':
        cur.uid = p.value.trim();
        break;
      case 'SUMMARY':
        cur.summary = unescapeText(p.value).trim();
        break;
      case 'DESCRIPTION':
        cur.description = unescapeText(p.value).trim();
        break;
      case 'URL':
        cur.url = p.value.trim();
        break;
      case 'DTSTART': {
        const d = parseIcsDate(p.value, p.params);
        if (d) {
          cur.start = d.t;
          cur.allDay = d.allDay;
        }
        break;
      }
    }
  }
  return events;
}

/* -------------------------------------------------------------------------- */
/* Canvas items                                                               */
/* -------------------------------------------------------------------------- */

export interface CanvasItem {
  uid: string;
  title: string;
  /** Course name from the summary's trailing [brackets]; null when there is none. */
  course: string | null;
  due: number;
  /** Assignments become tasks; other calendar events are offered but off by default. */
  kind: 'assignment' | 'event';
  /** Looks like a midterm/final: better added under Exams. */
  exam: boolean;
  url: string;
  description: string;
  estimate: Minutes;
  difficulty: Difficulty;
}

/** A first guess at the work an assignment takes, from its title. Editable in the preview. */
export function guessWork(title: string): { estimate: Minutes; difficulty: Difficulty; exam: boolean } {
  const kind = workKind(title);
  return { ...WORK[kind], exam: kind === 'exam' };
}

export type WorkKind = 'exam' | 'project' | 'lab' | 'homework' | 'quiz' | 'reading' | 'discussion' | 'other';

/** Typical effort per kind of work — the starting guess before there's history to learn from. */
export const WORK: Record<WorkKind, { estimate: Minutes; difficulty: Difficulty; label: string }> = {
  exam: { estimate: 60, difficulty: 3, label: 'exams' },
  project: { estimate: 240, difficulty: 3, label: 'projects' },
  lab: { estimate: 120, difficulty: 2, label: 'labs' },
  homework: { estimate: 120, difficulty: 2, label: 'problem sets' },
  quiz: { estimate: 30, difficulty: 1, label: 'quizzes' },
  reading: { estimate: 60, difficulty: 1, label: 'readings' },
  discussion: { estimate: 30, difficulty: 1, label: 'posts' },
  other: { estimate: 60, difficulty: 2, label: 'tasks' },
};

/** What kind of work a title describes: "HW 5", "hw5", "Problem Set 4" → homework. */
export function workKind(title: string): WorkKind {
  const t = title.toLowerCase();
  if (/\b(midterm|final exam|final|exam)\b/.test(t) && !/\b(project|paper|essay|report|draft)\b/.test(t)) return 'exam';
  if (/\b(project|paper|essay|report|presentation|portfolio)\b/.test(t)) return 'project';
  if (/\blab\s?\d*\b/.test(t)) return 'lab';
  if (/\b(hw\s?\d*|homework|problem set|pset\s?\d*|ps\s?\d+|worksheet|assignment)\b/.test(t)) return 'homework';
  if (/\bquiz\s?\d*\b/.test(t)) return 'quiz';
  if (/\b(reading|read|chapter|ch\.?\s?\d+)\b/.test(t)) return 'reading';
  if (/\b(discussion|post|reply|response|reflection|survey|attendance|participation|check-?in|poll)\b/.test(t)) return 'discussion';
  return 'other';
}

/** Split "Homework 3 [COM SCI 31]" into title and course. */
export function splitSummary(summary: string): { title: string; course: string | null } {
  const m = /^(.*?)\s*\[([^[\]]+)\]\s*$/.exec(summary);
  return m && m[1] ? { title: m[1].trim(), course: m[2].trim() } : { title: summary.trim(), course: null };
}

/** Canvas events → importable items. All-day assignments are due at `dueTime` that day. */
export function canvasItems(events: IcsEvent[], dueTime = '23:59'): CanvasItem[] {
  const [dh, dm] = dueTime.split(':').map(Number);
  const seen = new Set<string>();
  const items: CanvasItem[] = [];
  for (const e of events) {
    if (seen.has(e.uid)) continue;
    seen.add(e.uid);
    const { title, course } = splitSummary(e.summary);
    if (!title) continue;
    const due = e.allDay ? (() => { const d = new Date(e.start); d.setHours(dh, dm, 0, 0); return d.getTime(); })() : e.start;
    const work = guessWork(title);
    items.push({
      uid: e.uid,
      title: title.slice(0, LIMITS.titleMax),
      course,
      due,
      kind: /assignment/i.test(e.uid) ? 'assignment' : 'event',
      exam: work.exam,
      url: e.url,
      description: e.description,
      estimate: work.estimate,
      difficulty: work.difficulty,
    });
  }
  return items.sort((a, b) => a.due - b.due);
}

/** Task notes for an imported item: the link back, then the description (trimmed). */
export function canvasNotes(item: Pick<CanvasItem, 'url' | 'description'>): string {
  const desc = item.description.replace(/\n{3,}/g, '\n\n').trim();
  return [item.url && `From BruinLearn: ${item.url}`, desc.length > 1500 ? `${desc.slice(0, 1500).trimEnd()}…` : desc].filter(Boolean).join('\n\n').slice(0, LIMITS.notesMax);
}

/* -------------------------------------------------------------------------- */
/* Courses                                                                    */
/* -------------------------------------------------------------------------- */

/** UCLA subject spellings that mean the same department. */
const DEPT_ALIASES: Record<string, string> = {
  COMSCI: 'CS', CS: 'CS', CSCI: 'CS',
  ECENGR: 'ECE', EE: 'ECE', ECE: 'ECE', ELENGR: 'ECE',
  MECHAE: 'MAE', MAE: 'MAE',
  PHYSICS: 'PHYS', PHYS: 'PHYS',
  CHEM: 'CHEM', CHEMISTRY: 'CHEM',
  LIFESCI: 'LS', LS: 'LS',
  STATS: 'STAT', STAT: 'STAT', STATISTICS: 'STAT',
  PSYCH: 'PSYCH', PSYCHOLOGY: 'PSYCH',
  ECON: 'ECON', ECONOMICS: 'ECON',
  MATH: 'MATH', MATHEMATICS: 'MATH',
  ENGCOMP: 'ENGCOMP', ENGL: 'ENGL', ENGLISH: 'ENGL',
  POLSCI: 'POLSCI', POLISCI: 'POLSCI',
  HIST: 'HIST', HISTORY: 'HIST',
  MCDB: 'MCDB', EEB: 'EEB', BIOENGR: 'BE', BE: 'BE',
};

const isTermCode = (t: string) => /^\d{2}[FWS1-2]$/.test(t) || /^\d{4}$/.test(t) || /^(FALL|WINTER|SPRING|SUMMER|LEC|DIS|LAB|SEM|SEC)$/.test(t);
const NUM = /^[A-Z]?\d{1,3}[A-Z]{0,2}$/;

/** "COM SCI 31 - Lec 1 - Fall 2026", "26F-COMSCI31-1", "CS 31" → { dept: 'CS', num: '31', label: 'COM SCI 31' }. */
export function courseCode(name: string): { dept: string; num: string; label: string } | null {
  const tokens = name.toUpperCase().replace(/&/g, ' ').split(/[^A-Z0-9]+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (isTermCode(tok)) continue;
    const glued = /^([A-Z]{2,})([A-Z]?\d{1,3}[A-Z]{0,2})$/.exec(tok);
    if (glued) return finish(glued[1], glued[2], `${glued[1]} ${glued[2]}`);
    if (NUM.test(tok)) {
      let j = i;
      while (j > 0 && /^[A-Z]+$/.test(tokens[j - 1]) && !isTermCode(tokens[j - 1])) j--;
      if (j < i) {
        const words = tokens.slice(j, i);
        return finish(words.join(''), tok, `${words.join(' ')} ${tok}`);
      }
    }
  }
  return null;
  function finish(dept: string, num: string, label: string) {
    return { dept: DEPT_ALIASES[dept] ?? dept, num: num.replace(/^0+(?=\d)/, ''), label };
  }
}

const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** The existing course a Canvas course name most likely means, or null. */
export function matchCourse(canvasName: string, categories: Pick<Category, 'id' | 'name'>[]): ID | null {
  const exact = categories.find((c) => squash(c.name) === squash(canvasName));
  if (exact) return exact.id;
  const code = courseCode(canvasName);
  if (code) {
    const same = categories.filter((c) => {
      const k = courseCode(c.name);
      if (!k) return false;
      // "MUSCLG M82" vs "MUSCLGM82": the same code split differently.
      if (squash(k.label) === squash(code.label)) return true;
      return k.num === code.num && (k.dept === code.dept || k.dept.startsWith(code.dept) || code.dept.startsWith(k.dept));
    });
    if (same.length === 1) return same[0].id;
  }
  // "MATH 33A" inside "MATH 33A Linear Algebra - Fall 2026".
  const inside = categories.filter((c) => squash(c.name).length >= 3 && squash(canvasName).includes(squash(c.name)));
  return inside.length === 1 ? inside[0].id : null;
}

/** A short course name for a Canvas course that doesn't exist yet. */
export function suggestCourseName(canvasName: string): string {
  const code = courseCode(canvasName);
  return (code?.label ?? canvasName.split(/\s+-\s+/)[0].trim()).slice(0, LIMITS.categoryNameMax);
}

/* -------------------------------------------------------------------------- */
/* Feed links                                                                 */
/* -------------------------------------------------------------------------- */

/** Canvas hosts the feed proxy will fetch from. */
export const CANVAS_HOST = /^(?:[a-z0-9-]+\.)*(?:instructure\.com|bruinlearn\.ucla\.edu)$/i;

/** Normalise a pasted feed link (webcal:// → https://); null if it isn't a Canvas calendar feed. */
export function normalizeFeedUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim().replace(/^webcals?:\/\//i, 'https://'));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !CANVAS_HOST.test(url.hostname)) return null;
  if (!/^\/feeds\/calendars\/[\w.-]+\.ics$/i.test(url.pathname)) return null;
  return url.toString();
}
