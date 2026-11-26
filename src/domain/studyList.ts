/**
 * MyUCLA Study List → classes and finals. Students copy the Study List page and paste it; this
 * reads each course ("Economics" / "11 - Microeconomic Theory"), its sections (Lec 2 · MW ·
 * 5pm-6:15pm · Broad Art Center 2160E) and its final exam line. Works with the page copied as
 * plain text (tab-separated rows) or with links kept as Markdown. Pure functions.
 */
import type { Minutes } from './types';

export interface StudySection {
  /** "Lec 2", "Dis 2B". */
  section: string;
  /** "Lecture", "Discussion"… (the class "type" in FocusFlow). */
  kind: string;
  /** "Enrolled", "Waitlisted"… */
  status: string;
  days: number[];
  start: Minutes;
  end: Minutes;
  location: string;
}

export interface StudyFinal {
  start: number;
  duration: Minutes;
  location: string;
}

export interface StudyCourse {
  /** "Economics". */
  subject: string;
  /** "11", "1B", "M82". */
  number: string;
  /** "Microeconomic Theory". */
  title: string;
  /** Short course name: "ECON 11". */
  name: string;
  sections: StudySection[];
  final: StudyFinal | null;
}

const KINDS: Record<string, string> = {
  LEC: 'Lecture', DIS: 'Discussion', LAB: 'Lab', SEM: 'Seminar', TUT: 'Tutorial', ACT: 'Activity', STU: 'Studio',
  REC: 'Recitation', FLD: 'Fieldwork', CLI: 'Clinic', CLIN: 'Clinic', RES: 'Research', LAB2: 'Lab',
};

/** UCLA subject area names → the abbreviations used in course codes (Schedule of Classes). */
const SUBJECTS: Record<string, string> = {
  'african american studies': 'AF AMER', anthropology: 'ANTHRO', 'art history': 'ART HIS', art: 'ART', 'asian american studies': 'ASIA AM',
  astronomy: 'ASTR', 'atmospheric and oceanic sciences': 'AOS', bioengineering: 'BIOENGR', 'chemical engineering': 'CH ENGR',
  'chemistry and biochemistry': 'CHEM', chemistry: 'CHEM', 'chicana/o and central american studies': 'CCAS', 'civil and environmental engineering': 'C&EE',
  classics: 'CLASSIC', communication: 'COMM', 'communication studies': 'COMM', 'computer science': 'COM SCI', 'design media arts': 'DESMA',
  'earth, planetary, and space sciences': 'EPS SCI', 'ecology and evolutionary biology': 'EE BIOL', economics: 'ECON', education: 'EDUC',
  'electrical and computer engineering': 'EC ENGR', engineering: 'ENGR', english: 'ENGL', 'english composition': 'ENGCOMP',
  'environment': 'ENVIRON', 'film and television': 'FILM TV', french: 'FRNCH', 'gender studies': 'GENDER', geography: 'GEOG', german: 'GERMAN',
  'global studies': 'GLB ST', history: 'HIST', 'human genetics': 'HUM GEN', 'integrative biology and physiology': 'IN BIO', 'international development studies': 'INTL DV',
  japanese: 'JAPAN', korean: 'KOREAN', 'life sciences': 'LIFESCI', linguistics: 'LING', management: 'MGMT', 'materials science and engineering': 'MAT SCI',
  mathematics: 'MATH', 'mechanical and aerospace engineering': 'MECH&AE', 'microbiology, immunology, and molecular genetics': 'MIMG',
  'molecular, cell, and developmental biology': 'MCDB', music: 'MUSC', musicology: 'MUSCLG', neuroscience: 'NEUROSC', nursing: 'NURSING',
  philosophy: 'PHILOS', 'physics': 'PHYSICS', 'physiological science': 'PHYSCI', 'political science': 'POL SCI', psychology: 'PSYCH',
  'public health': 'PUB HLT', 'public policy': 'PUB PLC', sociology: 'SOCIOL', spanish: 'SPAN', statistics: 'STATS', 'statistics and data science': 'STATS',
  theater: 'THEATER', 'urban planning': 'URBN PL', 'world arts and cultures': 'WL ARTS',
};

const DAY_LETTERS: Record<string, number> = { U: 0, M: 1, T: 2, W: 3, R: 4, F: 5, S: 6 };
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const CLOCK = String.raw`\d{1,2}(?::\d{2})?\s*[ap]m`;
const RANGE = new RegExp(String.raw`(${CLOCK})\s*-\s*(${CLOCK})`, 'i');

/** "5pm", "6:15pm", "12pm" → minutes from midnight. */
export function parseClock12(s: string): Minutes | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])m$/i.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h < 1 || h > 12 || min > 59) return null;
  return ((h % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0)) * 60 + min;
}

/** "MW" → [1, 3]; "TR" → [2, 4]. Null for TBA/VAR. */
export function parseDays(s: string): number[] | null {
  if (!/^[MTWRFSU]{1,7}$/.test(s)) return null;
  return [...new Set([...s].map((c) => DAY_LETTERS[c]))].sort();
}

/** Short course name from the subject and catalog number: "Economics", "11" → "ECON 11". */
export function courseName(subject: string, number: string, code?: string | null): string {
  const abbr = code?.trim() || SUBJECTS[subject.trim().toLowerCase()] || subject.trim();
  return `${abbr} ${number}`.slice(0, 40);
}

const LINK = /\[([^\]]*)\]\([^)\s]*\)/g;
const COURSE_LINE = /^\s*([A-Z]{0,2}\d{1,4}[A-Z]{0,3})\s+-\s+(.+?)\s*$/;
const SECTION_START = /^\s*(Lec|Dis|Lab|Sem|Tut|Act|Stu|Rec|Fld|Clin?|Res)\s+([0-9A-Z]{1,4})\b/i;

function parseFinal(line: string): Omit<StudyFinal, 'location'> | null {
  const m = new RegExp(String.raw`Final Exam:\s*(?:[A-Za-z]+day,?\s+)?([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4}),?\s+` + RANGE.source, 'i').exec(line);
  if (!m) return null;
  const month = MONTHS.findIndex((x) => x.startsWith(m[1].toLowerCase().slice(0, 3)));
  const from = parseClock12(m[4]);
  const to = parseClock12(m[5]);
  if (month < 0 || from === null || to === null || to <= from) return null;
  return { start: new Date(Number(m[3]), month, Number(m[2]), Math.floor(from / 60), from % 60).getTime(), duration: to - from };
}

function parseSection(line: string): StudySection | null {
  const head = SECTION_START.exec(line);
  if (!head) return null;
  const cells = line.includes('\t') ? line.split('\t').map((c) => c.trim()).filter(Boolean) : null;
  const flat = line.replace(/\s+/g, ' ');
  const time = RANGE.exec(flat);
  if (!time) return null;
  // Days come right before the time.
  const before = flat.slice(0, time.index).trim().split(' ');
  const days = parseDays(before[before.length - 1] ?? '');
  const start = parseClock12(time[1]);
  const end = parseClock12(time[2]);
  if (!days || start === null || end === null || end <= start) return null;
  // Location: the cell after the time, or the text between the time and the units ("4.0").
  let location = '';
  if (cells) {
    const i = cells.findIndex((c) => RANGE.test(c));
    location = cells[i + 1] && !/^\d+(\.\d+)?$/.test(cells[i + 1]) ? cells[i + 1] : '';
  } else {
    location = /^\s*(.*?)\s+\d+\.\d\b/.exec(flat.slice(time.index + time[0].length))?.[1] ?? '';
  }
  const status = /\b(Enrolled|Waitlisted|Wait ?listed|Closed|Dropped|Cancelled|Canceled)\b/i.exec(flat)?.[1] ?? 'Enrolled';
  const type = head[1].toUpperCase();
  return { section: `${head[1][0].toUpperCase()}${head[1].slice(1).toLowerCase()} ${head[2]}`, kind: KINDS[type] ?? head[1], status, days, start, end, location: location.slice(0, 60) };
}

/** Read a pasted Study List. Throws if nothing that looks like a course is found. */
export function parseStudyList(text: string): StudyCourse[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const courses: Array<StudyCourse & { code: string | null }> = [];
  let cur: (StudyCourse & { code: string | null }) | null = null;
  let prev = '';
  let finalAt = -1;

  lines.forEach((raw, i) => {
    // Keep link text; Schedule of Classes links carry the subject code ("subj_area_cd=ECON+++").
    const code = /subj_area_cd=([^&)\s]+)/i.exec(raw)?.[1];
    const line = raw.replace(LINK, '$1');
    const t = line.trim();
    const course = COURSE_LINE.exec(line);
    if (course && !line.includes('\t') && prev && !/[:\t]/.test(prev) && !SECTION_START.test(prev)) {
      cur = { subject: prev, number: course[1], title: course[2], name: '', sections: [], final: null, code: null };
      courses.push(cur);
    } else if (cur && /^Final Exam:/i.test(t)) {
      const f = parseFinal(t);
      if (f) {
        cur.final = { ...f, location: '' };
        finalAt = i;
      }
    } else if (cur?.final && finalAt >= 0 && t && !/[:\t]/.test(t) && !/^Change\b/.test(t) && !SECTION_START.test(t) && i - finalAt <= 2) {
      // Up to two lines straight after the final exam line are its rooms.
      cur.final.location = cur.final.location ? `${cur.final.location} or ${t}` : t;
      finalAt = i;
    } else {
      if (t) finalAt = -1;
      const s = cur ? parseSection(line) : null;
      if (s && cur) {
        cur.sections.push(s);
        if (!cur.code && code) cur.code = decodeURIComponent(code.replace(/\+/g, ' ')).trim();
      }
    }
    if (t) prev = t;
  });

  const found = courses.filter((c) => c.sections.length || c.final);
  if (!found.length) throw new Error('No classes found. In MyUCLA, open your Study List, select from the first course down to the last, copy and paste it here.');
  return found.map(({ code, ...c }) => ({ ...c, name: courseName(c.subject, c.number, code), final: c.final ? { ...c.final, location: c.final.location.slice(0, 80) } : null }));
}
