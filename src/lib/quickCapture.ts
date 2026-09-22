/**
 * One-box capture (queue task C1).
 *
 * Pure logic: the user pastes an e-mail or types one free sentence —
 *   "meeting with Petrojet Tuesday about the Algeria offer, Ahmed to send prices"
 * — and this decides which record it should become (task, correspondence or
 * bid), who owns it, when it is due and which bid/project it belongs to. The
 * box on Home renders the proposal; the user confirms it in the normal create
 * form, so nothing is ever written from here.
 *
 * There is no AI behind this on purpose: the app is a static site with a public
 * repo, so a model key could only ever ship in the bundle. It is plain rules,
 * built on the same vocabulary as the Outlook suggestions (mailSuggest.ts) —
 * a pasted e-mail goes through `suggestFromEmail` unchanged, so the two can
 * never disagree about the same mail.
 *
 * Like mailSuggest, reasons come back as CODES; the wording is the UI's job.
 * `scripts/harness/quickcapture.mjs` runs this file unmodified.
 */

import { normalizeArabic } from '../utils';
import type { TaskPriority, CorrespondingCategory } from '../types';
import {
  suggestFromEmail, detectParty, detectDeadline, detectTenderNumber, cleanSubject,
  type KnownParty, type SuggestedKind, type SuggestionMatch, type SuggestEmail,
} from './mailSuggest';

export type CaptureReasonCode =
  | 'pasted-email'     // headers were found, the mail rules decided the kind
  | 'tender-words'
  | 'letter-words'
  | 'owner-named'      // a colleague's name was read out of the text
  | 'owner-me'         // "I will …" / «سأرسل»
  | 'date'             // a date was read — value is the words it came from
  | 'known-client'     // a bid/project on the boards was named
  | 'urgent-words';

export interface CaptureReason {
  code: CaptureReasonCode;
  value?: string;
}

/** A colleague the text can name. `name` is their displayName. */
export interface CapturePerson {
  id: string;
  name: string;
}

export interface CaptureContext {
  /** The person typing — the owner when nobody else is named. */
  me: CapturePerson;
  /** Approved colleagues (may include `me`). */
  people: CapturePerson[];
  /** Clients / projects already on the boards (same list the Outlook Feed uses). */
  parties: KnownParty[];
  /** The reader's own mail domain — a pasted mail from it is internal. */
  ownDomain?: string;
  /** Injectable for the harness; defaults to today. */
  today?: Date;
}

export interface CaptureProposal {
  source: 'email' | 'sentence';
  kind: SuggestedKind;
  title: string;
  /** Everything that was pasted, kept for the record's description/body. */
  description: string;
  owner: CapturePerson;
  /** Other colleagues named in the text — offered as collaborators. */
  others: CapturePerson[];
  /** ISO yyyy-mm-dd, or undefined when no date could be read. */
  date?: string;
  priority: TaskPriority;
  category: CorrespondingCategory;
  client: string;
  match?: SuggestionMatch;
  tenderNumber?: string;
  /** Only for a pasted e-mail: who sent it. */
  sender?: string;
  reasons: CaptureReason[];
}

// ── Small helpers ────────────────────────────────────────────────────────────

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const addDays = (base: Date, n: number) => {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + n);
  return d;
};

/** ٠-٩ and ۰-۹ → 0-9, so «الأحد ٣٠/٩» reads like "30/9". */
export function latinDigits(text: string): string {
  return (text || '')
    .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x06F0));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Word boundaries that also work for Arabic (JS `\b` only knows ASCII). */
const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

// Sunday = 0 … Saturday = 6, as Date#getDay counts.
const EN_DAYS: [RegExp, number][] = [
  [/sun(?:day)?/, 0], [/mon(?:day)?/, 1], [/tue(?:s|sday)?/, 2], [/wed(?:nesday)?/, 3],
  [/thu(?:r|rs|rsday)?/, 4], [/fri(?:day)?/, 5], [/sat(?:urday)?/, 6],
];
// Arabic, in normalizeArabic form (ا for أ, ه for ة). Written without «ال» —
// the prefix is matched separately so «الأحد», «للأحد», «والأحد» all read.
const AR_DAYS: [string, number][] = [
  ['احد', 0], ['اثنين', 1], ['ثلاثاء', 2], ['ثلاثا', 2], ['اربعاء', 3], ['اربعا', 3],
  ['خميس', 4], ['جمعه', 5], ['سبت', 6],
];
// How Egyptians SAY the days («يوم الحد»، «التلات»). Each is also an ordinary
// word — «الحد الأدنى», «التلات عروض», «الاتنين هيروحوا» — so these only count
// after «يوم» or before «الجاي/القادم».
const AR_DAYS_SPOKEN: [string, number][] = [
  ['حد', 0], ['اتنين', 1], ['تلات', 2], ['تلاته', 2], ['اربع', 3],
];

const AR_MONTHS: [string, number][] = [
  ['يناير', 1], ['فبراير', 2], ['مارس', 3], ['ابريل', 4], ['مايو', 5], ['يونيو', 6], ['يونيه', 6],
  ['يوليو', 7], ['يوليه', 7], ['اغسطس', 8], ['سبتمبر', 9], ['اكتوبر', 10], ['نوفمبر', 11], ['ديسمبر', 12],
];

// Numbers as they are SPOKEN (voice typing writes «خمسة أكتوبر», not "5 أكتوبر").
// normalizeArabic form; Egyptian and MSA spellings side by side.
const AR_UNITS: [string, number][] = [
  ['واحد', 1], ['اتنين', 2], ['اثنين', 2], ['تلاته', 3], ['ثلاثه', 3], ['تلات', 3], ['ثلاث', 3],
  ['اربعه', 4], ['اربع', 4], ['خمسه', 5], ['خمس', 5], ['سته', 6], ['ست', 6], ['سبعه', 7], ['سبع', 7],
  ['تمانيه', 8], ['ثمانيه', 8], ['تمنيه', 8], ['تمان', 8], ['ثماني', 8], ['ثمان', 8], ['تسعه', 9], ['تسع', 9],
];
const AR_TEENS: [string, number][] = [
  ['حداشر', 11], ['احداشر', 11], ['احد عشر', 11], ['احدعشر', 11],
  ['اتناشر', 12], ['اثنا عشر', 12], ['اثني عشر', 12], ['اثناعشر', 12],
  ['تلتاشر', 13], ['ثلاثه عشر', 13], ['ثلاث عشره', 13], ['اربعتاشر', 14], ['اربعه عشر', 14],
  ['خمستاشر', 15], ['خمسه عشر', 15], ['ستاشر', 16], ['سته عشر', 16], ['سبعتاشر', 17], ['سبعه عشر', 17],
  ['تمنتاشر', 18], ['ثمانيه عشر', 18], ['تسعتاشر', 19], ['تسعه عشر', 19],
  ['عشره', 10], ['عشر', 10],
];
const AR_TENS: [string, number][] = [['عشرين', 20], ['عشرون', 20], ['تلاتين', 30], ['ثلاثين', 30], ['ثلاثون', 30]];
// «أول أكتوبر», «الخامس من أكتوبر».
const AR_ORDINALS: [string, number][] = [
  ['الاول', 1], ['اول', 1], ['التاني', 2], ['الثاني', 2], ['التالت', 3], ['الثالث', 3], ['الرابع', 4],
  ['الخامس', 5], ['السادس', 6], ['السابع', 7], ['التامن', 8], ['الثامن', 8], ['التاسع', 9], ['العاشر', 10],
];
const alt = (list: [string, number][]) =>
  [...list].sort((a, b) => b[0].length - a[0].length).map(([w]) => w.replace(/ /g, '\\s+')).join('|');
const valueOf = (list: [string, number][], word: string) =>
  list.find(([w]) => w === word.replace(/\s+/g, ' '))?.[1];
const SPOKEN_NUMBER = new RegExp(
  `${B}(?:(${alt(AR_UNITS)})\\s*و\\s*(${alt(AR_TENS)})|(${alt(AR_TEENS)})|(${alt(AR_TENS)})|(${alt(AR_UNITS)})|(${alt(AR_ORDINALS)}))${E}`,
  'gu');

/**
 * Spoken Arabic numbers → digits, in normalizeArabic text: «خمسه وعشرين» → 25,
 * «تلاتين» → 30, «الخامس» → 5. Only ever run on the private copy the date
 * reader looks at — what the user typed or dictated is never rewritten. «ال»
 * forms other than ordinals do not match, so «الاتنين» (Monday) stays a day.
 */
export function spokenNumbers(n: string): string {
  return n.replace(SPOKEN_NUMBER, (_m, u, ten, teen, tens, unit, ord) => {
    const v = u ? valueOf(AR_UNITS, u)! + valueOf(AR_TENS, ten)!
      : teen ? valueOf(AR_TEENS, teen)
        : tens ? valueOf(AR_TENS, tens)
          : unit ? valueOf(AR_UNITS, unit)
            : valueOf(AR_ORDINALS, ord);
    return v === undefined ? _m : String(v);
  });
}

export interface ReadDate {
  date: string;
  /** The words the date was read from, as typed — shown back to the user. */
  words: string;
}

/**
 * The first date a person would mean by what they typed. Handles
 * today/tomorrow/day after (EN + AR, incl. «بكرة»), weekday names ("Tuesday",
 * "next Tue", «الثلاثاء», «يوم الخميس»), "next week", "end of the week",
 * "in 3 days" / «بعد ٣ أيام», "30/9", "5 Oct", and full dates via the mail
 * reader. A weekday is always the NEXT one — "Tuesday" said on a Tuesday means
 * a week today, not today. Past dates are ignored.
 */
export function readDate(rawText: string, today: Date): ReadDate | undefined {
  const text = latinDigits(rawText);
  const n = spokenNumbers(normalizeArabic(text));
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const found: { at: number; date: Date; words: string }[] = [];
  const add = (m: RegExpExecArray | RegExpMatchArray | null, date: Date | null) => {
    if (!m || !date || m.index === undefined) return;
    found.push({ at: m.index, date, words: m[0].trim() });
  };
  const re = (src: string) => new RegExp(src, 'iu');

  // Relative day words.
  add(n.match(re(`${B}(?:day after tomorrow|بعد بكره|بعد بكرا|بعد غد)${E}`)), addDays(t0, 2));
  const afterTomorrow = found.length > 0;
  if (!afterTomorrow) add(n.match(re(`${B}(?:tomorrow|tmrw|بكره|بكرا|غدا|الغد)${E}`)), addDays(t0, 1));
  add(n.match(re(`${B}(?:today|tonight|eod|end of (?:the )?day|اليوم|النهارده|النهاردا)${E}`)), t0);

  // "in 3 days / within 2 weeks / بعد ٣ ايام / خلال اسبوعين"
  const rel = n.match(re(`${B}(?:in|within|after|بعد|خلال)\\s+(\\d{1,3})\\s*(working days?|days?|weeks?|ايام|يوم|اسابيع|اسبوع)${E}`));
  if (rel) add(rel, addDays(t0, Number(rel[1]) * (/week|اسبوع|اسابيع/.test(rel[2]) ? 7 : 1)));
  const twoWeeks = n.match(re(`${B}(?:خلال|بعد)\\s+اسبوعين${E}`));
  if (twoWeeks) add(twoWeeks, addDays(t0, 14));
  // The dual and the bare singular: «بعد يومين», «خلال أسبوع» (not «بعد أسبوع من …»).
  add(n.match(re(`${B}(?:خلال|بعد)\\s+يومين${E}`)), addDays(t0, 2));
  add(n.match(re(`${B}(?:خلال|بعد)\\s+اسبوع${E}(?!\\s+من)`)), addDays(t0, 7));

  // "next week" = the coming Sunday (the department's week starts on Sunday).
  const toSunday = ((7 - t0.getDay()) % 7) || 7;
  add(n.match(re(`${B}(?:next week|الاسبوع (?:الجاي|القادم|المقبل))${E}`)), addDays(t0, toSunday));
  // "end of the week" = the coming Thursday (Fri/Sat weekend); today if it is Thursday.
  add(n.match(re(`${B}(?:end of (?:the |this )?week|اخر الاسبوع|نهايه الاسبوع)${E}`)), addDays(t0, (4 - t0.getDay() + 7) % 7));

  // Weekday names.
  for (const [day, dow] of EN_DAYS) {
    const m = n.match(re(`${B}(?:(?:next|this|on|by)\\s+)?${day.source}${E}`));
    if (m) add(m, addDays(t0, ((dow - t0.getDay() + 7) % 7) || 7));
  }
  for (const [stem, dow] of AR_DAYS) {
    const m = n.match(re(`${B}(?:يوم\\s+)?[وب]?(?:ال|لل)${stem}${E}`));
    if (m) add(m, addDays(t0, ((dow - t0.getDay() + 7) % 7) || 7));
  }
  for (const [stem, dow] of AR_DAYS_SPOKEN) {
    const m = n.match(re(`${B}يوم\\s+[وب]?(?:ال|لل)${stem}${E}`))
      ?? n.match(re(`${B}[وب]?(?:ال|لل)${stem}\\s+(?:الجاي|القادم|اللي جاي)${E}`));
    if (m) add(m, addDays(t0, ((dow - t0.getDay() + 7) % 7) || 7));
  }

  // Arabic month names: «5 أكتوبر», «الخامس من أكتوبر», «5 شهر أكتوبر»,
  // «أول نوفمبر 2026». Without a year: the next time that day comes round.
  const withYear = (dd: number, mm: number, year: string | undefined, m: RegExpMatchArray) => {
    if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return;
    let d = new Date(year ? Number(year) : t0.getFullYear(), mm - 1, dd);
    if (d.getMonth() !== mm - 1) return;
    if (d < t0) {
      if (year) return; // a past date with its year is history, not a deadline
      d = new Date(t0.getFullYear() + 1, mm - 1, dd);
    }
    add(m, d);
  };
  const YEAR = `(?:\\s+(?:سنه\\s+|عام\\s+)?(20\\d{2}))?`;
  const arMon = n.match(re(`(?<![\\d/.-])(\\d{1,2})\\s+(?:من\\s+)?(?:شهر\\s+)?(${AR_MONTHS.map(([w]) => w).join('|')})${E}${YEAR}`));
  if (arMon) withYear(Number(arMon[1]), AR_MONTHS.find(([w]) => w === arMon[2])![1], arMon[3], arMon);
  // «5 شهر 10» and, after «يوم/تاريخ», «30 9» — how a date sounds read aloud.
  const shahr = n.match(re(`(?<![\\d/.-])(\\d{1,2})\\s+شهر\\s+(\\d{1,2})(?![\\d/.-])${YEAR}`));
  if (shahr) withYear(Number(shahr[1]), Number(shahr[2]), shahr[3], shahr);
  const saidDate = n.match(re(`${B}(?:يوم|تاريخ|بتاريخ)\\s+(\\d{1,2})\\s+(\\d{1,2})(?![\\d/.-])${YEAR}`));
  if (saidDate) withYear(Number(saidDate[1]), Number(saidDate[2]), saidDate[3], saidDate);

  // "30/9" or "30-9" without a year — the next time that day comes round.
  // Only / and - : a dot is far more often a decimal ("2.5 million") than a date.
  const dm = n.match(/(?<![\d/.-])(\d{1,2})[/-](\d{1,2})(?![\d/.-])/);
  if (dm) {
    const dd = Number(dm[1]); const mm = Number(dm[2]);
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      let d = new Date(t0.getFullYear(), mm - 1, dd);
      if (d.getMonth() === mm - 1) {
        if (d < t0) d = new Date(t0.getFullYear() + 1, mm - 1, dd);
        add(dm, d);
      }
    }
  }
  // "5 Oct" / "Oct 5" without a year.
  const dMon = n.match(/(?<!\d)(\d{1,2})\s+([a-z]{3,9})(?![a-z])(?!\.?,?\s+20\d{2})/);
  const monD = n.match(/(?<![a-z])([a-z]{3,9})\.?\s+(\d{1,2})(?!\d)(?!,?\s+20\d{2})/);
  for (const [m, dayIdx, monIdx] of [[dMon, 1, 2], [monD, 2, 1]] as const) {
    if (!m) continue;
    const mo = MONTHS[m[monIdx].slice(0, 4)] ?? MONTHS[m[monIdx].slice(0, 3)];
    const dd = Number(m[dayIdx]);
    if (!mo || dd < 1 || dd > 31) continue;
    let d = new Date(t0.getFullYear(), mo - 1, dd);
    if (d.getMonth() !== mo - 1) continue;
    if (d < t0) d = new Date(t0.getFullYear() + 1, mo - 1, dd);
    add(m, d);
  }

  if (found.length) {
    // The earliest mention in the text wins: in "meeting Tuesday, prices by
    // Thursday" the first date is the one the sentence is about.
    found.sort((a, b) => a.at - b.at);
    const f = found[0];
    return { date: iso(f.date), words: f.words };
  }

  // Full dates with a year — the mail reader already knows those.
  const full = detectDeadline(text, today);
  return full ? { date: full, words: full } : undefined;
}

// Common first names in both scripts, so «منى» finds a colleague whose account
// says "Mona Fathy" and "Ahmed" finds «أحمد سمير». Arabic in normalizeArabic
// form. Short and deliberate: a name missing here still matches in the script
// it is stored in.
const FIRST_NAMES: [string, string[]][] = [
  ['احمد', ['ahmed', 'ahmad']], ['محمد', ['mohamed', 'mohammed', 'muhammad', 'mohammad']],
  ['محمود', ['mahmoud', 'mahmud']], ['مصطفي', ['mostafa', 'mustafa', 'moustafa']],
  ['خالد', ['khaled', 'khalid']], ['عمر', ['omar']], ['عمرو', ['amr']], ['علي', ['ali']],
  ['حسن', ['hassan', 'hasan']], ['حسين', ['hussein', 'hossam']], ['ابراهيم', ['ibrahim', 'ebrahim']],
  ['يوسف', ['youssef', 'yousef', 'yusuf']], ['طارق', ['tariq', 'tarek', 'tarik']],
  ['هاني', ['hany', 'hani']], ['كريم', ['karim', 'kareem']], ['سامح', ['sameh']],
  ['سمير', ['samir']], ['عادل', ['adel']], ['وليد', ['walid', 'waleed']], ['شريف', ['sherif', 'sharif']],
  ['اسامه', ['osama', 'usama']], ['ايمن', ['ayman']], ['هشام', ['hesham', 'hisham']],
  ['عمار', ['ammar']], ['ياسر', ['yasser', 'yasir']], ['رامي', ['ramy', 'rami']],
  ['مني', ['mona']], ['ساره', ['sara', 'sarah']], ['نيفين', ['nevin', 'nevine', 'nevien']],
  ['هبه', ['heba']], ['دينا', ['dina']], ['رانيا', ['rania']], ['ياسمين', ['yasmin', 'yasmine']],
  ['نور', ['nour', 'noor']], ['مريم', ['mariam', 'maryam']], ['اسماء', ['asmaa', 'asma']],
  ['فاطمه', ['fatma', 'fatima']], ['نهي', ['noha']], ['شيماء', ['shaimaa', 'shimaa']],
  ['اميره', ['amira', 'ameera']], ['ريم', ['reem', 'rim']], ['هند', ['hend', 'hind']],
];
const TO_ARABIC = new Map<string, string>();
for (const [ar, latin] of FIRST_NAMES) for (const l of latin) TO_ARABIC.set(l, ar);
const TO_LATIN = new Map<string, string[]>(FIRST_NAMES);

/** One key per first name whatever the script: "Mona" and «منى» are the same person-name. */
const nameKey = (first: string) => TO_ARABIC.get(first) ?? first;
/** The same first name in the other script and its other spellings (Tarek/Tariq). */
const otherScripts = (first: string): string[] => {
  const ar = TO_ARABIC.get(first) ?? (TO_LATIN.has(first) ? first : undefined);
  return ar ? [ar, ...TO_LATIN.get(ar)!].filter(n => n !== first) : [];
};

/**
 * Colleagues named in the text. A full display name counts; so does a first
 * name of 3+ letters — in either script — when exactly ONE colleague has it
 * (two Ahmeds and a bare "Ahmed" names nobody: better to ask than to hand the
 * work to the wrong one). Returned in the order they appear.
 */
export function findPeople(text: string, people: CapturePerson[]): { person: CapturePerson; at: number; end: number }[] {
  const hay = normalizeArabic(latinDigits(text));
  const firstCount = new Map<string, number>();
  for (const p of people) {
    const key = nameKey(normalizeArabic(p.name).trim().split(/\s+/)[0] || '');
    firstCount.set(key, (firstCount.get(key) || 0) + 1);
  }
  const out: { person: CapturePerson; at: number; end: number }[] = [];
  for (const p of people) {
    const full = normalizeArabic(p.name).trim();
    if (!full) continue;
    const first = full.split(/\s+/)[0];
    const tries = [full];
    if (first !== full && firstCount.get(nameKey(first)) === 1) tries.push(first, ...otherScripts(first));
    for (const name of tries) {
      if (name.length < 3) continue;
      const m = hay.match(new RegExp(`${B}(?:[وبل]|لل)?${escapeRe(name)}${E}`, 'u'));
      if (m && m.index !== undefined) {
        out.push({ person: p, at: m.index, end: m.index + m[0].length });
        break;
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Words right after a name that make that person the one doing the work. */
const DOER_AFTER = /^\s*(?:to|will|should|must|needs? to|has to|is to|can|please|ي|ت|س|هي|هو|لازم|يرجي|المطلوب)/u;
/** Words right before a name that hand them the work. */
const DOER_BEFORE = /(?:assign(?:ed)? to|ask|tell|remind|owner|for|by|كلف|اسند|اطلب من|قول ل|خلي|بلغ|على|علي|الي|مسؤول|مسئول)\s*[:,-]?\s*$/u;

const ME_WORDS = new RegExp(
  `${B}(?:i will|i'll|i need to|i have to|i must|i should|me to|remind me|انا|هعمل|هبعت|سارسل|ساقوم|ساتابع|هتابع|لازم ابعت|فكرني|هكلم|هتصل|هخلص|هجهز|هرد|هراجع)${E}`, 'iu');

const TENDER_WORDS = [
  'tender', 'rfq', 'rfp', 'itb', 'invitation to bid', 'bid', 'bidding', 'prequalification',
  'pre-qualification', 'eoi', 'expression of interest', 'request for quotation', 'request for proposal',
  'مناقصه', 'عطاء', 'عطاءات', 'كراسه الشروط', 'طلب عرض سعر', 'طلب عروض', 'تاهيل مسبق', 'ممارسه',
];
const LETTER_WORDS = [
  'received a letter', 'letter from', 'letter received', 'official letter', 'we received', 'they sent us',
  'incoming letter', 'وصل خطاب', 'وصلنا خطاب', 'خطاب من', 'جالنا خطاب', 'ورد خطاب', 'خطاب وارد',
];
const URGENT_WORDS = /(?<![\p{L}])(?:urgent|asap|immediately|critical|عاجل|فورا|ضروري|حالا)(?![\p{L}])/iu;

const hitWord = (hay: string, words: string[]) => {
  for (const w of words) {
    if (new RegExp(`${B}${escapeRe(w)}${E}`, 'u').test(hay)) return w;
  }
  return null;
};

// ── Pasted e-mail ────────────────────────────────────────────────────────────

const HEADER = /^\s*(from|sent|date|to|cc|subject|من|المرسل|تاريخ الإرسال|تاريخ الارسال|أرسل|ارسل|التاريخ|إلى|الى|نسخة|الموضوع)\s*[:：]\s*(.*)$/i;

/**
 * Header block of a mail pasted out of Outlook ("From: … / Sent: … / To: … /
 * Subject: …", or the Arabic Outlook labels). Needs a sender OR a subject plus
 * one other header, so a sentence that happens to contain "to:" is not a mail.
 */
export function parsePastedEmail(text: string): SuggestEmail | null {
  const lines = (text || '').replace(/\r/g, '').split('\n');
  const h: Record<string, string> = {};
  let lastHeader = -1;
  for (let i = 0; i < Math.min(lines.length, 25); i++) {
    const m = lines[i].match(HEADER);
    if (!m) continue;
    const key = normalizeArabic(m[1]);
    const k = key === 'from' || key === 'من' || key === 'المرسل' ? 'from'
      : key === 'subject' || key === 'الموضوع' ? 'subject'
        : key === 'sent' || key === 'date' || key === 'التاريخ' || key === 'ارسل' || key === 'تاريخ الارسال' ? 'sent'
          : key === 'to' || key === 'الي' ? 'to' : 'cc';
    if (!(k in h)) h[k] = m[2].trim();
    lastHeader = i;
  }
  const count = Object.keys(h).length;
  if (!(h.from || h.subject) || count < 2) return null;

  const from = h.from || '';
  const addr = (from.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/) || [''])[0];
  const senderName = from.replace(/<[^>]*>/, '').replace(addr, '').replace(/[[\]"()]/g, '').trim() || addr;
  const body = lines.slice(lastHeader + 1).join('\n').trim();
  const lower = `${h.subject || ''} ${body}`.toLowerCase();

  return {
    id: 'pasted',
    subject: h.subject || body.split('\n')[0].slice(0, 120),
    sender: senderName,
    sender_email: addr,
    body_preview: body.slice(0, 2000),
    received_at: '',
    importance: /importance:\s*high|high importance/.test(lower) ? 'High' : undefined,
  };
}

// ── The proposal ─────────────────────────────────────────────────────────────

/** First sentence, trimmed to a card-sized title. */
export function titleFrom(sentence: string): string {
  const one = sentence.replace(/\s+/g, ' ').trim();
  const cut = one.split(/(?<=[.!?؟])\s/)[0] || one;
  const clean = cut.replace(/[.!؟?]+$/, '').trim();
  if (clean.length <= 110) return clean.charAt(0).toUpperCase() + clean.slice(1);
  const at = clean.lastIndexOf(' ', 105);
  return `${clean.slice(0, at > 60 ? at : 105).trim()}…`;
}

function priorityFor(date: string | undefined, urgent: boolean, today: Date): TaskPriority {
  let p: TaskPriority = 'Medium';
  if (date) {
    const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const [y, m, d] = date.split('-').map(Number);
    const days = Math.round((new Date(y, m - 1, d).getTime() - t0) / 86400000);
    // Due today is urgent; the next three days are high. Tomorrow is NOT
    // urgent by itself, or every "call them tomorrow" would shout.
    if (days <= 0) p = 'Urgent';
    else if (days <= 3) p = 'High';
  }
  if (urgent) p = p === 'Medium' ? 'High' : 'Urgent';
  return p;
}

/**
 * Who does the work. A name followed by "to / will / should" (or preceded by
 * "assign to / ask") wins; then "I will …" means the writer; then the first
 * colleague named; then the writer.
 */
function pickOwner(text: string, ctx: CaptureContext, reasons: CaptureReason[]) {
  const hay = normalizeArabic(latinDigits(text));
  const named = findPeople(text, ctx.people);
  const doer = named.find(n => DOER_AFTER.test(hay.slice(n.end, n.end + 14)) || DOER_BEFORE.test(hay.slice(Math.max(0, n.at - 18), n.at)));
  let owner: CapturePerson | undefined;
  if (doer) owner = doer.person;
  else if (ME_WORDS.test(hay)) owner = ctx.me;
  else if (named.length) owner = named.find(n => n.person.id !== ctx.me.id)?.person ?? named[0].person;
  if (owner && owner.id !== ctx.me.id) reasons.push({ code: 'owner-named', value: owner.name });
  else if (owner || ME_WORDS.test(hay)) reasons.push({ code: 'owner-me' });
  owner = owner ?? ctx.me;
  const others = named.map(n => n.person).filter(p => p.id !== owner!.id && p.id !== ctx.me.id);
  return { owner, others };
}

export function readCapture(rawText: string, ctx: CaptureContext): CaptureProposal | null {
  const text = (rawText || '').trim();
  if (text.length < 3) return null;
  const today = ctx.today ?? new Date();
  const reasons: CaptureReason[] = [];

  // ── A pasted e-mail: the mail rules decide, the sentence rules add the owner.
  const mail = parsePastedEmail(text);
  if (mail) {
    const s = suggestFromEmail(mail, { ownDomain: ctx.ownDomain || '', parties: ctx.parties, today });
    reasons.push({ code: 'pasted-email', value: mail.sender });
    const { owner, others } = pickOwner(mail.body_preview, ctx, reasons);
    const read = readDate(`${mail.subject}\n${mail.body_preview}`, today);
    const date = s.deadline ?? read?.date;
    if (date) reasons.push({ code: 'date', value: s.deadline ? s.deadline : read!.words });
    if (s.match) reasons.push({ code: 'known-client', value: s.match.label });
    return {
      source: 'email',
      kind: s.kind,
      title: s.title,
      description: text,
      owner,
      others,
      date,
      priority: s.deadline ? s.priority : priorityFor(date, s.priority !== 'Medium', today),
      category: s.category,
      client: s.client,
      match: s.match,
      tenderNumber: s.tenderNumber,
      sender: mail.sender_email ? `${mail.sender} <${mail.sender_email}>` : mail.sender,
      reasons,
    };
  }

  // ── A free sentence.
  const hay = normalizeArabic(latinDigits(text));
  const tender = hitWord(hay, TENDER_WORDS);
  const letter = hitWord(hay, LETTER_WORDS);
  const tenderNumber = detectTenderNumber(latinDigits(text));
  const kind: SuggestedKind = tender && (tenderNumber || /new|جديد|وصل|received|invit|دعوه/.test(hay)) ? 'opportunity'
    : letter ? 'corresponding'
      : 'task';
  if (tender) reasons.push({ code: 'tender-words', value: tender });
  else if (letter) reasons.push({ code: 'letter-words', value: letter });

  const { owner, others } = pickOwner(text, ctx, reasons);

  const read = readDate(text, today);
  if (read) reasons.push({ code: 'date', value: read.words });

  const party = detectParty(
    { id: 'typed', subject: text, body_preview: '', sender: '', sender_email: '', received_at: '' },
    ctx.parties,
    true, // no sender domain to fall back on
  );
  if (party.match) reasons.push({ code: 'known-client', value: party.match.label });

  const urgent = URGENT_WORDS.test(hay);
  if (urgent) reasons.push({ code: 'urgent-words' });

  return {
    source: 'sentence',
    kind,
    title: titleFrom(cleanSubject(text)),
    description: text,
    owner,
    others,
    date: read?.date,
    priority: priorityFor(read?.date, urgent, today),
    category: party.match?.type === 'project' ? 'Project' : kind === 'corresponding' ? 'External' : 'Internal',
    client: party.client,
    match: party.match,
    tenderNumber,
    reasons,
  };
}
