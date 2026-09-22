/**
 * Deadline calendar (queue task D3).
 *
 * Pure logic behind the Calendar page: every dated commitment the department
 * has, on one month grid —
 *
 *   · a tender's submission deadline (bids still before Submitted)
 *   · the decision date a client promised (bids Submitted / Under Evaluation)
 *   · the end of a contract, work authorisation, agreement or amendment
 *   · the expiry of a sub-contract
 *   · the planned end of a running project
 *   · a task's due date and a letter's reply deadline
 *
 * …plus the "running out" watch: contracts and sub-contracts that end within
 * CONTRACT_WARN_DAYS, and the ones that already ENDED with nobody renewing or
 * closing them — the quiet expiry this task exists to catch.
 *
 * A contract counts as RENEWED when a later end date exists for it: an
 * amendment filed under it (`parentId`) or another row carrying the same
 * contract number that runs past it; a sub-contract when another row for the
 * same subcontractor on the same project does. Its status saying
 * renewed/extended counts as well. Nothing here is written — every date is
 * read off the records at render (settled rule 3). Plain shapes, not the
 * Firestore types, so `scripts/harness/deadlinecalendar.mjs` can feed fixtures.
 */

// ── Dates ────────────────────────────────────────────────────────────────────

export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Timestamp / Date / ISO string / ms → ms since epoch, or 0. A bare yyyy-mm-dd is local noon. */
function toMs(v: unknown): number {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const day = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
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
export const daysBetween = (fromDay: string, toDay: string) =>
  Math.round((toMs(toDay) - toMs(fromDay)) / 86_400_000);

/** yyyy-mm-dd → a local Date at noon (new Date('yyyy-mm-dd') would be UTC midnight). */
export const localDate = (isoDay: string) => {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};

// ── Windows ──────────────────────────────────────────────────────────────────

/** A contract ending within this many days goes on the "running out" watch (same as the client file). */
export const CONTRACT_WARN_DAYS = 60;
/** An ended, unrenewed, unclosed contract stays on the watch this long; older is stale data. */
export const ENDED_LOOKBACK_DAYS = 90;
/** A dated item this close is "soon" (amber). */
export const SOON_DAYS = 7;

// ── Shapes ───────────────────────────────────────────────────────────────────

export type DeadlineKind =
  | 'bid-deadline'     // submission deadline, bid before Submitted
  | 'bid-decision'     // decision date the client promised, bid submitted
  | 'contract-end'     // a contract / WA / agreement / amendment ends
  | 'subcontract-end'  // a sub-contract expires
  | 'project-end'      // a running project's planned end
  | 'task-due'
  | 'letter-due';

/** The filter chips on the page. */
export type DeadlineGroup = 'bid' | 'contract' | 'project' | 'task' | 'letter';

export const GROUP_OF: Record<DeadlineKind, DeadlineGroup> = {
  'bid-deadline': 'bid',
  'bid-decision': 'bid',
  'contract-end': 'contract',
  'subcontract-end': 'contract',
  'project-end': 'project',
  'task-due': 'task',
  'letter-due': 'letter',
};

export type DeadlineState = 'late' | 'today' | 'soon' | 'later';

export type OpenRef =
  | { type: 'task' | 'corresponding' | 'opportunity' | 'project'; id: string; serial?: string; label: string };

export interface DeadlineEvent {
  /** Stable key for React and the harness. */
  key: string;
  kind: DeadlineKind;
  group: DeadlineGroup;
  /** yyyy-mm-dd */
  date: string;
  title: string;
  serial?: string;
  /** The client, the project, or the subcontractor — whatever places it. */
  context?: string;
  /** Who holds it (display name), when known. */
  owner?: string;
  /** uids that make it "mine". */
  ownerIds: string[];
  /** Department-wide dates (contracts, projects) — shown to everyone, never filtered by Mine. */
  shared: boolean;
  /** Whole days from today; negative = passed. */
  daysLeft: number;
  state: DeadlineState;
  /** Contracts only: on the "running out" watch (≤ CONTRACT_WARN_DAYS, or ended unrenewed). */
  watch?: boolean;
  /** Contracts only: a later end date exists — the new end. */
  renewedTo?: string;
  /** What a click opens. */
  open?: OpenRef;
}

export interface DeadlineInput {
  /** Only the tasks this reader may see (subscribeVisibleTasks) — private stays private. */
  tasks?: any[];
  correspondences?: any[];
  opportunities?: any[];
  projects?: any[];
  /** projectContracts */
  contracts?: any[];
  /** projectSubcontracts */
  subcontracts?: any[];
}

// ── Classification ───────────────────────────────────────────────────────────

const TASK_CLOSED = ['Done', 'Archived'];
const BID_PREPARING = ['Identified', 'Prequalification', 'Bid Preparation'];
const BID_AWAITING = ['Submitted', 'Under Evaluation'];
const PROJECT_RUNNING = ['Active', 'On Hold'];

/** A contract / sub-contract status that means nothing is left to expire. */
export const CLOSED_CONTRACT = /\b(closed|completed|cancel+ed|terminated|finished)\b|منته|مغلق|ملغ/i;
/** A status that says it was renewed or extended in place. */
export const RENEWED_CONTRACT = /\b(renewed|extended)\b|مجدد|تجديد|ممدد|تمديد/i;

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export const stateFor = (daysLeft: number): DeadlineState =>
  daysLeft < 0 ? 'late' : daysLeft === 0 ? 'today' : daysLeft <= SOON_DAYS ? 'soon' : 'later';

/**
 * The later end date that supersedes this contract, or '' when none. Looks at
 * rows filed under it and rows sharing its contract number, same project.
 */
export function renewalOf(c: any, all: any[]): string {
  const end = dayOf(c?.endDate);
  if (!end) return '';
  const number = norm(c.contractNumber);
  let best = '';
  for (const o of all) {
    if (!o || o.id === c.id || o.projectId !== c.projectId) continue;
    const related = o.parentId === c.id || (!!number && norm(o.contractNumber) === number);
    if (!related) continue;
    const e = dayOf(o.endDate);
    if (e && e > end && e > best) best = e;
  }
  return best;
}

/** Same for a sub-contract: another row for the same subcontractor on the same project running later. */
export function subRenewalOf(s: any, all: any[]): string {
  const end = dayOf(s?.expiryDate);
  if (!end) return '';
  const name = norm(s.name);
  if (!name) return '';
  let best = '';
  for (const o of all) {
    if (!o || o.id === s.id || o.projectId !== s.projectId || norm(o.name) !== name) continue;
    const e = dayOf(o.expiryDate);
    if (e && e > end && e > best) best = e;
  }
  return best;
}

// ── The build ────────────────────────────────────────────────────────────────

export function buildDeadlines(input: DeadlineInput, today: Date = new Date()): DeadlineEvent[] {
  const todayIso = iso(today);
  const out: DeadlineEvent[] = [];

  const push = (e: Omit<DeadlineEvent, 'group' | 'daysLeft' | 'state'>) => {
    const daysLeft = daysBetween(todayIso, e.date);
    out.push({ ...e, group: GROUP_OF[e.kind], daysLeft, state: stateFor(daysLeft) });
  };

  // ── Bids ──
  for (const o of input.opportunities || []) {
    if (!o || o.id === '--stats--') continue;
    const stage = o.stage || 'Identified';
    const ref: OpenRef = { type: 'opportunity', id: o.id, serial: o.serialNumber, label: o.title || '' };
    const common = {
      title: o.title || '—', serial: o.serialNumber, context: o.client || undefined,
      owner: o.ownerName, ownerIds: [o.ownerId, ...(o.collaboratorIds || [])].filter(Boolean),
      shared: false, open: ref,
    };
    if (BID_PREPARING.includes(stage)) {
      const d = dayOf(o.submissionDeadline);
      if (d) push({ ...common, key: `bid:${o.id}:deadline`, kind: 'bid-deadline', date: d });
    } else if (BID_AWAITING.includes(stage)) {
      const d = dayOf(o.decisionDate);
      if (d) push({ ...common, key: `bid:${o.id}:decision`, kind: 'bid-decision', date: d });
    }
  }

  // ── Projects (and the lookups contracts need) ──
  const projects = new Map<string, any>();
  for (const p of input.projects || []) {
    if (!p || p.id === '--stats--') continue;
    projects.set(p.id, p);
    if (!PROJECT_RUNNING.includes(p.status || 'Active')) continue;
    const d = dayOf(p.endDate);
    if (!d) continue;
    push({
      key: `project:${p.id}`, kind: 'project-end', date: d,
      title: p.name || '—', serial: p.serialNumber, context: p.client || undefined,
      ownerIds: [], shared: true,
      open: { type: 'project', id: p.id, serial: p.serialNumber, label: p.name || '' },
    });
  }
  // A contract under a finished or cancelled project has nothing left to renew.
  // An unknown project (not loaded, or deleted) keeps its contracts: a missed
  // warning is worse than an extra one.
  const projectLive = (id: string) => {
    const p = projects.get(id);
    return !p || PROJECT_RUNNING.includes(p.status || 'Active');
  };
  const projectLabel = (id: string) => {
    const p = projects.get(id);
    if (!p) return undefined;
    return [p.name, p.client].filter(Boolean).join(' · ') || undefined;
  };
  const projectRef = (id: string): OpenRef | undefined => {
    const p = projects.get(id);
    return p ? { type: 'project', id: p.id, serial: p.serialNumber, label: p.name || '' } : undefined;
  };

  const watchFor = (daysLeft: number, renewed: string) =>
    !renewed && daysLeft <= CONTRACT_WARN_DAYS && daysLeft >= -ENDED_LOOKBACK_DAYS;

  // ── Contracts ──
  const contracts = (input.contracts || []).filter(c => c && c.id !== '--stats--');
  for (const c of contracts) {
    const d = dayOf(c.endDate);
    if (!d || CLOSED_CONTRACT.test(String(c.status || '')) || !projectLive(c.projectId)) continue;
    const renewedTo = renewalOf(c, contracts) || (RENEWED_CONTRACT.test(String(c.status || '')) ? d : '');
    const daysLeft = daysBetween(todayIso, d);
    // An ended, renewed contract is history, not a deadline — the renewal has its own row.
    if (renewedTo && daysLeft < 0) continue;
    push({
      key: `contract:${c.id}`, kind: 'contract-end', date: d,
      title: c.subject || c.contractNumber || '—', serial: c.contractNumber,
      context: projectLabel(c.projectId), owner: c.inCharge || undefined,
      ownerIds: [], shared: true,
      watch: watchFor(daysLeft, renewedTo), renewedTo: renewedTo && renewedTo !== d ? renewedTo : undefined,
      open: projectRef(c.projectId),
    });
  }

  // ── Sub-contracts ──
  const subs = (input.subcontracts || []).filter(s => s && s.id !== '--stats--');
  for (const s of subs) {
    const d = dayOf(s.expiryDate);
    if (!d || CLOSED_CONTRACT.test(String(s.status || '')) || !projectLive(s.projectId)) continue;
    const renewedTo = subRenewalOf(s, subs) || (RENEWED_CONTRACT.test(String(s.status || '')) ? d : '');
    const daysLeft = daysBetween(todayIso, d);
    if (renewedTo && daysLeft < 0) continue;
    push({
      key: `sub:${s.id}`, kind: 'subcontract-end', date: d,
      title: s.name || s.typeOfService || '—', serial: s.soOrContract || undefined,
      context: [s.typeOfService, projectLabel(s.projectId)].filter(Boolean).join(' · ') || undefined,
      ownerIds: [], shared: true,
      watch: watchFor(daysLeft, renewedTo), renewedTo: renewedTo && renewedTo !== d ? renewedTo : undefined,
      open: projectRef(s.projectId),
    });
  }

  // ── Tasks ──
  for (const t of input.tasks || []) {
    if (!t || t.id === '--stats--' || TASK_CLOSED.includes(t.status)) continue;
    const d = dayOf(t.dueDate);
    if (!d) continue;
    push({
      key: `task:${t.id}`, kind: 'task-due', date: d,
      title: t.taskName || '—', serial: t.serialNumber,
      context: t.opportunityTitle || t.projectName || undefined,
      owner: t.assignedTo, ownerIds: [t.assignedToId, ...(t.collaboratorIds || [])].filter(Boolean),
      shared: false,
      open: { type: 'task', id: t.id, serial: t.serialNumber, label: t.taskName || '' },
    });
  }

  // ── Letters ──
  for (const l of input.correspondences || []) {
    if (!l || l.id === '--stats--' || l.status === 'Closed') continue;
    const d = dayOf(l.deadline);
    if (!d) continue;
    push({
      key: `letter:${l.id}`, kind: 'letter-due', date: d,
      title: l.subject || '—', serial: l.serialNumber, context: l.sentFrom || undefined,
      owner: l.assignedTo, ownerIds: [l.assignedToId, l.userId].filter(Boolean),
      shared: false,
      open: { type: 'corresponding', id: l.id, serial: l.serialNumber, label: l.subject || '' },
    });
  }

  return out.sort(compareEvents);
}

/** Within a day: tenders and contracts first (they cannot slip), then the rest; then the title. */
const KIND_RANK: Record<DeadlineKind, number> = {
  'bid-deadline': 0, 'contract-end': 1, 'subcontract-end': 2, 'bid-decision': 3,
  'project-end': 4, 'letter-due': 5, 'task-due': 6,
};
export const compareEvents = (a: DeadlineEvent, b: DeadlineEvent) =>
  a.date.localeCompare(b.date) || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.title.localeCompare(b.title);

// ── Filters ──────────────────────────────────────────────────────────────────

export function filterEvents(
  list: DeadlineEvent[],
  opts: { uid: string; mineOnly: boolean; groups: DeadlineGroup[] | 'all' },
): DeadlineEvent[] {
  return list.filter(e =>
    (opts.groups === 'all' || opts.groups.includes(e.group)) &&
    (!opts.mineOnly || e.shared || e.ownerIds.includes(opts.uid)));
}

/** yyyy-mm-dd → the events on that day, in display order. */
export function byDay(list: DeadlineEvent[]): Map<string, DeadlineEvent[]> {
  const m = new Map<string, DeadlineEvent[]>();
  for (const e of list) {
    const arr = m.get(e.date);
    if (arr) arr.push(e); else m.set(e.date, [e]);
  }
  return m;
}

// ── The "running out" watch ─────────────────────────────────────────────────

export interface ExpiryWatch {
  /** Ends within CONTRACT_WARN_DAYS, today included — nearest first. */
  ending: DeadlineEvent[];
  /** Ended, not renewed, not closed — most recent first. */
  ended: DeadlineEvent[];
}

export function expiryWatch(list: DeadlineEvent[]): ExpiryWatch {
  const w = list.filter(e => e.group === 'contract' && e.watch);
  return {
    ending: w.filter(e => e.daysLeft >= 0).sort((a, b) => a.daysLeft - b.daysLeft || a.title.localeCompare(b.title)),
    ended: w.filter(e => e.daysLeft < 0).sort((a, b) => b.daysLeft - a.daysLeft || a.title.localeCompare(b.title)),
  };
}

// ── The month grid ───────────────────────────────────────────────────────────

/** Weeks start on Sunday — the Egyptian working week (Sun–Thu), and the Ask box's week. */
export const WEEK_STARTS_ON = 0;

export interface GridDay { date: string; inMonth: boolean; }

/** The weeks (rows of 7) that cover `month0` of `year`, padded with the neighbouring days. */
export function monthGrid(year: number, month0: number): GridDay[][] {
  const first = new Date(year, month0, 1, 12);
  const lead = (first.getDay() - WEEK_STARTS_ON + 7) % 7;
  const start = new Date(year, month0, 1 - lead, 12);
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7;
  const weeks: GridDay[][] = [];
  for (let i = 0; i < cells; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 12);
    if (i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push({ date: iso(d), inMonth: d.getMonth() === month0 });
  }
  return weeks;
}

/** yyyy-mm → { year, month0 }, or null when malformed. */
export function parseMonth(v: string | null | undefined): { year: number; month0: number } | null {
  const m = String(v || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const month0 = Number(m[2]) - 1;
  return month0 >= 0 && month0 < 12 ? { year: Number(m[1]), month0 } : null;
}

export const monthKey = (year: number, month0: number) => `${year}-${String(month0 + 1).padStart(2, '0')}`;

/** Totals for the month header. */
export function monthSummary(list: DeadlineEvent[], year: number, month0: number) {
  const prefix = monthKey(year, month0);
  const inMonth = list.filter(e => e.date.startsWith(prefix));
  return {
    count: inMonth.length,
    tenders: inMonth.filter(e => e.kind === 'bid-deadline').length,
    contracts: inMonth.filter(e => e.group === 'contract').length,
    late: inMonth.filter(e => e.state === 'late').length,
  };
}

// ── Contract expiry alerts ───────────────────────────────────────────────────

/**
 * Countdown for a contract's end: each bucket fires ONCE per contract per end
 * date (a renewal moves the end date, which re-arms it), never daily — a
 * 60-day window with a daily alert would be noise. Narrowest window first.
 */
export const CONTRACT_BUCKETS: Array<{ key: string; min: number; max: number }> = [
  { key: 'ended', min: -30, max: -1 },
  { key: 'd0', min: 0, max: 0 },
  { key: 'd7', min: 1, max: 7 },
  { key: 'd14', min: 8, max: 14 },
  { key: 'd30', min: 15, max: 30 },
  { key: 'd60', min: 31, max: CONTRACT_WARN_DAYS },
];

export const contractBucket = (daysLeft: number) =>
  CONTRACT_BUCKETS.find(b => daysLeft >= b.min && daysLeft <= b.max)?.key ?? null;

/** English headline for the bell / Telegram (every notification body in the app is English). */
export function contractAlertText(e: DeadlineEvent, fmtDay: (isoDay: string) => string): { title: string; message: string } {
  const what = e.kind === 'subcontract-end' ? 'Sub-contract' : 'Contract';
  const name = [e.serial, e.title !== e.serial ? `"${e.title}"` : ''].filter(Boolean).join(' ');
  const where = e.context ? ` (${e.context})` : '';
  const when = fmtDay(e.date);
  const act = e.kind === 'subcontract-end' ? 'Renew it or close it.' : 'Renew it, extend it with an amendment, or close it.';
  const n = Math.abs(e.daysLeft);
  if (e.daysLeft < 0) {
    return {
      title: `🔴 ${what} ended — not renewed`,
      message: `${what} ${name}${where} ended on ${when}, ${n} day${n === 1 ? '' : 's'} ago, and nobody has renewed or closed it. ${act}`,
    };
  }
  if (e.daysLeft === 0) {
    return { title: `🔴 ${what} ends today`, message: `${what} ${name}${where} ends today, ${when}. ${act}` };
  }
  return {
    title: e.daysLeft <= 7 ? `🟠 ${what} ends in ${n} day${n === 1 ? '' : 's'}` : `📄 ${what} ends in ${n} days`,
    message: `${what} ${name}${where} ends on ${when} — in ${n} day${n === 1 ? '' : 's'}. ${act}`,
  };
}
