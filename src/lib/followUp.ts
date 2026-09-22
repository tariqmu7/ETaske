// Follow-up letters and escalation (queue task B4).
//
// Two halves of the same idea — a record that has gone quiet needs either a
// push outwards or a push upwards:
//
//  1. **The letter.** When a thread or a correspondence has had no answer, the
//     user should not have to compose the chaser. `buildFollowUpLetter` writes
//     it, in English AND in Arabic, at the tone the wait deserves: a polite
//     nudge at first, firmer after a week, and a final notice that says the
//     matter goes to management. Nothing is sent from here — the letter is
//     handed to the user to read, copy and send from their own mailbox, because
//     a letter leaving in our name is a decision a person makes, not an app.
//
//  2. **The escalation.** A task whose date has come and gone twice with nobody
//     touching it stops being the owner's problem and becomes the manager's.
//     `runEscalations` raises that as a notification to Managers/Admins.
//
// The Arabic is written as Arabic, not translated: verbal sentences, real
// business openings, no «تم»/«بواسطة»/«الخاص بـ», and the day count agrees with
// the number (يوم عمل واحد · يومَي عمل · 5 أيام عمل · 12 يوم عمل).
//
// Everything above `runEscalations` is pure — `scripts/harness/followup.mjs`
// runs this file unmodified.

import { serverTimestamp } from 'firebase/firestore';
import { createNotification } from './pushNotification';
import { workingDaysBetween, WEEKEND_DAYS } from './mailThreads';
import { AppUser } from '../types';

// ── The letter ───────────────────────────────────────────────────────────────

/** How hard the letter pushes. Picked from the wait, overridable by the user. */
export type FollowUpTone = 'gentle' | 'firm' | 'final';

export type LetterLang = 'en' | 'ar';

export interface FollowUpInfo {
  /** What the letter is about — the mail subject or the record's title. */
  subject: string;
  /** Who is being chased: a person, a company, or a colleague. */
  counterparty?: string;
  /** Their address, so the letter can open in a mail client. */
  email?: string;
  /** Who signs it. */
  ourName?: string;
  /** Serial or tender number, quoted as the reference. */
  reference?: string;
  /** When we last wrote / when their letter arrived (yyyy-mm-dd or display). */
  lastContact?: string;
  /** Working days with no answer — drives the default tone and the wording. */
  waitingDays?: number;
  /** The date we are asking them to answer by. */
  needBy?: string;
  /** Chasing a colleague, not a client: first person, short, no letterhead. */
  internal?: boolean;
}

export interface FollowUpLetter {
  lang: LetterLang;
  tone: FollowUpTone;
  subject: string;
  body: string;
}

/** Working days after which a nudge is no longer enough. */
export const FIRM_AFTER_WORKING_DAYS = 5;
export const FINAL_AFTER_WORKING_DAYS = 10;

/** The tone a wait of this length has earned. */
export function toneFor(waitingDays = 0): FollowUpTone {
  if (waitingDays >= FINAL_AFTER_WORKING_DAYS) return 'final';
  if (waitingDays >= FIRM_AFTER_WORKING_DAYS) return 'firm';
  return 'gentle';
}

/** "3 working days" — English needs only the plural. */
function enWorkingDays(n: number): string {
  return `${n} working day${n === 1 ? '' : 's'}`;
}

/**
 * The same count in Arabic, in the genitive (it always follows منذ/على here),
 * with the agreement Arabic actually requires: singular, dual, the 3–10 plural
 * and the singular again from 11 up.
 */
function arWorkingDays(n: number): string {
  if (n <= 1) return 'يوم عمل واحد';
  if (n === 2) return 'يومَي عمل';
  if (n <= 10) return `${n} أيام عمل`;
  return `${n} يوم عمل`;
}

/** Drops the blank lines a missing field would otherwise leave behind. */
const joinLines = (lines: (string | false | undefined)[]): string =>
  lines.filter(l => l !== false && l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim();

// ── English ──────────────────────────────────────────────────────────────────

function englishLetter(info: FollowUpInfo, tone: FollowUpTone): FollowUpLetter {
  const days = info.waitingDays ?? 0;
  const about = info.reference ? `${info.subject} (ref ${info.reference})` : info.subject;
  const since = info.lastContact ? ` of ${info.lastContact}` : '';
  const by = info.needBy ? ` by ${info.needBy}` : '';

  if (info.internal) {
    // A colleague gets a message, not a letter: no salutation block, no
    // "kind regards", and the ask is one sentence.
    const hi = info.counterparty ? `Hi ${info.counterparty},` : 'Hi,';
    const body = tone === 'gentle'
      ? joinLines([
        hi, '',
        `A quick reminder about ${about}${info.needBy ? ` — it was due ${info.needBy}` : ''}. Where has it got to?`,
        '', 'If something is blocking it, tell me and I will help clear it.',
        '', info.ourName,
      ])
      : tone === 'firm'
        ? joinLines([
          hi, '',
          `${about} is still open and I have had no update for ${enWorkingDays(days)}.`,
          '', `Please send me the position today${by ? `, and a realistic date${by}` : ''}.`,
          '', info.ourName,
        ])
        : joinLines([
          hi, '',
          `${about} has now been sitting for ${enWorkingDays(days)} with no update, after more than one reminder.`,
          '', `I need the position${by || ' today'}. Otherwise I will have to raise it with management so a decision can be taken without it.`,
          '', info.ourName,
        ]);
    return { lang: 'en', tone, subject: `Reminder: ${info.subject}`, body };
  }

  const dear = info.counterparty ? `Dear ${info.counterparty},` : 'Dear Sir / Madam,';

  if (tone === 'gentle') {
    return {
      lang: 'en', tone,
      subject: `Follow-up: ${info.subject}`,
      body: joinLines([
        dear, '',
        `I am following up on our message${since} regarding ${about}, to which we have not yet had a reply.`,
        '', 'Could you kindly let us know where the matter stands? If anything is missing from our side, tell us and we will send it straight away.',
        '', 'Kind regards,', info.ourName,
      ]),
    };
  }

  if (tone === 'firm') {
    return {
      lang: 'en', tone,
      subject: `Second follow-up: ${info.subject}`,
      body: joinLines([
        dear, '',
        `We are writing again about ${about}. ${enWorkingDays(days)} have passed since our message${since} with no reply.`,
        '', `The delay is now holding up our side of the work, and we would be grateful for your answer${by || ' at your earliest convenience'}.`,
        '', 'Kind regards,', info.ourName,
      ]),
    };
  }

  return {
    lang: 'en', tone,
    subject: `Final reminder: ${info.subject}`,
    body: joinLines([
      dear, '',
      `Despite our previous letters regarding ${about}, we have still had no reply — ${enWorkingDays(days)} have now passed since our message${since}.`,
      '', `We ask for your answer${by || ' before the end of this week'}. If none reaches us, we will refer the matter to our management to take the decision it sees fit.`,
      '', 'Kind regards,', info.ourName,
    ]),
  };
}

// ── Arabic ───────────────────────────────────────────────────────────────────

function arabicLetter(info: FollowUpInfo, tone: FollowUpTone): FollowUpLetter {
  const days = info.waitingDays ?? 0;
  const about = info.reference ? `${info.subject} (المرجع: ${info.reference})` : info.subject;
  const since = info.lastContact ? ` المؤرخة ${info.lastContact}` : '';
  const by = info.needBy ? ` قبل ${info.needBy}` : '';
  const sign = info.ourName ? `\n${info.ourName}` : '';

  if (info.internal) {
    const hi = info.counterparty ? `الأستاذ/ ${info.counterparty}،` : 'تحية طيبة،';
    const body = tone === 'gentle'
      ? joinLines([
        hi, '',
        `أذكّرك بموضوع ${about}${info.needBy ? `، وقد حلّ موعده في ${info.needBy}` : ''}، ولم يصلني تحديث بعد.`,
        '', 'أرجو إفادتي بالموقف اليوم، وإن كان ثمة ما يعطّله فأخبرني لأساعدك في تذليله.',
        '', 'شكرًا لك،' + sign,
      ])
      : tone === 'firm'
        ? joinLines([
          hi, '',
          `ما زال موضوع ${about} مفتوحًا، ولم يصلني عنه تحديث منذ ${arWorkingDays(days)}.`,
          '', `أرجو موافاتي بالموقف اليوم${info.needBy ? `، وبموعد واقعي للإنجاز لا يتجاوز ${info.needBy}` : ''}.`,
          '', 'ولك الشكر،' + sign,
        ])
        : joinLines([
          hi, '',
          `مضى على موضوع ${about} ${arWorkingDays(days)} دون تحديث، رغم أكثر من تذكير.`,
          '', `أرجو إفادتي بالموقف${by || ' اليوم'}؛ وإلا عرضتُ الأمر على الإدارة لتقرر فيه.`,
          '', 'ولك الشكر،' + sign,
        ]);
    return { lang: 'ar', tone, subject: `تذكير: ${info.subject}`, body };
  }

  const to = info.counterparty ? `إلى السادة/ ${info.counterparty}` : 'إلى السادة المعنيين';

  if (tone === 'gentle') {
    return {
      lang: 'ar', tone,
      subject: `متابعة: ${info.subject}`,
      body: joinLines([
        to, 'تحية طيبة وبعد،', '',
        `نشير إلى رسالتنا${since} بشأن ${about}، ولم يصلنا ردكم حتى تاريخه.`,
        '', 'نرجو التكرم بإفادتنا بموقف الموضوع، وإن كان ينقصكم مستند من طرفنا فأبلغونا لنوافيكم به فورًا.',
        '', 'وتفضلوا بقبول وافر الاحترام،' + sign,
      ]),
    };
  }

  if (tone === 'firm') {
    return {
      lang: 'ar', tone,
      subject: `متابعة ثانية: ${info.subject}`,
      body: joinLines([
        to, 'تحية طيبة وبعد،', '',
        `نعاود الكتابة إليكم بشأن ${about}، ولم يصلنا ردكم على رسالتنا${since} منذ ${arWorkingDays(days)}.`,
        '', `ويؤخر هذا سير العمل لدينا، لذا نرجو موافاتنا بردكم${by || ' في أقرب وقت'}.`,
        '', 'وتفضلوا بقبول وافر الاحترام،' + sign,
      ]),
    };
  }

  return {
    lang: 'ar', tone,
    subject: `تذكير أخير: ${info.subject}`,
    body: joinLines([
      to, 'تحية طيبة وبعد،', '',
      `كتبنا إليكم أكثر من مرة بشأن ${about}، ولم يصلنا ردكم منذ ${arWorkingDays(days)}.`,
      '', `ونرجو إفادتنا${by || ' قبل نهاية هذا الأسبوع'}؛ وإلا رفعنا الأمر إلى إدارتنا لتتخذ ما تراه مناسبًا.`,
      '', 'وتفضلوا بقبول وافر الاحترام،' + sign,
    ]),
  };
}

/** One ready-to-send letter. `tone` defaults to what the wait has earned. */
export function buildFollowUpLetter(
  info: FollowUpInfo,
  lang: LetterLang,
  tone: FollowUpTone = toneFor(info.waitingDays),
): FollowUpLetter {
  return lang === 'ar' ? arabicLetter(info, tone) : englishLetter(info, tone);
}

/** Both languages at once — the modal shows them side by side. */
export function buildFollowUpPair(
  info: FollowUpInfo,
  tone: FollowUpTone = toneFor(info.waitingDays),
): Record<LetterLang, FollowUpLetter> {
  return {
    en: buildFollowUpLetter(info, 'en', tone),
    ar: buildFollowUpLetter(info, 'ar', tone),
  };
}

/**
 * Working days since a date on a record (a deadline, the day a letter arrived),
 * which is what `waitingDays` wants. 0 for a missing or future date, so a
 * record that is not late yet asks for the gentlest wording.
 */
export function waitingSince(from?: string, now: Date = new Date()): number {
  if (!from) return 0;
  const at = new Date(`${from}T00:00:00`).getTime();
  if (Number.isNaN(at) || at >= now.getTime()) return 0;
  return workingDaysBetween(new Date(at), now);
}

/**
 * A `mailto:` that opens the letter in whatever mail client the desk has.
 * It never sends anything — it only fills a draft, which is the whole point.
 */
export function mailtoUrl(letter: FollowUpLetter, to?: string): string {
  const q = `subject=${encodeURIComponent(letter.subject)}&body=${encodeURIComponent(letter.body)}`;
  return `mailto:${encodeURIComponent(to || '')}?${q}`;
}

// ── Escalation ───────────────────────────────────────────────────────────────
//
// "A task that passes its date twice with no update escalates to the manager."
//
// A task doc holds ONE dueDate and no history of the dates it used to have, so
// "twice" cannot be read literally from the data. It is read here as two full
// grace windows: the date passes (window one, which dueAlerts.ts already nags
// the owner about), then a second window passes and still nobody has touched
// the record. Any edit — a note, a status change, a new date — restarts the
// clock, because that is somebody moving it.
//
// The scan runs in the MANAGER's own browser and raises the notification for
// that manager. Doing it in the owner's browser instead would have every
// employee's tab notifying every manager about the same task.

/** Working days in one grace window. Two of them = escalation. */
export const ESCALATION_WINDOW_WORKING_DAYS = 3;
/** Quiet working days at which the manager is told. */
export const ESCALATE_LEVEL_1 = ESCALATION_WINDOW_WORKING_DAYS * 2;   // 6
/** …and at which they are told again, louder. */
export const ESCALATE_LEVEL_2 = ESCALATION_WINDOW_WORKING_DAYS * 4;   // 12

export interface EscalationItem {
  id: string;
  kind: 'task' | 'corresponding';
  label: string;
  serial?: string;
  /** yyyy-mm-dd — dueDate for a task, deadline for a correspondence. */
  due?: string;
  status?: string;
  priority?: string;
  ownerId?: string;
  ownerName?: string;
  /** Epoch ms of the last edit (updatedAt). Absent = never edited since. */
  updatedAt?: number;
}

const CLOSED = ['Done', 'Closed', 'Archived', 'Cancelled', 'Rejected'];

export const isEscalatable = (item: EscalationItem): boolean =>
  !!item.due && !CLOSED.includes(item.status ?? '');

/**
 * Working days this record has been both LATE and untouched. The clock starts
 * at the later of its due date and its last edit, so an update buys a fresh
 * window rather than cancelling the count for good.
 */
export function quietWorkingDays(item: EscalationItem, now: Date, weekend: number[] = WEEKEND_DAYS): number {
  if (!isEscalatable(item)) return 0;
  const due = new Date(`${item.due}T00:00:00`).getTime();
  if (Number.isNaN(due)) return 0;
  if (due >= now.getTime()) return 0;          // not late yet — nothing to escalate
  const from = Math.max(due, item.updatedAt ?? 0);
  if (from >= now.getTime()) return 0;         // edited in the future / just now
  return workingDaysBetween(new Date(from), now, weekend);
}

/** 0 = leave it alone, 1 = tell the manager, 2 = tell them again, louder. */
export function escalationLevel(item: EscalationItem, now: Date = new Date()): 0 | 1 | 2 {
  const quiet = quietWorkingDays(item, now);
  if (quiet >= ESCALATE_LEVEL_2) return 2;
  if (quiet >= ESCALATE_LEVEL_1) return 1;
  return 0;
}

/** "Ahmed's task TK000012 "Prepare the AGIBA offer" …" — the manager's message. */
export function buildEscalationMessage(item: EscalationItem, quiet: number, level: 1 | 2): string {
  const kind = item.kind === 'task' ? 'task' : 'correspondence';
  const who = item.ownerName ? `${item.ownerName}'s` : 'The unassigned';
  const head = [item.serial, `"${item.label}"`].filter(Boolean).join(' ');

  const lines = [
    level === 1
      ? `${who} ${kind} ${head} passed its date on ${item.due} and nobody has touched it for ${enWorkingDays(quiet)}.`
      : `${who} ${kind} ${head} is still not moving — ${enWorkingDays(quiet)} with no update since ${item.due}.`,
  ];

  const facts = [
    item.ownerName ? `Owner: ${item.ownerName}` : 'Owner: nobody',
    item.status && `Status: ${item.status}`,
    item.priority && `Priority: ${item.priority}`,
  ].filter(Boolean) as string[];
  lines.push(facts.join(' · '));

  lines.push(level === 1
    ? 'Reassign it, agree a new date, or close it.'
    : 'It has been escalated once already and nothing has changed.');

  return lines.join('\n');
}

// A first run on a neglected board must not fire fifty notifications.
const MAX_PER_RUN = 5;
const MAX_PER_DAY = 10;
const LEDGER_PREFIX = 'etaske:escalate:';
const DAILY_COUNT_KEY = '__count';
// An escalation is raised ONCE per record per level, so its ledger entry must
// outlive the day it was written — unlike the dueAlerts ledger, which is a
// per-day dedupe. Entries older than this are dropped so it cannot grow for ever.
const LEDGER_KEEP_DAYS = 120;

type Ledger = Record<string, string>; // "<id>:esc<level>" -> YYYY-MM-DD

/** Local calendar date — never toISOString(), which rolls over at 02:00 in Cairo. */
export function localDay(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function readLedger(uid: string): Ledger {
  try {
    return JSON.parse(localStorage.getItem(LEDGER_PREFIX + uid) || '{}') as Ledger;
  } catch {
    return {};
  }
}

function writeLedger(uid: string, ledger: Ledger, now: Date): void {
  const floor = now.getTime() - LEDGER_KEEP_DAYS * 86400000;
  const pruned: Ledger = {};
  for (const [k, v] of Object.entries(ledger)) {
    const stamp = v.split(':')[0];
    const at = new Date(`${stamp}T00:00:00`).getTime();
    if (Number.isNaN(at) || at >= floor) pruned[k] = v;
  }
  try {
    localStorage.setItem(LEDGER_PREFIX + uid, JSON.stringify(pruned));
  } catch {
    // Storage full / disabled — worst case an escalation repeats.
  }
}

export interface EscalationRun {
  uid: string;
  /** Only a Manager or Admin scans; an employee's browser does nothing here. */
  isManager: boolean;
  users: AppUser[];
  items: EscalationItem[];
  /** Injectable for the harness. */
  now?: Date;
}

/**
 * Raise escalations for the manager running this browser.
 *
 * Safe to call on every snapshot: the ledger is claimed BEFORE the first await
 * (several listeners call in here and would otherwise race into a double send),
 * and each record/level pair is only ever raised once.
 */
export async function runEscalations({
  uid, isManager, users, items, now = new Date(),
}: EscalationRun): Promise<void> {
  if (!isManager || !uid) return;

  const ledger = readLedger(uid);
  const stamp = localDay(now);
  const [countDate, countValue] = (ledger[DAILY_COUNT_KEY] ?? '').split(':');
  let dailyTotal = countDate === stamp ? Number(countValue) || 0 : 0;

  const batch: Array<{ item: EscalationItem; level: 1 | 2; quiet: number }> = [];
  // Longest quiet first, so a capped run reports the worst rather than the
  // first row the snapshot happened to hand us.
  const ranked = items
    .map(item => ({ item, quiet: quietWorkingDays(item, now) }))
    .sort((a, b) => b.quiet - a.quiet);

  for (const { item, quiet } of ranked) {
    if (batch.length >= MAX_PER_RUN || dailyTotal >= MAX_PER_DAY) break;
    const level = escalationLevel(item, now);
    if (!level) continue;
    const key = `${item.id}:esc${level}`;
    if (ledger[key]) continue;                 // this level already went out
    ledger[key] = stamp;
    dailyTotal += 1;
    batch.push({ item, level, quiet });
  }

  if (!batch.length) return;

  ledger[DAILY_COUNT_KEY] = `${stamp}:${dailyTotal}`;
  writeLedger(uid, ledger, now);

  for (const { item, level, quiet } of batch) {
    await createNotification({
      // The stem decides the deep link (refTypeForNotification), so an
      // escalated correspondence must not be announced as a task.
      type: item.kind === 'task' ? 'task_escalated' : 'corresponding_escalated',
      title: level === 1 ? '⚠️ Escalated — nobody has moved this' : '🚨 Escalated again — still not moving',
      message: buildEscalationMessage(item, quiet, level),
      forUserId: uid,
      read: false,
      relatedId: item.id,
      createdAt: serverTimestamp(),
    }, users);
  }
}
