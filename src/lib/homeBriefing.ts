// Home as a briefing page (queue task E1).
//
// Home used to be a launcher: ten tiles, each a door to a board. It told you
// where things live, not what is waiting. This module turns the same records
// into a handful of SENTENCES — "3 things are late", "2 tenders close this
// week", "5 e-mails are waiting for a reply" — each of which opens the one
// page that deals with it. Every other section moves one level down.
//
// Pure and English-free: it returns counts, a lead record and a target view;
// HomeDashboard owns the wording (en/ar). Nothing here is written back
// (settled rule 3 — derived numbers are derived at render).
//
// Scope follows settled rule 11: an employee's briefing counts only their own
// records (assignee OR collaborator); a manager's counts the whole visible
// board, like the daily digest in dailyBriefing.ts.

import { BriefItem, bucketOf, isOpenItem } from './dailyBriefing';
import { waitingForSignOff, isPreSend } from './offerApproval';
import { buildDeadlines, expiryWatch, CONTRACT_WARN_DAYS } from './deadlineCalendar';
import { daysUntil } from '../utils';

export type LineKey = 'late' | 'today' | 'signoff' | 'bids' | 'mail' | 'review' | 'contracts';

/** alert = something slipped; warn = act today or this week; info = worth knowing. */
export type Tone = 'alert' | 'warn' | 'info';

/** The record a sentence names as its example ("longest: TK000012 …"). */
export interface LeadRecord {
  label: string;
  serial?: string;
  /** Whole days from today; negative = late. */
  days?: number;
  owner?: string;
}

export interface BriefLine {
  key: LineKey;
  count: number;
  tone: Tone;
  /** The page a click opens (an AppView id). */
  view: 'due-soon' | 'opportunities' | 'waiting' | 'correspondences' | 'calendar';
  lead?: LeadRecord;
  /** Manager 'late' only: whose desk most of it sits on. */
  topPerson?: { name: string; count: number };
  /** Mail only: chains where WE wrote last and nothing came back. */
  second?: number;
}

export interface BriefingInput {
  uid: string;
  isManager: boolean;
  /** Only the tasks this reader may see (subscribeVisibleTasks). */
  tasks: any[];
  correspondences: any[];
  opportunities: any[];
  /** Manager only; omitted = no contract line. */
  projects?: any[];
  contracts?: any[];
  subcontracts?: any[];
  /** From the Outlook helper on this PC; null = helper not running (no mail line). */
  mail?: { awaitingUs: number; awaitingThem: number } | null;
  /** id → display name, for "most with Ahmed". */
  userNames?: Record<string, string>;
}

const mineOf = (r: any, uid: string) =>
  r.assignedToId === uid || r.ownerId === uid || (r.collaboratorIds || []).includes(uid);

const real = (rows: any[]) => rows.filter(r => r && r.id !== '--stats--');

/** Longest late first, then soonest due. */
const byUrgency = (a: BriefItem, b: BriefItem) => (daysUntil(a.due) ?? 9999) - (daysUntil(b.due) ?? 9999);

const leadOf = (item: BriefItem | undefined): LeadRecord | undefined =>
  item ? { label: item.label, serial: item.serial, days: daysUntil(item.due) ?? undefined, owner: item.ownerName } : undefined;

function topPersonOf(items: BriefItem[], userNames: Record<string, string>) {
  const counts = new Map<string, number>();
  for (const i of items) {
    const name = i.ownerName || (i.ownerId ? userNames[i.ownerId] : '') || '';
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  // One person carrying one item says nothing about where the load sits.
  return best && best[1] > 1 ? { name: best[0], count: best[1] } : undefined;
}

/**
 * The briefing sentences, most urgent first. Only lines with something to say
 * are returned — an empty array means "nothing is late, nothing due today".
 */
export function buildHomeBriefing(input: BriefingInput): BriefLine[] {
  const { uid, isManager } = input;
  const userNames = input.userNames || {};
  const inScope = (r: any) => isManager || mineOf(r, uid);

  // Tasks and letters share the late / today lines — a letter with a passed
  // deadline is as late as a task. Bids get their own line: a tender deadline
  // is imposed from outside and counts down in days (settled rule 8).
  const work: BriefItem[] = [
    ...real(input.tasks).filter(inScope).map(t => ({
      id: t.id, kind: 'task' as const, label: t.taskName || '', serial: t.serialNumber,
      due: t.dueDate, status: t.status, ownerId: t.assignedToId, ownerName: t.assignedTo,
    })),
    ...real(input.correspondences).filter(inScope).map(c => ({
      id: c.id, kind: 'corresponding' as const, label: c.subject || '', serial: c.serialNumber,
      due: c.deadline, status: c.status, ownerId: c.assignedToId, ownerName: c.assignedTo,
    })),
  ].filter(isOpenItem);

  const late = work.filter(i => bucketOf(i) === 'late').sort(byUrgency);
  const today = work.filter(i => bucketOf(i) === 'today');

  const lines: BriefLine[] = [];

  if (late.length) {
    lines.push({
      key: 'late', count: late.length, tone: 'alert', view: 'due-soon', lead: leadOf(late[0]),
      topPerson: isManager ? topPersonOf(late, userNames) : undefined,
    });
  }
  if (today.length) {
    lines.push({ key: 'today', count: today.length, tone: 'warn', view: 'due-soon', lead: leadOf(today[0]) });
  }

  const bids = real(input.opportunities);

  // Before "tenders closing": an offer waiting on the manager holds up the
  // submission, so it is the more urgent of the two for them.
  if (isManager) {
    const waiting = waitingForSignOff(bids, Date.now());
    if (waiting.length) {
      const oldest = waiting[0];
      lines.push({
        key: 'signoff', count: waiting.length, tone: 'warn', view: 'opportunities',
        lead: { label: oldest.title, serial: oldest.serial, days: -oldest.ageDays, owner: oldest.requestedByName },
      });
    }
  }

  // Only bids still to be sent: a Submitted bid is in the pipeline, but its
  // deadline no longer asks anything of us.
  const closing: BriefItem[] = bids
    .filter(o => isPreSend(o.stage) && inScope(o))
    .map(o => ({ id: o.id, kind: 'opportunity' as const, label: o.title || '', serial: o.serialNumber, due: o.submissionDeadline, status: o.stage }))
    .filter(o => { const d = daysUntil(o.due); return d !== null && d >= 0 && d <= 7; })
    .sort(byUrgency);
  if (closing.length) {
    lines.push({ key: 'bids', count: closing.length, tone: 'warn', view: 'opportunities', lead: leadOf(closing[0]) });
  }

  if (input.mail && (input.mail.awaitingUs || input.mail.awaitingThem)) {
    lines.push({
      key: 'mail', count: input.mail.awaitingUs, tone: input.mail.awaitingUs ? 'warn' : 'info',
      view: 'waiting', second: input.mail.awaitingThem,
    });
  }

  if (isManager) {
    const review = real(input.correspondences).filter(c => ['Unread', 'Reviewing'].includes(c.status));
    if (review.length) lines.push({ key: 'review', count: review.length, tone: 'info', view: 'correspondences' });
  }

  if (isManager && input.projects && input.contracts) {
    const events = buildDeadlines({ projects: input.projects, contracts: input.contracts, subcontracts: input.subcontracts || [] });
    const { ending } = expiryWatch(events);
    if (ending.length) {
      const e = ending[0];
      lines.push({
        key: 'contracts', count: ending.length, tone: 'info', view: 'calendar',
        lead: { label: e.context ? `${e.context} — ${e.title}` : e.title, serial: e.serial, days: e.daysLeft },
      });
    }
  }

  return lines;
}

export { CONTRACT_WARN_DAYS };
