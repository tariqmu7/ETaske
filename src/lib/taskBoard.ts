/**
 * The Tasks page's Board view (Tidy Tasks T4) — pure, so the harness can pin
 * it without a browser.
 *
 * Three columns: Pending · In Progress · Done. The two open columns keep the
 * order they are handed (the board's urgency order, lib/taskOrder.ts), so a
 * late task still sits at the top of its column. Done is the latest finished
 * first and shows only `doneLimit` of them unless asked for all — a year of
 * finished work would otherwise bury the two columns that matter.
 *
 * Any status that is not one of the three (an old or hand-edited value) lands
 * in Pending rather than vanishing from the board.
 */

export const BOARD_STATUSES = ['Pending', 'In Progress', 'Done'] as const;
export type BoardStatus = typeof BOARD_STATUSES[number];

export interface BoardTask {
  id: string;
  status: string;
  completedAt?: unknown;
  archivedAt?: unknown;
  updatedAt?: unknown;
  createdAt?: unknown;
}

export interface BoardColumns<T> {
  pending: T[];
  inProgress: T[];
  /** The Done rows to draw (all of them, or the latest `doneLimit`). */
  done: T[];
  doneTotal: number;
  doneHidden: number;
}

/** Milliseconds from a Firestore Timestamp, Date, number or date string; 0 when unknown. */
export function stampMs(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') { const n = Date.parse(v); return Number.isNaN(n) ? 0 : n; }
  if (v instanceof Date) return v.getTime() || 0;
  const o = v as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
  if (typeof o.toMillis === 'function') { try { return o.toMillis() || 0; } catch { return 0; } }
  if (typeof o.seconds === 'number') return o.seconds * 1000 + Math.floor((o.nanoseconds || 0) / 1e6);
  return 0;
}

/** When a finished task was finished — the same order of guesses the weekly report uses. */
export function finishedAt(t: BoardTask): number {
  return stampMs(t.completedAt) || stampMs(t.archivedAt) || stampMs(t.updatedAt) || stampMs(t.createdAt);
}

/** The column a task belongs in. */
export function columnOf(status: string): BoardStatus {
  return status === 'In Progress' || status === 'Done' ? status : 'Pending';
}

export function boardColumns<T extends BoardTask>(
  items: readonly T[],
  opts: { doneLimit?: number; showAllDone?: boolean } = {},
): BoardColumns<T> {
  const { doneLimit = 5, showAllDone = false } = opts;
  const pending: T[] = [];
  const inProgress: T[] = [];
  const doneAll: T[] = [];
  for (const t of items) {
    const col = columnOf(t.status);
    if (col === 'Done') doneAll.push(t);
    else if (col === 'In Progress') inProgress.push(t);
    else pending.push(t);
  }
  // Latest finished first; ties keep the incoming order (stable sort).
  doneAll.sort((a, b) => finishedAt(b) - finishedAt(a));
  const done = showAllDone ? doneAll : doneAll.slice(0, Math.max(0, doneLimit));
  return { pending, inProgress, done, doneTotal: doneAll.length, doneHidden: doneAll.length - done.length };
}

/**
 * The status to write when a card is dropped on a column, or null when the
 * drop changes nothing (dropped back where it came from, or an unknown column).
 */
export function dropStatus(current: string, target: string): BoardStatus | null {
  if (!(BOARD_STATUSES as readonly string[]).includes(target)) return null;
  return columnOf(current) === target ? null : (target as BoardStatus);
}
