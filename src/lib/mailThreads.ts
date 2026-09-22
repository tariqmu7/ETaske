/**
 * Mail threads and the "nobody replied" flag (queue task B2).
 *
 * Two jobs, both pure:
 *
 *  1. **One thread = one record.** A reply chain arrives as three separate
 *     Outlook messages ("Tender 123", "RE: Tender 123", "RE: RE: Tender 123").
 *     Suggesting three records for it is worse than suggesting none, so the
 *     messages are grouped and the newest INCOMING one speaks for the thread.
 *
 *  2. **Nobody replied.** A thread whose newest message came IN, with no answer
 *     from us since, is the thing that quietly rots. After two WORKING days it
 *     is flagged. (Tariq's #1 daily pain.)
 *
 * What the bridge gives us decides the design. `outlook_bridge.py` returns no
 * Outlook ConversationID, and its `recipients` are DISPLAY NAMES, not addresses
 * — and the .exe is already on ~15 desks, so changing it means re-shipping it.
 * Everything here therefore works off the subject line plus the display names:
 *   - the thread key is the cleaned, normalized subject;
 *   - a sent message only counts as an answer if it went back to the person who
 *     wrote in — which is what stops two clients who both write "Monthly
 *     report" from cancelling each other's flag.
 *
 * Nothing here touches Firestore, the bridge or the DOM: `scripts/harness/
 * mailthreads.mjs` runs this file unmodified.
 */

import { normalizeArabic } from '../utils';
import {
  cleanSubject, suggestFromEmail, compareSuggestions,
  type SuggestEmail, type MailSuggestion, type SuggestContext, type MailHandledState,
} from './mailSuggest';

/** Working days an incoming mail may sit unanswered before it is flagged. */
export const REPLY_DUE_WORKING_DAYS = 2;

/** Egypt's weekend. 0 = Sunday ... 5 = Friday, 6 = Saturday. */
export const WEEKEND_DAYS = [5, 6];

/**
 * Working days OUR letter may go unanswered before we should chase them.
 * Longer than the two we hold ourselves to: a client is not our employee, and
 * a reminder after two days reads as nagging rather than as diligence.
 */
export const CHASE_DUE_WORKING_DAYS = 4;

/** Ledger prefix for a "waiting for a reply" row the user waved away. */
export const WAIT_LEDGER_PREFIX = 'wait:';

/** …and for a "they have not replied" row (queue task B4). */
export const CHASE_LEDGER_PREFIX = 'chase:';

export interface ThreadEmail extends SuggestEmail {
  recipients?: string[];
  to?: string;
}

export interface MailThread {
  /** Stable key for the whole chain — also the ledger key for its suggestion. */
  key: string;
  /** The chain's subject, with RE:/FW: and [EXTERNAL] already stripped. */
  title: string;
  /** Every message in the chain, oldest first. */
  messages: ThreadEmail[];
  count: number;
  first: ThreadEmail;
  last: ThreadEmail;
  lastIncoming?: ThreadEmail;
  lastOutgoing?: ThreadEmail;
  /** Who the chain is with, as a person reads it. */
  counterparty: string;
  /** The newest message came in and nothing has gone back to them since. */
  awaitingReply: boolean;
  /** Working days that mail has been sitting there (0 when it is answered). */
  waitingDays: number;
  /** awaitingReply and the wait has passed REPLY_DUE_WORKING_DAYS. */
  overdue: boolean;
  // The mirror case (queue task B4). `awaitingReply` above is OUR debt — their
  // letter is sitting unanswered in our inbox. These three are THEIRS: we wrote
  // last and nothing has come back, which is what a follow-up letter is for.
  /** The newest message went OUT and nothing has come back since. */
  awaitingTheirReply: boolean;
  /** Working days our last message has gone unanswered (0 when they replied). */
  theirWaitingDays: number;
  /** awaitingTheirReply and the wait has passed CHASE_DUE_WORKING_DAYS. */
  theirOverdue: boolean;
}

export interface ThreadOptions {
  /** Injectable for the harness; defaults to now. */
  today?: Date;
  /** Override the two-working-day rule. */
  replyDueDays?: number;
  /** Override the four-working-day rule for chasing THEM. */
  chaseDueDays?: number;
  /** Override the Fri/Sat weekend (e.g. [0, 6] for a Sun/Sat one). */
  weekendDays?: number[];
}

// ── Working days ─────────────────────────────────────────────────────────────

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Working days from `from` to `to`, counting the days AFTER `from`'s own day.
 * A letter that arrived on Thursday is 0 days old on Thursday, 1 on Sunday
 * (Friday and Saturday are the weekend here) and 2 on Monday.
 */
export function workingDaysBetween(from: Date, to: Date, weekendDays: number[] = WEEKEND_DAYS): number {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  const cursor = midnight(from);
  const end = midnight(to);
  if (end <= cursor) return 0;
  const weekend = new Set(weekendDays);
  let days = 0;
  // A mailbox never reaches this, but an unparseable date must not spin.
  for (let guard = 0; guard < 2000; guard++) {
    cursor.setDate(cursor.getDate() + 1);
    if (cursor > end) break;
    if (!weekend.has(cursor.getDay())) days++;
  }
  return days;
}

// ── Grouping ─────────────────────────────────────────────────────────────────

/** Collapse spacing and punctuation so "RE: Tender 123 !!" keys like "tender 123". */
const flatten = (s: string) =>
  normalizeArabic(s)
    .replace(/[\s ]+/g, ' ')
    .replace(/[.!?،,;:"'\-_]+$/g, '')
    .trim();

/**
 * The key every message in one chain shares. A subject too short to be
 * distinctive ("hi", "") gets a key of its own rather than dragging unrelated
 * mail into a thread.
 */
export function threadKeyOf(email: ThreadEmail): string {
  const subject = flatten(cleanSubject(email.subject || ''));
  if (subject.length < 4) return `#${email.id}`;
  return subject;
}

/** The names a sent message went to, normalized for comparison. */
const recipientNames = (email: ThreadEmail): string[] => {
  const raw = email.recipients && email.recipients.length
    ? email.recipients
    : String(email.to || '').split(';');
  return raw.map(r => flatten(String(r))).filter(Boolean);
};

/**
 * Does this outgoing message answer that incoming one — or is it a different
 * conversation that happens to share a subject line?
 *
 * With no recipient information at all we say yes: a missed flag is quieter
 * than a false one, and the user loses nothing they had before.
 */
export function answersSender(sent: ThreadEmail, incoming: ThreadEmail): boolean {
  const names = recipientNames(sent);
  if (!names.length) return true;
  const sender = flatten(incoming.sender || '');
  const local = flatten(String(incoming.sender_email || '').split('@')[0] || '');
  return names.some(n =>
    (sender.length > 2 && (n.includes(sender) || sender.includes(n))) ||
    (local.length > 2 && n.includes(local)),
  );
}

const timeOf = (e: ThreadEmail): number => {
  const t = new Date(e.received_at || 0).getTime();
  return Number.isNaN(t) ? 0 : t;
};

const isSent = (e: ThreadEmail) => e.direction === 'sent';

/**
 * Group a mixed inbox + sent list into threads, newest chain first, each one
 * already carrying its wait.
 */
export function groupThreads(emails: ThreadEmail[], opts: ThreadOptions = {}): MailThread[] {
  const today = opts.today ?? new Date();
  const dueDays = opts.replyDueDays ?? REPLY_DUE_WORKING_DAYS;
  const chaseDays = opts.chaseDueDays ?? CHASE_DUE_WORKING_DAYS;
  const weekend = opts.weekendDays ?? WEEKEND_DAYS;

  const buckets = new Map<string, ThreadEmail[]>();
  const seen = new Set<string>();
  for (const e of emails) {
    if (!e || !e.id) continue;
    if (seen.has(e.id)) continue; // the same mail can arrive from two fetches
    seen.add(e.id);
    const key = threadKeyOf(e);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(e); else buckets.set(key, [e]);
  }

  const threads: MailThread[] = [];
  buckets.forEach((messages, key) => {
    messages.sort((a, b) => timeOf(a) - timeOf(b));
    const incoming = messages.filter(m => !isSent(m));
    const outgoing = messages.filter(isSent);
    const lastIncoming = incoming[incoming.length - 1];
    const lastOutgoing = outgoing[outgoing.length - 1];

    // Answered = something went back to that person after their mail arrived.
    let awaitingReply = false;
    let waitingDays = 0;
    if (lastIncoming) {
      const arrived = timeOf(lastIncoming);
      const answered = outgoing.some(o => timeOf(o) >= arrived && answersSender(o, lastIncoming));
      awaitingReply = !answered;
      if (awaitingReply) waitingDays = workingDaysBetween(new Date(arrived), today, weekend);
    }

    // The mirror (queue task B4): we wrote last, they have gone quiet. Only a
    // chain that HAS an incoming message counts — a mail we sent into the blue
    // (a circular, a first approach) is not somebody failing to answer us.
    let awaitingTheirReply = false;
    let theirWaitingDays = 0;
    if (lastOutgoing && lastIncoming && timeOf(lastOutgoing) > timeOf(lastIncoming)) {
      awaitingTheirReply = true;
      theirWaitingDays = workingDaysBetween(new Date(timeOf(lastOutgoing)), today, weekend);
    }

    const last = messages[messages.length - 1];
    const counterparty = lastIncoming
      ? (lastIncoming.sender || lastIncoming.sender_email || '')
      : (last.recipients?.[0] || last.to || '');

    threads.push({
      key,
      title: cleanSubject(messages[0].subject || ''),
      messages,
      count: messages.length,
      first: messages[0],
      last,
      lastIncoming,
      lastOutgoing,
      counterparty,
      awaitingReply,
      waitingDays,
      overdue: awaitingReply && waitingDays >= dueDays,
      awaitingTheirReply,
      theirWaitingDays,
      theirOverdue: awaitingTheirReply && theirWaitingDays >= chaseDays,
    });
  });

  threads.sort((a, b) => timeOf(b.last) - timeOf(a.last));
  return threads;
}

/** Index every message id to the thread it belongs to — for the mail list. */
export function threadIndex(threads: MailThread[]): Record<string, MailThread> {
  const out: Record<string, MailThread> = {};
  for (const th of threads) for (const m of th.messages) out[m.id] = th;
  return out;
}

/**
 * The chase list: threads nobody answered, the longest wait first. Rows the
 * user waved away (ledger key `wait:<thread key>`) stay away.
 */
export function threadsAwaitingReply(
  threads: MailThread[],
  handled: Record<string, MailHandledState> = {},
  limit = 12,
): MailThread[] {
  return threads
    .filter(th => th.overdue && !handled[WAIT_LEDGER_PREFIX + th.key])
    .sort((a, b) => b.waitingDays - a.waitingDays || timeOf(b.last) - timeOf(a.last))
    .slice(0, limit);
}

/**
 * The other chase list (queue task B4): chains where WE wrote last and nothing
 * came back, longest silence first. These are the ones a follow-up letter is
 * written for. Rows waved away (ledger key `chase:<thread key>`) stay away.
 */
export function threadsAwaitingTheirReply(
  threads: MailThread[],
  handled: Record<string, MailHandledState> = {},
  limit = 12,
): MailThread[] {
  return threads
    .filter(th => th.theirOverdue && !handled[CHASE_LEDGER_PREFIX + th.key])
    .sort((a, b) => b.theirWaitingDays - a.theirWaitingDays || timeOf(b.last) - timeOf(a.last))
    .slice(0, limit);
}

// ── One suggestion per thread ────────────────────────────────────────────────

export interface ThreadSuggestion extends MailSuggestion {
  /** The chain this stands for — and the key its ledger entry is filed under. */
  threadKey: string;
  /** How many messages the chain holds (1 = a single mail). */
  threadCount: number;
  awaitingReply: boolean;
  waitingDays: number;
}

export interface ThreadSuggestOptions extends SuggestContext {
  /** Ignore threads whose newest incoming mail is older than this (default 14 days). */
  windowDays?: number;
  /** Cap the list so the page stays readable (default 12). */
  limit?: number;
  /** Thread keys (and legacy email ids) already accepted or dismissed. */
  handled?: Record<string, MailHandledState>;
}

/**
 * One suggestion per thread, built from the newest incoming message but
 * speaking for the whole chain. Replaces `suggestionsFor` in the Outlook Feed:
 * same cards, but a three-mail chain now offers ONE record, not three.
 */
export function threadSuggestions(threads: MailThread[], opts: ThreadSuggestOptions): ThreadSuggestion[] {
  const today = opts.today ?? new Date();
  const windowDays = opts.windowDays ?? 14;
  const limit = opts.limit ?? 12;
  const handled = opts.handled || {};
  const floor = today.getTime() - windowDays * 86400000;

  const out: ThreadSuggestion[] = [];
  for (const th of threads) {
    const head = th.lastIncoming;
    if (!head) continue;                                // a chain we started is not a suggestion
    if (handled[th.key] || handled[head.id]) continue;  // legacy per-mail entries still count
    const at = timeOf(head);
    if (at && at < floor) continue;
    out.push({
      ...suggestFromEmail(head, opts),
      threadKey: th.key,
      threadCount: th.count,
      awaitingReply: th.awaitingReply,
      waitingDays: th.waitingDays,
    });
  }
  out.sort(compareSuggestions);
  return out.slice(0, limit);
}
