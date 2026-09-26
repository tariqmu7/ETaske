/**
 * The Tasks board's reading order (Tidy Tasks T2) — pure, so the harness can
 * pin it without a browser.
 *
 * Open work comes first, in the order it needs attention:
 *   1. late          — due date before today, oldest first
 *   2. due soon      — today and the next `soonDays` days, soonest first
 *   3. the rest      — later due dates, soonest first
 *   4. no due date
 * Finished (`Done`) tasks go last. Inside one date, Urgent > High > Medium >
 * Low; anything still equal keeps the incoming order (the listener delivers
 * newest-created first, and `Array.prototype.sort` is stable).
 *
 * Dates are the stored `yyyy-mm-dd` strings and "today" is the LOCAL calendar
 * day — the same day the red/orange due text on the row is judged against.
 */

export interface OrderableTask {
  status: string;
  dueDate?: string | null;
  priority?: string | null;
}

/** Rank 0-4 (lower = needs attention sooner). Exported for the harness. */
export function urgencyRank(task: OrderableTask, today: string, soonDays = 3): number {
  if (task.status === 'Done') return 4;
  const due = (task.dueDate ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(due)) return 3;
  const day = due.slice(0, 10);
  if (day < today) return 0;
  return day <= addDays(today, soonDays) ? 1 : 2;
}

const PRIORITY_RANK: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 };

/** Comparator for `Array.prototype.sort`. `today` is `yyyy-mm-dd`. */
export function byTaskUrgency<T extends OrderableTask>(today: string, soonDays = 3) {
  return (a: T, b: T) => {
    const ra = urgencyRank(a, today, soonDays);
    const rb = urgencyRank(b, today, soonDays);
    if (ra !== rb) return ra - rb;
    // Finished and undated rows: keep the incoming (newest first) order.
    if (ra < 3) {
      const da = (a.dueDate ?? '').slice(0, 10);
      const db = (b.dueDate ?? '').slice(0, 10);
      if (da !== db) return da < db ? -1 : 1;
    }
    if (ra === 4) return 0;
    return (PRIORITY_RANK[a.priority ?? ''] ?? 2) - (PRIORITY_RANK[b.priority ?? ''] ?? 2);
  };
}

/** Local calendar date as `yyyy-mm-dd`. */
export function localToday(now: Date = new Date()): string {
  return isoDay(now);
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return isoDay(new Date(y, m - 1, d + n));
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Which rows of a list are shown when finished work is folded away.
 * A finished row still shows when it is the one the user has open (`keepIds`),
 * or when the list holds nothing BUT finished work (the "Done" group, or the
 * Done status filter) — folding everything would leave an empty list behind a
 * button, which is just a slower way to show the same rows.
 */
export function foldFinished<T extends OrderableTask & { id: string }>(
  items: readonly T[],
  showFinished: boolean,
  keepIds: readonly (string | null | undefined)[] = [],
): { visible: T[]; hidden: number } {
  if (showFinished || items.every(t => t.status === 'Done')) return { visible: [...items], hidden: 0 };
  const keep = new Set(keepIds.filter(Boolean) as string[]);
  const visible: T[] = [];
  let hidden = 0;
  for (const t of items) {
    if (t.status === 'Done' && !keep.has(t.id)) hidden++;
    else visible.push(t);
  }
  return { visible, hidden };
}
