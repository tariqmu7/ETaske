// Daily briefing — one message a day, per person, in place of a board to open.
//
// The alert engine in `dueAlerts.ts` fires per RECORD: it is good at "this one
// thing is late" and bad at "how does my day look". This is the other half —
// at most ONE message per person per day that answers the only question people
// actually ask in the morning ("what is on me today, and what did I let slip"),
// plus a whole-department digest for a manager, capped at ten lines so it can
// be read on a phone lock screen without opening anything.
//
// Same delivery as every other notification: `createNotification` writes the
// in-app bell entry and mirrors it to the recipient's Telegram DM / FCM push
// (see `pushNotification.ts`), so no Blaze plan and no server are involved.
//
// It is therefore CLIENT-SIDE, exactly like dueAlerts: the briefing is sent the
// FIRST time the person opens ETaske on a given day, not at a fixed hour.
// Somebody who never opens the app never gets it. A true 07:00 send needs a
// scheduled Cloud Function (Blaze) or an Apps Script time trigger — a separate
// job, deliberately not done here.

import { serverTimestamp } from 'firebase/firestore';
import { createNotification } from './pushNotification';
import { AppUser } from '../types';
import { daysUntil } from '../utils';

// ── The one record shape the briefing works in ───────────────────────────────
//
// Tasks, correspondences and bids differ in every field name (dueDate /
// deadline / submissionDeadline, taskName / subject / title), so the caller
// flattens them once and everything below stays kind-agnostic.

export interface BriefItem {
  id: string;
  kind: 'task' | 'corresponding' | 'opportunity';
  label: string;
  serial?: string;
  /** ISO yyyy-mm-dd: dueDate / deadline / submissionDeadline. */
  due?: string;
  status?: string;
  priority?: string;
  /** Whose record it is — used by the manager digest to split the load. */
  ownerId?: string;
  ownerName?: string;
  /** Set by the caller: does this count as the recipient's own work? The rule
   *  (assignee OR collaborator) lives in App.tsx beside the alert engine's. */
  mine?: boolean;
}

// A closed record has no day left to plan. 'Cancelled', 'No Bid', 'Won' and
// 'Lost' are here for opportunities, whose stages are their own vocabulary.
const CLOSED = ['Done', 'Closed', 'Archived', 'Cancelled', 'No Bid', 'Won', 'Lost', 'Rejected'];

export const isOpenItem = (item: BriefItem): boolean => !CLOSED.includes(item.status ?? '');

type Bucket = 'late' | 'today' | 'week';

/** Which part of the day/week an item falls in. Null = no date, or further out
 *  than a week — neither belongs in a morning message. */
export function bucketOf(item: BriefItem): Bucket | null {
  const days = daysUntil(item.due);
  if (days === null) return null;
  if (days < 0) return 'late';
  if (days === 0) return 'today';
  return days <= 7 ? 'week' : null;
}

/** "3 days late" / "due today" / "in 3 days" — the tail of a bullet line. */
export function whenLabel(item: BriefItem): string {
  const days = daysUntil(item.due);
  if (days === null) return '';
  if (days < 0) {
    const late = Math.abs(days);
    return `${late} day${late === 1 ? '' : 's'} late`;
  }
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `in ${days} days`;
}

/** "TK000012 Prepare the AGIBA offer — 3 days late" */
function bulletFor(item: BriefItem): string {
  const head = [item.serial, item.label].filter(Boolean).join(' ');
  return `• ${head} — ${whenLabel(item)}`;
}

// Longest overdue first, then soonest due. A list that opens with the thing
// that has been ignored longest is the one that gets acted on.
function byUrgency(a: BriefItem, b: BriefItem): number {
  return (daysUntil(a.due) ?? 9999) - (daysUntil(b.due) ?? 9999);
}

// A phone lock-screen message stops being read somewhere around here.
const MAX_BULLETS = 5;

function section(heading: string, items: BriefItem[]): string[] {
  if (!items.length) return [];
  const sorted = [...items].sort(byUrgency);
  const lines = [`${heading} (${items.length})`, ...sorted.slice(0, MAX_BULLETS).map(bulletFor)];
  const hidden = items.length - MAX_BULLETS;
  if (hidden > 0) lines.push(`  …and ${hidden} more`);
  return lines;
}

/** "3 due today, 1 late and 2 bids closing this week" */
function headlineCounts(late: number, today: number, bids: number): string {
  const parts: string[] = [];
  if (today) parts.push(`${today} due today`);
  if (late) parts.push(`${late} late`);
  if (bids) parts.push(`${bids} bid${bids === 1 ? '' : 's'} closing this week`);
  if (!parts.length) return 'nothing due today and nothing late';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export interface Briefing {
  title: string;
  body: string;
}

/**
 * The personal briefing.
 *
 * `items` is the whole visible board; only `mine` records count. Returns null
 * when the person has nothing late, nothing today and nothing inside the week —
 * an empty briefing every morning is how a notification channel gets muted.
 */
export function buildPersonalBriefing(items: BriefItem[]): Briefing | null {
  const mine = items.filter(i => i.mine && isOpenItem(i));

  const late = mine.filter(i => bucketOf(i) === 'late');
  const today = mine.filter(i => bucketOf(i) === 'today');
  const week = mine.filter(i => bucketOf(i) === 'week');

  if (!late.length && !today.length && !week.length) return null;

  const bidsThisWeek = [...today, ...week].filter(i => i.kind === 'opportunity').length;

  const lines = [
    `Good morning — ${headlineCounts(late.length, today.length, bidsThisWeek)}.`,
    '',
    ...section('Late', late),
    ...section('Today', today),
    ...section('Rest of the week', week),
  ];

  return { title: '☀️ Your day', body: lines.join('\n').trim() };
}

// ── The manager digest ───────────────────────────────────────────────────────

// Ten lines, as commissioned. Anything that does not fit is not important
// enough to push at somebody before their first coffee.
const MAX_DIGEST_LINES = 10;
// Three names hint at where the load sits; a full roster is a report.
const TOP_PEOPLE = 3;

/** "Ahmed 7 · Nevine 5 · Sara 3" — heaviest first, ties broken by name so the
 *  same board always renders the same way. */
function byPerson(items: BriefItem[], users: AppUser[]): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    const name =
      item.ownerName || users.find(u => u.id === item.ownerId)?.displayName || '';
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_PEOPLE)
    .map(([name, n]) => `${name} ${n}`)
    .join(' · ');
}

/**
 * The whole-department digest, for Managers and Admins.
 *
 * Counts every OPEN record on the board the manager can see — not just their
 * own — and answers, in at most ten lines: how much is open, what slipped, what
 * closes this week, who is carrying it, and what nobody owns.
 * Returns null when the department has nothing open at all.
 */
export function buildManagerDigest(
  items: BriefItem[],
  users: AppUser[],
  dateLabel: string,
): Briefing | null {
  const open = items.filter(isOpenItem);
  if (!open.length) return null;

  const late = open.filter(i => bucketOf(i) === 'late');
  const today = open.filter(i => bucketOf(i) === 'today');
  const week = open.filter(i => bucketOf(i) === 'week');
  const bids = open.filter(i => i.kind === 'opportunity');
  const bidsClosing = [...today, ...week].filter(i => i.kind === 'opportunity').sort(byUrgency);
  const unowned = open.filter(i => !i.ownerId && !i.ownerName);

  const lines: string[] = [
    `Department briefing — ${dateLabel}`,
    `${open.length} open · ${late.length} late · ${today.length} due today · ${week.length} later this week`,
  ];

  if (bids.length) {
    const nearest = bidsClosing[0];
    lines.push(
      nearest
        ? `Bids: ${bids.length} open, ${bidsClosing.length} closing this week — nearest ${[nearest.serial, nearest.label].filter(Boolean).join(' ')} ${whenLabel(nearest)}`
        : `Bids: ${bids.length} open, none closing this week`,
    );
  }

  if (late.length) {
    lines.push('Longest late:');
    for (const item of [...late].sort(byUrgency).slice(0, 3)) {
      lines.push(`${bulletFor(item)}${item.ownerName ? ` (${item.ownerName})` : ''}`);
    }
    const spread = byPerson(late, users);
    if (spread) lines.push(`Late by person: ${spread}`);
  }

  const load = byPerson(open, users);
  if (load) lines.push(`Biggest load: ${load}`);

  if (unowned.length) {
    lines.push(
      `${unowned.length} open record${unowned.length === 1 ? ' has' : 's have'} nobody on them`,
    );
  }

  return { title: '📋 Department briefing', body: lines.slice(0, MAX_DIGEST_LINES).join('\n') };
}

// ── Once a day, on first open ────────────────────────────────────────────────

const LEDGER_PREFIX = 'etaske:briefing:';

type BriefLedger = { personal?: string; manager?: string };

/** Local calendar date — NOT toISOString(), which is UTC and would roll the
 *  "day" over at 02:00 in Cairo and hand somebody yesterday's briefing. */
export function localDay(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function readLedger(uid: string): BriefLedger {
  try {
    return JSON.parse(localStorage.getItem(LEDGER_PREFIX + uid) || '{}') as BriefLedger;
  } catch {
    return {};
  }
}

function writeLedger(uid: string, ledger: BriefLedger): void {
  try {
    localStorage.setItem(LEDGER_PREFIX + uid, JSON.stringify(ledger));
  } catch {
    // Storage full / disabled — worst case the briefing repeats on next open.
  }
}

/** "Mon 21 Sep" — short enough for line one of a ten-line message. */
function dayLabel(now: Date): string {
  return now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** The briefing links to "Needs you today" rather than to any one record. */
function briefingUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/due-soon`;
}

export interface BriefingRun {
  uid: string;
  isManager: boolean;
  users: AppUser[];
  items: BriefItem[];
}

/**
 * Send today's briefing if it has not gone out yet.
 *
 * Safe to call on every snapshot — the localStorage ledger absorbs the repeats,
 * and it is claimed BEFORE the first await for the same reason dueAlerts does:
 * several listeners call in here and would otherwise race into a double send.
 */
export async function runDailyBriefing({
  uid,
  isManager,
  users,
  items,
}: BriefingRun): Promise<void> {
  const now = new Date();
  const stamp = localDay(now);
  const ledger = readLedger(uid);

  const wantPersonal = ledger.personal !== stamp;
  const wantManager = isManager && ledger.manager !== stamp;
  if (!wantPersonal && !wantManager) return;

  const personal = wantPersonal ? buildPersonalBriefing(items) : null;
  const digest = wantManager ? buildManagerDigest(items, users, dayLabel(now)) : null;

  // A day with nothing to say is still a day that has been handled — stamping
  // it stops the check re-running on every snapshot until midnight.
  if (wantPersonal) ledger.personal = stamp;
  if (wantManager) ledger.manager = stamp;
  writeLedger(uid, ledger);

  const url = briefingUrl();

  for (const brief of [personal, digest]) {
    if (!brief) continue;
    await createNotification(
      {
        // Deliberately matches none of refTypeForNotification's stems: a
        // briefing is about the day, not about one record, so it must not
        // deep-link into a dashboard as if it were.
        type: 'daily_briefing',
        title: brief.title,
        message: brief.body,
        forUserId: uid,
        read: false,
        createdAt: serverTimestamp(),
      },
      users,
      url,
    );
  }
}
