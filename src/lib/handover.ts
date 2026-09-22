/**
 * Handover file (queue task D7).
 *
 * Pure logic behind the Handover page: everything still open in one person's
 * name, and the writes that move it to someone else —
 *
 *   TASKS      · open (not Done / Archived) where they are the owner or a
 *                collaborator
 *   LETTERS    · not Closed and assigned to them
 *   BIDS       · still live (before a decision) where they own or co-own it
 *   CONTRACTS  · project contract lines whose "in charge" name is theirs —
 *                `inCharge` is typed text, not a uid, so it is matched by name
 *                (`sameName`) and only while the contract and its project are
 *                still running
 *
 * Nothing here reads Firestore; plain shapes in, plain patches out, so
 * `scripts/harness/handover.mjs` can feed fixtures. Tasks must come from
 * `subscribeVisibleTasks` — a private task stays with the only person who may
 * see it.
 */

import { CLOSED_CONTRACT } from './deadlineCalendar';

// ── Dates ────────────────────────────────────────────────────────────────────

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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

/** Anything date-like → yyyy-mm-dd (local), or ''. */
export function dayOf(v: unknown): string {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const ms = toMs(v);
  return ms ? iso(new Date(ms)) : '';
}

/** A contract that ended longer ago than this is old data, not open work. */
export const ENDED_GRACE_DAYS = 90;

// ── Names ────────────────────────────────────────────────────────────────────

/** Titles people type in front of a name, in both languages. */
const TITLES = new Set(['eng', 'engineer', 'mr', 'mrs', 'ms', 'dr', 'م', 'د', 'مهندس', 'المهندس', 'مهندسة', 'المهندسة', 'أ', 'ا', 'الأستاذ', 'الاستاذ', 'استاذ', 'أستاذ']);

/** Lower-case, no harakat/tatweel, one alef/yaa/taa-marbuta form, no titles, single spaces. */
export function normName(s: string | undefined | null): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(w => w && !TITLES.has(w))
    .join(' ');
}

/**
 * Is a typed "in charge" name the same person as a user's display name?
 * Equal after `normName`, or — when the shorter one has at least two words —
 * the shorter one appears whole, in order, inside the longer ("Ahmed Ali" in
 * "Ahmed Ali Hassan"). One word alone ("Ahmed") never matches a longer name:
 * a department has too many Ahmeds.
 */
export function sameName(a: string | undefined | null, b: string | undefined | null): boolean {
  const x = normName(a), y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.split(' ').length < 2) return false;
  return (` ${long} `).includes(` ${short} `);
}

// ── Shapes ───────────────────────────────────────────────────────────────────

export type HandKind = 'task' | 'letter' | 'bid' | 'contract';
/** How the item is in their name — drives the "co-owner" chip and the write. */
export type HandRole = 'owner' | 'collaborator' | 'in-charge';

export interface Person { id: string; name: string; }

export interface HandItem {
  /** Stable key for React and the harness. */
  key: string;
  kind: HandKind;
  role: HandRole;
  /** The Firestore doc id (tasks / correspondences / opportunities / projectContracts). */
  id: string;
  title: string;
  serial?: string;
  /** Status / stage, as stored (English enum — translated at display). */
  status?: string;
  /** The client, the sender of a letter, or the contract's company. */
  party?: string;
  /** Project name, for a contract line. */
  project?: string;
  projectId?: string;
  /** The date that matters: task due, letter reply-by, tender deadline / decision date, contract end. */
  due?: string;
  late: boolean;
  /** The last thing written about it, so the next person knows where it stands. */
  lastNote?: string;
}

export interface HandoverInput {
  /** Only the tasks this reader may see (subscribeVisibleTasks). */
  tasks: any[];
  correspondences: any[];
  opportunities: any[];
  contracts: any[];
  projects: any[];
}

export const KIND_ORDER: HandKind[] = ['task', 'letter', 'bid', 'contract'];

const TASK_CLOSED = ['Done', 'Archived'];
/** Stages where a bid still needs someone to carry it. */
export const BID_OPEN = ['Identified', 'Prequalification', 'Bid Preparation', 'Submitted', 'Under Evaluation'];
const BID_BEFORE_SUBMIT = ['Identified', 'Prequalification', 'Bid Preparation'];
const PROJECT_DONE = ['Completed', 'Cancelled'];

const lastTaskNote = (t: any): string | undefined => {
  const notes = Array.isArray(t.notes) ? t.notes.filter((n: any) => n?.text) : [];
  const note = notes.length ? notes[notes.length - 1].text : '';
  return (t.statusUpdate || note || '').trim() || undefined;
};

// ── Building the file ────────────────────────────────────────────────────────

/** Everything open in `person`'s name, grouped by kind, latest-due first within each. */
export function buildHandover(input: HandoverInput, person: Person, today: Date = new Date()): HandItem[] {
  const todayIso = iso(today);
  const graceIso = iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - ENDED_GRACE_DAYS));
  const items: HandItem[] = [];
  const add = (it: Omit<HandItem, 'late'>) =>
    items.push({ ...it, due: it.due || undefined, late: !!it.due && it.due < todayIso });

  for (const t of input.tasks) {
    if (!t || t.id === '--stats--' || TASK_CLOSED.includes(t.status)) continue;
    const role: HandRole | null = t.assignedToId === person.id ? 'owner'
      : (t.collaboratorIds || []).includes(person.id) ? 'collaborator' : null;
    if (!role) continue;
    add({
      key: `task:${t.id}`, kind: 'task', role, id: t.id,
      title: t.taskName || '—', serial: t.serialNumber, status: t.status,
      party: t.opportunityTitle || t.projectName || t.correspondingSubject || undefined,
      due: dayOf(t.dueDate), lastNote: lastTaskNote(t),
    });
  }

  for (const l of input.correspondences) {
    if (!l || l.id === '--stats--' || l.status === 'Closed' || l.assignedToId !== person.id) continue;
    add({
      key: `letter:${l.id}`, kind: 'letter', role: 'owner', id: l.id,
      title: l.subject || '—', serial: l.serialNumber, status: l.status,
      party: l.sentFrom || undefined, due: dayOf(l.deadline),
      lastNote: (l.actions || '').trim() || undefined,
    });
  }

  for (const o of input.opportunities) {
    if (!o || o.id === '--stats--' || !BID_OPEN.includes(o.stage || 'Identified')) continue;
    const role: HandRole | null = o.ownerId === person.id ? 'owner'
      : (o.collaboratorIds || []).includes(person.id) ? 'collaborator' : null;
    if (!role) continue;
    const before = BID_BEFORE_SUBMIT.includes(o.stage || 'Identified');
    add({
      key: `bid:${o.id}`, kind: 'bid', role, id: o.id,
      title: o.title || '—', serial: o.serialNumber, status: o.stage || 'Identified',
      party: o.client || undefined,
      due: before ? dayOf(o.submissionDeadline) : dayOf(o.decisionDate),
      lastNote: (o.lastFollowUpText || '').trim() || undefined,
    });
  }

  const projects = new Map(input.projects.filter(p => p && p.id !== '--stats--').map(p => [p.id, p]));
  for (const c of input.contracts) {
    if (!c || !sameName(c.inCharge, person.name)) continue;
    if (CLOSED_CONTRACT.test(String(c.status || ''))) continue;
    const p = projects.get(c.projectId);
    if (!p || PROJECT_DONE.includes(p.status)) continue;
    const end = dayOf(c.endDate);
    if (end && end < graceIso) continue;
    add({
      key: `contract:${c.id}`, kind: 'contract', role: 'in-charge', id: c.id,
      title: c.subject || c.contractNumber || '—', serial: c.contractNumber || undefined,
      status: c.status || undefined, party: c.companyName || p.client || undefined,
      project: p.name, projectId: p.id, due: end,
      lastNote: (c.remarks || '').trim() || undefined,
    });
  }

  // Late first, then the nearest date, then undated, then by title.
  const order = (a: HandItem, b: HandItem) =>
    KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
    Number(b.late) - Number(a.late) ||
    (a.due ? 0 : 1) - (b.due ? 0 : 1) ||
    (a.due || '').localeCompare(b.due || '') ||
    a.title.localeCompare(b.title);
  return items.sort(order);
}

/** Header numbers: per kind, late, and how many are held as co-owner. */
export function handoverSummary(items: HandItem[]) {
  const byKind: Record<HandKind, number> = { task: 0, letter: 0, bid: 0, contract: 0 };
  for (const i of items) byKind[i.kind]++;
  return {
    total: items.length,
    byKind,
    late: items.filter(i => i.late).length,
    shared: items.filter(i => i.role === 'collaborator').length,
  };
}

// ── Who may move what (mirrors firestore.rules) ──────────────────────────────

/**
 * Tasks: owner, collaborator, or — on a public task — a manager or the
 * assigner. Letters: the person who logged it, or a manager. Bids and project
 * contracts: any approved member (shared board).
 */
export function canHandOver(item: HandItem, record: any, uid: string, isManager: boolean): boolean {
  if (!record) return false;
  switch (item.kind) {
    case 'task':
      return record.assignedToId === uid ||
        (record.collaboratorIds || []).includes(uid) ||
        (!record.isPrivate && (isManager || record.assignedById === uid));
    case 'letter':
      return isManager || record.userId === uid;
    case 'bid':
    case 'contract':
      return true;
  }
}

// ── The writes ───────────────────────────────────────────────────────────────

export interface HandWrite {
  collection: 'tasks' | 'correspondences' | 'opportunities' | 'projectContracts';
  id: string;
  data: Record<string, unknown>;
}

/** Swap `from` for `to` in a co-owner list; `to` is dropped if they already own it. */
function swapCollaborator(ids: string[], fromId: string, toId: string, ownerId: string | undefined): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const next = id === fromId ? toId : id;
    if (next && next !== ownerId && !out.includes(next)) out.push(next);
  }
  return out;
}

/**
 * The Firestore writes that move one item from `from` to `to` (`updatedAt` is
 * added by the caller). A letter's linked task follows the letter when it is
 * still open and still with the same person — the Correspondences board does
 * the same on a reassign. `names` resolves uids to display names for the
 * denormalised `collaborators` list on tasks.
 */
export function handoverWrites(
  item: HandItem,
  record: any,
  from: Person,
  to: Person,
  names: Record<string, string>,
  linkedTask?: any,
): HandWrite[] {
  if (!record || !to.id || to.id === from.id) return [];
  const nameOf = (id: string) => names[id] || (id === to.id ? to.name : '');

  const taskOwnerMove = (t: any): Record<string, unknown> => {
    const collab = (t.collaboratorIds || []).filter((id: string) => id !== to.id);
    return {
      assignedToId: to.id,
      assignedTo: to.name,
      collaboratorIds: collab,
      collaborators: collab.map(nameOf),
    };
  };

  switch (item.kind) {
    case 'task': {
      if (item.role === 'owner') return [{ collection: 'tasks', id: record.id, data: taskOwnerMove(record) }];
      const collab = swapCollaborator(record.collaboratorIds || [], from.id, to.id, record.assignedToId);
      return [{ collection: 'tasks', id: record.id, data: { collaboratorIds: collab, collaborators: collab.map(nameOf) } }];
    }
    case 'letter': {
      const out: HandWrite[] = [{
        collection: 'correspondences', id: record.id,
        data: { assignedToId: to.id, assignedTo: to.name },
      }];
      const t = linkedTask;
      if (t && t.id === record.convertedToTaskId && t.assignedToId === from.id && !TASK_CLOSED.includes(t.status)) {
        out.push({ collection: 'tasks', id: t.id, data: taskOwnerMove(t) });
      }
      return out;
    }
    case 'bid': {
      if (item.role === 'owner') {
        return [{
          collection: 'opportunities', id: record.id,
          data: { ownerId: to.id, ownerName: to.name, collaboratorIds: (record.collaboratorIds || []).filter((id: string) => id !== to.id) },
        }];
      }
      return [{ collection: 'opportunities', id: record.id, data: { collaboratorIds: swapCollaborator(record.collaboratorIds || [], from.id, to.id, record.ownerId) } }];
    }
    case 'contract':
      return [{ collection: 'projectContracts', id: record.id, data: { inCharge: to.name } }];
  }
}

/** The notification type that deep-links the receiver to the record (lib/deepLink.ts stems). */
export const NOTIFY_TYPE: Record<HandKind, string> = {
  task: 'task_assigned',
  letter: 'corresponding_assigned',
  bid: 'opportunity_assigned',
  contract: 'handover_received',
};

// ── The note for the person taking over ──────────────────────────────────────

type T = (key: string, opts?: Record<string, unknown>) => string;

/**
 * A plain-text handover note — what is open, where each thing stands, what date
 * matters — to paste into an e-mail or print. `t` translates (the key is the
 * English sentence, as everywhere in the app); `fmtDate` formats yyyy-mm-dd.
 */
export function handoverNote(items: HandItem[], person: Person, t: T, fmtDate: (isoDay: string) => string, today: Date = new Date()): string {
  const s = handoverSummary(items);
  const heading: Record<HandKind, string> = { task: 'Tasks', letter: 'Letters', bid: 'Bids', contract: 'Contracts' };
  const lines: string[] = [
    t('Handover file — {{name}}', { name: person.name }),
    t('As of {{date}}', { date: fmtDate(iso(today)) }),
    t('Open items: {{count}}', { count: s.total }) + (s.late ? ` · ${t('{{count}} late', { count: s.late })}` : ''),
  ];
  for (const kind of KIND_ORDER) {
    const list = items.filter(i => i.kind === kind);
    if (!list.length) continue;
    lines.push('', `${t(heading[kind])} (${list.length})`);
    list.forEach((i, n) => {
      const head = [i.serial, i.title].filter(Boolean).join(' — ');
      const bits = [
        i.status ? t(i.status) : '',
        i.role === 'collaborator' ? t('Co-owner') : '',
        i.project ? t('Project: {{name}}', { name: i.project }) : '',
        i.party ? t('With: {{name}}', { name: i.party }) : '',
        i.due ? (i.late ? t('Was due {{date}}', { date: fmtDate(i.due) }) : t('Due {{date}}', { date: fmtDate(i.due) })) : '',
      ].filter(Boolean);
      lines.push(`${n + 1}. ${head}`);
      if (bits.length) lines.push(`   ${bits.join(' · ')}`);
      if (i.lastNote) lines.push(`   ${t('Where it stands: {{note}}', { note: i.lastNote.replace(/\s+/g, ' ').slice(0, 240) })}`);
    });
  }
  return lines.join('\n');
}
