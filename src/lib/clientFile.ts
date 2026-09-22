/**
 * Client file (queue task D1).
 *
 * Pure logic behind the Clients page: one page per client that answers, without
 * opening four boards, "where are we with AGIBA?" —
 *   · what we owe them (open letters, tasks, bid submissions, checklist steps),
 *   · who spoke to them last, and who on our side knows them,
 *   · their open bids and our record with them,
 *   · their projects and every contract under them (and which are running out),
 *   · the latest letters on file, and — when the Outlook helper is running on
 *     this PC — the latest e-mails too.
 *
 * A "client" is not a collection of its own: it is the `client` text already on
 * projects and bids. Spellings are merged by `clientKey` (case, Arabic letter
 * variants, punctuation, «شركة» / "Co." / "Ltd"), nothing cleverer — "AGIBA"
 * and "AGIBA Petroleum" stay two clients rather than risk merging two real
 * companies that share a word.
 *
 * Everything is derived at render and nothing is written (settled rule 3), so
 * the page can never contradict the boards it reads. Plain shapes, not the
 * Firestore types, so `scripts/harness/clientfile.mjs` can feed fixtures.
 */

import { normalizeArabic } from '../utils';

// ── Keys and matching ────────────────────────────────────────────────────────

const LEGAL_SUFFIX = /\s+(?:co|company|corp|corporation|ltd|limited|llc|inc|sae|s a e|plc)$/;
const LEGAL_PREFIX = /^(?:شركه|الشركه)\s+/;

/** One key per client however it was typed: "Agiba Co." = "AGIBA" = "agiba". */
export function clientKey(name?: string | null): string {
  let k = normalizeArabic(String(name || ''))
    .replace(/[^\p{L}\d]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (let i = 0; i < 2; i++) k = k.replace(LEGAL_SUFFIX, '').replace(LEGAL_PREFIX, '').trim();
  return k;
}

/**
 * Does free text (a letter's sender, an e-mail's From) name this client?
 * Whole words only — "APC" must not be found inside "CAPCO" — and an Arabic
 * one-letter prefix (و، ب، ل، ف) or «لل» is allowed, as in «لأجيبا».
 */
export function textNamesClient(text: string | undefined | null, key: string): boolean {
  if (!text || key.length < 2) return false;
  const hay = ` ${normalizeArabic(String(text)).replace(/[^\p{L}\d]+/gu, ' ').replace(/\s+/g, ' ').trim()} `;
  if (hay.includes(` ${key} `)) return true;
  return /[؀-ۿ]/.test(key) && [' و', ' ب', ' ل', ' ف', ' لل'].some(p => hay.includes(`${p}${key} `));
}

// ── The page address ─────────────────────────────────────────────────────────

/** `#/clients?c=<key>` — what a project / bid page links to. */
export function clientFileHash(name: string): string {
  return `#/clients?c=${encodeURIComponent(clientKey(name))}`;
}

/** The client key a `#/clients?c=…` hash opens, or null for the list. */
export function clientFromHash(hash: string): string | null {
  const [view, qs] = hash.replace(/^#\/?/, '').split('?');
  if (view !== 'clients' || !qs) return null;
  const c = new URLSearchParams(qs).get('c');
  return c ? clientKey(c) || null : null;
}

// ── Dates ────────────────────────────────────────────────────────────────────

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Timestamp / Date / ISO string / ms → ms since epoch, or 0. A bare yyyy-mm-dd is local noon. */
export function toMs(v: unknown): number {
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

/** Anything date-like → yyyy-mm-dd (local), or ''. */
export function dayOf(v: unknown): string {
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m && v.length === 10) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  const ms = toMs(v);
  return ms ? iso(new Date(ms)) : '';
}

const daysBetween = (fromDay: string, toDay: string) =>
  Math.round((toMs(toDay) - toMs(fromDay)) / 86_400_000);

// ── Input shapes ─────────────────────────────────────────────────────────────

export interface ClientInput {
  projects: any[];
  opportunities: any[];
  correspondences: any[];
  /** Only the tasks this reader may see (subscribeVisibleTasks) — private stays private. */
  tasks?: any[];
  contracts?: any[];
  projectUpdates?: any[];
  followUps?: any[];
  /** Outlook mail from the local bridge (Inbox + Sent Items), when it is running. */
  mails?: any[];
  /** uid → display name, for "who entered this letter". */
  userNames?: Record<string, string>;
}

// ── The client list ──────────────────────────────────────────────────────────

export interface ClientSummary {
  key: string;
  /** The spelling used most often on the boards. */
  name: string;
  /** Every other spelling that was merged into this client. */
  otherNames: string[];
  projects: number;
  activeProjects: number;
  openBids: number;
  bids: number;
  letters: number;
  /** yyyy-mm-dd of the newest thing on file, or ''. */
  lastActivity: string;
}

const PROJECT_OPEN = (s?: string) => !s || s === 'Active' || s === 'On Hold';
const BID_CLOSED = ['Won', 'Lost', 'No Bid', 'Cancelled'];
const BID_OPEN = (s?: string) => !BID_CLOSED.includes(s || 'Identified');
/** Stages where the next move is still ours — after Submitted we wait on the client. */
const BID_OURS = ['Identified', 'Prequalification', 'Bid Preparation'];

/** Which client each project / bid belongs to, and the letters naming each one. */
export function listClients(input: Pick<ClientInput, 'projects' | 'opportunities' | 'correspondences'>): ClientSummary[] {
  const byKey = new Map<string, ClientSummary & { spellings: Map<string, number> }>();
  const touch = (raw: string | undefined, day: string) => {
    const key = clientKey(raw);
    if (!key) return null;
    let c = byKey.get(key);
    if (!c) {
      c = { key, name: '', otherNames: [], projects: 0, activeProjects: 0, openBids: 0, bids: 0, letters: 0, lastActivity: '', spellings: new Map() };
      byKey.set(key, c);
    }
    const spelling = String(raw).trim();
    c.spellings.set(spelling, (c.spellings.get(spelling) || 0) + 1);
    if (day > c.lastActivity) c.lastActivity = day;
    return c;
  };

  const projectClient = new Map<string, string>();
  for (const p of input.projects) {
    const c = touch(p.client, dayOf(p.lastUpdateAt) || dayOf(p.updatedAt) || dayOf(p.createdAt));
    if (!c) continue;
    projectClient.set(p.id, c.key);
    c.projects++;
    if (PROJECT_OPEN(p.status)) c.activeProjects++;
  }
  const bidClient = new Map<string, string>();
  for (const o of input.opportunities) {
    const c = touch(o.client, dayOf(o.lastFollowUpAt) || dayOf(o.updatedAt) || dayOf(o.createdAt));
    if (!c) continue;
    bidClient.set(o.id, c.key);
    c.bids++;
    if (BID_OPEN(o.stage)) c.openBids++;
  }
  const keys = [...byKey.keys()];
  for (const l of input.correspondences) {
    const owner = letterClientKeys(l, keys, projectClient, bidClient);
    const day = dayOf(l.dateReceived) || dayOf(l.createdAt);
    for (const k of owner) {
      const c = byKey.get(k)!;
      c.letters++;
      if (day > c.lastActivity) c.lastActivity = day;
    }
  }

  return [...byKey.values()].map(({ spellings, ...c }) => {
    const ranked = [...spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { ...c, name: ranked[0][0], otherNames: ranked.slice(1).map(r => r[0]) };
  }).sort((a, b) => b.lastActivity.localeCompare(a.lastActivity) || a.name.localeCompare(b.name));
}

/** A letter is on a client's file when it is linked to their project / bid, or they sent it. */
function letterClientKeys(l: any, keys: string[], projectClient: Map<string, string>, bidClient: Map<string, string>): string[] {
  const out = new Set<string>();
  if (l.projectId && projectClient.has(l.projectId)) out.add(projectClient.get(l.projectId)!);
  if (l.opportunityId && bidClient.has(l.opportunityId)) out.add(bidClient.get(l.opportunityId)!);
  if (l.sentFrom) {
    // The longest name wins: a letter from "AGIBA Meleiha" is not also AGIBA's
    // when both are clients.
    const named = keys.filter(k => textNamesClient(l.sentFrom, k)).sort((a, b) => b.length - a.length);
    if (named.length) out.add(named[0]);
  }
  return [...out];
}

// ── One client's file ────────────────────────────────────────────────────────

export type OwedKind = 'letter' | 'task' | 'bid' | 'step';
export type RecordKind = 'task' | 'corresponding' | 'opportunity' | 'project';

export interface OwedItem {
  kind: OwedKind;
  /** The record a click opens. */
  open: { type: RecordKind; id: string; serial?: string; label: string };
  title: string;
  /** The bid / project it belongs to, when that is not the record itself. */
  context?: string;
  owner?: string;
  /** yyyy-mm-dd, or '' when nobody set a date. */
  due: string;
  late: boolean;
  /** Whole days past the date (late) or left until it (not late); null without a date. */
  days: number | null;
}

export type ContactVia = 'letter' | 'mail-in' | 'mail-out' | 'bid-follow-up' | 'project-update';

export interface ContactEvent {
  via: ContactVia;
  at: number;
  /** Our person — who handled it. Undefined for mail read off this PC's mailbox. */
  who?: string;
  /** Their person, for an e-mail. */
  them?: string;
  what: string;
  open?: { type: RecordKind; id: string; serial?: string; label: string };
}

export interface ContractRow {
  id: string;
  projectId: string;
  projectName: string;
  number?: string;
  subject?: string;
  type?: string;
  value?: number | string;
  currency?: string;
  start?: string;
  end?: string;
  status?: string;
  inCharge?: string;
  /** 'ended' = end date passed; 'soon' = ends within CONTRACT_WARN_DAYS. */
  expiry?: 'ended' | 'soon';
  daysLeft: number | null;
}

export interface ClientFile {
  key: string;
  name: string;
  otherNames: string[];
  owed: OwedItem[];
  contacts: ContactEvent[];
  /** Our people on this client, most involved first. */
  people: { name: string; count: number }[];
  projects: any[];
  contracts: ContractRow[];
  openBids: any[];
  closedBids: any[];
  record: { won: number; lost: number; noBid: number; cancelled: number };
  letters: any[];
  mails: any[];
}

/** A step due further out than this is not "owed" yet — a bid has 11 of them. */
export const STEP_HORIZON_DAYS = 14;
/** A contract ending within this many days is flagged. */
export const CONTRACT_WARN_DAYS = 60;

const CLOSED_CONTRACT = /\b(closed|completed|cancel+ed|terminated|finished)\b|منته|مغلق|ملغ/i;

export function buildClientFile(key: string, input: ClientInput, today: Date = new Date()): ClientFile {
  const todayIso = iso(today);
  const names = input.userNames || {};
  const all = listClients(input);
  const summary = all.find(c => c.key === key);

  const projects = input.projects.filter(p => clientKey(p.client) === key);
  const bids = input.opportunities.filter(o => clientKey(o.client) === key);
  const projectIds = new Set(projects.map(p => p.id));
  const bidIds = new Set(bids.map(o => o.id));

  // Letters — the same test the list uses, so the two counts always agree.
  const keys = all.map(c => c.key);
  const projectClient = new Map(input.projects.filter(p => clientKey(p.client)).map(p => [p.id, clientKey(p.client)] as [string, string]));
  const bidClient = new Map(input.opportunities.filter(o => clientKey(o.client)).map(o => [o.id, clientKey(o.client)] as [string, string]));
  const letters = input.correspondences
    .filter(l => letterClientKeys(l, keys, projectClient, bidClient).includes(key))
    .sort((a, b) => (toMs(b.dateReceived) || toMs(b.createdAt)) - (toMs(a.dateReceived) || toMs(a.createdAt)));
  const letterIds = new Set(letters.map(l => l.id));

  const tasks = (input.tasks || []).filter(t =>
    (t.projectId && projectIds.has(t.projectId)) ||
    (t.opportunityId && bidIds.has(t.opportunityId)) ||
    (t.correspondingId && letterIds.has(t.correspondingId)));

  const mails = (input.mails || [])
    .filter(m => textNamesClient(m.sender, key) || textNamesClient(m.sender_email?.split('@')[1]?.split('.')[0], key) ||
      textNamesClient(m.to, key) || textNamesClient(m.subject, key))
    .sort((a, b) => toMs(b.received_at) - toMs(a.received_at));

  // ── What we owe them ──
  const owed: OwedItem[] = [];
  const add = (item: Omit<OwedItem, 'late' | 'days'>) => {
    const due = item.due || '';
    const late = !!due && due < todayIso;
    owed.push({ ...item, due, late, days: due ? Math.abs(daysBetween(todayIso, due)) : null });
  };
  for (const l of letters) {
    if (l.status === 'Closed') continue;
    add({
      kind: 'letter', title: l.subject || '—', owner: l.assignedTo, due: dayOf(l.deadline),
      open: { type: 'corresponding', id: l.id, serial: l.serialNumber, label: l.subject || '' },
    });
  }
  for (const t of tasks) {
    if (t.status === 'Done' || t.status === 'Archived') continue;
    add({
      kind: 'task', title: t.taskName || '—', owner: t.assignedTo, due: dayOf(t.dueDate),
      context: t.opportunityTitle || t.projectName || t.correspondingSubject,
      open: { type: 'task', id: t.id, serial: t.serialNumber, label: t.taskName || '' },
    });
  }
  for (const o of bids) {
    if (!BID_OURS.includes(o.stage || 'Identified')) continue;
    const ref = { type: 'opportunity' as const, id: o.id, serial: o.serialNumber, label: o.title || '' };
    add({ kind: 'bid', title: o.title || '—', owner: o.ownerName, due: dayOf(o.submissionDeadline), open: ref });
    for (const s of o.checklist || []) owedStep(s, o.title, ref);
  }
  for (const p of projects) {
    if (!PROJECT_OPEN(p.status)) continue;
    const ref = { type: 'project' as const, id: p.id, serial: p.serialNumber, label: p.name || '' };
    for (const s of p.checklist || []) owedStep(s, p.name, ref);
  }
  function owedStep(s: any, context: string | undefined, ref: OwedItem['open']) {
    if (s.done || !s.dueDate) return;
    if (daysBetween(todayIso, s.dueDate) > STEP_HORIZON_DAYS) return;
    add({ kind: 'step', title: s.title || '—', context, due: s.dueDate, open: ref });
  }
  // Late first (longest late at the top), then soonest, then undated.
  owed.sort((a, b) => {
    if (a.late !== b.late) return a.late ? -1 : 1;
    if (!a.due !== !b.due) return a.due ? -1 : 1;
    return a.due.localeCompare(b.due) || a.title.localeCompare(b.title);
  });

  // ── Who spoke to them ──
  const contacts: ContactEvent[] = [];
  for (const l of letters) {
    contacts.push({
      via: 'letter', at: toMs(l.dateReceived) || toMs(l.createdAt),
      who: l.assignedTo || names[l.userId], what: l.subject || '',
      open: { type: 'corresponding', id: l.id, serial: l.serialNumber, label: l.subject || '' },
    });
  }
  for (const f of input.followUps || []) {
    if (!bidIds.has(f.opportunityId)) continue;
    const o = bids.find(b => b.id === f.opportunityId);
    contacts.push({
      via: 'bid-follow-up', at: toMs(f.createdAt), who: f.authorName, what: f.text || '',
      open: { type: 'opportunity', id: o.id, serial: o.serialNumber, label: o.title || '' },
    });
  }
  for (const u of input.projectUpdates || []) {
    if (!projectIds.has(u.projectId)) continue;
    const p = projects.find(x => x.id === u.projectId);
    contacts.push({
      via: 'project-update', at: toMs(u.createdAt), who: u.authorName, what: u.text || '',
      open: { type: 'project', id: p.id, serial: p.serialNumber, label: p.name || '' },
    });
  }
  for (const m of mails) {
    const out = m.direction === 'sent';
    contacts.push({
      via: out ? 'mail-out' : 'mail-in', at: toMs(m.received_at),
      them: out ? m.to : m.sender, what: m.subject || '',
    });
  }
  contacts.sort((a, b) => b.at - a.at);

  // ── Contracts ──
  const projectName = new Map(projects.map(p => [p.id, p.name || '']));
  const contracts: ContractRow[] = (input.contracts || [])
    .filter(c => projectIds.has(c.projectId))
    .map(c => {
      const end = dayOf(c.endDate) || undefined;
      const closed = CLOSED_CONTRACT.test(String(c.status || ''));
      const left = end ? daysBetween(todayIso, end) : null;
      const expiry = !end || closed ? undefined
        : left! < 0 ? 'ended' as const
          : left! <= CONTRACT_WARN_DAYS ? 'soon' as const : undefined;
      return {
        id: c.id, projectId: c.projectId, projectName: projectName.get(c.projectId) || '',
        number: c.contractNumber, subject: c.subject, type: c.type,
        value: c.valueAfterIncrease || c.contractValue, currency: c.currency,
        start: dayOf(c.startDate) || undefined, end, status: c.status, inCharge: c.inCharge,
        expiry, daysLeft: left,
      };
    })
    // Running out first, then by end date (latest first), undated last.
    .sort((a, b) => {
      const rank = (r: ContractRow) => (r.expiry === 'soon' ? 0 : r.expiry === 'ended' ? 2 : 1);
      return rank(a) - rank(b) || (b.end || '').localeCompare(a.end || '');
    });
  // ── Our people on this client ──
  const tally = new Map<string, number>();
  const count = (n?: string) => { const v = (n || '').trim(); if (v) tally.set(v, (tally.get(v) || 0) + 1); };
  bids.forEach(o => count(o.ownerName));
  letters.forEach(l => count(l.assignedTo));
  tasks.forEach(t => count(t.assignedTo));
  (input.followUps || []).filter(f => bidIds.has(f.opportunityId)).forEach(f => count(f.authorName));
  (input.projectUpdates || []).filter(u => projectIds.has(u.projectId)).forEach(u => count(u.authorName));
  contracts.forEach(c => count(c.inCharge));
  const people = [...tally.entries()]
    .map(([name, n]) => ({ name, count: n }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));


  const openBids = bids.filter(o => BID_OPEN(o.stage))
    .sort((a, b) => (dayOf(a.submissionDeadline) || '9999').localeCompare(dayOf(b.submissionDeadline) || '9999'));
  const closedBids = bids.filter(o => !BID_OPEN(o.stage))
    .sort((a, b) => (dayOf(b.decisionDate) || dayOf(b.updatedAt)).localeCompare(dayOf(a.decisionDate) || dayOf(a.updatedAt)));
  const record = {
    won: bids.filter(o => o.stage === 'Won').length,
    lost: bids.filter(o => o.stage === 'Lost').length,
    noBid: bids.filter(o => o.stage === 'No Bid').length,
    cancelled: bids.filter(o => o.stage === 'Cancelled').length,
  };

  const sortedProjects = [...projects].sort((a, b) =>
    Number(PROJECT_OPEN(b.status)) - Number(PROJECT_OPEN(a.status)) ||
    String(a.name || '').localeCompare(String(b.name || '')));


  return {
    key,
    name: summary?.name || key,
    otherNames: summary?.otherNames || [],
    owed, contacts, people,
    projects: sortedProjects, contracts, openBids, closedBids, record,
    letters, mails,
  };
}
