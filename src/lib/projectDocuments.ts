// ─── Documents per project (queue task D4) ───────────────────────────────────
//
// Every letter, offer, set of minutes, contract or invoice that belongs to a
// project, in ONE list — and one search box that finds any of them, in Arabic
// or English, across every project.
//
// Where the documents come from:
//   • FILED  — entries typed on the project's Documents tab. They live as a
//              `documents` ARRAY ON THE PROJECT DOC (same shape as the C3
//              checklist): no new collection, so no rules deploy, and the
//              department-wide search needs only the `projects` list it already
//              reads (settled rule 1 — read the parent, never the children).
//   • LETTER — correspondences linked to the project (`projectId`), shown
//              read-only; they are owned by the Correspondences board.
//   • TASK   — tasks linked to the project that carry a file or a folder path.
//
// Pure: no Firebase, no React, no i18n — `scripts/harness/projectdocs.mjs`
// bundles it as-is. Stored values stay ENGLISH (kind / direction are data);
// the UI translates them at display time.

export type DocKind =
  | 'letter' | 'offer' | 'minutes' | 'contract' | 'invoice' | 'report' | 'drawing' | 'other';

export const DOC_KINDS: DocKind[] = [
  'letter', 'offer', 'minutes', 'contract', 'invoice', 'report', 'drawing', 'other',
];

/** in = we received it, out = we sent it, internal = stayed in the company. */
export type DocDirection = 'in' | 'out' | 'internal';

export const DOC_DIRECTIONS: DocDirection[] = ['in', 'out', 'internal'];

/** One filed entry, as stored in `projects/{id}.documents[]`. */
export interface ProjectDocument {
  id: string;
  kind: DocKind;
  title: string;
  /** yyyy-mm-dd — the date ON the document, not the day it was filed. */
  date?: string;
  direction?: DocDirection;
  /** Its own reference / outgoing number, e.g. "EPROM/BD/2026/118". */
  refNo?: string;
  /** Who it came from or went to. */
  party?: string;
  /** Pasted text or the main points — this is what the search reads. */
  summary?: string;
  /** An http(s) link, or a file-server path (\\eprom-fs01\…, C:\…). */
  link?: string;
  fileName?: string;
  addedBy?: string;
  addedById?: string;
  /** ISO timestamp — serverTimestamp() is not allowed inside an array. */
  addedAt?: string;
  editedAt?: string;
}

/** The fields a person fills in on the form. */
export type DocumentInput = Pick<
  ProjectDocument, 'kind' | 'title' | 'date' | 'direction' | 'refNo' | 'party' | 'summary' | 'link' | 'fileName'
>;

// ─── Limits ──────────────────────────────────────────────────────────────────

/** A Firestore document is capped at 1 MiB; the list shares it with the project. */
export const SUMMARY_MAX = 4000;
export const TITLE_MAX = 200;
export const MAX_DOCUMENTS = 400;

// ─── Links ───────────────────────────────────────────────────────────────────

export type LinkKind = 'url' | 'path' | 'bad' | null;

/**
 * What the link box holds. A web link must be http(s) — never `javascript:` or
 * `data:` (it is rendered as an <a href>). A Windows/UNC path cannot be opened
 * from a web page, so the UI shows it with a Copy button instead.
 */
export function linkKind(link?: string | null): LinkKind {
  const v = (link || '').trim();
  if (!v) return null;
  if (/^https?:\/\/\S+$/i.test(v)) return 'url';
  // \\server\share\…  ·  C:\… or C:/…  ·  //server/share/…
  if (/^\\\\[^\\\s]+\\/.test(v) || /^[a-z]:[\\/]/i.test(v) || /^\/\/[^/\s]+\//.test(v)) return 'path';
  return 'bad';
}

// ─── Validation + building ───────────────────────────────────────────────────

export type DocProblem = 'title' | 'kind' | 'date' | 'link' | 'full';

export function validateDocument(input: Partial<DocumentInput>, currentCount = 0, isNew = true): DocProblem | null {
  if (!input.title || !input.title.trim()) return 'title';
  if (!input.kind || !DOC_KINDS.includes(input.kind)) return 'kind';
  if (input.date && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return 'date';
  if (linkKind(input.link) === 'bad') return 'link';
  if (isNew && currentCount >= MAX_DOCUMENTS) return 'full';
  return null;
}

const clean = (s?: string | null, max = 500) => {
  const v = (s || '').trim();
  return v ? v.slice(0, max) : undefined;
};

/** Drop undefined keys — Firestore rejects `undefined` values. */
function compact<T extends object>(o: T): T {
  const out: any = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

let seq = 0;
export const newDocId = (now = Date.now()) =>
  `doc_${now.toString(36)}_${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function tidy(input: Partial<DocumentInput>): Partial<ProjectDocument> {
  return {
    kind: input.kind && DOC_KINDS.includes(input.kind) ? input.kind : 'other',
    title: clean(input.title, TITLE_MAX) || '',
    date: clean(input.date, 10),
    direction: input.direction && DOC_DIRECTIONS.includes(input.direction) ? input.direction : undefined,
    refNo: clean(input.refNo, 120),
    party: clean(input.party, 200),
    summary: clean(input.summary, SUMMARY_MAX),
    link: clean(input.link, 1000),
    fileName: clean(input.fileName, 200),
  };
}

export function buildDocument(
  input: Partial<DocumentInput>,
  who: { uid: string; name?: string },
  now = new Date(),
): ProjectDocument {
  return compact({
    id: newDocId(now.getTime()),
    ...tidy(input),
    addedBy: clean(who.name, 120),
    addedById: who.uid,
    addedAt: now.toISOString(),
  }) as ProjectDocument;
}

// The list edits are written against the array RE-READ inside a transaction,
// so each one is a small, pure change to whatever is there now.

export const addDocument = (list: ProjectDocument[], d: ProjectDocument): ProjectDocument[] =>
  [...(list || []).filter(x => x.id !== d.id), d];

export function updateDocument(
  list: ProjectDocument[], id: string, input: Partial<DocumentInput>, now = new Date(),
): ProjectDocument[] {
  return (list || []).map(d => {
    if (d.id !== id) return d;
    const next: any = { ...d, ...tidy(input), editedAt: now.toISOString() };
    // A field the user emptied must go, not keep its old value.
    for (const k of ['date', 'direction', 'refNo', 'party', 'summary', 'link', 'fileName'] as const) {
      if (next[k] === undefined) delete next[k];
    }
    return next as ProjectDocument;
  });
}

export const removeDocument = (list: ProjectDocument[], id: string): ProjectDocument[] =>
  (list || []).filter(d => d.id !== id);

/** The filer may edit/remove their own entry; a Manager/Admin any entry. */
export const canChangeDocument = (d: Pick<ProjectDocument, 'addedById'>, uid: string, role?: string) =>
  role === 'Admin' || role === 'Manager' || (!!d.addedById && d.addedById === uid);

// ─── One list across the three sources ───────────────────────────────────────

export type DocSource = 'filed' | 'letter' | 'task';

export interface DocRow {
  /** Unique across sources: `filed:<projectId>:<id>`, `letter:<id>`, `task:<id>`. */
  key: string;
  source: DocSource;
  /** The filed entry's id, or the correspondence / task id. */
  recordId: string;
  projectId: string;
  projectName: string;
  client?: string;
  kind: DocKind;
  title: string;
  date?: string;
  direction?: DocDirection;
  refNo?: string;
  party?: string;
  summary?: string;
  link?: string;
  fileName?: string;
  /** Folder paths a letter / task carries (`filePaths`). */
  paths?: string[];
  addedBy?: string;
  addedById?: string;
  /** Letter / task status, for the chip. */
  status?: string;
}

interface ProjectLike {
  id: string; name?: string; client?: string; documents?: ProjectDocument[];
}
interface LetterLike {
  id: string; subject?: string; body?: string; sentFrom?: string; dateReceived?: string;
  serialNumber?: string; attachedFile?: string; attachedFileName?: string; filePaths?: string[];
  projectId?: string; projectName?: string; status?: string; userId?: string;
}
interface TaskLike {
  id: string; taskName?: string; description?: string; dueDate?: string; serialNumber?: string;
  attachedFile?: string; attachedFileName?: string; filePaths?: string[];
  projectId?: string; projectName?: string; status?: string; assignedTo?: string;
  createdAt?: any;
}

const dayOfTs = (v: any): string | undefined => {
  if (!v) return undefined;
  if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined;
  const d: Date | null = typeof v.toDate === 'function' ? v.toDate() : v instanceof Date ? v : null;
  if (!d || isNaN(d.getTime())) return undefined;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const realPaths = (p?: string[]) => (Array.isArray(p) ? p.map(s => (s || '').trim()).filter(Boolean) : []);

/**
 * Every document of every project the caller passes, newest first.
 * Letters and tasks count only when linked to a project in `projects` — a link
 * to a deleted project is dropped rather than shown under a name that is gone.
 */
export function gatherDocuments(src: {
  projects: ProjectLike[];
  letters?: LetterLike[];
  tasks?: TaskLike[];
}): DocRow[] {
  const byId = new Map(src.projects.map(p => [p.id, p]));
  const rows: DocRow[] = [];

  for (const p of src.projects) {
    for (const d of Array.isArray(p.documents) ? p.documents : []) {
      if (!d || !d.id || !d.title) continue;
      rows.push({
        key: `filed:${p.id}:${d.id}`, source: 'filed', recordId: d.id,
        projectId: p.id, projectName: p.name || '', client: p.client,
        kind: DOC_KINDS.includes(d.kind) ? d.kind : 'other',
        title: d.title, date: d.date, direction: d.direction, refNo: d.refNo, party: d.party,
        summary: d.summary, link: d.link, fileName: d.fileName,
        addedBy: d.addedBy, addedById: d.addedById,
      });
    }
  }

  for (const l of src.letters || []) {
    const p = l.projectId ? byId.get(l.projectId) : undefined;
    if (!p) continue;
    rows.push({
      key: `letter:${l.id}`, source: 'letter', recordId: l.id,
      projectId: p.id, projectName: p.name || l.projectName || '', client: p.client,
      kind: 'letter', title: l.subject || l.attachedFileName || l.serialNumber || l.id,
      date: dayOfTs(l.dateReceived), direction: 'in', refNo: l.serialNumber, party: l.sentFrom,
      summary: l.body, link: l.attachedFile, fileName: l.attachedFileName,
      paths: realPaths(l.filePaths), status: l.status, addedById: l.userId,
    });
  }

  for (const t of src.tasks || []) {
    const p = t.projectId ? byId.get(t.projectId) : undefined;
    if (!p) continue;
    const paths = realPaths(t.filePaths);
    if (!t.attachedFile && paths.length === 0) continue; // a task with no file is not a document
    rows.push({
      key: `task:${t.id}`, source: 'task', recordId: t.id,
      projectId: p.id, projectName: p.name || t.projectName || '', client: p.client,
      kind: 'other', title: t.attachedFileName || t.taskName || t.serialNumber || t.id,
      date: dayOfTs(t.createdAt), refNo: t.serialNumber, party: t.assignedTo,
      summary: [t.taskName, t.description].filter(Boolean).join(' — '),
      link: t.attachedFile, fileName: t.attachedFileName, paths, status: t.status,
    });
  }

  return sortRows(rows);
}

/** Newest document date first; undated last; then title. */
export function sortRows(rows: DocRow[]): DocRow[] {
  return [...rows].sort((a, b) => {
    const da = a.date || '', db = b.date || '';
    if (da !== db) return da ? (db ? db.localeCompare(da) : -1) : 1;
    return a.title.localeCompare(b.title);
  });
}

// ─── Arabic-aware search ─────────────────────────────────────────────────────

/**
 * Words each kind and direction answers to, in both languages, so «محضر» finds
 * minutes, "quotation" finds an offer and «صادر» finds what we sent — whatever
 * language the person filed it in.
 */
export const KIND_WORDS: Record<DocKind, string> = {
  letter: 'letter correspondence خطاب مكاتبة رسالة جواب',
  offer: 'offer quotation proposal tender bid عرض عرض سعر عرض فني عرض مالي عطاء',
  minutes: 'minutes meeting mom محضر اجتماع محضر اجتماع',
  contract: 'contract agreement amendment po order عقد اتفاقية ملحق امر توريد تعاقد',
  invoice: 'invoice claim payment certificate فاتورة مستخلص مطالبة',
  report: 'report study تقرير دراسة',
  drawing: 'drawing layout plan رسم رسومات لوحة مخطط',
  other: 'other document مستند وثيقة',
};
export const DIRECTION_WORDS: Record<DocDirection, string> = {
  in: 'received incoming inbound وارد مستلم',
  out: 'sent outgoing outbound صادر مرسل',
  internal: 'internal داخلي',
};

/** One character in → its searchable form (possibly empty). Per-char on purpose: see `highlightRanges`. */
function foldChar(ch: string): string {
  if (/[\u064B-\u0652\u0670\u0640]/.test(ch)) return '';      // harakat, dagger alef, tatweel
  if (/[أإآٱ]/.test(ch)) return 'ا';
  if (ch === 'ة') return 'ه';
  if (ch === 'ى') return 'ي';
  if (ch === 'ؤ') return 'و';
  if (ch === 'ئ') return 'ي';
  if (/[\u0660-\u0669]/.test(ch)) return String(ch.charCodeAt(0) - 0x0660);
  if (/[\u06F0-\u06F9]/.test(ch)) return String(ch.charCodeAt(0) - 0x06F0);
  return ch.toLowerCase();
}

/** The form both the query and the text are compared in. */
export function foldText(text?: string | null): string {
  if (!text) return '';
  let out = '';
  for (const ch of text) out += foldChar(ch);
  // A superset of utils.normalizeArabic (not imported: src/utils.ts reads
  // import.meta.env at load, which the plain-node harness cannot provide).
  return out.replace(/\s+/g, ' ');
}

const STOP = new Set([
  'في', 'من', 'الي', 'عن', 'مع', 'و', 'او', 'the', 'of', 'and', 'or', 'to', 'for', 'in', 'on', 'a', 'an',
]);

/** Arabic clitics a word may carry in the text but not in the query (or the reverse). */
const PREFIXES = ['وال', 'بال', 'فال', 'كال', 'لل', 'ال', 'و', 'ب', 'ف', 'ل'];

export function searchTokens(query: string): string[] {
  const words = foldText(query).split(/[\s,.;:!?؟،؛()"'«»\-–—_/\\]+/).filter(Boolean);
  const kept = words.filter(w => !STOP.has(w));
  return kept.length ? kept : words;
}

/** The token plus its bare stem (`الخطاب` → `خطاب`), longest first. */
export function tokenForms(token: string): string[] {
  const forms = [token];
  for (const p of PREFIXES) {
    if (token.startsWith(p) && token.length - p.length >= 3) { forms.push(token.slice(p.length)); break; }
  }
  return forms;
}

const hit = (hay: string, token: string) => tokenForms(token).some(f => hay.includes(f));

function fields(r: DocRow) {
  return {
    title: foldText([r.title, r.fileName].filter(Boolean).join(' ')),
    strong: foldText([r.refNo, r.party, r.projectName, r.client].filter(Boolean).join(' ')),
    body: foldText([
      r.summary, (r.paths || []).join(' '), KIND_WORDS[r.kind],
      r.direction ? DIRECTION_WORDS[r.direction] : '', r.addedBy,
    ].filter(Boolean).join(' ')),
  };
}

export interface SearchFilters {
  kind?: DocKind | 'all';
  projectId?: string | 'all';
  direction?: DocDirection | 'all';
}

export interface SearchHit { row: DocRow; score: number }

/**
 * Every row whose text holds ALL the words of the query (each word may match
 * with or without its Arabic prefix), best first: a word in the title weighs 3,
 * in the ref / party / project 2, anywhere else 1; equal scores fall back to
 * newest first. An empty query returns the filtered list in date order.
 */
export function searchDocuments(rows: DocRow[], query: string, filters: SearchFilters = {}): SearchHit[] {
  const pool = rows.filter(r =>
    (!filters.kind || filters.kind === 'all' || r.kind === filters.kind) &&
    (!filters.projectId || filters.projectId === 'all' || r.projectId === filters.projectId) &&
    (!filters.direction || filters.direction === 'all' || r.direction === filters.direction));
  const tokens = searchTokens(query);
  if (tokens.length === 0) return sortRows(pool).map(row => ({ row, score: 0 }));

  const hits: SearchHit[] = [];
  for (const row of pool) {
    const f = fields(row);
    let score = 0;
    let all = true;
    for (const tk of tokens) {
      if (hit(f.title, tk)) score += 3;
      else if (hit(f.strong, tk)) score += 2;
      else if (hit(f.body, tk)) score += 1;
      else { all = false; break; }
    }
    if (all) hits.push({ row, score });
  }
  const order = new Map(sortRows(hits.map(h => h.row)).map((r, i) => [r.key, i]));
  return hits.sort((a, b) => b.score - a.score || order.get(a.row.key)! - order.get(b.row.key)!);
}

/**
 * [start, end) ranges in the ORIGINAL text where the query's words match, so
 * the UI can mark them even though the comparison ran on the folded text
 * (harakat and tatweel removed). Works because folding is per character: each
 * folded character remembers which original character it came from.
 */
export function highlightRanges(text: string, query: string): [number, number][] {
  if (!text) return [];
  const tokens = searchTokens(query);
  if (!tokens.length) return [];
  // folded[i] came from text[from[i] .. to[i]).
  let folded = '';
  const from: number[] = [];
  const to: number[] = [];
  let pos = 0;
  for (const ch of text) {
    for (const c of foldChar(ch)) { folded += c; from.push(pos); to.push(pos + ch.length); }
    pos += ch.length;
  }
  const ranges: [number, number][] = [];
  for (const tk of tokens) {
    for (const form of tokenForms(tk)) {
      let i = folded.indexOf(form);
      if (i === -1) continue;
      while (i !== -1) {
        ranges.push([from[i], to[i + form.length - 1]]);
        i = folded.indexOf(form, i + form.length);
      }
      break; // the fullest form that matched wins
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/**
 * A short window of `text` around its first match (or its start), for the
 * result row — ~`width` characters, cut at word boundaries, with "…" marks.
 */
export function snippet(text: string | undefined, query: string, width = 180): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= width) return t;
  const r = highlightRanges(t, query)[0];
  let start = r ? Math.max(0, r[0] - Math.floor(width / 3)) : 0;
  if (start > 0) {
    const sp = t.indexOf(' ', start);
    if (sp !== -1 && sp < start + 20) start = sp + 1;
  }
  let end = Math.min(t.length, start + width);
  if (end < t.length) {
    const sp = t.lastIndexOf(' ', end);
    if (sp > start + width / 2) end = sp;
  }
  return `${start > 0 ? '… ' : ''}${t.slice(start, end)}${end < t.length ? ' …' : ''}`;
}

/** Per-kind counts, for the filter chips. */
export function countByKind(rows: DocRow[]): Record<DocKind, number> {
  const out = Object.fromEntries(DOC_KINDS.map(k => [k, 0])) as Record<DocKind, number>;
  for (const r of rows) out[r.kind] = (out[r.kind] || 0) + 1;
  return out;
}
