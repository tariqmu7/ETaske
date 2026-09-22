/**
 * Ask-it questions (queue task D11).
 *
 * Pure logic: somebody types a question in plain words —
 *   "what did we send NNPC in July?"   «إيه اللي بعتناه لبترومنت الشهر اللي فات؟»
 *   "open bids closing this month"     "Mona's late tasks"
 * — and this reads it into filters (which boards, which client, who, which
 * period, which state) and runs those filters over the records the reader can
 * already see. The Ask box on Home renders the answer; nothing is written.
 *
 * Like the one-box capture there is no AI behind this on purpose: the app is a
 * static site with a public repo, so a model key could only ship in the bundle.
 * It is plain rules, and every rule it applied comes back as a chip ("Client:
 * NNPC · July 2026 · Letters") so the reader can see exactly what was searched
 * — an answer that cannot show its working is worse than no answer.
 *
 * Honest limits, kept visible in the UI: ETaske only knows what was logged on
 * its boards. A letter that went out from Outlook and was never logged is not
 * here, and the answer says so whenever the question is about sending.
 *
 * `scripts/harness/askrecords.mjs` runs this file unmodified.
 */

import { normalizeArabic } from '../utils';
import { latinDigits, spokenNumbers, findPeople, type CapturePerson } from './quickCapture';

export type AskKind = 'task' | 'corresponding' | 'opportunity' | 'project';

/** One record from any board, flattened to what a question can ask about. */
export interface AskRecord {
  kind: AskKind;
  id: string;
  serial?: string;
  title: string;
  /** Everything searchable about the record, in one string (raw, not normalized). */
  text: string;
  /** The other side: client, sender, linked bid/project name. */
  party?: string;
  /** For a correspondence: who the letter came from (`sentFrom`). */
  from?: string;
  /** uids on the record — owner, collaborators, whoever entered it. */
  people: string[];
  /** Owner's display name, for the answer row. */
  ownerName?: string;
  /** Stored status / stage, English (display-labelled by the UI). */
  status: string;
  open: boolean;
  /** yyyy-mm-dd the record happened: received, created, announced. */
  date?: string;
  /** yyyy-mm-dd it is due / closes / ends. */
  due?: string;
}

export type AskState = 'open' | 'late' | 'done' | 'won' | 'lost' | 'submitted';
export type AskDirection = 'sent' | 'received';
export type AskPeriodCode =
  | 'today' | 'yesterday'
  | 'this-week' | 'last-week' | 'next-week'
  | 'this-month' | 'last-month' | 'next-month'
  | 'this-year' | 'last-year'
  | 'last-days' | 'month' | 'year' | 'since-month';

export interface AskPeriod {
  code: AskPeriodCode;
  /** yyyy-mm-dd, inclusive. */
  from: string;
  to: string;
  /** For 'month' / 'since-month': 1-12. */
  month?: number;
  year?: number;
  /** For 'last-days'. */
  days?: number;
}

export interface AskQuery {
  /** Empty = every board. */
  kinds: AskKind[];
  party?: string;
  person?: CapturePerson;
  period?: AskPeriod;
  /** Which date the period applies to: when it happened, or when it is due. */
  dateField: 'date' | 'due';
  state?: AskState;
  direction?: AskDirection;
  /** Words left over once everything above was read — matched against the text. */
  words: string[];
  /** "how many …" — the UI leads with the number. */
  count: boolean;
}

export interface AskAnswer {
  query: AskQuery;
  /** Newest first (or soonest first for a question about what is coming up). */
  rows: AskRecord[];
  /** How many of each kind matched. */
  byKind: Record<AskKind, number>;
  /** Every word had to match and nothing did, so ANY word was accepted instead. */
  loosened: boolean;
}

export interface AskContext {
  /** The person asking — "my tasks" means them. */
  me: CapturePerson;
  /** Colleagues a question can name. */
  people: CapturePerson[];
  /** Client / project / sender names the boards already know. */
  parties: string[];
  /** Injectable for the harness; defaults to today. */
  today?: Date;
}

// ── Dates ────────────────────────────────────────────────────────────────────

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const day = (y: number, m: number, d: number) => new Date(y, m, d);

/** Firestore Timestamp / Date / ISO string → yyyy-mm-dd (local), or undefined. */
export function isoDay(v: unknown): string | undefined {
  if (!v) return undefined;
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
  }
  const d = typeof (v as any).toDate === 'function' ? (v as any).toDate()
    : v instanceof Date ? v : null;
  return d && !isNaN(d.getTime()) ? iso(d) : undefined;
}

const monthRange = (y: number, m: number) => ({ from: iso(day(y, m, 1)), to: iso(day(y, m + 1, 0)) });

/** The week runs Sunday–Saturday (Egypt's working week starts on Sunday). */
const weekStart = (d: Date) => day(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());

// ── Vocabulary ───────────────────────────────────────────────────────────────
// Everything below is matched on normalizeArabic(text): lower case, أإآ→ا,
// ة→ه, ى→ي, no diacritics. So «السنة» is written "السنه" here.

const EN_MONTHS: [RegExp, number][] = [
  [/\bjan(?:uary)?\b/, 0], [/\bfeb(?:ruary)?\b/, 1], [/\bmar(?:ch)?\b/, 2], [/\bapr(?:il)?\b/, 3],
  // "may" is also a verb — only a month after in/since/of/during/last/this or before a year.
  [/\b(?:in|since|of|during|last|this|from)\s+may\b|\bmay\s+20\d\d\b/, 4],
  [/\bjune?\b/, 5], [/\bjuly?\b/, 6], [/\baug(?:ust)?\b/, 7], [/\bsept?(?:ember)?\b/, 8],
  [/\boct(?:ober)?\b/, 9], [/\bnov(?:ember)?\b/, 10], [/\bdec(?:ember)?\b/, 11],
];
const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'ابريل', 'مايو', 'يونيو', 'يوليو', 'اغسطس', 'سبتمبر', 'اكتوبر', 'نوفمبر', 'ديسمبر'];

// Arabic words may carry a one-letter prefix (و، ب، ل، ف) or «لل», and the article.
const AR_PRE = '(?:^|[^\\p{L}])(?:و|ب|ل|ف|لل)?(?:ال)?';
const AR_END = '(?=$|[^\\p{L}])';
const ar = (alts: string) => new RegExp(`${AR_PRE}(?:${alts})${AR_END}`, 'u');

const KIND_WORDS: [AskKind, RegExp][] = [
  ['corresponding', /\b(letters?|correspondences?|mails?|e-?mails?|memos?)\b/],
  ['corresponding', ar('خطاب|خطابات|جواب|جوابات|مراسله|مراسلات|مكاتبه|مكاتبات|ايميل|ايميلات|بريد')],
  ['opportunity', /\b(bids?|tenders?|offers?|quotations?|quotes?|rfqs?|pipeline|opportunit(?:y|ies))\b/],
  ['opportunity', ar('مناقصه|مناقصات|المناقصه|المناقصات|عطاء|عطاءات|العطاء|العطاءات|عرض|عروض|العرض|العروض|ممارسه|ممارسات')],
  ['task', /\b(tasks?|to-?dos?|jobs?|work(?:ing)? on)\b/],
  ['task', ar('مهمه|مهام|المهمه|المهام|مهامي|شغل|الشغل')],
  ['project', /\b(projects?|contracts?)\b/],
  ['project', ar('مشروع|مشاريع|مشروعات|المشروع|المشاريع|المشروعات|عقد|عقود|العقد|العقود')],
];

const SENT_WORDS = [/\b(send|sent|did we send|we sent|wrote to|write to|replied to|reply to|outgoing)\b/,
  ar('ارسلنا|ارسلناه|ارسلناها|بعتنا|بعتناه|بعتناها|بعتنالهم|ارسلت|بعت|بعتت|كتبنا|صادر|الصادر|رددنا')];
const RECEIVED_WORDS = [/\b(received|receive|got from|came from|incoming|from them)\b/,
  ar('وصلنا|وصلني|استلمنا|استلمت|جالنا|جانا|وارد|الوارد|بعتوا|بعتولنا|ارسلوا')];

const STATE_WORDS: [AskState, RegExp[]][] = [
  ['won', [/\b(won|win|wins|awarded)\b/, ar('فزنا|كسبنا|رسا|رست|الفائزه|ترسيه')]],
  ['lost', [/\b(lost|lose|losing)\b/, ar('خسرنا|خسرناها|خسرناه|الخاسره')]],
  ['submitted', [/\b(submitted)\b/, ar('قدمنا|قدمناها|اتقدمت|مقدمه|المقدمه')]],
  ['late', [/\b(late|overdue|delayed|behind)\b/, ar('متاخر|متاخره|متاخرين|المتاخره|المتاخرين|متأخره|فات ميعادها|فات ميعاده')]],
  ['done', [/\b(done|finished|completed|closed)\b/, ar('خلصت|خلص|خلصنا|منتهيه|المنتهيه|مقفوله|اتقفلت|مغلقه|المغلقه|انتهت')]],
  ['open', [/\b(open|pending|active|ongoing|in progress|current|outstanding|still)\b/, ar('مفتوح|مفتوحه|المفتوحه|جاري|جاريه|الجاريه|قائم|قائمه|لسه|معلقه')]],
];

// "closing / due / expiring" — the period is about the DUE date, not the day it happened.
const DUE_WORDS = [/\b(due|deadlines?|closing|closes|close on|expir(?:e|es|ing|y)|ending|ends|submission)\b/,
  ar('ينتهي|تنتهي|بينتهي|بتنتهي|تسليم|التسليم|ميعاد|ميعادها|موعد|موعدها|اخر موعد|تقفل|بتقفل|تستحق|مستحق')];

const COUNT_WORDS = [/\b(how many|count|number of)\b/, ar('كام|عدد|كم')];

const MINE_WORDS = [/\b(my|mine)\b/, ar('بتاعي|بتاعتي|مهامي|عندي|ليا|خاصتي')];

const STOP = new Set([
  // English
  'what', 'whats', 'which', 'who', 'whom', 'whose', 'did', 'do', 'does', 'done', 'we', 'us', 'our', 'ours', 'the', 'a', 'an', 'to',
  'for', 'in', 'on', 'at', 'of', 'about', 'with', 'and', 'or', 'any', 'all', 'show', 'list', 'find', 'give', 'me', 'tell',
  'is', 'are', 'was', 'were', 'have', 'has', 'had', 'there', 'that', 'this', 'those', 'these', 'from', 'by', 'it', 'its',
  'be', 'been', 'get', 'got', 'please', 'how', 'many', 'much', 'anything', 'something', 'things', 'thing', 'stuff',
  'regarding', 're', 'since', 'until', 'till', 'between', 'yet', 'now', 'i', 'you', 'they', 'them', 'their', 'can',
  'could', 'would', 'should', 'will', 'still', 'last', 'next', 'week', 'month', 'year', 'today', 'yesterday', 'days', 'day',
  'past', 'coming', 'upcoming', 'so', 'far', 'far?', 'up', 'out', 'back', 'my', 'mine', 'count', 'number', 'where',
  'when', 'why', 'everything', 'anybody', 'someone', 'else', 'else?', 'more', 'most', 'latest', 'recent', 'recently', 'ever', 'go', 'went', 'gone',
  // Arabic (normalized)
  'ايه', 'ايش', 'ماذا', 'ما', 'ماهي', 'ماهو', 'هل', 'في', 'من', 'الي', 'علي', 'عن', 'مع', 'و', 'او', 'اللي', 'الذي',
  'التي', 'الذين', 'كل', 'بتاع', 'بتاعه', 'بتاعت', 'هو', 'هي', 'هم', 'احنا', 'نحن', 'ده', 'دي', 'دا', 'دول', 'لو',
  'ممكن', 'عايز', 'عاوز', 'عايزه', 'اعرف', 'وريني', 'اعرضلي', 'هات', 'قولي', 'قول', 'لي', 'لنا', 'لينا', 'كام', 'عدد',
  'كم', 'شهر', 'يوم', 'سنه', 'عام', 'اسبوع', 'الاسبوع', 'الشهر', 'السنه', 'العام', 'اليوم', 'النهارده', 'امبارح', 'امس',
  'الماضي', 'الماضيه', 'فات', 'فاتت', 'الجاي', 'الجايه', 'القادم', 'القادمه', 'المقبل', 'الحالي', 'الحاليه', 'هذا',
  'هذه', 'ايام', 'اخر', 'منذ', 'بخصوص', 'حول', 'موضوع', 'لهم', 'ليهم', 'له', 'لها', 'عليه', 'عليها', 'اي', 'فيه',
  'فيها', 'به', 'بها', 'بهم', 'عنه', 'عنها', 'منه', 'منها', 'لهم', 'ماذا', 'التي', 'الذي', 'كان', 'كانت', 'يكون', 'تكون', 'ايه؟', 'حاجه', 'حاجات', 'الحاجات', 'اللى', 'شو', 'انا', 'انت', 'بعد', 'قبل',
]);

// ── Reading the question ─────────────────────────────────────────────────────

const any = (res: RegExp[], text: string) => res.some(r => r.test(text));

/** Is `name` (already normalized) in `hay` as whole words (an Arabic one-letter prefix is fine)? */
function hasName(hay: string, name: string): { at: number; end: number } | null {
  if (name.length < 3) return null;
  let from = 0;
  for (;;) {
    const at = hay.indexOf(name, from);
    if (at < 0) return null;
    const end = at + name.length;
    const before = at === 0 ? '' : hay[at - 1];
    const before2 = at < 2 ? '' : hay[at - 2];
    const after = hay[end] ?? '';
    const isLetter = (c: string) => !!c && /\p{L}|\d/u.test(c);
    const beforeOk = !isLetter(before) ||
      (/[وبلف]/.test(before) && !isLetter(before2)) ||
      (before === 'ل' && before2 === 'ل' && !isLetter(hay[at - 3] ?? ''));
    // "NNPC's" and the Arabic attached pronouns stay the same name.
    const afterOk = !isLetter(after) || hay.startsWith("'s", end) || /^(ه|ها|هم)(?!\p{L})/u.test(hay.slice(end));
    if (beforeOk && afterOk) return { at, end };
    from = at + 1;
  }
}

/** The longest known name in the question — "AGIBA Meleiha" beats "AGIBA". */
export function findParty(text: string, parties: string[]): { name: string; at: number; end: number } | null {
  const hay = normalizeArabic(latinDigits(text));
  const ranked = [...new Set(parties.map(p => p.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  for (const p of ranked) {
    const hit = hasName(hay, normalizeArabic(p).trim());
    if (hit) return { name: p, ...hit };
  }
  return null;
}

/**
 * The period a question is about. A bare month means the most recent one for a
 * question about what happened ("in July", asked in September = this July;
 * "in October" = last October) and the next one for a question about what is
 * due ("bids closing in October" = this coming October).
 */
export function readPeriod(rawText: string, today: Date, dueField = false): { period: AskPeriod; words: string[] } | undefined {
  const n = spokenNumbers(normalizeArabic(latinDigits(rawText)));
  const t0 = day(today.getFullYear(), today.getMonth(), today.getDate());
  const y = t0.getFullYear();
  const mo = t0.getMonth();
  const hit = (re: RegExp) => n.match(re);
  const mk = (code: AskPeriodCode, from: Date, to: Date, extra: Partial<AskPeriod> = {}, words: string[] = []) =>
    ({ period: { code, from: iso(from), to: iso(to), ...extra }, words });

  // "last 30 days" / «آخر 30 يوم»
  let m = hit(/\b(?:last|past)\s+(\d{1,3})\s+days?\b/) || hit(new RegExp(`اخر\\s+(\\d{1,3})\\s+(?:يوم|ايام)`, 'u'));
  if (m) {
    const days = Math.max(1, Math.min(366, Number(m[1])));
    return mk('last-days', day(y, mo, t0.getDate() - days + 1), t0, { days }, m[0].split(/\s+/));
  }

  if (hit(/\byesterday\b/) || hit(ar('امبارح|امس|البارحه'))) return mk('yesterday', day(y, mo, t0.getDate() - 1), day(y, mo, t0.getDate() - 1));
  if (hit(/\btoday\b/) || hit(ar('النهارده|النهاردا|اليوم ده|اليوم'))) return mk('today', t0, t0);

  const ws = weekStart(t0);
  if (hit(/\b(?:last|previous)\s+week\b/) || hit(ar('الاسبوع (?:اللي فات|الماضي|السابق|الفايت)')))
    return mk('last-week', day(ws.getFullYear(), ws.getMonth(), ws.getDate() - 7), day(ws.getFullYear(), ws.getMonth(), ws.getDate() - 1));
  if (hit(/\bnext\s+week\b/) || hit(ar('الاسبوع (?:الجاي|القادم|المقبل)')))
    return mk('next-week', day(ws.getFullYear(), ws.getMonth(), ws.getDate() + 7), day(ws.getFullYear(), ws.getMonth(), ws.getDate() + 13));
  if (hit(/\bthis\s+week\b/) || hit(ar('الاسبوع ده|هذا الاسبوع|الاسبوع الحالي|الاسبوع دا')))
    return mk('this-week', ws, day(ws.getFullYear(), ws.getMonth(), ws.getDate() + 6));

  if (hit(/\b(?:last|previous)\s+month\b/) || hit(ar('الشهر (?:اللي فات|الماضي|السابق|الفايت)'))) {
    const r = monthRange(y, mo - 1);
    return { period: { code: 'last-month', ...r }, words: [] };
  }
  if (hit(/\bnext\s+month\b/) || hit(ar('الشهر (?:الجاي|القادم|المقبل)'))) {
    const r = monthRange(y, mo + 1);
    return { period: { code: 'next-month', ...r }, words: [] };
  }
  if (hit(/\bthis\s+month\b/) || hit(ar('الشهر ده|هذا الشهر|الشهر الحالي|الشهر دا'))) {
    const r = monthRange(y, mo);
    return { period: { code: 'this-month', ...r }, words: [] };
  }
  if (hit(/\b(?:last|previous)\s+year\b/) || hit(ar('السنه (?:اللي فاتت|الماضيه|السابقه)|العام (?:الماضي|السابق|اللي فات)')))
    return mk('last-year', day(y - 1, 0, 1), day(y - 1, 11, 31), { year: y - 1 });
  if (hit(/\bthis\s+year\b/) || hit(ar('السنه دي|هذه السنه|هذا العام|العام الحالي|السنه الحاليه|السنادي')))
    return mk('this-year', day(y, 0, 1), day(y, 11, 31), { year: y });

  // A named month, maybe with a year: "July", "July 2025", «يوليو», «شهر 7».
  let month = -1;
  let monthWord = '';
  for (const [re, idx] of EN_MONTHS) {
    const mm = n.match(re);
    if (mm) { month = idx; monthWord = mm[0].split(/\s+/).pop() || ''; break; }
  }
  if (month < 0) {
    for (let i = 0; i < AR_MONTHS.length; i++) {
      const mm = n.match(ar(AR_MONTHS[i]));
      if (mm) { month = i; monthWord = AR_MONTHS[i]; break; }
    }
  }
  if (month < 0) {
    const mm = n.match(/شهر\s+(\d{1,2})(?!\d)/u);
    if (mm && Number(mm[1]) >= 1 && Number(mm[1]) <= 12) { month = Number(mm[1]) - 1; monthWord = mm[1]; }
  }
  const yearHit = n.match(/(?:^|\D)(20\d\d)(?!\d)/);
  const year = yearHit ? Number(yearHit[1]) : undefined;

  if (month >= 0) {
    const since = new RegExp(`(?:\\bsince\\b|\\bfrom\\b|\\bsince (?:early|the start of)\\b|منذ|من اول|من 1|من اوائل|من بدايه|من)\\s+(?:شهر\\s+)?${monthWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(n);
    let yy = year ?? (dueField
      ? (month >= mo ? y : y + 1)
      : (month <= mo ? y : y - 1));
    if (since) {
      if (year === undefined && month > mo) yy = y - 1;
      return mk('since-month', day(yy, month, 1), t0, { month: month + 1, year: yy }, [monthWord]);
    }
    const r = monthRange(yy, month);
    return { period: { code: 'month', ...r, month: month + 1, year: yy }, words: [monthWord] };
  }
  if (year !== undefined) return mk('year', day(year, 0, 1), day(year, 11, 31), { year }, [String(year)]);
  return undefined;
}

/** Split the question into search words, dropping everything a rule already consumed. */
function leftoverWords(n: string, consumed: string[]): string[] {
  let rest = ` ${n} `;
  for (const c of consumed.filter(Boolean).sort((a, b) => b.length - a.length)) {
    rest = rest.split(c).join(' ');
  }
  const vocab = [
    ...KIND_WORDS.map(([, r]) => r), ...SENT_WORDS, ...RECEIVED_WORDS,
    ...STATE_WORDS.flatMap(([, r]) => r), ...DUE_WORDS, ...COUNT_WORDS, ...MINE_WORDS,
  ];
  const out: string[] = [];
  for (const raw of rest.split(/[^\p{L}\d-]+/u)) {
    let w = raw.replace(/^-+|-+$/g, '');
    if (!w || STOP.has(w)) continue;
    if (/^\d+$/.test(w)) continue;
    if (vocab.some(r => r.test(` ${w} `))) continue;
    // «المناقصة» should find «مناقصة»: drop the article (and a joined و/ب/ل before it).
    w = w.replace(/^(?:و|ب|ف|ك)?(?:ال)(?=\p{L}{3,})/u, '');
    if (w.length < (/[؀-ۿ]/.test(w) ? 3 : 3)) continue;
    if (STOP.has(w)) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

export function readQuestion(rawText: string, ctx: AskContext): AskQuery | null {
  const text = rawText.trim();
  if (!text) return null;
  const today = ctx.today ?? new Date();
  const n = spokenNumbers(normalizeArabic(latinDigits(text)));
  const consumed: string[] = [];

  const kinds: AskKind[] = [];
  for (const [kind, re] of KIND_WORDS) {
    const m = n.match(re);
    if (m) { if (!kinds.includes(kind)) kinds.push(kind); consumed.push(m[0]); }
  }

  let direction: AskDirection | undefined;
  if (any(RECEIVED_WORDS, n)) direction = 'received';
  else if (any(SENT_WORDS, n)) direction = 'sent';
  // Sending is letters and the tasks that sent them; a received thing is a letter.
  if (direction === 'sent' && !kinds.length) kinds.push('corresponding', 'task');
  if (direction === 'received' && !kinds.length) kinds.push('corresponding');

  let state: AskState | undefined;
  for (const [s, res] of STATE_WORDS) {
    if (any(res, n)) { state = s; break; }
  }
  // Won / lost / submitted only exist on the bid board.
  if ((state === 'won' || state === 'lost' || state === 'submitted') && !kinds.length) kinds.push('opportunity');

  const dateField: 'date' | 'due' = any(DUE_WORDS, n) ? 'due' : 'date';
  const read = readPeriod(text, today, dateField === 'due');
  if (read) consumed.push(...read.words);

  const party = findParty(text, ctx.parties);
  if (party) consumed.push(normalizeArabic(party.name));

  let person: CapturePerson | undefined;
  const named = findPeople(text, ctx.people);
  if (named.length) {
    person = named[0].person;
    consumed.push(normalizeArabic(latinDigits(text)).slice(named[0].at, named[0].end));
    // «منى» found "Mona Fathy" — both halves of the display name are consumed too.
    consumed.push(...normalizeArabic(person.name).split(/\s+/));
  } else if (any(MINE_WORDS, n)) {
    person = ctx.me;
  }

  const words = leftoverWords(n, consumed);
  const count = any(COUNT_WORDS, n);

  if (!kinds.length && !party && !person && !read && !state && !words.length) return null;

  return {
    kinds, party: party?.name, person, period: read?.period, dateField, state, direction, words, count,
  };
}

// ── Answering ────────────────────────────────────────────────────────────────

const CLOSED_BAD = ['Lost', 'No Bid', 'Cancelled'];

function stateMatches(r: AskRecord, s: AskState, todayIso: string): boolean {
  switch (s) {
    case 'open': return r.open;
    // A bid already handed in is waiting on the client, not late on us.
    case 'late': return r.open && !!r.due && r.due < todayIso &&
      !(r.kind === 'opportunity' && ['Submitted', 'Under Evaluation'].includes(r.status));
    case 'done': return !r.open && !CLOSED_BAD.includes(r.status);
    case 'won': return r.kind === 'opportunity' && r.status === 'Won';
    case 'lost': return r.kind === 'opportunity' && r.status === 'Lost';
    case 'submitted': return r.kind === 'opportunity' && ['Submitted', 'Under Evaluation', 'Won', 'Lost'].includes(r.status);
  }
}

export function answerQuestion(q: AskQuery, records: AskRecord[], today: Date = new Date()): AskAnswer {
  const todayIso = iso(today);
  const party = q.party ? normalizeArabic(q.party).trim() : '';
  const blob = new Map<AskRecord, string>();
  const hay = (r: AskRecord) => {
    let h = blob.get(r);
    if (h === undefined) {
      h = normalizeArabic(latinDigits(`${r.serial || ''} ${r.title} ${r.party || ''} ${r.from || ''} ${r.text}`));
      blob.set(r, h);
    }
    return h;
  };
  const fieldOf = (r: AskRecord) => (q.dateField === 'due' ? r.due : r.date);

  const base = records.filter(r => {
    if (q.kinds.length && !q.kinds.includes(r.kind)) return false;
    if (party && !hasName(hay(r), party)) return false;
    if (q.person && !r.people.includes(q.person.id)) return false;
    if (q.state && !stateMatches(r, q.state, todayIso)) return false;
    if (q.direction && party && r.kind === 'corresponding') {
      const fromThem = !!r.from && !!hasName(normalizeArabic(r.from), party);
      if (q.direction === 'received' && !fromThem) return false;
      if (q.direction === 'sent' && fromThem) return false;
    }
    if (q.period) {
      const d = fieldOf(r);
      if (!d || d < q.period.from || d > q.period.to) return false;
    }
    return true;
  });

  let rows = base;
  let loosened = false;
  if (q.words.length) {
    rows = base.filter(r => q.words.every(w => hay(r).includes(w)));
    if (!rows.length && q.words.length > 1) {
      rows = base.filter(r => q.words.some(w => hay(r).includes(w)));
      loosened = rows.length > 0;
    }
  }

  // A question about what is coming up reads soonest first; anything else newest first.
  const ahead = q.dateField === 'due' && (!q.period || q.period.to >= todayIso);
  rows = [...rows].sort((a, b) => {
    const da = fieldOf(a) || (ahead ? '9999' : '0000');
    const db = fieldOf(b) || (ahead ? '9999' : '0000');
    return ahead ? da.localeCompare(db) : db.localeCompare(da);
  });

  const byKind: Record<AskKind, number> = { task: 0, corresponding: 0, opportunity: 0, project: 0 };
  for (const r of rows) byKind[r.kind]++;
  return { query: q, rows, byKind, loosened };
}

// ── Records from the four boards ─────────────────────────────────────────────
// Plain shapes (not the Firestore types) so the harness can feed fixtures.

const join = (...xs: unknown[]) => xs.filter(x => typeof x === 'string' && x).join(' \n ');
const ids = (...xs: (string | undefined | string[])[]) =>
  [...new Set(xs.flat().filter((x): x is string => !!x))];

export function taskRecord(t: any): AskRecord {
  return {
    kind: 'task', id: t.id, serial: t.serialNumber, title: t.taskName || '',
    text: join(t.description, t.statusUpdate, t.category, t.subCategory, t.department,
      t.correspondingSubject, t.correspondingSerialNumber, t.opportunityTitle, t.opportunitySerial,
      t.projectName, t.assignedTo, ...(t.collaborators || []), ...((t.notes || []).map((x: any) => x?.text))),
    party: t.projectName || t.opportunityTitle,
    people: ids(t.assignedToId, t.collaboratorIds, t.userId),
    ownerName: t.assignedTo,
    status: t.status || 'Pending',
    open: !['Done', 'Archived'].includes(t.status),
    date: isoDay(t.createdAt),
    due: isoDay(t.dueDate),
  };
}

export function correspondingRecord(c: any): AskRecord {
  return {
    kind: 'corresponding', id: c.id, serial: c.serialNumber, title: c.subject || '',
    text: join(c.body, c.actions, c.notes, c.category, c.subCategory, c.department,
      c.opportunityTitle, c.opportunitySerial, c.projectName, c.assignedTo, c.attachedFileName),
    party: c.sentFrom,
    from: c.sentFrom,
    people: ids(c.assignedToId, c.userId),
    ownerName: c.assignedTo,
    status: c.status || 'Unread',
    open: c.status !== 'Closed',
    date: isoDay(c.dateReceived) || isoDay(c.createdAt),
    due: isoDay(c.deadline),
  };
}

export function opportunityRecord(o: any): AskRecord {
  const closed = ['Won', 'Lost', 'No Bid', 'Cancelled'].includes(o.stage);
  return {
    kind: 'opportunity', id: o.id, serial: o.serialNumber, title: o.title || '',
    text: join(o.scope, o.sector, o.location, o.tenderNumber, o.source, o.lastFollowUpText, o.awardedTo, o.ownerName),
    party: o.client,
    people: ids(o.ownerId, o.collaboratorIds, o.userId),
    ownerName: o.ownerName,
    status: o.stage || 'Identified',
    open: !closed,
    date: isoDay(o.submittedDate) || isoDay(o.announcedDate) || isoDay(o.createdAt),
    due: isoDay(o.submissionDeadline) || isoDay(o.decisionDate),
  };
}

export function projectRecord(p: any): AskRecord {
  return {
    kind: 'project', id: p.id, serial: p.serialNumber, title: p.name || '',
    text: join(p.code, p.description, p.location, p.operator, p.currentStatus, p.lastUpdateText),
    party: p.client,
    people: ids(p.userId),
    status: p.status || 'Active',
    open: p.status === 'Active' || p.status === 'On Hold' || !p.status,
    date: isoDay(p.startDate) || isoDay(p.createdAt),
    due: isoDay(p.endDate),
  };
}
