// Overdue / due-soon alerts.
//
// The due-soon listener in App.tsx already streams every task and correspondence
// the user may read; this turns that stream into at most one alert per record per
// bucket per day. Alerts are client-side (no Blaze plan needed), so the dedupe
// ledger lives in localStorage and is keyed by uid — a user on two devices may
// get the same alert twice, which is the accepted trade-off for staying off
// Cloud Functions (see CLAUDE.md → Hosting / runtime split).
//
// Each alert goes through createNotification, so it lands in the in-app bell AND
// as a Telegram DM / FCM push with a deep link, exactly like every other
// notification.

import { serverTimestamp } from 'firebase/firestore';
import { createNotification } from './pushNotification';
import { DeepLinkRef } from './deepLink';
import { taskDetails, corrDetails } from './notifyDetails';
import { AppUser } from '../types';
import { isOverdue, isDueSoon } from '../utils';

type Bucket = 'overdue' | 'soon';

export interface DueCandidate {
  id: string;
  type: DeepLinkRef['type'];
  label: string;      // task name / correspondence subject
  due?: string;       // dueDate or deadline
  serial?: string;
  description?: string;
  priority?: string;
  status?: string;
  assignedTo?: string;
  // Who the record belongs to. When the alert is being raised for someone else's
  // record (manager oversight) this is the person actually on the hook.
  ownerId?: string;
}

// A first run on an account with a large backlog must not dump 80 alerts.
const MAX_PER_RUN = 5;
// MAX_PER_RUN alone only throttles each snapshot — a manager watching the whole
// board would still accumulate one alert per overdue record over the day. This
// caps the total so a large backlog can't bury the bell on day one.
const MAX_PER_DAY = 25;
const LEDGER_PREFIX = 'etaske:duealert:';
// Reserved ledger key holding "<YYYY-MM-DD>:<count>" for today's alert budget.
const DAILY_COUNT_KEY = '__count';

const today = () => new Date().toISOString().slice(0, 10);

type Ledger = Record<string, string>; // "<id>:<bucket>" -> YYYY-MM-DD

function readLedger(uid: string): Ledger {
  try {
    return JSON.parse(localStorage.getItem(LEDGER_PREFIX + uid) || '{}') as Ledger;
  } catch {
    return {};
  }
}

function writeLedger(uid: string, ledger: Ledger): void {
  // Drop yesterday's entries so the ledger can't grow without bound. Both a
  // per-record entry ("<date>") and the budget counter ("<date>:<n>") are keyed
  // by today's date, so a prefix test prunes them together.
  const stamp = today();
  const pruned: Ledger = {};
  for (const [k, v] of Object.entries(ledger)) if (v.startsWith(stamp)) pruned[k] = v;
  try {
    localStorage.setItem(LEDGER_PREFIX + uid, JSON.stringify(pruned));
  } catch {
    // Storage full / disabled — worst case we re-alert next run.
  }
}

function bucketFor(due?: string): Bucket | null {
  if (isOverdue(due)) return 'overdue';
  if (isDueSoon(due)) return 'soon';
  return null;
}

/** Headline + detail block for one due record. */
function buildMessage(item: DueCandidate, bucket: Bucket, forSelf: boolean): string {
  const kind = item.type === 'task' ? 'task' : 'correspondence';
  const subject = forSelf
    ? `Your ${kind} "${item.label}"`
    : `${item.assignedTo ?? 'Unassigned'}'s ${kind} "${item.label}"`;
  const headline = bucket === 'overdue'
    ? `${subject} is overdue.`
    : `${subject} is due within 48 hours.`;

  const shared = {
    serialNumber: item.serial,
    priority: item.priority as any,
    status: item.status as any,
    assignedTo: item.assignedTo,
  };

  return item.type === 'task'
    ? taskDetails(headline, { ...shared, taskName: item.label, description: item.description, dueDate: item.due })
    : corrDetails(headline, { ...shared, subject: item.label, body: item.description, deadline: item.due });
}

/**
 * Raise overdue / due-within-48h alerts for `recipientId`.
 *
 * `candidates` are the records to consider — a user's own for employees, the
 * whole visible board for managers. Safe to call on every snapshot; the ledger
 * absorbs the repeats.
 */
export async function runDueAlerts(
  recipientId: string,
  projectUsers: AppUser[],
  candidates: DueCandidate[],
): Promise<void> {
  const ledger = readLedger(recipientId);
  const stamp = today();

  // Claim the batch and persist the ledger BEFORE any await. The task and
  // correspondence snapshot handlers both call in here, so an await between
  // reading and writing the ledger would let them pick the same records twice.
  const batch: Array<{ item: DueCandidate; bucket: Bucket }> = [];
  // The budget resets when the stored date is no longer today.
  const [countDate, countValue] = (ledger[DAILY_COUNT_KEY] ?? '').split(':');
  let dailyTotal = countDate === stamp ? Number(countValue) || 0 : 0;

  for (const item of candidates) {
    if (batch.length >= MAX_PER_RUN || dailyTotal >= MAX_PER_DAY) break;

    const bucket = bucketFor(item.due);
    if (!bucket) continue;

    const key = `${item.id}:${bucket}`;
    if (ledger[key] === stamp) continue;

    ledger[key] = stamp;
    dailyTotal += 1;
    batch.push({ item, bucket });
  }

  if (!batch.length) return;

  ledger[DAILY_COUNT_KEY] = `${stamp}:${dailyTotal}`;
  writeLedger(recipientId, ledger);

  for (const { item, bucket } of batch) {
    const forSelf = !item.ownerId || item.ownerId === recipientId;

    await createNotification({
      // Type drives the deep link's target view (refTypeForNotification), so a
      // correspondence must not be announced as a task.
      type: item.type === 'task' ? 'task_overdue' : 'corresponding_overdue',
      title: bucket === 'overdue' ? '🔴 Overdue' : '🟠 Due Soon',
      message: buildMessage(item, bucket, forSelf),
      forUserId: recipientId,
      read: false,
      relatedId: item.id,
      createdAt: serverTimestamp(),
    }, projectUsers);
  }
}
