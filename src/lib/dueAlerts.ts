// Overdue / due-soon Telegram alerts.
//
// The due-soon listener in App.tsx already streams every task and correspondence
// the user may read; this turns that stream into at most one DM per record per
// bucket per day. Alerts are client-side (no Blaze plan needed), so the dedupe
// ledger lives in localStorage and is keyed by uid — a user on two devices may
// get the same alert twice, which is the accepted trade-off for staying off
// Cloud Functions (see CLAUDE.md → Hosting / runtime split).

import { pushTelegram } from './pushNotification';
import { buildDeepLinkUrl, DeepLinkRef } from './deepLink';
import { isOverdue, isDueSoon } from '../utils';

type Bucket = 'overdue' | 'soon';

export interface DueCandidate {
  id: string;
  type: DeepLinkRef['type'];
  label: string;      // task name / correspondence subject
  due?: string;       // dueDate or deadline
  serial?: string;
}

// A first run on an account with a large backlog must not dump 80 DMs.
const MAX_PER_RUN = 5;
const LEDGER_PREFIX = 'etaske:duealert:';

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
  // Drop yesterday's entries so the ledger can't grow without bound.
  const stamp = today();
  const pruned: Ledger = {};
  for (const [k, v] of Object.entries(ledger)) if (v === stamp) pruned[k] = v;
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

/**
 * Send Telegram alerts for the caller's overdue / due-within-48h records.
 * No-op when the user hasn't linked Telegram. Safe to call on every snapshot —
 * the ledger absorbs the repeats.
 */
export function runDueAlerts(
  uid: string,
  chatId: string | undefined,
  candidates: DueCandidate[],
): void {
  if (!chatId) return;

  const ledger = readLedger(uid);
  const stamp = today();
  let sent = 0;

  for (const item of candidates) {
    if (sent >= MAX_PER_RUN) break;

    const bucket = bucketFor(item.due);
    if (!bucket) continue;

    const key = `${item.id}:${bucket}`;
    if (ledger[key] === stamp) continue;

    const kind = item.type === 'task' ? 'مهمة' : 'مراسلة';
    const title = bucket === 'overdue'
      ? `🔴 متأخر — ${kind}`
      : `🟠 يقترب الموعد — ${kind}`;
    const lines = [
      item.serial ? `${item.serial} — ${item.label}` : item.label,
      item.due ? `الموعد النهائي: ${item.due}` : '',
    ].filter(Boolean);

    pushTelegram(chatId, title, lines.join('\n'), buildDeepLinkUrl(item.type, item.id));

    ledger[key] = stamp;
    sent += 1;
  }

  if (sent > 0) writeLedger(uid, ledger);
}
