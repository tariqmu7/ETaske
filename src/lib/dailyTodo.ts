// Daily to-do sheet — a one-page Arabic list of what is pending today and
// what must be done about it, built from the boards, to be printed and put on
// the manager's desk each morning (she ticks "done / not done" by hand).
//
// Pure (no Firebase, no i18n) so the harness can prove it. The page lets the
// person preparing it edit any row, delete rows and add their own rows before
// printing or downloading — the generated list is only the starting point.
//
// What goes on the list (one row per record, the most pressing reason wins):
//   · Bids waiting for the manager's price sign-off       → «اعتماد سعر العرض قبل إرساله»
//   · Bids still being prepared, deadline passed or near  → «تقديم العطاء قبل الموعد»
//   · Bids whose next step falls due                      → the next step itself
//   · Open tasks late or due within the window, plus every open Urgent task
//   · Letters not closed: Unread ones (they wait for routing) and those whose
//     reply deadline has passed or is near
// Private tasks never appear, even the reader's own.

import { dayOf, iso, localDate, daysBetween } from './deadlineCalendar';
import { arDate } from './weeklyReport';

export type TodoKind = 'task' | 'letter' | 'bid' | 'manual';

export interface TodoRow {
  /** Record id, or `manual-<n>` for a row the person typed in. */
  id: string;
  kind: TodoKind;
  serial?: string;
  title: string;
  /** Whose it is: task owner, letter assignee, bid owner. */
  owner?: string;
  /** What has to happen — editable on the page. */
  action: string;
  /** Due day (yyyy-mm-dd), when there is one. */
  due?: string;
  /** Days late on the sheet's day (> 0), 0 = today, < 0 = days left, undefined = no date. */
  lateBy?: number;
  /** Needs the manager herself (sign-off, routing a letter). */
  forManager?: boolean;
  /** A free note column — empty when generated. */
  note?: string;
}

export interface TodoInput {
  tasks?: any[];
  correspondences?: any[];
  opportunities?: any[];
}

export interface TodoOptions {
  /** Days AHEAD of the sheet's day to include (0 = today only). Late items are always in. */
  ahead?: number;
}

const real = (list?: any[]) => (list || []).filter(r => r && r.id !== '--stats--');
const day10 = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : dayOf(v));

const TASK_OPEN = ['Pending', 'In Progress'];
const BID_PREPARING = ['Identified', 'Prequalification', 'Bid Preparation'];
const BID_CLOSED = ['Won', 'Lost', 'No Bid', 'Cancelled'];

/** The first not-ticked note on a task — usually the very next thing to do. */
function nextTaskNote(t: any): string {
  const n = (Array.isArray(t.notes) ? t.notes : []).find((x: any) => x && !x.isCompleted && String(x.text || '').trim());
  return n ? String(n.text).replace(/\s+/g, ' ').trim() : '';
}

export function buildDailyTodo(input: TodoInput, day: string, opts: TodoOptions = {}): TodoRow[] {
  const ahead = Math.max(0, opts.ahead ?? 3);
  const until = iso(new Date(localDate(day).getTime() + ahead * 86_400_000));
  const inWindow = (d?: string) => !!d && d <= until;
  const late = (d?: string) => (d ? daysBetween(d, day) : undefined);
  const out: TodoRow[] = [];

  // ── Bids ──
  for (const o of real(input.opportunities)) {
    if (BID_CLOSED.includes(o.stage)) continue;
    const base = { id: o.id, kind: 'bid' as const, serial: o.serialNumber, title: o.title || '—', owner: o.ownerName || undefined };
    const deadline = day10(o.submissionDeadline);
    if (o.approval?.status === 'requested') {
      out.push({ ...base, action: 'اعتماد سعر العرض قبل إرساله', due: deadline || undefined, lateBy: late(deadline), forManager: true });
      continue;
    }
    if (BID_PREPARING.includes(o.stage) && inWindow(deadline)) {
      const passed = deadline < day;
      out.push({ ...base, action: passed ? 'فات موعد التقديم — توضيح الموقف وتحديد الخطوة التالية' : 'تقديم العطاء قبل الموعد', due: deadline, lateBy: late(deadline) });
      continue;
    }
    const next = day10(o.nextActionDate);
    if (inWindow(next)) {
      const step = String(o.nextStep || '').replace(/\s+/g, ' ').trim();
      out.push({ ...base, action: step || 'متابعة العميل', due: next, lateBy: late(next) });
    }
  }

  // ── Tasks ──
  for (const t of real(input.tasks)) {
    if (t.isPrivate === true || !TASK_OPEN.includes(t.status)) continue;
    const due = day10(t.dueDate);
    const urgent = t.priority === 'Urgent';
    if (!inWindow(due) && !urgent) continue;
    const n = late(due);
    const fallback = n === undefined ? 'إنجاز المهمة العاجلة' : n > 0 ? 'إنهاء المهمة المتأخرة' : n === 0 ? 'إنجاز المهمة اليوم' : 'متابعة الإنجاز قبل الموعد';
    out.push({
      id: t.id, kind: 'task', serial: t.serialNumber, title: t.taskName || '—', owner: t.assignedTo || undefined,
      action: nextTaskNote(t) || fallback, due: due || undefined, lateBy: n,
    });
  }

  // ── Letters ──
  for (const c of real(input.correspondences)) {
    if (c.status === 'Closed') continue;
    const deadline = day10(c.deadline);
    const unread = c.status === 'Unread';
    if (!unread && !inWindow(deadline)) continue;
    const asked = String(c.actions || '').replace(/\s+/g, ' ').trim();
    out.push({
      id: c.id, kind: 'letter', serial: c.serialNumber, title: c.subject || '—',
      owner: c.assignedTo || undefined,
      action: unread ? 'مراجعة الخطاب وتوجيهه للمسؤول' : (asked || 'الرد على الخطاب'),
      due: deadline || undefined, lateBy: late(deadline), forManager: unread || undefined,
    });
  }

  return out.sort(compareRows);
}

/** Late first (most late on top), then today, then by date, undated last; ties by serial. */
export function compareRows(a: TodoRow, b: TodoRow): number {
  const rank = (r: TodoRow) => (r.lateBy === undefined ? -1e6 : r.lateBy);
  return rank(b) - rank(a) || (a.serial || '').localeCompare(b.serial || '') || a.title.localeCompare(b.title);
}

/** The status cell, in Arabic: «متأخر 3 أيام» · «اليوم» · «غدًا» · «بعد يومين» · «—». */
export function arDueState(r: TodoRow): string {
  const n = r.lateBy;
  if (n === undefined) return '—';
  if (n === 0) return 'اليوم';
  if (n === -1) return 'غدًا';
  const d = Math.abs(n);
  const days = d === 1 ? 'يوم واحد' : d === 2 ? 'يومين' : d <= 10 ? `${d} أيام` : `${d} يومًا`;
  return n > 0 ? `متأخر ${days}` : `بعد ${days}`;
}

/** "12/10" (day/month) for the due column — numeric dates stay Latin, as everywhere in the app. */
export const shortDay = (d?: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—');

export const KIND_AR: Record<TodoKind, string> = { task: 'مهمة', letter: 'خطاب', bid: 'عطاء', manual: 'بند مضاف' };

export function sheetTitle(department?: string): string {
  const d = (department || '').trim();
  return d ? `قائمة المتابعة اليومية — ${d}` : 'قائمة المتابعة اليومية';
}

export const sheetDate = (day: string) => arDate(day, true);

/** Counts for the sheet's header line. */
export function sheetCounts(rows: TodoRow[]) {
  return {
    total: rows.length,
    late: rows.filter(r => (r.lateBy ?? -1) > 0).length,
    today: rows.filter(r => r.lateBy === 0).length,
    forManager: rows.filter(r => r.forManager).length,
  };
}
