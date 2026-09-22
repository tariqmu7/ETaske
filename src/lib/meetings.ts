// ─── Meeting helper (queue task D5) ──────────────────────────────────────────
//
// Before a meeting: an agenda, with items the boards suggest for it — last
// meeting's unfinished action points, the linked bid's deadline, late tasks of
// the people attending, open letters, checklist steps falling due.
// After it: the minutes (what was said and decided under each agenda item),
// a draft of the minutes as a letter in Arabic or English, and the action
// points — each one becomes a real task on the Tasks board in one click.
//
// Meetings live in their own `meetings` collection (one doc per meeting; the
// agenda and the action points are arrays on it). Created tasks carry
// `meetingId`, and the meeting keeps each task's id + serial, so the list can
// show which action points are done without a second copy of the status.
//
// Pure: no Firebase, no React, no i18n — `scripts/harness/meetings.mjs`
// bundles it as-is. The UI composes the display sentences for suggestions;
// the letter texts (invitation, minutes) are built here in both languages,
// the same way `followUp.ts` builds its chasers.

import { normalizeArabic } from '../utils';
import type { TaskPriority } from '../types';
import { clientKey, textNamesClient } from './clientFile';
import { readCapture, titleFrom, latinDigits, type CapturePerson } from './quickCapture';

// ── Shapes ───────────────────────────────────────────────────────────────────

export type MeetingRefType = 'task' | 'corresponding' | 'opportunity' | 'project';

export interface MeetingRef {
  type: MeetingRefType;
  id: string;
  serial?: string;
}

export type SuggestSource =
  | 'carry'          // an action point from the previous meeting, not done yet
  | 'bid-deadline'   // a bid in scope whose submission date is close (or just passed)
  | 'bid-decision'   // a submitted bid still waiting for the client's decision
  | 'late-task'      // an open task past its date
  | 'open-task'      // an open task on the linked bid / project
  | 'letter'         // an open letter on the linked bid / project / client
  | 'step';          // an unticked checklist step due soon

export interface AgendaItem {
  id: string;
  text: string;
  /** Set when the item came from a suggestion — hides that suggestion. */
  key?: string;
  source?: SuggestSource;
  ref?: MeetingRef;
  /** What was said (the minutes). */
  notes?: string;
  /** What was decided. */
  decision?: string;
}

export interface ActionPoint {
  id: string;
  text: string;
  ownerId?: string;
  ownerName?: string;
  /** yyyy-mm-dd */
  due?: string;
  priority: TaskPriority;
  /** Set once the task exists — the action is never turned into a task twice. */
  taskId?: string;
  taskSerial?: string;
}

export interface Meeting {
  id: string;
  title: string;
  /** yyyy-mm-dd */
  date: string;
  /** HH:MM, 24-hour */
  time?: string;
  place?: string;
  attendeeIds: string[];
  /** People from outside the app (the client's side, consultants) — free text. */
  guests?: string;
  client?: string;
  opportunityId?: string;
  opportunitySerial?: string;
  opportunityTitle?: string;
  projectId?: string;
  projectName?: string;
  agenda: AgendaItem[];
  /** Anything said that belongs to no agenda item. */
  notes?: string;
  actions: ActionPoint[];
  /** The id of the minutes filed on the project's Documents tab (D4), once filed. */
  minutesDocId?: string;
  createdById: string;
  createdBy?: string;
}

// ── Small helpers ────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const dayMs = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};
/** Whole days from `from` to `to` (yyyy-mm-dd both). */
export const daysBetween = (from: string, to: string) => Math.round((dayMs(to) - dayMs(from)) / 86_400_000);

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
/** A stored date may carry a time ("2026-09-30T12:00") — keep the day. */
const dayPart = (v: unknown): string => (typeof v === 'string' && isDay(v.slice(0, 10)) ? v.slice(0, 10) : '');

let seq = 0;
export const newItemId = (prefix = 'm', now = Date.now()) =>
  `${prefix}_${now.toString(36)}_${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Drop undefined keys — Firestore rejects `undefined` values. */
export function compact<T extends object>(o: T): T {
  const out: any = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

const fold = (s?: string | null) =>
  normalizeArabic(latinDigits(String(s || ''))).replace(/[^\p{L}\d]+/gu, ' ').replace(/\s+/g, ' ').trim();

export const TITLE_MAX = 160;
export const TEXT_MAX = 2000;
export const MAX_AGENDA = 40;
export const MAX_ACTIONS = 60;

// ── Validation + building ────────────────────────────────────────────────────

export type MeetingProblem = 'title' | 'date' | 'time';

export function validateMeeting(m: Partial<Pick<Meeting, 'title' | 'date' | 'time'>>): MeetingProblem | null {
  if (!m.title || !m.title.trim()) return 'title';
  if (!isDay(m.date)) return 'date';
  if (m.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(m.time)) return 'time';
  return null;
}

const clip = (s: string | undefined, max: number) => {
  const v = (s || '').trim();
  return v ? v.slice(0, max) : undefined;
};

/**
 * The doc written for a meeting — trimmed, capped and without undefined keys.
 * Used for the first write and every save, so a save can never store a shape
 * the list does not expect.
 */
export function meetingFields(m: Omit<Meeting, 'id'>): Record<string, unknown> {
  return compact({
    title: clip(m.title, TITLE_MAX) || '',
    date: m.date,
    time: clip(m.time, 5),
    place: clip(m.place, 200),
    attendeeIds: [...new Set(m.attendeeIds || [])],
    guests: clip(m.guests, 500),
    client: clip(m.client, 200),
    opportunityId: m.opportunityId || undefined,
    opportunitySerial: m.opportunityId ? m.opportunitySerial : undefined,
    opportunityTitle: m.opportunityId ? m.opportunityTitle : undefined,
    projectId: m.projectId || undefined,
    projectName: m.projectId ? m.projectName : undefined,
    agenda: (m.agenda || [])
      .filter(a => a.text && a.text.trim())
      .slice(0, MAX_AGENDA)
      .map(a => compact({
        id: a.id,
        text: clip(a.text, 400)!,
        key: a.key,
        source: a.source,
        ref: a.ref ? compact({ ...a.ref }) : undefined,
        notes: clip(a.notes, TEXT_MAX),
        decision: clip(a.decision, 1000),
      })),
    notes: clip(m.notes, TEXT_MAX * 2),
    actions: (m.actions || [])
      .filter(a => a.text && a.text.trim())
      .slice(0, MAX_ACTIONS)
      .map(a => compact({
        id: a.id,
        text: clip(a.text, 300)!,
        ownerId: a.ownerId || undefined,
        ownerName: a.ownerId ? a.ownerName : undefined,
        due: isDay(a.due) ? a.due : undefined,
        priority: a.priority || 'Medium',
        taskId: a.taskId,
        taskSerial: a.taskSerial,
      })),
    minutesDocId: m.minutesDocId,
    createdById: m.createdById,
    createdBy: clip(m.createdBy, 120),
  });
}

// ── Where a meeting stands ───────────────────────────────────────────────────

/** Anything was written after the meeting: notes, a decision or an action point. */
export const hasMinutes = (m: Pick<Meeting, 'agenda' | 'notes' | 'actions'>) =>
  !!(m.notes && m.notes.trim())
  || (m.actions || []).length > 0
  || (m.agenda || []).some(a => (a.notes && a.notes.trim()) || (a.decision && a.decision.trim()));

export type MeetingStage = 'upcoming' | 'today' | 'needs-minutes' | 'done';

export function meetingStage(m: Pick<Meeting, 'date' | 'agenda' | 'notes' | 'actions'>, today: string): MeetingStage {
  if (m.date > today) return 'upcoming';
  if (m.date === today) return 'today';
  return hasMinutes(m) ? 'done' : 'needs-minutes';
}

/** The creator, an attendee or a manager — the same people the rules let write. */
export const canEditMeeting = (m: Pick<Meeting, 'createdById' | 'attendeeIds'>, uid: string, isManager: boolean) =>
  isManager || m.createdById === uid || (m.attendeeIds || []).includes(uid);

/** Deleting is narrower: the creator or a manager. */
export const canDeleteMeeting = (m: Pick<Meeting, 'createdById'>, uid: string, isManager: boolean) =>
  isManager || m.createdById === uid;

export const isMyMeeting = (m: Pick<Meeting, 'createdById' | 'attendeeIds'>, uid: string) =>
  m.createdById === uid || (m.attendeeIds || []).includes(uid);

export interface MeetingLists {
  /** Today and later, soonest first. */
  upcoming: Meeting[];
  /** Held, nothing written yet — newest first. */
  needsMinutes: Meeting[];
  /** Held and written up — newest first. */
  done: Meeting[];
}

export function listMeetings(meetings: Meeting[], today: string): MeetingLists {
  const out: MeetingLists = { upcoming: [], needsMinutes: [], done: [] };
  for (const m of meetings) {
    const s = meetingStage(m, today);
    (s === 'upcoming' || s === 'today' ? out.upcoming : s === 'needs-minutes' ? out.needsMinutes : out.done).push(m);
  }
  const at = (m: Meeting) => `${m.date} ${m.time || '99:99'}`;
  out.upcoming.sort((a, b) => at(a).localeCompare(at(b)));
  out.needsMinutes.sort((a, b) => at(b).localeCompare(at(a)));
  out.done.sort((a, b) => at(b).localeCompare(at(a)));
  return out;
}

// ── Action points and their tasks ────────────────────────────────────────────

const DONE_TASK = new Set(['Done', 'Archived']);

export type ActionState = 'draft' | 'open' | 'late' | 'done' | 'gone';

/**
 * Where one action point stands. `tasks` is what the reader may see; a task
 * that is not in it was deleted OR is private to somebody else — both read as
 * 'gone', which the UI words as "task not visible", never "deleted".
 */
export function actionState(a: ActionPoint, tasksById: Map<string, any>, today: string): ActionState {
  if (!a.taskId) return 'draft';
  const t = tasksById.get(a.taskId);
  if (!t) return 'gone';
  if (DONE_TASK.has(t.status)) return 'done';
  const due = dayPart(t.dueDate);
  return due && due < today ? 'late' : 'open';
}

export function actionSummary(actions: ActionPoint[], tasksById: Map<string, any>, today: string) {
  let created = 0, done = 0, late = 0;
  for (const a of actions || []) {
    const s = actionState(a, tasksById, today);
    if (s !== 'draft') created++;
    if (s === 'done') done++;
    if (s === 'late') late++;
  }
  return { total: (actions || []).length, created, done, late, drafts: (actions || []).length - created };
}

/** A draft action needs words; an owner is not required (it falls back to the creator). */
export const readyActions = (actions: ActionPoint[]) =>
  (actions || []).filter(a => !a.taskId && a.text && a.text.trim());

/**
 * The task doc for one action point — every field the Tasks board expects
 * (the same shape `CreateTaskPanel` writes), minus the serial and the
 * timestamps, which the caller adds. The owner falls back to whoever creates
 * the tasks, like an unassigned task on the board does.
 */
export function actionTaskFields(
  a: ActionPoint,
  meeting: Pick<Meeting, 'id' | 'title' | 'date' | 'opportunityId' | 'opportunitySerial' | 'opportunityTitle' | 'projectId' | 'projectName'>,
  by: { uid: string; name: string; teamId?: string; department?: string },
  lang: 'en' | 'ar',
): Record<string, unknown> {
  const ownerId = a.ownerId || by.uid;
  const ownerName = a.ownerId ? (a.ownerName || '') : by.name;
  const from = lang === 'ar'
    ? `من اجتماع «${meeting.title}» بتاريخ ${numericDate(meeting.date)}.`
    : `From the meeting "${meeting.title}" on ${numericDate(meeting.date)}.`;
  return compact({
    taskName: a.text.trim().slice(0, 300),
    description: from,
    status: 'Pending',
    priority: a.priority || 'Medium',
    category: meeting.projectId ? 'Project' : 'Internal',
    subCategory: '',
    department: by.department || '',
    assignedTo: ownerName,
    assignedToId: ownerId,
    assignedBy: by.name,
    assignedById: by.uid,
    collaboratorIds: [],
    collaborators: [],
    teamId: by.teamId || 'NONE',
    dueDate: isDay(a.due) ? a.due : null,
    filePaths: [],
    isPrivate: false,
    attachedFile: null,
    attachedFileName: null,
    meetingId: meeting.id,
    meetingTitle: meeting.title,
    opportunityId: meeting.opportunityId || undefined,
    opportunitySerial: meeting.opportunityId ? meeting.opportunitySerial : undefined,
    opportunityTitle: meeting.opportunityId ? meeting.opportunityTitle : undefined,
    projectId: meeting.projectId || undefined,
    projectName: meeting.projectId ? meeting.projectName : undefined,
  });
}

// ── Reading action points out of the notes ───────────────────────────────────

/** "Action: …", "AP - …", "To do: …", «إجراء: …», «مطلوب: …», «تكليف: …». */
const ACTION_MARK = /^\s*(?:action(?:\s*point)?|ap|a\/p|to\s*do|todo|إجراء|اجراء|مطلوب|المطلوب|تكليف)\s*[:：\-–—]\s*/i;
const BULLET = /^\s*(?:[-*•–—·]|\d{1,2}[.)]|[٠-٩]{1,2}[.)])\s*/;

/**
 * Every line in the notes that reads like an action point, as a draft: a line
 * marked "Action:" / «إجراء:», or one that names a colleague who is to do
 * something ("Mona to send the offer by Thursday", «يتولى أحمد مراجعة العقد»),
 * or "I will …" with a date. Owner and date come from the same rules as the
 * Add-anything box (quickCapture.ts). A line already on the action list (same
 * words) is skipped, so pressing the button twice adds nothing.
 */
export function actionsFromNotes(
  text: string,
  ctx: { me: CapturePerson; people: CapturePerson[]; today: Date },
  existing: ActionPoint[] = [],
): ActionPoint[] {
  const seen = new Set((existing || []).map(a => fold(a.text)));
  const out: ActionPoint[] = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(BULLET, '').trim();
    if (line.length < 4) continue;
    const marked = ACTION_MARK.test(line);
    const body = line.replace(ACTION_MARK, '').trim();
    if (body.length < 3) continue;
    const p = readCapture(body, { me: ctx.me, people: ctx.people, parties: [], today: ctx.today });
    if (!p) continue;
    const named = p.reasons.some(r => r.code === 'owner-named');
    const me = p.reasons.some(r => r.code === 'owner-me');
    const dated = p.reasons.some(r => r.code === 'date');
    if (!marked && !named && !(me && dated)) continue;
    const words = titleFrom(body);
    const key = fold(words);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const owner = named || me ? p.owner : undefined;
    out.push({
      id: newItemId('ap', ctx.today.getTime()),
      text: words,
      ownerId: owner?.id,
      ownerName: owner?.name,
      due: p.date,
      priority: p.priority,
    });
  }
  return out;
}

/** All the minutes text, in reading order — what "Find action points" reads. */
export const minutesText = (m: Pick<Meeting, 'agenda' | 'notes'>) =>
  [...(m.agenda || []).flatMap(a => [a.notes || '', a.decision || '']), m.notes || ''].filter(Boolean).join('\n');

// ── Series: "the previous meeting" ───────────────────────────────────────────

/**
 * Two meetings are the same series when their titles match once dates,
 * numbers and punctuation are gone — "Weekly BD meeting 14/9" and
 * "Weekly BD meeting – 21/9" — or when both are about the same bid / project.
 */
export function seriesKey(title?: string | null): string {
  return fold(title)
    .replace(/\d+/g, ' ')
    .replace(/\b(?:no|rev|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function previousMeeting(m: Meeting, all: Meeting[]): Meeting | null {
  const key = seriesKey(m.title);
  const same = (o: Meeting) =>
    (key.length >= 3 && seriesKey(o.title) === key)
    || (!!m.opportunityId && o.opportunityId === m.opportunityId)
    || (!!m.projectId && o.projectId === m.projectId);
  const before = all.filter(o => o.id !== m.id && `${o.date} ${o.time || ''}` < `${m.date} ${m.time || ''}` && same(o));
  before.sort((a, b) => `${b.date} ${b.time || ''}`.localeCompare(`${a.date} ${a.time || ''}`));
  return before[0] || null;
}

// ── Agenda suggestions ───────────────────────────────────────────────────────

export interface AgendaSuggestion {
  /** Stable — stored on the agenda item so an added suggestion is not offered again. */
  key: string;
  source: SuggestSource;
  /** Record title, step title (English template titles are display-labelled) or action text. */
  title: string;
  owner?: string;
  /** Deadline / due date, yyyy-mm-dd. */
  date?: string;
  /** Days from today to `date`; negative = that many days late. */
  days?: number;
  ref?: MeetingRef;
  /** The bid or project a step / task belongs to, for the sentence. */
  on?: string;
}

export interface SuggestInput {
  meeting: Meeting;
  meetings: Meeting[];
  tasks: any[];
  letters: any[];
  bids: any[];
  projects: any[];
  userNames: Record<string, string>;
}

/** A bid's submission date this close (or this recently passed) is agenda material. */
export const BID_DAYS_AHEAD = 21;
export const BID_DAYS_PASSED = 7;
/** A checklist step due within this many days. */
export const STEP_DAYS_AHEAD = 14;
/** Late tasks per attendee — the agenda is not the Tasks board. */
export const LATE_PER_PERSON = 3;
export const MAX_SUGGESTIONS = 14;

const PRE_SUBMIT = new Set(['Identified', 'Prequalification', 'Bid Preparation']);
const AWAITING = new Set(['Submitted', 'Under Evaluation']);
const ORDER: SuggestSource[] = ['carry', 'bid-deadline', 'late-task', 'letter', 'step', 'open-task', 'bid-decision'];

const isOpenTask = (t: any) => !DONE_TASK.has(t.status);
const taskOwners = (t: any): string[] => [t.assignedToId, ...(t.collaboratorIds || [])].filter(Boolean);

/**
 * What the boards say this meeting should cover. The scope is the linked bid /
 * project and the client (typed, or the linked record's); with no scope, the
 * attendees' late work and the department's bids closing this week.
 * Never more than MAX_SUGGESTIONS, most pressing first.
 */
export function suggestAgenda(input: SuggestInput, today: string): AgendaSuggestion[] {
  const { meeting: m } = input;
  const out: AgendaSuggestion[] = [];
  const add = (s: AgendaSuggestion) => { if (!out.some(o => o.key === s.key)) out.push(s); };
  const tasksById = new Map(input.tasks.map(t => [t.id, t]));

  // 1. Last meeting's action points that are not done.
  const prev = previousMeeting(m, input.meetings);
  if (prev) {
    for (const a of prev.actions || []) {
      const st = actionState(a, tasksById, today);
      if (st === 'done') continue;
      add({
        key: `carry:${prev.id}:${a.id}`,
        source: 'carry',
        title: a.text,
        owner: a.ownerName || (a.ownerId ? input.userNames[a.ownerId] : undefined),
        date: a.due,
        days: a.due ? daysBetween(today, a.due) : undefined,
        ref: a.taskId ? { type: 'task', id: a.taskId, serial: a.taskSerial } : undefined,
      });
    }
  }

  // 2. The scope: linked records + the client.
  const linkedBid = m.opportunityId ? input.bids.find(b => b.id === m.opportunityId) : undefined;
  const linkedProject = m.projectId ? input.projects.find(p => p.id === m.projectId) : undefined;
  const key = clientKey(m.client || linkedBid?.client || linkedProject?.client || '');
  const bidIds = new Set<string>();
  const projectIds = new Set<string>();
  if (m.opportunityId) bidIds.add(m.opportunityId);
  if (m.projectId) projectIds.add(m.projectId);
  if (key) {
    for (const b of input.bids) if (clientKey(b.client) === key) bidIds.add(b.id);
    for (const p of input.projects) if (clientKey(p.client) === key) projectIds.add(p.id);
  }
  const scoped = bidIds.size > 0 || projectIds.size > 0 || !!key;

  // Bids: deadline close, or submitted and waiting on the client.
  for (const b of input.bids) {
    const inScope = bidIds.has(b.id);
    const deadline = dayPart(b.submissionDeadline);
    if (PRE_SUBMIT.has(b.stage) && deadline && (inScope || !scoped)) {
      const days = daysBetween(today, deadline);
      const ahead = inScope ? BID_DAYS_AHEAD : 7;
      if (days <= ahead && days >= -BID_DAYS_PASSED) {
        add({ key: `bid:${b.id}`, source: 'bid-deadline', title: b.title || '', date: deadline, days, ref: { type: 'opportunity', id: b.id, serial: b.serialNumber } });
      }
    }
    if (inScope && AWAITING.has(b.stage)) {
      add({ key: `bid:${b.id}`, source: 'bid-decision', title: b.title || '', ref: { type: 'opportunity', id: b.id, serial: b.serialNumber } });
    }
  }

  // Checklist steps on the bids / projects in scope.
  const stepsOf = (rec: any, type: 'opportunity' | 'project') => {
    for (const s of rec.checklist || []) {
      if (s.done || !isDay(s.dueDate)) continue;
      const days = daysBetween(today, s.dueDate);
      if (days > STEP_DAYS_AHEAD) continue;
      add({
        key: `step:${rec.id}:${s.id}`, source: 'step', title: s.title, date: s.dueDate, days,
        on: type === 'opportunity' ? rec.title : rec.name, ref: { type, id: rec.id, serial: rec.serialNumber },
      });
    }
  };
  for (const b of input.bids) if (bidIds.has(b.id) && PRE_SUBMIT.has(b.stage)) stepsOf(b, 'opportunity');
  for (const p of input.projects) if (projectIds.has(p.id)) stepsOf(p, 'project');

  // Tasks on the bids / projects in scope; then the attendees' late ones.
  const taskSuggestion = (t: any, late: boolean): AgendaSuggestion => {
    const due = dayPart(t.dueDate);
    return {
      key: `task:${t.id}`, source: late ? 'late-task' : 'open-task', title: t.taskName || '',
      owner: t.assignedTo || input.userNames[t.assignedToId], date: due || undefined,
      days: due ? daysBetween(today, due) : undefined, ref: { type: 'task', id: t.id, serial: t.serialNumber },
    };
  };
  const isLate = (t: any) => { const d = dayPart(t.dueDate); return !!d && d < today; };
  for (const t of input.tasks) {
    if (!isOpenTask(t) || t.meetingId === m.id) continue;
    if (bidIds.has(t.opportunityId) || projectIds.has(t.projectId)) add(taskSuggestion(t, isLate(t)));
  }
  const people = new Set(m.attendeeIds || []);
  const perPerson = new Map<string, number>();
  const lateTasks = input.tasks
    .filter(t => isOpenTask(t) && isLate(t) && t.meetingId !== m.id)
    .sort((a, b) => dayPart(a.dueDate).localeCompare(dayPart(b.dueDate)));
  for (const t of lateTasks) {
    const who = taskOwners(t).find(id => people.has(id));
    if (!who && (scoped || people.size > 0)) continue;
    const k = who || '*';
    const n = perPerson.get(k) || 0;
    if (n >= (who ? LATE_PER_PERSON : 5)) continue;
    if (out.some(o => o.key === `task:${t.id}`)) continue;
    perPerson.set(k, n + 1);
    add(taskSuggestion(t, true));
  }

  // Open letters on the scope.
  if (scoped) {
    for (const l of input.letters) {
      if (l.status === 'Closed') continue;
      const inScope = bidIds.has(l.opportunityId) || projectIds.has(l.projectId) || (!!key && textNamesClient(l.sentFrom, key));
      if (!inScope) continue;
      const due = dayPart(l.deadline);
      add({
        key: `letter:${l.id}`, source: 'letter', title: l.subject || '', owner: l.sentFrom || undefined,
        date: due || undefined, days: due ? daysBetween(today, due) : undefined,
        ref: { type: 'corresponding', id: l.id, serial: l.serialNumber },
      });
    }
  }

  // A task already offered as last meeting's action point is not offered twice.
  const carried = new Set(out.filter(s => s.source === 'carry' && s.ref).map(s => `task:${s.ref!.id}`));
  for (let i = out.length - 1; i >= 0; i--) if (out[i].source !== 'carry' && carried.has(out[i].key)) out.splice(i, 1);

  const rank = (s: AgendaSuggestion) => ORDER.indexOf(s.source);
  out.sort((a, b) => rank(a) - rank(b) || (a.days ?? 999) - (b.days ?? 999));
  const onAgenda = new Set((m.agenda || []).map(a => a.key).filter(Boolean));
  return out.filter(s => !onAgenda.has(s.key)).slice(0, MAX_SUGGESTIONS);
}

// ── The letters: invitation and minutes ──────────────────────────────────────

export type MeetingLang = 'en' | 'ar';

/** dd/mm/yyyy — a numeric date reads the same in both languages (settled i18n rule). */
export function numericDate(day?: string): string {
  if (!day || !isDay(day)) return '';
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}

const WEEKDAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const weekdayName = (day: string, lang: MeetingLang) =>
  (lang === 'ar' ? WEEKDAY_AR : WEEKDAY_EN)[new Date(dayMs(day)).getDay()];

export interface MeetingLetter {
  subject: string;
  body: string;
}

/** Everything the letters need that is not on the meeting doc itself. */
export interface LetterContext {
  /** uid → display name, for the attendees and owners. */
  names: Record<string, string>;
  /** Who is writing — the signature. */
  from: string;
}

const joinList = (items: string[], lang: MeetingLang) => items.filter(Boolean).join(lang === 'ar' ? '، ' : ', ');

function linkedLine(m: Meeting, lang: MeetingLang): string {
  const parts: string[] = [];
  if (m.opportunityId && (m.opportunityTitle || m.opportunitySerial)) {
    const bid = [m.opportunitySerial, m.opportunityTitle].filter(Boolean).join(' — ');
    parts.push(lang === 'ar' ? `المناقصة: ${bid}` : `Bid: ${bid}`);
  }
  if (m.projectId && m.projectName) parts.push(lang === 'ar' ? `المشروع: ${m.projectName}` : `Project: ${m.projectName}`);
  if (m.client) parts.push(lang === 'ar' ? `العميل: ${m.client}` : `Client: ${m.client}`);
  return parts.join(lang === 'ar' ? ' · ' : ' · ');
}

function whenText(m: Meeting, lang: MeetingLang): string {
  const day = `${weekdayName(m.date, lang)} ${numericDate(m.date)}`;
  if (lang === 'ar') return `يوم ${day}${m.time ? ` الساعة ${m.time}` : ''}`;
  return `on ${day}${m.time ? ` at ${m.time}` : ''}`;
}

function attendeesText(m: Meeting, ctx: LetterContext, lang: MeetingLang): string {
  const inside = joinList((m.attendeeIds || []).map(id => ctx.names[id] || ''), lang);
  const guests = (m.guests || '').trim();
  if (!guests) return inside;
  if (!inside) return guests;
  return lang === 'ar' ? `${inside}، ومن الخارج: ${guests}` : `${inside}; guests: ${guests}`;
}

/** The invitation with the agenda — to paste into a mail or open as a draft. */
export function buildInvitation(m: Meeting, ctx: LetterContext, lang: MeetingLang): MeetingLetter {
  const items = (m.agenda || []).filter(a => a.text.trim());
  const linked = linkedLine(m, lang);
  if (lang === 'ar') {
    const lines = [
      'الزملاء الأعزاء،',
      'تحية طيبة، وبعد،',
      '',
      `أدعوكم إلى اجتماع «${m.title}» ${whenText(m, 'ar')}${m.place ? `، في ${m.place}` : ''}.`,
    ];
    if (linked) lines.push(linked);
    lines.push('');
    if (items.length) {
      lines.push('جدول الأعمال:');
      items.forEach((a, i) => lines.push(`${i + 1}. ${a.text}`));
      lines.push('', 'أرجو مراجعة هذه البنود قبل الاجتماع، والحضور في الموعد.');
    } else {
      lines.push('أرجو الحضور في الموعد.');
    }
    lines.push('', 'مع خالص التحية،', ctx.from);
    return { subject: `دعوة إلى اجتماع: ${m.title} — ${numericDate(m.date)}`, body: lines.join('\n') };
  }
  const lines = [
    'Dear colleagues,',
    '',
    `You are invited to "${m.title}" ${whenText(m, 'en')}${m.place ? `, ${m.place}` : ''}.`,
  ];
  if (linked) lines.push(linked);
  lines.push('');
  if (items.length) {
    lines.push('Agenda:');
    items.forEach((a, i) => lines.push(`${i + 1}. ${a.text}`));
    lines.push('', 'Please review the items above before we meet.');
  } else {
    lines.push('Please be on time.');
  }
  lines.push('', 'Kind regards,', ctx.from);
  return { subject: `Meeting invitation: ${m.title} — ${numericDate(m.date)}`, body: lines.join('\n') };
}

const ORDINAL_AR = ['أولًا', 'ثانيًا', 'ثالثًا', 'رابعًا'];

/**
 * The minutes as a letter: who attended, each agenda item with what was said
 * and decided, other notes, and the action points with owner and date.
 * Sections with nothing in them are left out.
 */
export function buildMinutes(m: Meeting, ctx: LetterContext, lang: MeetingLang): MeetingLetter {
  const ar = lang === 'ar';
  const items = (m.agenda || []).filter(a => a.text.trim());
  const actions = (m.actions || []).filter(a => a.text.trim());
  const linked = linkedLine(m, lang);
  const who = attendeesText(m, ctx, lang);
  const lines: string[] = [];

  if (ar) {
    lines.push(`محضر اجتماع: ${m.title}`);
    lines.push(`التاريخ: ${weekdayName(m.date, 'ar')} ${numericDate(m.date)}${m.time ? ` — الساعة ${m.time}` : ''}`);
    if (m.place) lines.push(`المكان: ${m.place}`);
    if (who) lines.push(`الحضور: ${who}`);
    if (linked) lines.push(linked);
  } else {
    lines.push(`Minutes of meeting: ${m.title}`);
    lines.push(`Date: ${weekdayName(m.date, 'en')} ${numericDate(m.date)}${m.time ? ` — ${m.time}` : ''}`);
    if (m.place) lines.push(`Place: ${m.place}`);
    if (who) lines.push(`Attendees: ${who}`);
    if (linked) lines.push(linked);
  }

  let section = 0;
  const heading = (en: string, arText: string) => {
    lines.push('');
    // English headings carry no number: the items under them are numbered.
    lines.push(ar ? `${ORDINAL_AR[section] || `${section + 1}.`}: ${arText}` : `${en.toUpperCase()}`);
    section++;
  };

  if (items.length) {
    heading('Agenda — what was discussed and decided', 'بنود جدول الأعمال وما دار فيها');
    items.forEach((a, i) => {
      lines.push(`${i + 1}. ${a.text}`);
      if (a.notes && a.notes.trim()) {
        const said = a.notes.trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        lines.push(ar ? `   ما نوقش: ${said[0]}` : `   Discussed: ${said[0]}`);
        for (const more of said.slice(1)) lines.push(`   ${more}`);
      }
      if (a.decision && a.decision.trim()) lines.push(ar ? `   القرار: ${a.decision.trim()}` : `   Decision: ${a.decision.trim()}`);
      if (!(a.notes && a.notes.trim()) && !(a.decision && a.decision.trim())) {
        lines.push(ar ? '   لم يُناقَش هذا البند.' : '   Not discussed.');
      }
    });
  }

  if (m.notes && m.notes.trim()) {
    heading('Other notes', 'ملاحظات أخرى');
    for (const s of m.notes.trim().split(/\r?\n/).map(x => x.trim()).filter(Boolean)) lines.push(`- ${s}`);
  }

  if (actions.length) {
    heading('Action points', 'المهام المطلوبة');
    actions.forEach((a, i) => {
      const owner = a.ownerName || (a.ownerId ? ctx.names[a.ownerId] : '') || (ar ? 'لم يُحدَّد' : 'not set');
      const due = a.due ? numericDate(a.due) : (ar ? 'دون موعد' : 'no date');
      const serial = a.taskSerial ? ` (${a.taskSerial})` : '';
      lines.push(ar
        ? `${i + 1}. ${a.text}${serial} — المسؤول: ${owner} — الموعد: ${due}`
        : `${i + 1}. ${a.text}${serial} — Owner: ${owner} — Due: ${due}`);
    });
  }

  lines.push('');
  lines.push(ar ? `أعدّ المحضر: ${ctx.from}` : `Minutes by: ${ctx.from}`);
  return {
    subject: ar ? `محضر اجتماع: ${m.title} — ${numericDate(m.date)}` : `Minutes of meeting: ${m.title} — ${numericDate(m.date)}`,
    body: lines.join('\n'),
  };
}

/** A `mailto:` draft — the app never sends anything itself. */
export function meetingMailto(letter: MeetingLetter, to: string[] = []): string {
  const q = `subject=${encodeURIComponent(letter.subject)}&body=${encodeURIComponent(letter.body)}`;
  return `mailto:${to.map(encodeURIComponent).join(',')}?${q}`;
}

// ── The page address ─────────────────────────────────────────────────────────

/** `#/meetings?id=<id>` opens one meeting; `#/meetings` is the list. */
export const meetingHash = (id?: string | null) => (id ? `#/meetings?id=${encodeURIComponent(id)}` : '#/meetings');

export function meetingFromHash(hash: string): string | null {
  const raw = String(hash || '').replace(/^#\/?/, '');
  if (!raw.startsWith('meetings')) return null;
  const qs = raw.split('?')[1] || '';
  const id = new URLSearchParams(qs).get('id');
  return id && /^[\w-]{1,128}$/.test(id) ? id : null;
}
