/**
 * Mail → record suggestions (queue task B1).
 *
 * Pure logic: given one Outlook message and what the boards already know
 * (clients, live bids, live projects), decide WHICH record the mail should
 * become — a bid, a correspondence or a task — and pre-fill what can be read
 * out of the text: the real subject, the client, a submission/answer deadline,
 * a tender number, the priority.
 *
 * Nothing here touches Firestore, the bridge or the DOM, so `mailsuggest.mjs`
 * in scripts/harness runs the shipping code unmodified. The UI (OutlookFeed)
 * only renders what these functions return and hands an accepted suggestion to
 * the create form through src/lib/createIntent.ts.
 *
 * Reasons come back as CODES, not sentences: the wording is the UI's job, so a
 * suggestion reads in Arabic as well as it does in English.
 */

import { normalizeArabic } from '../utils';
import type { TaskPriority, CorrespondingCategory } from '../types';

export type SuggestedKind = 'opportunity' | 'corresponding' | 'task';

export type ReasonCode =
  | 'tender-words'      // the text asks for a bid
  | 'letter-words'      // official / contractual letter wording
  | 'action-words'      // somebody is being asked to do something
  | 'known-client'      // the counterparty is already on a board
  | 'internal-sender'   // same mail domain as the reader
  | 'external-sender'
  | 'deadline'          // a date was read out of the text
  | 'attachment'
  | 'high-importance';

export interface SuggestionReason {
  code: ReasonCode;
  /** Free value for the codes that quote something (client, date, word). */
  value?: string;
}

/** An existing record the mail seems to belong to. */
export interface SuggestionMatch {
  type: 'opportunity' | 'project';
  id: string;
  label: string;
}

export interface MailSuggestion {
  emailId: string;
  kind: SuggestedKind;
  /** Cleaned subject — RE:/FW: and [EXTERNAL] tags removed. */
  title: string;
  client: string;
  category: CorrespondingCategory;
  priority: TaskPriority;
  /** ISO yyyy-mm-dd when a date could be read, else undefined. */
  deadline?: string;
  tenderNumber?: string;
  confidence: 'high' | 'medium' | 'low';
  reasons: SuggestionReason[];
  match?: SuggestionMatch;
}

/** One party (client) the app already deals with, and where it came from. */
export interface KnownParty {
  name: string;
  type: 'opportunity' | 'project';
  id: string;
  label: string;
}

export interface SuggestEmail {
  id: string;
  subject: string;
  sender: string;
  sender_email: string;
  body_preview: string;
  received_at: string;
  importance?: string;
  has_attachments?: boolean;
  attachment_names?: string[];
  direction?: 'sent' | 'received';
}

export interface SuggestContext {
  /** The reader's own mail domain — mail from it is internal. */
  ownDomain: string;
  parties: KnownParty[];
  /** Injectable for the harness; defaults to today. */
  today?: Date;
}

// ── Vocabulary ───────────────────────────────────────────────────────────────
// Matched against `normalizeArabic(subject + body)`, so the Arabic entries are
// written in their normalized form (ه not ة, ا not أ/إ/آ, ي not ى).

const TENDER_WORDS = [
  'tender', 'rfq', 'rfp', 'itb', 'invitation to bid', 'invitation to tender',
  'bid', 'bidding', 'prequalification', 'pre-qualification', 'eoi',
  'expression of interest', 'request for quotation', 'request for proposal',
  'quotation request', 'technical offer', 'commercial offer',
  'مناقصه', 'عطاء', 'عطاءات', 'كراسه الشروط', 'دعوه للمناقصه', 'طلب عرض سعر',
  'طلب عروض', 'عرض فني', 'عرض مالي', 'تاهيل مسبق', 'ممارسه',
];

const LETTER_WORDS = [
  'letter', 'official', 'our ref', 'your ref', 'contract', 'agreement',
  'addendum', 'amendment', 'minutes of meeting', 'notification',
  'approval', 'invoice', 'purchase order', 'service order', 'certificate',
  'خطاب', 'مذكره', 'اشعار', 'عقد', 'اتفاقيه', 'محضر اجتماع', 'موافقه',
  'فاتوره', 'امر شراء', 'امر شغل', 'شهاده', 'مرفق طيه', 'اشاره الي',
];

const ACTION_WORDS = [
  'please', 'kindly', 'action required', 'required', 'asap', 'urgent',
  'follow up', 'reminder', 'revert', 'confirm',
  'برجاء', 'يرجي', 'مطلوب', 'عاجل', 'للتنفيذ', 'للمراجعه', 'متابعه', 'تذكير',
  'افاده', 'الرد',
];

const DEADLINE_WORDS = [
  'deadline', 'closing date', 'closes on', 'due by', 'due on', 'submission date',
  'last date', 'not later than', 'no later than', 'expiry', 'valid until',
  'الموعد النهائي', 'اخر موعد', 'تاريخ الاقفال', 'موعد التسليم',
  'قبل تاريخ', 'حتي تاريخ',
];

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

// ── Small helpers ────────────────────────────────────────────────────────────

const hit = (haystack: string, words: string[]): string | null => {
  for (const w of words) if (haystack.includes(w)) return w;
  return null;
};

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Strip the reply/forward prefixes and the mail-gateway tags an Outlook subject
 * collects, so "RE: FW: [EXTERNAL] Tender 123" becomes "Tender 123".
 */
export function cleanSubject(subject: string): string {
  let s = (subject || '').trim();
  const prefix = /^\s*(re|fw|fwd|rif|رد|اعاده توجيه|إعادة توجيه)\s*[:：]\s*/i;
  const tag = /^\s*[[(](external|caution|spam|suspected[^\])]*)[\])]\s*/i;
  for (let i = 0; i < 6; i++) {
    const before = s;
    s = s.replace(prefix, '').replace(tag, '');
    if (s === before) break;
  }
  return s.trim() || (subject || '').trim();
}

/** The company part of an address: "a.hassan@agiba.com.eg" → "agiba". */
export function domainOf(address: string): string {
  const at = (address || '').split('@')[1];
  if (!at) return '';
  const parts = at.toLowerCase().split('.').filter(Boolean);
  if (!parts.length) return '';
  // Drop the public suffix ("com", "com.eg", "co.uk") to land on the company.
  const generic = new Set(['com', 'net', 'org', 'gov', 'eg', 'uk', 'co', 'sa', 'ae', 'ly', 'om']);
  let i = parts.length - 1;
  while (i > 0 && generic.has(parts[i])) i--;
  return parts[i] || '';
}

/**
 * A tender / RFQ reference out of the text — the number the client will quote
 * back at you, so it is worth carrying onto the bid.
 */
export function detectTenderNumber(text: string): string | undefined {
  // Every keyword is tried, not just the first: in "New tender from AGIBA,
  // RFQ-2026-118" the first one is followed by a word, the second by the number.
  const all = text.matchAll(
    /(?:tender|rfq|rfp|itb|bid|enquiry|inquiry|مناقصه|مناقصة|عطاء)\s*(?:no\.?|number|ref\.?|reference|#|رقم)?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9/-]{3,24})/gi,
  );
  for (const m of all) {
    const raw = m[1].replace(/[.,;:]+$/, '');
    // A bare word ("required", "documents") is not a reference — insist on a digit.
    if (/\d/.test(raw)) return raw;
  }
  return undefined;
}

/**
 * First plausible FUTURE date in the text. Handles 12/10/2026, 2026-10-12,
 * "12 October 2026", "October 12, 2026" and "within 9 days" / "خلال 9 ايام".
 * Past dates are ignored — a deadline that has gone is not a deadline.
 */
export function detectDeadline(text: string, today: Date): string | undefined {
  const horizon = new Date(today.getTime());
  horizon.setFullYear(horizon.getFullYear() + 2);
  const ok = (d: Date) => {
    if (Number.isNaN(d.getTime())) return false;
    const floor = new Date(today.getTime());
    floor.setDate(floor.getDate() - 1);
    return d >= floor && d <= horizon;
  };

  // "within/in N days|weeks" — counted from the day the mail arrived.
  const rel = text.match(/(?:within|in|خلال)\s+(\d{1,3})\s*(days?|working days?|weeks?|ايام|يوم|اسابيع|اسبوع|أيام|أسابيع|أسبوع)/i);
  if (rel) {
    const n = Number(rel[1]);
    const weeks = /week|اسبوع|اسابيع|أسبوع|أسابيع/i.test(rel[2]);
    const d = new Date(today.getTime());
    d.setDate(d.getDate() + n * (weeks ? 7 : 1));
    if (ok(d)) return iso(d);
  }

  // yyyy-mm-dd
  const isoM = text.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoM) {
    const d = new Date(Number(isoM[1]), Number(isoM[2]) - 1, Number(isoM[3]));
    if (ok(d)) return iso(d);
  }

  // dd/mm/yyyy — day first, which is how Egypt and the Gulf write it.
  const dmy = text.match(/(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})/);
  if (dmy) {
    const d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    if (ok(d)) return iso(d);
  }

  // 12 October 2026
  const dMon = text.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(20\d{2})/);
  if (dMon) {
    const mo = MONTHS[dMon[2].slice(0, 4).toLowerCase()] ?? MONTHS[dMon[2].slice(0, 3).toLowerCase()];
    if (mo) {
      const d = new Date(Number(dMon[3]), mo - 1, Number(dMon[1]));
      if (ok(d)) return iso(d);
    }
  }

  // October 12, 2026
  const monD = text.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(20\d{2})/);
  if (monD) {
    const mo = MONTHS[monD[1].slice(0, 4).toLowerCase()] ?? MONTHS[monD[1].slice(0, 3).toLowerCase()];
    if (mo) {
      const d = new Date(Number(monD[3]), mo - 1, Number(monD[2]));
      if (ok(d)) return iso(d);
    }
  }
  return undefined;
}

/**
 * Which client the mail is with. A name already on a board wins (and carries
 * the record it came from); otherwise the sender's own domain is the first
 * guess, so the field is never left blank for outside mail.
 */
export function detectParty(
  email: SuggestEmail,
  parties: KnownParty[],
  internal: boolean,
): { client: string; match?: SuggestionMatch } {
  const hay = normalizeArabic(`${email.subject} ${email.body_preview} ${email.sender} ${email.sender_email}`);
  // Longest name first: "AGIBA Meleiha" must beat a bare "AGIBA".
  const ranked = [...parties].sort((a, b) => b.name.length - a.name.length);
  for (const p of ranked) {
    const name = normalizeArabic(p.name).trim();
    if (name.length < 3) continue;
    if (hay.includes(name)) {
      return { client: p.name, match: { type: p.type, id: p.id, label: p.label } };
    }
  }
  if (internal) return { client: '' };
  const dom = domainOf(email.sender_email);
  if (!dom || dom.length < 3) return { client: '' };
  return { client: dom.toUpperCase() };
}

// ── The suggestion itself ────────────────────────────────────────────────────

export function suggestFromEmail(email: SuggestEmail, ctx: SuggestContext): MailSuggestion {
  const today = ctx.today ?? new Date();
  const title = cleanSubject(email.subject);
  const rawText = `${email.subject}\n${email.body_preview}`;
  const hay = normalizeArabic(rawText);
  const internal = !!ctx.ownDomain && !!email.sender_email &&
    domainOf(email.sender_email) === domainOf(`x@${ctx.ownDomain}`);

  const reasons: SuggestionReason[] = [];
  const tender = hit(hay, TENDER_WORDS);
  const letter = hit(hay, LETTER_WORDS);
  const action = hit(hay, ACTION_WORDS);
  const deadlineWord = hit(hay, DEADLINE_WORDS);

  const { client, match } = detectParty(email, ctx.parties, internal);
  const deadline = detectDeadline(rawText, today);
  const tenderNumber = detectTenderNumber(rawText);

  // Kind. A tender from outside wins outright; otherwise outside mail is a
  // correspondence and inside mail is a task (an instruction from a colleague).
  let kind: SuggestedKind;
  if (tender && !internal) kind = 'opportunity';
  else if (tender && tenderNumber) kind = 'opportunity';
  else if (!internal) kind = 'corresponding';
  else kind = 'task';

  if (tender) reasons.push({ code: 'tender-words', value: tender });
  else if (letter) reasons.push({ code: 'letter-words', value: letter });
  if (action && kind === 'task') reasons.push({ code: 'action-words', value: action });
  if (match) reasons.push({ code: 'known-client', value: client });
  reasons.push({ code: internal ? 'internal-sender' : 'external-sender', value: email.sender });
  if (deadline) reasons.push({ code: 'deadline', value: deadline });
  if (email.has_attachments) {
    reasons.push({ code: 'attachment', value: String((email.attachment_names || []).length || 1) });
  }
  if (email.importance === 'High') reasons.push({ code: 'high-importance' });

  // Priority: the mail's own flag, an approaching deadline, or the wording.
  let priority: TaskPriority = 'Medium';
  if (email.importance === 'High') priority = 'High';
  if (deadline) {
    const days = Math.round((new Date(deadline).getTime() - today.getTime()) / 86400000);
    if (days <= 3) priority = 'Urgent';
    else if (days <= 7) priority = 'High';
  }
  if (priority === 'Medium' && /urgent|asap|عاجل/i.test(hay)) priority = 'High';

  // Confidence — how much of the guess rests on something concrete.
  let score = 0;
  if (tender) score += 2;
  if (letter) score += 1;
  if (match) score += 2;
  if (deadline) score += 1;
  if (deadlineWord) score += 1;
  if (tenderNumber) score += 1;
  if (email.has_attachments) score += 1;
  const confidence: MailSuggestion['confidence'] = score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low';

  const category: CorrespondingCategory =
    internal ? 'Internal' : match?.type === 'project' ? 'Project' : 'External';

  return {
    emailId: email.id,
    kind,
    title,
    client,
    category,
    priority,
    deadline,
    tenderNumber,
    confidence,
    reasons,
    match,
  };
}

/** Sorting weight — the most actionable suggestion first. */
const CONFIDENCE_RANK: Record<MailSuggestion['confidence'], number> = { high: 0, medium: 1, low: 2 };

/**
 * The order the cards are shown in: surest first, then the nearest deadline.
 * Exported because `mailThreads.ts` (queue task B2) builds the same list one
 * card per thread and must not invent a second order.
 */
export function compareSuggestions(a: MailSuggestion, b: MailSuggestion): number {
  const c = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
  if (c) return c;
  // Within the same confidence, the nearest deadline is the most urgent.
  const ad = a.deadline || '9999-12-31';
  const bd = b.deadline || '9999-12-31';
  return ad.localeCompare(bd);
}

export interface SuggestListOptions extends SuggestContext {
  /** Ignore mail older than this many days (default 14). */
  windowDays?: number;
  /** Cap the list so the page stays readable (default 12). */
  limit?: number;
  /** Email ids already accepted or dismissed. */
  handled?: Record<string, MailHandledState>;
}

/**
 * The suggestion queue for a fetched inbox: received mail only, inside the
 * window, not already dealt with, best first — ONE CARD PER MESSAGE.
 *
 * The Outlook Feed calls `threadSuggestions` in `mailThreads.ts` instead since
 * queue task B2, so that a reply chain is offered once rather than three times.
 * This stays as the per-message form of the same queue.
 */
export function suggestionsFor(emails: SuggestEmail[], opts: SuggestListOptions): MailSuggestion[] {
  const today = opts.today ?? new Date();
  const windowDays = opts.windowDays ?? 14;
  const limit = opts.limit ?? 12;
  const handled = opts.handled || {};
  const floor = today.getTime() - windowDays * 86400000;

  const rows = emails.filter(e => {
    if (!e || !e.id) return false;
    if (e.direction === 'sent') return false;
    if (handled[e.id]) return false;
    if (e.received_at) {
      const at = new Date(e.received_at).getTime();
      if (!Number.isNaN(at) && at < floor) return false;
    }
    return true;
  });

  const out = rows.map(e => suggestFromEmail(e, opts));
  out.sort(compareSuggestions);
  return out.slice(0, limit);
}

// ── The "already dealt with" ledger ──────────────────────────────────────────
// One localStorage key, the same shape as the dueAlerts ledger: a suggestion
// that was accepted or waved away must not come back on the next auto-pull.

export type MailHandledState = 'accepted' | 'dismissed';

export const MAIL_LEDGER_KEY = 'etaske-mail-suggestions-v1';
const LEDGER_MAX = 400;

export function loadMailLedger(): Record<string, MailHandledState> {
  try {
    const raw = localStorage.getItem(MAIL_LEDGER_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {}; // private mode / corrupt value — suggest everything again
  }
}

export function markMailHandled(
  id: string,
  state: MailHandledState,
  ledger: Record<string, MailHandledState> = loadMailLedger(),
): Record<string, MailHandledState> {
  const next = { ...ledger, [id]: state };
  // Trim the oldest entries once it grows — entry ids are unbounded.
  const keys = Object.keys(next);
  if (keys.length > LEDGER_MAX) {
    for (const k of keys.slice(0, keys.length - LEDGER_MAX)) delete next[k];
  }
  try {
    localStorage.setItem(MAIL_LEDGER_KEY, JSON.stringify(next));
  } catch {
    /* storage full or blocked — the suggestion simply reappears later */
  }
  return next;
}
