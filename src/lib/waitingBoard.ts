/**
 * "Waiting on us / waiting on them" (queue task D2).
 *
 * Pure logic behind the Waiting board: every open piece of work sorted into the
 * side whose move it is, with how long it has been waiting, in days —
 *
 *   ON US   · an open letter nobody has closed (age from the day it arrived)
 *           · an open task (age from the day it was created)
 *           · a bid still before Submitted (age from the day it was entered,
 *             with the submission deadline beside it)
 *           · an Outlook chain where THEY wrote last (from the local helper)
 *   ON THEM · a bid we submitted and the client has not decided (age from the
 *             submission date)
 *           · a task or letter someone marked "waiting on them" (age from the
 *             day it was marked — `waitingSince`)
 *           · an Outlook chain where WE wrote last and nothing came back
 *
 * The only thing ever written is the "waiting on them" mark on a task or a
 * letter (`waitingPatch`) — the board has no other way to know that the ball is
 * in someone else's court. Everything else is derived at render (settled rule 3)
 * so the board can never contradict the records it reads. Plain shapes, not the
 * Firestore types, so `scripts/harness/waitingboard.mjs` can feed fixtures.
 */

// ── Dates ────────────────────────────────────────────────────────────────────

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Timestamp / Date / ISO string / ms → ms since epoch, or 0. A bare yyyy-mm-dd is local noon. */
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

/** Whole calendar days from `fromDay` to `toDay` (both yyyy-mm-dd). */
const daysBetween = (fromDay: string, toDay: string) =>
  Math.round((toMs(toDay) - toMs(fromDay)) / 86_400_000);

// ── Ageing ───────────────────────────────────────────────────────────────────

/** From this many days an item is shown amber… */
export const AGE_WARN_DAYS = 7;
/** …and from this many, red. */
export const AGE_ALERT_DAYS = 14;

export type AgeBand = 'fresh' | 'warn' | 'alert';

export const ageBand = (days: number | null): AgeBand =>
  days === null ? 'fresh' : days >= AGE_ALERT_DAYS ? 'alert' : days >= AGE_WARN_DAYS ? 'warn' : 'fresh';

// ── Shapes ───────────────────────────────────────────────────────────────────

export type Side = 'us' | 'them';
export type WaitKind = 'letter' | 'task' | 'bid' | 'mail';
export type RecordKind = 'task' | 'corresponding' | 'opportunity';

/**
 * Why the item sits on its side — drives the one-line reason under it, and is
 * the only thing the UI branches on.
 */
export type WaitReason =
  | 'letter-open'       // a letter came in and is not closed
  | 'task-open'         // a task is open
  | 'bid-prepare'       // a bid before Submitted
  | 'mail-unanswered'   // Outlook: they wrote last
  | 'bid-decision'      // submitted, the client has not decided
  | 'marked'            // someone marked it "waiting on them"
  | 'mail-no-reply';    // Outlook: we wrote last

export interface WaitItem {
  side: Side;
  kind: WaitKind;
  reason: WaitReason;
  /** Stable key for React and the harness. */
  key: string;
  title: string;
  serial?: string;
  /** Who on our side holds it (display name). */
  owner?: string;
  /** uids that make it "mine" for the Mine filter. */
  ownerIds: string[];
  /** Who we are waiting on, when known (a client, a sender, a typed name). */
  party?: string;
  /** yyyy-mm-dd the wait started, '' when unknown. */
  since: string;
  /** Whole days waited; null when `since` is unknown. */
  days: number | null;
  band: AgeBand;
  /** A date that matters on top of the age: a deadline or due date. */
  due?: string;
  late?: boolean;
  /** The record a click opens; absent for Outlook mail. */
  open?: { type: RecordKind; id: string; serial?: string; label: string };
  /** Only tasks and letters can be moved between the sides by hand. */
  movable: boolean;
}

export interface WaitInput {
  /** Only the tasks this reader may see (subscribeVisibleTasks) — private stays private. */
  tasks: any[];
  correspondences: any[];
  opportunities: any[];
  /** Outlook chains from `groupThreads` when the local helper runs; plain objects are fine. */
  threads?: any[];
  /** uid → display name, for the owner of a letter nobody was assigned. */
  userNames?: Record<string, string>;
}

// ── Classification ───────────────────────────────────────────────────────────

const TASK_CLOSED = ['Done', 'Archived'];
const BID_OURS = ['Identified', 'Prequalification', 'Bid Preparation'];
const BID_THEIRS = ['Submitted', 'Under Evaluation'];

/**
 * Is this task / letter marked as waiting on the other side? The new
 * `waitingOn` field decides; an older task whose status note already says
 * "Waiting on Third Party" counts as well, so data typed before this board
 * existed lands on the right side.
 */
export function isMarkedThem(r: any): boolean {
  if (r?.waitingOn === 'them') return true;
  if (r?.waitingOn === 'us') return false;
  return r?.statusUpdate === 'Waiting on Third Party';
}

/**
 * The write that moves a task or letter across. Going to "them" stamps the day
 * (the age restarts there — that is the wait that matters now) and who we are
 * waiting on; coming back clears both. `updatedAt` is added by the caller.
 */
export function waitingPatch(side: Side, party?: string, today: Date = new Date()): Record<string, unknown> {
  if (side === 'them') {
    return { waitingOn: 'them', waitingSince: iso(today), waitingFor: (party || '').trim() };
  }
  return { waitingOn: 'us', waitingSince: '', waitingFor: '' };
}

/** Who may move a letter: the person who logged it, or a manager (firestore.rules). */
export const canMoveLetter = (l: any, uid: string, isManager: boolean) =>
  isManager || l?.userId === uid;

/** Who may move a task: owner, collaborator, or — on a public task — a manager or the assigner (firestore.rules). */
export const canMoveTask = (t: any, uid: string, isManager: boolean) =>
  t?.assignedToId === uid ||
  (t?.collaboratorIds || []).includes(uid) ||
  (!t?.isPrivate && (isManager || t?.assignedById === uid));

export function buildWaitingBoard(input: WaitInput, today: Date = new Date()): { us: WaitItem[]; them: WaitItem[] } {
  const todayIso = iso(today);
  const names = input.userNames || {};
  const items: WaitItem[] = [];

  const push = (it: Omit<WaitItem, 'days' | 'band' | 'late'> & { due?: string }) => {
    const days = it.since ? Math.max(0, daysBetween(it.since, todayIso)) : null;
    const due = it.due || undefined;
    items.push({ ...it, due, late: !!due && due < todayIso, days, band: ageBand(days) });
  };

  for (const l of input.correspondences) {
    if (!l || l.id === '--stats--' || l.status === 'Closed') continue;
    const them = isMarkedThem(l);
    push({
      side: them ? 'them' : 'us',
      kind: 'letter',
      reason: them ? 'marked' : 'letter-open',
      key: `letter:${l.id}`,
      title: l.subject || '—',
      serial: l.serialNumber,
      owner: l.assignedTo || names[l.userId],
      ownerIds: [l.assignedToId, l.userId].filter(Boolean),
      party: them ? (l.waitingFor || l.sentFrom || undefined) : (l.sentFrom || undefined),
      since: them ? (dayOf(l.waitingSince) || dayOf(l.updatedAt)) : (dayOf(l.dateReceived) || dayOf(l.createdAt)),
      due: dayOf(l.deadline) || undefined,
      open: { type: 'corresponding', id: l.id, serial: l.serialNumber, label: l.subject || '' },
      movable: true,
    });
  }

  for (const t of input.tasks) {
    if (!t || t.id === '--stats--' || TASK_CLOSED.includes(t.status)) continue;
    const them = isMarkedThem(t);
    push({
      side: them ? 'them' : 'us',
      kind: 'task',
      reason: them ? 'marked' : 'task-open',
      key: `task:${t.id}`,
      title: t.taskName || '—',
      serial: t.serialNumber,
      owner: t.assignedTo,
      ownerIds: [t.assignedToId, ...(t.collaboratorIds || [])].filter(Boolean),
      party: them ? (t.waitingFor || undefined) : undefined,
      since: them ? (dayOf(t.waitingSince) || dayOf(t.updatedAt)) : dayOf(t.createdAt),
      due: dayOf(t.dueDate) || undefined,
      open: { type: 'task', id: t.id, serial: t.serialNumber, label: t.taskName || '' },
      movable: true,
    });
  }

  for (const o of input.opportunities) {
    if (!o || o.id === '--stats--') continue;
    const stage = o.stage || 'Identified';
    const ours = BID_OURS.includes(stage);
    const theirs = BID_THEIRS.includes(stage);
    if (!ours && !theirs) continue;
    const ref = { type: 'opportunity' as const, id: o.id, serial: o.serialNumber, label: o.title || '' };
    push({
      side: ours ? 'us' : 'them',
      kind: 'bid',
      reason: ours ? 'bid-prepare' : 'bid-decision',
      key: `bid:${o.id}`,
      title: o.title || '—',
      serial: o.serialNumber,
      owner: o.ownerName,
      ownerIds: [o.ownerId, ...(o.collaboratorIds || [])].filter(Boolean),
      party: o.client || undefined,
      // A submitted bid waits from the day it went in; without that date the
      // last time anyone touched it is the honest fallback.
      since: ours
        ? (dayOf(o.announcedDate) || dayOf(o.createdAt))
        : (dayOf(o.submittedDate) || dayOf(o.updatedAt)),
      // Ours: the submission deadline is the date that can be missed. Theirs:
      // the decision date, when someone typed the one the client promised.
      due: ours ? (dayOf(o.submissionDeadline) || undefined) : (dayOf(o.decisionDate) || undefined),
      open: ref,
      movable: false,
    });
  }

  for (const th of input.threads || []) {
    // Only once the Outlook Feed would flag it too (2 / 4 working days) — a
    // mail that came in this morning is not "waiting" yet.
    const us = !!th?.awaitingReply && !!th?.overdue;
    const them = !!th?.awaitingTheirReply && !!th?.theirOverdue;
    if (!us && !them) continue;
    const at = us ? th.lastIncoming?.received_at : th.lastOutgoing?.received_at;
    push({
      side: us ? 'us' : 'them',
      kind: 'mail',
      reason: us ? 'mail-unanswered' : 'mail-no-reply',
      key: `mail:${th.key}`,
      title: th.title || '—',
      // Outlook on this PC is this reader's own mailbox.
      owner: undefined,
      ownerIds: ['__me__'],
      party: th.counterparty || undefined,
      since: dayOf(at || th.last?.received_at),
      movable: false,
    });
  }

  const order = (a: WaitItem, b: WaitItem) =>
    // Longest wait first; unknown ages last; then a late date; then the title.
    (b.days ?? -1) - (a.days ?? -1) ||
    Number(!!b.late) - Number(!!a.late) ||
    a.title.localeCompare(b.title);

  return {
    us: items.filter(i => i.side === 'us').sort(order),
    them: items.filter(i => i.side === 'them').sort(order),
  };
}

// ── Filters ──────────────────────────────────────────────────────────────────

/** Mine = I own it, co-own it, logged the letter, or it is my own Outlook. */
export const isMine = (it: WaitItem, uid: string) =>
  it.ownerIds.includes(uid) || it.ownerIds.includes('__me__');

export type KindFilter = 'all' | WaitKind;

export function filterItems(list: WaitItem[], opts: { uid: string; mineOnly: boolean; kind: KindFilter; person?: string }): WaitItem[] {
  return list.filter(it =>
    (!opts.mineOnly || isMine(it, opts.uid)) &&
    (opts.kind === 'all' || it.kind === opts.kind) &&
    (!opts.person || it.owner === opts.person));
}

/** Totals for the header: how many, how many old (≥ AGE_WARN_DAYS), the oldest. */
export function sideSummary(list: WaitItem[]) {
  const aged = list.filter(i => i.days !== null && i.days >= AGE_WARN_DAYS).length;
  const oldest = list.reduce((m, i) => Math.max(m, i.days ?? 0), 0);
  return { count: list.length, aged, oldest };
}
