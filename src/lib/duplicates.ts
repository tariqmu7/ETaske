/**
 * Duplicate / conflict detection (queue task D8).
 *
 * Pure logic behind the Duplicates page and the "this looks like a bid we
 * already have" note on the New bid form:
 *
 *   BIDS      · the same tender entered twice — same tender / RFQ number
 *               (certain), or the same client with a near-identical title and
 *               submission deadlines close together (likely)
 *   LETTERS   · the same letter logged twice — same sender, same or near-same
 *               subject, received within a few days
 *   TASKS     · the same job opened twice — one letter turned into a task
 *               twice (certain), or the same title for the same person or the
 *               same bid/project within a week (likely)
 *   PROJECTS  · the same contract number, or the same client + project name
 *   CLASHES   · two or more people each holding open bids for one client —
 *               not an error, but somebody should know the other is talking
 *               to them too
 *
 * Matching is plain rules, no AI (static site, public repo). Titles are compared
 * as word sets (Dice coefficient) after folding Arabic letter forms, digits and
 * the common filler words, so «مناقصة صيانة خزانات أجيبا» and "AGIBA tank
 * maintenance tender" are NOT claimed to match — cross-language matching would
 * need a dictionary and would guess wrong more often than it helps. A year in
 * both titles that differs ("Turnaround 2025" / "Turnaround 2026") always means
 * two different tenders.
 *
 * Nothing is written and nothing is merged automatically: the page only points
 * at the copies, and a person decides which to delete. Plain shapes in, plain
 * groups out, so `scripts/harness/duplicates.mjs` can feed fixtures.
 */

import { clientKey } from './clientFile';

// ── Dates ────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;

function toMs(v: unknown): number {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const day = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]), 12).getTime();
    const t = Date.parse(v);
    return isNaN(t) ? 0 : t;
  }
  if (typeof (v as any).toMillis === 'function') return (v as any).toMillis();
  if (typeof (v as any).toDate === 'function') return (v as any).toDate().getTime();
  if (v instanceof Date) return isNaN(v.getTime()) ? 0 : v.getTime();
  return 0;
}

const iso = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Whole days between two date-likes, or null when either is missing. */
export function daysApart(a: unknown, b: unknown): number | null {
  const x = toMs(a), y = toMs(b);
  if (!x || !y) return null;
  return Math.round(Math.abs(x - y) / DAY);
}

// ── Text ─────────────────────────────────────────────────────────────────────

const ARABIC_DIGITS = /[٠-٩]/g;
const PERSIAN_DIGITS = /[۰-۹]/g;

/** Lower-case, one form per Arabic letter, no harakat/tatweel, Latin digits. */
export function fold(s: string | undefined | null): string {
  return String(s || '')
    .replace(ARABIC_DIGITS, d => String(d.charCodeAt(0) - 0x0660))
    .replace(PERSIAN_DIGITS, d => String(d.charCodeAt(0) - 0x06f0))
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');
}

/**
 * Tender / RFQ / contract numbers: letters and digits only, upper-case, so
 * "RFQ-2026/118" = "rfq 2026 118". Placeholders people type when they do not
 * know the number yet ("N/A", "TBD", "-", "0") count as no number at all.
 */
export function normRef(s: string | undefined | null): string {
  const r = fold(s).replace(/[^\p{L}\p{N}]+/gu, '').toUpperCase();
  if (r.length < 3 || /^0+$/.test(r)) return '';
  if (['NONE', 'TBD', 'TBA', 'NIL', 'UNKNOWN', 'لايوجد'].includes(r)) return '';
  return r;
}

/** Words that say nothing about WHICH tender / letter / task this is. */
const FILLER = new Set([
  'the', 'a', 'an', 'of', 'for', 'and', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 're', 'fw', 'fwd', 'no',
  'tender', 'rfq', 'rfp', 'bid', 'offer', 'quotation', 'inquiry', 'enquiry', 'project', 'services', 'service', 'works', 'work',
  'مناقصه', 'مناقصة', 'ممارسه', 'عمليه', 'عرض', 'عروض', 'اسعار', 'طلب', 'مشروع', 'خدمات', 'اعمال', 'رقم', 'بخصوص', 'بشان',
  'في', 'من', 'علي', 'الي', 'عن', 'مع', 'و', 'ل', 'ب', 'رد',
]);

/** Arabic clitics that glue onto a word: «والصيانة» → «صيانه». */
function stripClitics(w: string): string {
  if (!/[؀-ۿ]/.test(w) || w.length <= 3) return w;
  for (const p of ['وال', 'بال', 'فال', 'كال', 'لل', 'ال']) {
    if (w.startsWith(p) && w.length - p.length >= 2) return w.slice(p.length);
  }
  if (['و', 'ب', 'ل', 'ف'].includes(w[0]) && w.length > 4) return w.slice(1);
  return w;
}

/** The meaningful words of a title, as a set. `drop` removes the client's own words. */
export function titleWords(s: string | undefined | null, drop: string[] = []): Set<string> {
  const dropSet = new Set(drop.map(stripClitics));
  const words = fold(s)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .map(stripClitics)
    .filter(w => w && !FILLER.has(w) && !dropSet.has(w) && !(w.length === 1 && !/\d/.test(w)));
  return new Set(words);
}

/** Dice coefficient of two word sets: 1 = the same words, 0 = none shared. */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return (2 * shared) / (a.size + b.size);
}

const YEAR = /^(?:19|20)\d\d$/;

/** Both titles carry a year and the years differ → two different tenders. */
export function yearsClash(a: Set<string>, b: Set<string>): boolean {
  const ya = [...a].filter(w => YEAR.test(w));
  const yb = [...b].filter(w => YEAR.test(w));
  return ya.length > 0 && yb.length > 0 && !ya.some(y => yb.includes(y));
}

// ── Shapes ───────────────────────────────────────────────────────────────────

export type DupKind = 'bid' | 'letter' | 'task' | 'project';
export type Strength = 'certain' | 'likely';

/**
 * Why two records were paired. Codes, not sentences — the page words them
 * (in the reader's language) and the harness asserts on them.
 */
export type ReasonCode =
  | 'same-tender-number'
  | 'same-client'
  | 'similar-title'
  | 'same-title'
  | 'deadlines-close'
  | 'one-closed'
  | 'same-sender'
  | 'received-close'
  | 'same-letter'
  | 'same-owner'
  | 'same-link'
  | 'created-close'
  | 'same-contract-number';

export interface Reason { code: ReasonCode; value?: string | number; }

/** One record as the page shows it. */
export interface DupRecord {
  kind: DupKind;
  id: string;
  serial?: string;
  title: string;
  /** Client, sender or linked record — whatever says WHO it is about. */
  party?: string;
  ownerId?: string;
  ownerName?: string;
  /** Stage / status as stored (English enum — translated at display). */
  status?: string;
  /** The date that identifies it: tender deadline, date received, due date, start date. */
  date?: string;
  /** yyyy-mm-dd it was entered, when known. */
  created?: string;
  open: boolean;
}

export interface DupGroup {
  /** `<kind>:<sorted ids>` — what a "not a duplicate" dismissal remembers. */
  key: string;
  kind: DupKind;
  strength: Strength;
  reasons: Reason[];
  /** Oldest first: the first one is usually the one to keep. */
  records: DupRecord[];
}

export interface ClashPerson { id: string; name: string; bids: DupRecord[]; }

export interface ClientClash {
  /** `clash:<clientKey>:<sorted owner ids>` — a third person joining brings it back. */
  key: string;
  clientKey: string;
  /** The client as most of its bids spell it. */
  client: string;
  people: ClashPerson[];
}

export interface DupInput {
  opportunities: any[];
  correspondences: any[];
  /** Only the tasks this reader may see (subscribeVisibleTasks). */
  tasks: any[];
  projects: any[];
}

export interface DupReport {
  groups: DupGroup[];
  clashes: ClientClash[];
}

// ── Tuning (exported so the harness and the page footnote agree) ─────────────

/** Two tenders for one client with near-identical titles, deadlines this close, are one tender. */
export const BID_DEADLINE_DAYS = 21;
/** Without both deadlines, fall back to when they were entered. */
export const BID_CREATED_DAYS = 90;
export const BID_TITLE_MIN = 0.6;
export const LETTER_DAYS = 3;
export const LETTER_TITLE_MIN = 0.8;
export const TASK_DAYS = 7;
export const TASK_TITLE_MIN = 0.85;
export const PROJECT_TITLE_MIN = 0.8;

const BID_OPEN = ['Identified', 'Prequalification', 'Bid Preparation', 'Submitted', 'Under Evaluation'];
const TASK_CLOSED = ['Done', 'Archived'];
const PROJECT_DONE = ['Completed', 'Cancelled'];

const real = (r: any) => r && r.id && r.id !== '--stats--';
const createdDay = (r: any) => { const ms = toMs(r.createdAt); return ms ? iso(ms) : undefined; };
const dayOf = (v: unknown) => {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const ms = toMs(v);
  return ms ? iso(ms) : undefined;
};

// ── Records ──────────────────────────────────────────────────────────────────

const bidRecord = (o: any): DupRecord => ({
  kind: 'bid', id: o.id, serial: o.serialNumber, title: o.title || '—', party: o.client || undefined,
  ownerId: o.ownerId || undefined, ownerName: o.ownerName || undefined, status: o.stage || 'Identified',
  date: dayOf(o.submissionDeadline), created: createdDay(o), open: BID_OPEN.includes(o.stage || 'Identified'),
});

const letterRecord = (l: any): DupRecord => ({
  kind: 'letter', id: l.id, serial: l.serialNumber, title: l.subject || '—', party: l.sentFrom || undefined,
  ownerId: l.assignedToId || undefined, ownerName: l.assignedTo || undefined, status: l.status,
  date: dayOf(l.dateReceived), created: createdDay(l), open: l.status !== 'Closed',
});

const taskRecord = (t: any): DupRecord => ({
  kind: 'task', id: t.id, serial: t.serialNumber, title: t.taskName || '—',
  party: t.opportunityTitle || t.projectName || t.correspondingSubject || undefined,
  ownerId: t.assignedToId || undefined, ownerName: t.assignedTo || undefined, status: t.status,
  date: dayOf(t.dueDate), created: createdDay(t), open: !TASK_CLOSED.includes(t.status),
});

const projectRecord = (p: any): DupRecord => ({
  kind: 'project', id: p.id, serial: p.serialNumber, title: p.name || '—', party: p.client || undefined,
  status: p.status, date: dayOf(p.startDate), created: createdDay(p), open: !PROJECT_DONE.includes(p.status),
});

// ── Pair rules ───────────────────────────────────────────────────────────────

interface Pair { strength: Strength; reasons: Reason[]; }

/** Is bid `b` the same tender as bid (or New-bid draft) `a`? */
export function compareBids(a: any, b: any): Pair | null {
  const ka = clientKey(a.client), kb = clientKey(b.client);
  // Two named clients that differ are two tenders, whatever else matches:
  // "RFQ-001" is a number many clients use.
  if (ka && kb && ka !== kb) return null;

  const ra = normRef(a.tenderNumber), rb = normRef(b.tenderNumber);
  const drop = (ka || kb).split(' ').filter(Boolean);
  const wa = titleWords(a.title, drop), wb = titleWords(b.title, drop);
  const openA = BID_OPEN.includes(a.stage || 'Identified'), openB = BID_OPEN.includes(b.stage || 'Identified');
  const closedNote: Reason[] = openA !== openB ? [{ code: 'one-closed' }] : [];

  if (ra && rb) {
    if (ra !== rb) return null;
    // The same number with two clearly different years in the titles is a re-issue a year on.
    if (yearsClash(wa, wb)) return null;
    const reasons: Reason[] = [{ code: 'same-tender-number', value: String(a.tenderNumber || '').trim() }];
    if (ka && kb) reasons.push({ code: 'same-client', value: a.client });
    return { strength: closedNote.length ? 'likely' : 'certain', reasons: [...reasons, ...closedNote] };
  }

  // No shared number: needs the same client AND the same title.
  if (!ka || !kb) return null;
  if (yearsClash(wa, wb)) return null;
  const sim = similarity(wa, wb);
  if (sim < BID_TITLE_MIN) return null;

  const dl = daysApart(a.submissionDeadline, b.submissionDeadline);
  const reasons: Reason[] = [{ code: 'same-client', value: a.client }, sim === 1 ? { code: 'same-title' } : { code: 'similar-title', value: Math.round(sim * 100) }];
  if (dl !== null) {
    if (dl > BID_DEADLINE_DAYS) return null;
    reasons.push({ code: 'deadlines-close', value: dl });
  } else {
    const made = daysApart(a.createdAt, b.createdAt);
    // A draft has no createdAt yet: it is being entered now.
    const madeNow = made ?? daysApart(a.createdAt || Date.now(), b.createdAt || Date.now());
    if (madeNow === null || madeNow > BID_CREATED_DAYS) return null;
    reasons.push({ code: 'created-close', value: madeNow });
  }
  return { strength: 'likely', reasons: [...reasons, ...closedNote] };
}

/** Folded text with punctuation gone: "Invoice No. 45 — March" = "invoice no 45 march". */
const plain = (s: string | undefined | null) => fold(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function compareLetters(a: any, b: any): Pair | null {
  const sa = clientKey(a.sentFrom), sb = clientKey(b.sentFrom);
  if (sa !== sb) return null;
  const apart = daysApart(a.dateReceived || a.createdAt, b.dateReceived || b.createdAt);
  if (apart === null || apart > LETTER_DAYS) return null;
  const wa = titleWords(a.subject), wb = titleWords(b.subject);
  const sim = similarity(wa, wb);
  const exact = plain(a.subject) === plain(b.subject);
  if (!exact && sim < LETTER_TITLE_MIN) return null;
  const reasons: Reason[] = [
    ...(sa ? [{ code: 'same-sender' as const, value: a.sentFrom }] : []),
    exact ? { code: 'same-title' } : { code: 'similar-title', value: Math.round(sim * 100) },
    { code: 'received-close', value: apart },
  ];
  return { strength: exact && sa && apart === 0 ? 'certain' : 'likely', reasons };
}

function compareTasks(a: any, b: any): Pair | null {
  if (a.correspondingId && a.correspondingId === b.correspondingId) {
    return { strength: 'certain', reasons: [{ code: 'same-letter', value: a.correspondingSerialNumber || a.correspondingSubject || '' }] };
  }
  const sameOwner = !!a.assignedToId && a.assignedToId === b.assignedToId;
  const link = (t: any) => t.opportunityId ? `o:${t.opportunityId}` : t.projectId ? `p:${t.projectId}` : '';
  const sameLink = !!link(a) && link(a) === link(b);
  if (!sameOwner && !sameLink) return null;
  const apart = daysApart(a.createdAt, b.createdAt);
  if (apart === null || apart > TASK_DAYS) return null;
  const wa = titleWords(a.taskName), wb = titleWords(b.taskName);
  if (yearsClash(wa, wb)) return null;
  const sim = similarity(wa, wb);
  if (sim < TASK_TITLE_MIN) return null;
  const reasons: Reason[] = [sim === 1 ? { code: 'same-title' } : { code: 'similar-title', value: Math.round(sim * 100) }];
  if (sameOwner) reasons.push({ code: 'same-owner', value: a.assignedTo || '' });
  if (sameLink) reasons.push({ code: 'same-link', value: a.opportunityTitle || a.projectName || '' });
  reasons.push({ code: 'created-close', value: apart });
  return { strength: 'likely', reasons };
}

function compareProjects(a: any, b: any): Pair | null {
  const ca = normRef(a.code), cb = normRef(b.code);
  if (ca && cb && ca === cb) {
    return { strength: 'certain', reasons: [{ code: 'same-contract-number', value: String(a.code).trim() }] };
  }
  const ka = clientKey(a.client), kb = clientKey(b.client);
  if (!ka || ka !== kb) return null;
  if (ca && cb) return null; // two different contract numbers = two contracts
  const drop = ka.split(' ');
  const wa = titleWords(a.name, drop), wb = titleWords(b.name, drop);
  if (yearsClash(wa, wb)) return null;
  const sim = similarity(wa, wb);
  // Only the client's name in both titles ("AGIBA" / "AGIBA") → the word sets are empty; that is the same project.
  const bothBare = !wa.size && !wb.size;
  if (!bothBare && sim < PROJECT_TITLE_MIN) return null;
  return { strength: 'likely', reasons: [{ code: 'same-client', value: a.client }, sim === 1 || bothBare ? { code: 'same-title' } : { code: 'similar-title', value: Math.round(sim * 100) }] };
}

// ── Grouping ─────────────────────────────────────────────────────────────────

/**
 * Buckets keep the pair search from being every-record-against-every-record:
 * two records are only compared if they share a bucket. Each rule's bucket is
 * a NECESSARY condition of that rule, so nothing is missed.
 */
function groupsOf(
  kind: DupKind,
  rows: any[],
  buckets: (r: any) => string[],
  compare: (a: any, b: any) => Pair | null,
  toRecord: (r: any) => DupRecord,
  keep: (a: any, b: any) => boolean,
): DupGroup[] {
  const byBucket = new Map<string, number[]>();
  rows.forEach((r, i) => {
    for (const k of new Set(buckets(r))) {
      if (!k) continue;
      const list = byBucket.get(k);
      if (list) list.push(i); else byBucket.set(k, [i]);
    }
  });

  // Union-find over the matching pairs, so three copies make ONE group.
  const parent = rows.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const pairs = new Map<string, Pair>();
  for (const list of byBucket.values()) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const i = list[x], j = list[y];
        const pk = i < j ? `${i}:${j}` : `${j}:${i}`;
        if (pairs.has(pk)) continue;
        if (!keep(rows[i], rows[j])) continue;
        const p = compare(rows[i], rows[j]);
        if (!p) continue;
        pairs.set(pk, p);
        parent[find(i)] = find(j);
      }
    }
  }

  const members = new Map<number, number[]>();
  const pairOfRoot = new Map<number, Pair[]>();
  for (const [pk, p] of pairs) {
    const root = find(Number(pk.split(':')[0]));
    if (!pairOfRoot.has(root)) pairOfRoot.set(root, []);
    pairOfRoot.get(root)!.push(p);
  }
  rows.forEach((_, i) => {
    const root = find(i);
    if (!pairOfRoot.has(root)) return;
    if (!members.has(root)) members.set(root, []);
    members.get(root)!.push(i);
  });

  const out: DupGroup[] = [];
  for (const [root, idx] of members) {
    const ps = pairOfRoot.get(root)!;
    const reasons: Reason[] = [];
    for (const p of ps) for (const r of p.reasons) {
      if (!reasons.some(x => x.code === r.code)) reasons.push(r);
    }
    // "similar-title" and "same-title" both present: say the stronger one only.
    if (reasons.some(r => r.code === 'same-title')) {
      const i = reasons.findIndex(r => r.code === 'similar-title');
      if (i >= 0) reasons.splice(i, 1);
    }
    const records = idx.map(i => toRecord(rows[i]))
      .sort((a, b) => (a.created || '9999').localeCompare(b.created || '9999') || (a.serial || '').localeCompare(b.serial || ''));
    out.push({
      key: groupKey(kind, records.map(r => r.id)),
      kind,
      strength: ps.some(p => p.strength === 'certain') ? 'certain' : 'likely',
      reasons,
      records,
    });
  }
  return out;
}

/** The dismissal key of a group: kind + its ids, sorted, so order never matters. */
export function groupKey(kind: DupKind | 'clash', ids: string[]): string {
  return `${kind}:${[...ids].sort().join(',')}`;
}

/** Everything that looks entered twice, plus the client clashes. */
export function findDuplicates(input: DupInput): DupReport {
  const bids = input.opportunities.filter(real);
  const letters = input.correspondences.filter(real);
  const tasks = input.tasks.filter(real).filter(t => !TASK_CLOSED.includes(t.status));
  const projects = input.projects.filter(real);

  const groups: DupGroup[] = [
    ...groupsOf('bid', bids,
      b => [normRef(b.tenderNumber) && `n:${normRef(b.tenderNumber)}`, clientKey(b.client) && `c:${clientKey(b.client)}`],
      compareBids, bidRecord,
      // A duplicate among closed bids no longer costs anything — at least one must still be live.
      (a, b) => BID_OPEN.includes(a.stage || 'Identified') || BID_OPEN.includes(b.stage || 'Identified')),
    ...groupsOf('letter', letters,
      // Same sender is required (compareLetters checks the dates before the words, so a big sender stays cheap).
      l => [`s:${clientKey(l.sentFrom)}`],
      compareLetters, letterRecord,
      (a, b) => a.status !== 'Closed' || b.status !== 'Closed'),
    ...groupsOf('task', tasks,
      t => [
        t.correspondingId && `l:${t.correspondingId}`,
        t.assignedToId && `u:${t.assignedToId}`,
        t.opportunityId ? `o:${t.opportunityId}` : t.projectId ? `p:${t.projectId}` : '',
      ],
      compareTasks, taskRecord, () => true),
    ...groupsOf('project', projects,
      p => [normRef(p.code) && `n:${normRef(p.code)}`, clientKey(p.client) && `c:${clientKey(p.client)}`],
      compareProjects, projectRecord,
      (a, b) => !PROJECT_DONE.includes(a.status) || !PROJECT_DONE.includes(b.status)),
  ];

  const kindOrder: DupKind[] = ['bid', 'letter', 'task', 'project'];
  groups.sort((a, b) =>
    Number(b.strength === 'certain') - Number(a.strength === 'certain') ||
    kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) ||
    (b.records[b.records.length - 1].created || '').localeCompare(a.records[a.records.length - 1].created || ''));

  return { groups, clashes: findClientClashes(bids) };
}

/**
 * Two or more people each owning an OPEN bid for the same client. Unowned bids
 * do not count (nobody to tell), and co-owners are one team, not a clash.
 */
export function findClientClashes(opportunities: any[]): ClientClash[] {
  const byClient = new Map<string, any[]>();
  for (const o of opportunities) {
    if (!real(o) || !o.ownerId || !BID_OPEN.includes(o.stage || 'Identified')) continue;
    const k = clientKey(o.client);
    if (!k) continue;
    if (!byClient.has(k)) byClient.set(k, []);
    byClient.get(k)!.push(o);
  }

  const out: ClientClash[] = [];
  for (const [k, list] of byClient) {
    const owners = [...new Set(list.map(o => o.ownerId as string))];
    if (owners.length < 2) continue;
    // If every owner is a co-owner on the others' bids, they are working it together.
    const together = list.every(o => owners.every(id => id === o.ownerId || (o.collaboratorIds || []).includes(id)));
    if (together) continue;

    const people: ClashPerson[] = owners.map(id => {
      const mine = list.filter(o => o.ownerId === id);
      return { id, name: mine.find(o => o.ownerName)?.ownerName || '', bids: mine.map(bidRecord) };
    }).sort((a, b) => b.bids.length - a.bids.length || a.name.localeCompare(b.name));

    // The spelling most of their bids use.
    const counts = new Map<string, number>();
    for (const o of list) counts.set(String(o.client).trim(), (counts.get(String(o.client).trim()) || 0) + 1);
    const client = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];

    out.push({ key: groupKey('clash', [k, ...owners]), clientKey: k, client, people });
  }
  return out.sort((a, b) => b.people.length - a.people.length || a.client.localeCompare(b.client));
}

// ── The New bid form ─────────────────────────────────────────────────────────

export interface SimilarBid { record: DupRecord; strength: Strength; reasons: Reason[]; }

/**
 * Bids that look like the one being typed into the New bid form, strongest
 * first, at most `limit`. A closed bid only counts on a shared tender number
 * ("you already recorded this one as Lost"); a matching title alone is only
 * checked against live bids. `excludeId` = the bid being edited.
 */
export function findSimilarBids(
  draft: { title?: string; client?: string; tenderNumber?: string; submissionDeadline?: string },
  opportunities: any[],
  excludeId?: string,
  limit = 3,
): SimilarBid[] {
  if (!draft.title?.trim() && !normRef(draft.tenderNumber)) return [];
  const probe = { ...draft, stage: 'Identified', createdAt: undefined };
  const hits: SimilarBid[] = [];
  for (const o of opportunities) {
    if (!real(o) || o.id === excludeId) continue;
    const p = compareBids(probe, o);
    if (!p) continue;
    if (!BID_OPEN.includes(o.stage || 'Identified') && !p.reasons.some(r => r.code === 'same-tender-number')) continue;
    hits.push({ record: bidRecord(o), strength: p.strength, reasons: p.reasons });
  }
  return hits
    .sort((a, b) => Number(b.strength === 'certain') - Number(a.strength === 'certain') ||
      Number(b.reasons.some(r => r.code === 'same-tender-number')) - Number(a.reasons.some(r => r.code === 'same-tender-number')) ||
      (b.record.created || '').localeCompare(a.record.created || ''))
    .slice(0, limit);
}

// ── Summary ──────────────────────────────────────────────────────────────────

export function duplicateSummary(report: DupReport) {
  const byKind: Record<DupKind, number> = { bid: 0, letter: 0, task: 0, project: 0 };
  for (const g of report.groups) byKind[g.kind]++;
  return {
    groups: report.groups.length,
    certain: report.groups.filter(g => g.strength === 'certain').length,
    /** Records that would go if every group kept only one copy. */
    extraCopies: report.groups.reduce((n, g) => n + g.records.length - 1, 0),
    byKind,
    clashes: report.clashes.length,
  };
}
