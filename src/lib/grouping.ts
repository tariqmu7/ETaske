/**
 * The shared "Group by (X)" mechanism.
 *
 * ── Why a lib and not a hook ─────────────────────────────────────────────────
 * Four dashboards (tasks, correspondences, projects, opportunities) all want the
 * same behaviour — bucket the already-filtered rows by one dimension, keep a
 * meaningful bucket order, sort inside each bucket, and put the "has no value"
 * rows last. None of that needs React state, so it stays a pure function and
 * every caller can wrap it in its own `useMemo` with its own dependencies.
 *
 * ── The two rules that matter ────────────────────────────────────────────────
 * 1. **Keys are the STORED value, never the translated one.** Grouping runs on
 *    what Firestore holds (`'In Progress'`, a project name, a display name); the
 *    caller translates only when it paints the header. Same rule as
 *    `lib/displayLabel.ts` — a projection at render time, never on the data.
 * 2. **Sorting is stable.** `Array.prototype.sort` is stable, so rows the
 *    comparator calls equal keep the order they arrived in. Callers hand us
 *    lists already ordered `createdAt desc`, which makes "newest first" the
 *    automatic tie-break inside a bucket without anyone asking for it.
 */

/** Bucket key for rows whose grouping field is empty. Never a real stored value. */
export const UNGROUPED = '__ungrouped__';

export interface RecordGroup<T> {
  /** Stored value, or `UNGROUPED`. Use as the React key. */
  key: string;
  /** The stored value to translate for the header. Empty for the UNGROUPED bucket. */
  value: string;
  items: T[];
}

export interface BuildGroupsOptions<T> {
  /**
   * Fixed bucket order, written as STORED values (e.g. the status enum). Keys
   * not listed are appended after them, alphabetically. Without this, every key
   * is alphabetical — which is what free-text dimensions (project, location,
   * person) want.
   */
  order?: readonly string[];
  /** Sort applied inside every bucket. Omit to keep the incoming order. */
  sort?: (a: T, b: T) => number;
}

/**
 * Bucket `items` by `keyOf`. Empty buckets are dropped; the UNGROUPED bucket is
 * always last so a wall of "No project" rows never leads the page.
 */
export function buildGroups<T>(
  items: readonly T[],
  keyOf: (item: T) => string | null | undefined,
  options: BuildGroupsOptions<T> = {},
): RecordGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const raw = (keyOf(item) ?? '').trim();
    const key = raw || UNGROUPED;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  const ordered = options.order ?? [];
  const listed = ordered.filter(k => buckets.has(k));
  const rest = Array.from(buckets.keys())
    .filter(k => k !== UNGROUPED && !ordered.includes(k))
    .sort((a, b) => a.localeCompare(b));

  const keys = [...listed, ...rest];
  if (buckets.has(UNGROUPED)) keys.push(UNGROUPED);

  return keys.map(key => {
    const items = buckets.get(key)!;
    return {
      key,
      value: key === UNGROUPED ? '' : key,
      items: options.sort ? [...items].sort(options.sort) : items,
    };
  });
}

/**
 * "Soonest first, undated last." Dates are stored as `yyyy-mm-dd` strings, so a
 * lexical compare would do — `Date.parse` is used anyway so a row holding some
 * other format is treated as undated instead of sorting to a random position.
 *
 * Equal dates (and two undated rows) compare equal, which the stable sort turns
 * into "newest created first" — see the header.
 */
export function byDueDateAsc<T>(getDue: (item: T) => string | null | undefined) {
  const at = (item: T) => {
    const raw = (getDue(item) ?? '').trim();
    if (!raw) return Number.POSITIVE_INFINITY;
    const ms = Date.parse(raw);
    return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
  };
  return (a: T, b: T) => {
    const da = at(a);
    const dbv = at(b);
    // Both undated → equal, so the incoming (createdAt desc) order survives.
    if (da === dbv) return 0;
    return da < dbv ? -1 : 1;
  };
}
