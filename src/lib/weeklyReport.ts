// Weekly department report (queue task D9) — written in Arabic, from what the
// boards actually recorded during one week.
//
// Two halves, both pure (no Firebase, no i18n) so the harness can prove them:
//
//   buildWeeklyFacts   the records → what happened between Sunday and Saturday:
//                      tasks finished / added / still late, letters in and
//                      closed, bids submitted and decided, project updates,
//                      contracts running out, meetings held, each colleague's
//                      share, and what falls due the week after.
//   writeArabicReport  those facts → a plain-text Arabic report ready to paste
//                      into an e-mail or WhatsApp: one prose summary, then
//                      labelled sections, then next week.
//
// No AI (the repo is public and the site static — same reason as C1/D11). The
// Arabic is assembled from fixed phrases whose counted nouns agree with the
// number (مهمة واحدة · مهمتين · 5 مهام · 12 مهمة); the sections use
// "label: number" lines so no other sentence has to agree with a count.
//
// ⚠ What the records can and cannot say about the past:
//   · A task carries `completedAt` only when it was finished on the Tasks
//     board. Otherwise a Done/Archived task is dated by `archivedAt`, then by
//     `updatedAt` — an estimate, counted in `tasks.doneEstimated` and admitted
//     in the report's closing note.
//   · A letter keeps no closing date: a Closed letter is dated by `updatedAt`.
//   · A closed bid is dated by `decisionDate`, else by `updatedAt`.
//   · "Open / late at the end of the week" is rebuilt from those dates, so a
//     past week reads as it stood then, not as it stands today.
//   · Private tasks never reach this module (the page reads visible tasks).

import { buildDeadlines, expiryWatch, dayOf, iso, localDate, daysBetween, CONTRACT_WARN_DAYS } from './deadlineCalendar';

// ── Weeks ────────────────────────────────────────────────────────────────────

/** Sunday → Saturday, both yyyy-mm-dd. The Egyptian working week plus its weekend. */
export interface WeekRange { start: string; end: string }

const addDays = (day: string, n: number) => {
  const d = localDate(day);
  d.setDate(d.getDate() + n);
  return iso(d);
};

/** The Sunday-to-Saturday week a day falls in. */
export function weekOf(day: string): WeekRange {
  const d = localDate(day);
  const start = addDays(day, -d.getDay());
  return { start, end: addDays(start, 6) };
}

export const shiftWeek = (w: WeekRange, n: number): WeekRange => weekOf(addDays(w.start, 7 * n));

/**
 * The week a manager most likely wants: on Sunday–Tuesday the week just
 * finished (the report is being written for it), from Wednesday this week.
 */
export function defaultWeek(today: Date = new Date()): WeekRange {
  const w = weekOf(iso(today));
  return today.getDay() <= 2 ? shiftWeek(w, -1) : w;
}

/** `?w=yyyy-mm-dd` (any day of the week) → that week; anything else → null. */
export function parseWeekParam(v: string | null | undefined): WeekRange | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = localDate(v);
  if (isNaN(d.getTime()) || iso(d) !== v) return null;
  return weekOf(v);
}

const within = (day: string, w: WeekRange) => !!day && day >= w.start && day <= w.end;

// ── Input / output shapes ────────────────────────────────────────────────────

export interface WeeklyInput {
  /** Only the tasks this reader may see — private stays private. */
  tasks?: any[];
  correspondences?: any[];
  opportunities?: any[];
  projects?: any[];
  projectUpdates?: any[];
  meetings?: any[];
  /** projectContracts */
  contracts?: any[];
  /** projectSubcontracts */
  subcontracts?: any[];
  users?: Array<{ id: string; displayName?: string; status?: string }>;
}

export type ReportKind = 'task' | 'letter' | 'bid' | 'project' | 'contract' | 'meeting';

export interface ReportItem {
  id: string;
  kind: ReportKind;
  serial?: string;
  title: string;
  /** Owner, sender, client or project — whatever says whose it is. */
  who?: string;
  /** The day the thing happened / falls due (yyyy-mm-dd). */
  day?: string;
  /** Days late (tasks, letters, bids) or days left (contracts). */
  days?: number;
  /** A short extra: the latest project update, who a lost bid went to. */
  note?: string;
}

export interface PersonLine {
  id: string;
  name: string;
  done: number;
  added: number;
  open: number;
  late: number;
}

export interface WeeklyFacts {
  week: WeekRange;
  next: WeekRange;
  /** The day "open" and "late" are measured on: the week's Saturday, or today if earlier. */
  asOf: string;
  /** The week is still running. */
  current: boolean;
  tasks: {
    done: ReportItem[];
    /** How many of `done` are dated by a guess (archivedAt / updatedAt). */
    doneEstimated: number;
    added: ReportItem[];
    openAtEnd: number;
    /** Late at `asOf`, most late first. */
    late: ReportItem[];
  };
  letters: {
    received: ReportItem[];
    /** Senders with ≥ 2 letters this week, busiest first. */
    topSenders: Array<{ name: string; count: number }>;
    closed: number;
    /** Received this week and still Unread at `asOf`. */
    unread: number;
    /** Open at `asOf` with the deadline passed, most late first. */
    overdue: ReportItem[];
  };
  bids: {
    added: ReportItem[];
    submitted: ReportItem[];
    won: ReportItem[];
    lost: ReportItem[];
    noBid: ReportItem[];
    cancelled: ReportItem[];
    /** Still being prepared with the submission deadline passed. */
    missed: ReportItem[];
    awaitingDecision: number;
    open: number;
  };
  projects: {
    /** One row per project updated this week, the latest update as its note. */
    updated: ReportItem[];
    added: ReportItem[];
    /** Contracts / sub-contracts ending within CONTRACT_WARN_DAYS of `asOf`, nearest first. */
    contractsEnding: ReportItem[];
    /** Ended, not renewed, not closed. */
    contractsEnded: number;
    /** Checklist steps (bids + projects) ticked this week. */
    stepsDone: number;
  };
  meetings: {
    held: ReportItem[];
    actionPoints: number;
    /** Action points already turned into tasks. */
    actionTasks: number;
  };
  people: PersonLine[];
  coming: {
    tasksDue: ReportItem[];
    bidsClosing: ReportItem[];
    lettersDue: ReportItem[];
  };
  /** Nothing at all happened or is pending — the page says so instead of an empty report. */
  empty: boolean;
}

// ── Record helpers ───────────────────────────────────────────────────────────

const real = (list?: any[]) => (list || []).filter(r => r && r.id !== '--stats--');

const TASK_DONE = ['Done', 'Archived'];
const BID_PREPARING = ['Identified', 'Prequalification', 'Bid Preparation'];
const BID_AWAITING = ['Submitted', 'Under Evaluation'];
const BID_CLOSED = ['Won', 'Lost', 'No Bid', 'Cancelled'];

/** The day a task was finished, and whether that day is only an estimate. */
export function taskDoneDay(t: any): { day: string; estimated: boolean } | null {
  if (!TASK_DONE.includes(t.status)) return null;
  const exact = dayOf(t.completedAt);
  if (exact) return { day: exact, estimated: false };
  const guess = dayOf(t.archivedAt) || dayOf(t.updatedAt);
  // Finished at some unknown time — treat it as long ago, never as this week.
  return { day: guess || '0000-00-00', estimated: true };
}

const letterDay = (c: any) => (typeof c.dateReceived === 'string' && /^\d{4}-\d{2}-\d{2}/.test(c.dateReceived) ? c.dateReceived.slice(0, 10) : dayOf(c.createdAt));
const letterClosedDay = (c: any) => (c.status === 'Closed' ? dayOf(c.updatedAt) || '0000-00-00' : '');
const bidClosedDay = (o: any) => (BID_CLOSED.includes(o.stage) ? (dayOf(o.decisionDate) || dayOf(o.updatedAt) || '0000-00-00') : '');

const taskItem = (t: any, extra: Partial<ReportItem> = {}): ReportItem => ({
  id: t.id, kind: 'task', serial: t.serialNumber, title: t.taskName || '—', who: t.assignedTo || undefined, ...extra,
});
const letterItem = (c: any, extra: Partial<ReportItem> = {}): ReportItem => ({
  id: c.id, kind: 'letter', serial: c.serialNumber, title: c.subject || '—', who: c.sentFrom || undefined, ...extra,
});
const bidItem = (o: any, extra: Partial<ReportItem> = {}): ReportItem => ({
  id: o.id, kind: 'bid', serial: o.serialNumber, title: o.title || '—', who: o.client || undefined, ...extra,
});

const byDaysDesc = (a: ReportItem, b: ReportItem) => (b.days ?? 0) - (a.days ?? 0) || a.title.localeCompare(b.title);
const byDay = (a: ReportItem, b: ReportItem) => (a.day || '').localeCompare(b.day || '') || a.title.localeCompare(b.title);

/** Collapses whitespace and cuts at `max` characters on a word boundary. */
export function clip(text: string, max = 110): string {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trim()}…`;
}

// ── The facts ────────────────────────────────────────────────────────────────

export function buildWeeklyFacts(input: WeeklyInput, week: WeekRange, today: Date = new Date()): WeeklyFacts {
  const todayIso = iso(today);
  const asOf = week.end < todayIso ? week.end : todayIso;
  const current = week.end >= todayIso;
  const next = shiftWeek(week, 1);

  const tasks = real(input.tasks);
  const letters = real(input.correspondences);
  const bids = real(input.opportunities);
  const projects = real(input.projects);

  // ── Tasks ──
  const done: ReportItem[] = [];
  let doneEstimated = 0;
  const added: ReportItem[] = [];
  const late: ReportItem[] = [];
  let openAtEnd = 0;
  const tasksDue: ReportItem[] = [];
  const people = new Map<string, PersonLine>();
  const person = (id?: string, name?: string): PersonLine | null => {
    if (!id) return null;
    let p = people.get(id);
    if (!p) {
      const u = (input.users || []).find(x => x.id === id);
      p = { id, name: u?.displayName || name || '—', done: 0, added: 0, open: 0, late: 0 };
      people.set(id, p);
    }
    return p;
  };

  for (const t of tasks) {
    const created = dayOf(t.createdAt);
    const fin = taskDoneDay(t);
    const p = person(t.assignedToId, t.assignedTo);
    if (fin && within(fin.day, week)) {
      done.push(taskItem(t, { day: fin.day }));
      if (fin.estimated) doneEstimated++;
      if (p) p.done++;
    }
    if (within(created, week)) {
      added.push(taskItem(t, { day: created }));
      if (p) p.added++;
    }
    // Did it exist, and was it still open, on the measuring day?
    const existed = !created || created <= asOf;
    const openThen = existed && !(fin && fin.day <= asOf);
    if (openThen) {
      openAtEnd++;
      if (p) p.open++;
      const due = typeof t.dueDate === 'string' ? t.dueDate.slice(0, 10) : '';
      if (due && due < asOf) {
        late.push(taskItem(t, { day: due, days: daysBetween(due, asOf) }));
        if (p) p.late++;
      }
    }
    if (!fin && typeof t.dueDate === 'string' && within(t.dueDate.slice(0, 10), next)) {
      tasksDue.push(taskItem(t, { day: t.dueDate.slice(0, 10) }));
    }
  }

  // ── Letters ──
  const received: ReportItem[] = [];
  const senders = new Map<string, { name: string; count: number }>();
  let closed = 0;
  let unread = 0;
  const overdue: ReportItem[] = [];
  const lettersDue: ReportItem[] = [];
  for (const c of letters) {
    const got = letterDay(c);
    const shut = letterClosedDay(c);
    if (within(got, week)) {
      received.push(letterItem(c, { day: got }));
      const name = String(c.sentFrom || '').trim();
      if (name) {
        const key = name.toLowerCase();
        const s = senders.get(key) || { name, count: 0 };
        s.count++;
        senders.set(key, s);
      }
      if (c.status === 'Unread') unread++;
    }
    if (within(shut, week)) closed++;
    const openThen = (!got || got <= asOf) && !(shut && shut <= asOf);
    const deadline = typeof c.deadline === 'string' ? c.deadline.slice(0, 10) : '';
    if (openThen && deadline && deadline < asOf) overdue.push(letterItem(c, { day: deadline, days: daysBetween(deadline, asOf) }));
    if (!shut && deadline && within(deadline, next)) lettersDue.push(letterItem(c, { day: deadline }));
  }
  const topSenders = [...senders.values()].filter(s => s.count >= 2)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 3);

  // ── Bids ──
  const bidsAdded: ReportItem[] = [];
  const submitted: ReportItem[] = [];
  const won: ReportItem[] = [];
  const lost: ReportItem[] = [];
  const noBid: ReportItem[] = [];
  const cancelled: ReportItem[] = [];
  const missed: ReportItem[] = [];
  const bidsClosing: ReportItem[] = [];
  let awaitingDecision = 0;
  let openBids = 0;
  for (const o of bids) {
    const created = dayOf(o.createdAt);
    if (within(created, week)) bidsAdded.push(bidItem(o, { day: created }));
    const sub = dayOf(o.submittedDate);
    if (within(sub, week)) submitted.push(bidItem(o, { day: sub }));
    const shut = bidClosedDay(o);
    if (within(shut, week)) {
      if (o.stage === 'Won') won.push(bidItem(o, { day: shut }));
      else if (o.stage === 'Lost') lost.push(bidItem(o, { day: shut, note: o.awardedTo ? String(o.awardedTo) : undefined }));
      else if (o.stage === 'No Bid') noBid.push(bidItem(o, { day: shut }));
      else cancelled.push(bidItem(o, { day: shut }));
    }
    if (!BID_CLOSED.includes(o.stage)) openBids++;
    if (BID_AWAITING.includes(o.stage)) awaitingDecision++;
    const deadline = dayOf(o.submissionDeadline);
    if (BID_PREPARING.includes(o.stage) && deadline) {
      if (deadline < asOf) missed.push(bidItem(o, { day: deadline, days: daysBetween(deadline, asOf) }));
      else if (within(deadline, next)) bidsClosing.push(bidItem(o, { day: deadline }));
    }
  }

  // ── Projects, updates, contracts, checklist steps ──
  const projectName = new Map(projects.map(p => [p.id, p.name || '—']));
  const latestUpdate = new Map<string, { at: number; day: string; text: string; author?: string }>();
  for (const u of real(input.projectUpdates)) {
    const day = dayOf(u.createdAt);
    if (!within(day, week) || !u.projectId) continue;
    const at = typeof u.createdAt?.toMillis === 'function' ? u.createdAt.toMillis() : localDate(day).getTime();
    const prev = latestUpdate.get(u.projectId);
    if (!prev || at >= prev.at) latestUpdate.set(u.projectId, { at, day, text: String(u.text || ''), author: u.authorName });
  }
  const updated: ReportItem[] = [...latestUpdate.entries()].map(([pid, u]) => ({
    id: pid, kind: 'project' as const, title: projectName.get(pid) || '—', day: u.day, who: u.author, note: clip(u.text),
  })).sort((a, b) => a.title.localeCompare(b.title));
  const projectsAdded: ReportItem[] = projects.filter(p => within(dayOf(p.createdAt), week))
    .map(p => ({ id: p.id, kind: 'project' as const, serial: p.serialNumber, title: p.name || '—', who: p.client || undefined, day: dayOf(p.createdAt) }));

  const events = buildDeadlines({ projects, contracts: input.contracts, subcontracts: input.subcontracts }, localDate(asOf));
  const watch = expiryWatch(events);
  const contractsEnding: ReportItem[] = watch.ending.filter(e => e.daysLeft <= CONTRACT_WARN_DAYS).map(e => ({
    id: e.key, kind: 'contract' as const, serial: e.serial, title: e.title, who: e.context, day: e.date, days: e.daysLeft,
  }));

  let stepsDone = 0;
  for (const r of [...bids, ...projects]) {
    for (const step of Array.isArray(r.checklist) ? r.checklist : []) {
      if (step && step.done && within(dayOf(step.doneAt), week)) stepsDone++;
    }
  }

  // ── Meetings ──
  const held: ReportItem[] = [];
  let actionPoints = 0;
  let actionTasks = 0;
  for (const m of real(input.meetings)) {
    if (!within(m.date, week)) continue;
    held.push({ id: m.id, kind: 'meeting', title: m.title || '—', day: m.date, who: m.client || m.projectName || m.opportunityTitle || undefined });
    for (const a of Array.isArray(m.actions) ? m.actions : []) {
      if (!a || !String(a.text || '').trim()) continue;
      actionPoints++;
      if (a.taskId) actionTasks++;
    }
  }

  const peopleList = [...people.values()]
    .filter(p => p.done || p.added || p.open)
    .sort((a, b) => b.done - a.done || b.late - a.late || b.open - a.open || a.name.localeCompare(b.name));

  const facts: WeeklyFacts = {
    week, next, asOf, current,
    tasks: { done: done.sort(byDay), doneEstimated, added: added.sort(byDay), openAtEnd, late: late.sort(byDaysDesc) },
    letters: { received: received.sort(byDay), topSenders, closed, unread, overdue: overdue.sort(byDaysDesc) },
    bids: {
      added: bidsAdded.sort(byDay), submitted: submitted.sort(byDay), won, lost, noBid, cancelled,
      missed: missed.sort(byDaysDesc), awaitingDecision, open: openBids,
    },
    projects: { updated, added: projectsAdded, contractsEnding, contractsEnded: watch.ended.length, stepsDone },
    meetings: { held: held.sort(byDay), actionPoints, actionTasks },
    people: peopleList,
    coming: { tasksDue: tasksDue.sort(byDay), bidsClosing: bidsClosing.sort(byDay), lettersDue: lettersDue.sort(byDay) },
    empty: false,
  };
  facts.empty = activityCount(facts) === 0 && openAtEnd === 0 && openBids === 0;
  return facts;
}

/** Everything that HAPPENED in the week (not what is merely open). */
export function activityCount(f: WeeklyFacts): number {
  return f.tasks.done.length + f.tasks.added.length + f.letters.received.length + f.letters.closed
    + f.bids.added.length + f.bids.submitted.length + f.bids.won.length + f.bids.lost.length
    + f.bids.noBid.length + f.bids.cancelled.length + f.projects.updated.length + f.projects.added.length
    + f.projects.stepsDone + f.meetings.held.length;
}

// ── Arabic: dates ────────────────────────────────────────────────────────────

// Egyptian month names (never the Levantine آب/أيلول) and Latin digits — the app's convention.
const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const AR_WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** "الأحد 14 سبتمبر" (+ the year when asked). */
export function arDate(day: string, withYear = false): string {
  const d = localDate(day);
  const base = `${AR_WEEKDAYS[d.getDay()]} ${d.getDate()} ${AR_MONTHS[d.getMonth()]}`;
  return withYear ? `${base} ${d.getFullYear()}` : base;
}

/** "14 سبتمبر" — for list lines where the weekday is noise. */
const arShort = (day: string) => {
  const d = localDate(day);
  return `${d.getDate()} ${AR_MONTHS[d.getMonth()]}`;
};

/** "من الأحد 14 سبتمبر إلى السبت 20 سبتمبر 2026" (both years when the week crosses one). */
export function arWeekRange(w: WeekRange): string {
  const sameYear = w.start.slice(0, 4) === w.end.slice(0, 4);
  return `من ${arDate(w.start, !sameYear)} إلى ${arDate(w.end, true)}`;
}

// ── Arabic: counted nouns ────────────────────────────────────────────────────
//
// Each form is the one a DIRECT OBJECT takes (accusative), because every
// counted sentence below is built as "the team DID <count>". `oneGen` is the
// form after a preposition or in an idafa ("في عطاء واحد", "موعد مهمة واحدة");
// the dual and the plurals read the same in both cases.
//   1 → the noun + واحد/ة · 2 → the dual · 3–10 → digits + plural · 11+ → digits + singular.

export interface ArNoun { one: string; oneGen?: string; two: string; few: string; many: string }

export const AR = {
  task: { one: 'مهمة واحدة', two: 'مهمتين', few: 'مهام', many: 'مهمة' },
  lateTask: { one: 'مهمة واحدة متأخرة', two: 'مهمتين متأخرتين', few: 'مهام متأخرة', many: 'مهمة متأخرة' },
  letter: { one: 'خطابًا واحدًا', oneGen: 'خطاب واحد', two: 'خطابين', few: 'خطابات', many: 'خطابًا' },
  overdueLetter: { one: 'خطابًا واحدًا تجاوز موعده', two: 'خطابين تجاوزا موعدهما', few: 'خطابات تجاوزت مواعيدها', many: 'خطابًا تجاوزت مواعيدها' },
  offer: { one: 'عرضًا واحدًا', oneGen: 'عرض واحد', two: 'عرضين', few: 'عروض', many: 'عرضًا' },
  bid: { one: 'عطاءً واحدًا', oneGen: 'عطاء واحد', two: 'عطاءين', few: 'عطاءات', many: 'عطاءً' },
  missedBid: { one: 'عطاءً واحدًا فات موعد تقديمه', two: 'عطاءين فات موعد تقديمهما', few: 'عطاءات فات موعد تقديمها', many: 'عطاءً فات موعد تقديمها' },
  meeting: { one: 'اجتماعًا واحدًا', oneGen: 'اجتماع واحد', two: 'اجتماعين', few: 'اجتماعات', many: 'اجتماعًا' },
  project: { one: 'مشروعًا واحدًا', oneGen: 'مشروع واحد', two: 'مشروعين', few: 'مشروعات', many: 'مشروعًا' },
  day: { one: 'يومًا واحدًا', oneGen: 'يوم واحد', two: 'يومين', few: 'أيام', many: 'يومًا' },
} satisfies Record<string, ArNoun>;

/** 12 → "12 مهمة", 2 → "مهمتين", 1 → "مهمة واحدة" (accusative, or genitive with `gen`). */
export function arCount(n: number, noun: ArNoun, gen = false): string {
  if (n === 1) return gen ? (noun.oneGen || noun.one) : noun.one;
  if (n === 2) return noun.two;
  if (n >= 3 && n <= 10) return `${n} ${noun.few}`;
  return `${n} ${noun.many}`;
}

/** "بعطاءين" / "بـ3 عطاءات" — the preposition joins a word, and takes a tatweel before digits. */
const bi = (counted: string) => (/^\d/.test(counted) ? `بـ${counted}` : `ب${counted}`);

// ── Arabic: the report ───────────────────────────────────────────────────────

const ORDINALS = ['أولًا', 'ثانيًا', 'ثالثًا', 'رابعًا', 'خامسًا', 'سادسًا', 'سابعًا', 'ثامنًا'];

export interface ArabicReportOptions {
  /** Shown after "التقرير الأسبوعي — ", e.g. «إدارة تطوير الأعمال». */
  department?: string;
  /** How many records a list shows before "وغيرها: N". */
  maxList?: number;
}

/** "TK000123 إعداد عرض أجيبا (Mona Fathy)" */
function line(it: ReportItem, tail = ''): string {
  const head = [it.serial, clip(it.title, 90)].filter(Boolean).join(' ');
  const who = it.who ? ` (${clip(it.who, 40)})` : '';
  return `  - ${head}${who}${tail ? ` — ${tail}` : ''}`;
}

function list(items: ReportItem[], max: number, tail: (it: ReportItem) => string = () => ''): string[] {
  const out = items.slice(0, max).map(it => line(it, tail(it)));
  if (items.length > max) out.push(`  - وغيرها: ${items.length - max}`);
  return out;
}

/** The opening paragraph: what the team did, what it carries, what comes next. */
export function arabicSummary(f: WeeklyFacts): string {
  const did: Array<[string, string]> = [];
  if (f.tasks.done.length) did.push(['أنجز', arCount(f.tasks.done.length, AR.task)]);
  if (f.letters.received.length) did.push(['استقبل', arCount(f.letters.received.length, AR.letter)]);
  if (f.bids.submitted.length) did.push(['قدّم', arCount(f.bids.submitted.length, AR.offer)]);
  if (f.bids.won.length) did.push(['فاز', bi(arCount(f.bids.won.length, AR.bid, true))]);
  if (f.projects.updated.length) did.push(['حدّث', `موقف ${arCount(f.projects.updated.length, AR.project, true)}`]);
  if (f.meetings.held.length) did.push(['عقد', arCount(f.meetings.held.length, AR.meeting)]);

  const when = f.current ? 'حتى الآن هذا الأسبوع' : 'خلال الأسبوع';
  const sentences: string[] = [];
  if (did.length) {
    sentences.push(did.map(([verb, obj], i) => (i === 0 ? `${verb} الفريق ${when} ${obj}` : `و${verb} ${obj}`)).join('، ') + '.');
  } else {
    sentences.push(`لم يسجّل الفريق في ETaske أي إنجاز ${when}.`);
  }

  const carry: string[] = [];
  if (f.tasks.late.length) carry.push(arCount(f.tasks.late.length, AR.lateTask));
  if (f.letters.overdue.length) carry.push(arCount(f.letters.overdue.length, AR.overdueLetter));
  if (f.bids.missed.length) carry.push(arCount(f.bids.missed.length, AR.missedBid));
  if (carry.length) {
    const verb = f.current ? 'ويتابع الفريق اليوم' : 'وحمل الفريق إلى الأسبوع التالي';
    sentences.push(`${verb} ${carry.join(' و')}.`);
  }

  const soon: string[] = [];
  if (f.coming.bidsClosing.length) soon.push(`يُغلق باب التقديم في ${arCount(f.coming.bidsClosing.length, AR.bid, true)}`);
  if (f.coming.tasksDue.length) soon.push(`يحل موعد ${arCount(f.coming.tasksDue.length, AR.task, true)}`);
  if (soon.length) sentences.push(`وفي الأسبوع المقبل ${soon.join('، و')}.`);

  return sentences.join(' ');
}

/** The whole report as plain text (RTL when pasted into anything Arabic-aware). */
export function writeArabicReport(f: WeeklyFacts, opts: ArabicReportOptions = {}): string {
  const max = Math.max(1, opts.maxList ?? 5);
  const dept = (opts.department || '').trim();
  const out: string[] = [];
  out.push(dept ? `التقرير الأسبوعي — ${dept}` : 'التقرير الأسبوعي للإدارة');
  out.push(`الأسبوع ${arWeekRange(f.week)}`);
  if (f.current) out.push(`(الأرقام حتى اليوم، ${arDate(f.asOf)})`);
  out.push('');
  out.push('الخلاصة');
  out.push(arabicSummary(f));

  const sections: Array<{ title: string; body: string[] }> = [];
  const endWord = f.current ? 'حتى اليوم' : 'في نهاية الأسبوع';

  // Tasks
  {
    const t = f.tasks;
    const body: string[] = [];
    if (t.done.length) body.push(`• المنجزة: ${t.done.length}`);
    if (t.added.length) body.push(`• الجديدة: ${t.added.length}`);
    if (t.openAtEnd) body.push(`• المفتوحة ${endWord}: ${t.openAtEnd}${t.late.length ? `، المتأخرة منها: ${t.late.length}` : ''}`);
    if (t.done.length) body.push('أبرز ما أُنجز:', ...list(t.done, max));
    if (t.late.length) body.push('أقدم المتأخرات:', ...list(t.late, max, it => `متأخرة ${arCount(it.days || 0, AR.day)}`));
    if (body.length) sections.push({ title: 'المهام', body });
  }

  // Letters
  {
    const l = f.letters;
    const body: string[] = [];
    if (l.received.length) {
      const top = l.topSenders.length ? ` (أكثرها من: ${l.topSenders.map(s => `${s.name} ${s.count}`).join('، ')})` : '';
      body.push(`• الواردة: ${l.received.length}${top}`);
    }
    if (l.closed) body.push(`• المغلقة: ${l.closed}`);
    if (l.unread) body.push(`• وارد الأسبوع الذي لم يُفتح بعد: ${l.unread}`);
    if (l.overdue.length) {
      body.push(`• تجاوزت موعدها ولم تُغلق: ${l.overdue.length}`);
      body.push(...list(l.overdue, max, it => `متأخر ${arCount(it.days || 0, AR.day)}`));
    }
    if (body.length) sections.push({ title: 'المراسلات', body });
  }

  // Bids
  {
    const b = f.bids;
    const body: string[] = [];
    if (b.submitted.length) body.push(`• المقدَّمة: ${b.submitted.length}`, ...list(b.submitted, max));
    const results = b.won.length + b.lost.length + b.noBid.length + b.cancelled.length;
    if (results) {
      body.push('• النتائج:');
      for (const it of b.won.slice(0, max)) body.push(line(it, 'رسا علينا'));
      for (const it of b.lost.slice(0, max)) body.push(line(it, it.note ? `لم يرسُ علينا، ورسا على ${clip(it.note, 40)}` : 'لم يرسُ علينا'));
      for (const it of b.noBid.slice(0, max)) body.push(line(it, 'اعتذرنا عن التقدم'));
      for (const it of b.cancelled.slice(0, max)) body.push(line(it, 'أُلغيت المناقصة'));
      const shown = Math.min(b.won.length, max) + Math.min(b.lost.length, max) + Math.min(b.noBid.length, max) + Math.min(b.cancelled.length, max);
      if (results > shown) body.push(`  - وغيرها: ${results - shown}`);
    }
    if (b.added.length) body.push(`• الجديدة على اللوحة: ${b.added.length}`);
    if (b.missed.length) body.push(`• فات موعد تقديمها ولم تُقدَّم: ${b.missed.length}`, ...list(b.missed, max, it => `منذ ${arCount(it.days || 0, AR.day, true)}`));
    if (b.awaitingDecision) body.push(`• في انتظار قرار العميل: ${b.awaitingDecision}`);
    if (b.open && body.length) body.push(`• العطاءات المفتوحة إجمالًا: ${b.open}`);
    if (body.length) sections.push({ title: 'العطاءات', body });
  }

  // Projects and contracts
  {
    const p = f.projects;
    const body: string[] = [];
    if (p.updated.length) {
      body.push(`• المشروعات التي حُدِّث موقفها: ${p.updated.length}`);
      for (const it of p.updated.slice(0, max)) body.push(`  - ${clip(it.title, 60)}: ${it.note || '—'}`);
      if (p.updated.length > max) body.push(`  - وغيرها: ${p.updated.length - max}`);
    }
    if (p.added.length) body.push(`• المشروعات الجديدة: ${p.added.length}`, ...list(p.added, max));
    if (p.stepsDone) body.push(`• خطوات قوائم البدء المنجزة في العطاءات والمشروعات: ${p.stepsDone}`);
    if (p.contractsEnding.length) {
      body.push(`• عقود تنتهي خلال ${CONTRACT_WARN_DAYS} يومًا: ${p.contractsEnding.length}`);
      body.push(...list(p.contractsEnding, max, it => (it.days === 0 ? 'ينتهي اليوم' : `ينتهي في ${arShort(it.day!)} (بعد ${arCount(it.days || 0, AR.day, true)})`)));
    }
    if (p.contractsEnded) body.push(`• عقود انتهت ولم تُجدَّد أو تُغلق: ${p.contractsEnded}`);
    if (body.length) sections.push({ title: 'المشروعات والعقود', body });
  }

  // Meetings
  {
    const m = f.meetings;
    if (m.held.length) {
      const body = [`• الاجتماعات المنعقدة: ${m.held.length}`];
      for (const it of m.held.slice(0, max)) body.push(`  - ${arDate(it.day!)}: ${clip(it.title, 80)}${it.who ? ` (${clip(it.who, 40)})` : ''}`);
      if (m.held.length > max) body.push(`  - وغيرها: ${m.held.length - max}`);
      if (m.actionPoints) body.push(`• نقاط العمل المسجلة: ${m.actionPoints}، تحوّل منها إلى مهام: ${m.actionTasks}`);
      sections.push({ title: 'الاجتماعات', body });
    }
  }

  // People
  if (f.people.length) {
    const body = f.people.map(p => {
      const parts = [`المنجز ${p.done}`, `الجديد ${p.added}`, `المفتوح ${p.open}`];
      if (p.late) parts.push(`المتأخر ${p.late}`);
      return `  - ${p.name}: ${parts.join(' · ')}`;
    });
    sections.push({ title: 'حصة كل زميل من المهام', body });
  }

  // Next week
  {
    const c = f.coming;
    const body: string[] = [];
    if (c.bidsClosing.length) body.push(`• مواعيد تقديم العطاءات: ${c.bidsClosing.length}`, ...list(c.bidsClosing, max, it => arDate(it.day!)));
    if (c.tasksDue.length) body.push(`• مهام يحل موعدها: ${c.tasksDue.length}`, ...list(c.tasksDue, max, it => arDate(it.day!)));
    if (c.lettersDue.length) body.push(`• خطابات يحل موعد الرد عليها: ${c.lettersDue.length}`, ...list(c.lettersDue, max, it => arDate(it.day!)));
    if (body.length) sections.push({ title: `الأسبوع المقبل (${arWeekRange(f.next)})`, body });
  }

  sections.forEach((s, i) => {
    out.push('');
    out.push(`${ORDINALS[i] || `${i + 1}.`}: ${s.title}`);
    out.push(...s.body);
  });

  out.push('');
  out.push('—');
  const notes = [`أعدّ ETaske هذا التقرير آليًا من السجلات المدوّنة حتى ${arDate(f.asOf, true)}، ولا يشمل المهام الخاصة.`];
  if (f.tasks.doneEstimated) notes.push(`لم يُسجَّل يوم الإنجاز لبعض المهام المنجزة (${f.tasks.doneEstimated})، فاعتُمد يوم آخر تعديل عليها.`);
  out.push(notes.join(' '));
  return out.join('\n');
}

/** The e-mail subject line. */
export const arabicSubject = (f: WeeklyFacts, department?: string) =>
  `${department?.trim() ? `التقرير الأسبوعي — ${department.trim()}` : 'التقرير الأسبوعي للإدارة'}: ${arWeekRange(f.week)}`;
