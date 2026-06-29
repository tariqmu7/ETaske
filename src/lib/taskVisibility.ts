import {
  collection, query, where, onSnapshot, getDocs, type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Task } from '../types';

/**
 * Privacy-aware task reads.
 *
 * Tasks can be PUBLIC (the default shared-org board) or PRIVATE (`isPrivate:
 * true`), where a private task is readable only by its owner — the assignee
 * (`assignedToId`). The firestore.rules `tasks` read rule enforces this.
 *
 * Because Firestore security rules are guards, not row filters, a single
 * unconstrained `collection('tasks')` listener is REJECTED with
 * permission-denied the moment any other user owns a private task (the query
 * could surface a doc the caller can't read). So every place that used to read
 * the whole `tasks` collection must instead read the union of two rule-safe
 * queries and merge them:
 *   1. all PUBLIC tasks        — where('isPrivate', '==', false)
 *   2. the caller's OWN tasks  — where('assignedToId', '==', uid)  (incl. private)
 *
 * Both filters are single-field equality, so Firestore's automatic indexes
 * cover them — no composite index is required. Results are merged + de-duped by
 * id and returned UNSORTED; callers already sort/filter client-side as before.
 *
 * NOTE: existing task docs created before this feature have no `isPrivate`
 * field and therefore won't match query (1). They must be backfilled with
 * `isPrivate: false` (see scripts/backfill-task-privacy.mjs) or they'll only be
 * visible to their owner. The rules treat a missing field as public, so it is
 * purely a query-visibility concern, not a security one.
 */

const STATS_DOC = '--stats--';

function toTasks(snapDocs: any[]): Task[] {
  return snapDocs
    .filter(d => d.id !== STATS_DOC)
    .map(d => ({ id: d.id, ...d.data() } as Task));
}

function mergeById(a: Task[], b: Task[]): Task[] {
  const byId = new Map<string, Task>();
  for (const t of a) byId.set(t.id, t);
  for (const t of b) byId.set(t.id, t); // `mine` wins on overlap (identical doc)
  return Array.from(byId.values());
}

/**
 * Live listener over every task the signed-in user may read (public + own).
 * Mirrors `onSnapshot`'s contract: returns an unsubscribe function and only
 * emits once BOTH underlying queries have produced a snapshot, so callers never
 * see a half-populated list.
 */
export function subscribeVisibleTasks(
  uid: string,
  onData: (tasks: Task[]) => void,
  onError?: (err: any) => void,
): Unsubscribe {
  let publicTasks: Task[] = [];
  let myTasks: Task[] = [];
  let gotPublic = false;
  let gotMine = false;

  const emit = () => {
    if (gotPublic && gotMine) onData(mergeById(publicTasks, myTasks));
  };

  const unsubPublic = onSnapshot(
    query(collection(db, 'tasks'), where('isPrivate', '==', false)),
    snap => { publicTasks = toTasks(snap.docs); gotPublic = true; emit(); },
    err => onError?.(err),
  );
  const unsubMine = onSnapshot(
    query(collection(db, 'tasks'), where('assignedToId', '==', uid)),
    snap => { myTasks = toTasks(snap.docs); gotMine = true; emit(); },
    err => onError?.(err),
  );

  return () => { unsubPublic(); unsubMine(); };
}

/**
 * One-shot read of every task the signed-in user may read (public + own).
 * The `getDocs` equivalent of {@link subscribeVisibleTasks}.
 */
export async function getVisibleTasks(uid: string): Promise<Task[]> {
  const [pub, mine] = await Promise.all([
    getDocs(query(collection(db, 'tasks'), where('isPrivate', '==', false))),
    getDocs(query(collection(db, 'tasks'), where('assignedToId', '==', uid))),
  ]);
  return mergeById(toTasks(pub.docs), toTasks(mine.docs));
}
