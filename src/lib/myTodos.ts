// "My daily tasks" — the second half of the daily to-do sheet. The first half
// is built from the boards (dailyTodo.ts); this half is the person's OWN list,
// typed by hand, saved to their account (Firestore `myTodos`, owner-only — see
// firestore.rules) so it is on every device and carries over day to day until
// it is ticked done. Nobody else can read it, managers and admins included.
//
// Which rows a day shows: every open one added on or before that day, plus the
// ones ticked done ON that day (so the printed sheet keeps today's ✓).

import { addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { db } from './firebase';
import { daysBetween } from './deadlineCalendar';

export interface MyTodo {
  id: string;
  ownerId: string;
  title: string;
  /** Who does it — free text, often the person themself. */
  owner?: string;
  action?: string;
  /** yyyy-mm-dd, optional. */
  due?: string;
  note?: string;
  done: boolean;
  /** Day it was added (yyyy-mm-dd). */
  addedDay: string;
  /** Day it was ticked done (yyyy-mm-dd). */
  doneDay?: string;
}

/** The fields the page may change. Mirrors the `myTodos` rule in firestore.rules. */
export type MyTodoPatch = Partial<Pick<MyTodo, 'title' | 'owner' | 'action' | 'due' | 'note' | 'done' | 'doneDay'>>;

export const MAX_TEXT = 1000;

/** Pure: the rows to show for `day`, open ones first (late on top), then today's done ones. */
export function todosForDay(all: MyTodo[], day: string): MyTodo[] {
  const shown = all.filter(t => (t.done ? t.doneDay === day : (t.addedDay || day) <= day));
  const rank = (t: MyTodo) => (t.due ? daysBetween(t.due, day) : -1e6);
  return shown.sort((a, b) => Number(a.done) - Number(b.done) || rank(b) - rank(a) || (a.addedDay || '').localeCompare(b.addedDay || '') || a.title.localeCompare(b.title));
}

/** Days late on `day` (> 0), 0 = today, < 0 = days left, undefined = no date — the same scale as TodoRow.lateBy. */
export const myLateBy = (t: MyTodo, day: string) => (t.due ? daysBetween(t.due, day) : undefined);

const clip = (s: unknown) => String(s ?? '').slice(0, MAX_TEXT);

/** Live view of the signed-in person's own list. Returns the unsubscribe. */
export function watchMyTodos(uid: string, onChange: (rows: MyTodo[]) => void, onError: (err: unknown) => void): () => void {
  // The rule refuses any query that is not filtered to the reader's own id.
  return onSnapshot(
    query(collection(db, 'myTodos'), where('ownerId', '==', uid)),
    snap => onChange(snap.docs.map(d => {
      const v = d.data() as any;
      return {
        id: d.id, ownerId: v.ownerId, title: v.title || '', owner: v.owner || undefined, action: v.action || undefined,
        due: v.due || undefined, note: v.note || undefined, done: v.done === true, addedDay: v.addedDay || '', doneDay: v.doneDay || undefined,
      };
    })),
    onError,
  );
}

export async function addMyTodo(uid: string, day: string, row: { title: string; owner?: string; action?: string; due?: string }): Promise<string> {
  const ref = await addDoc(collection(db, 'myTodos'), {
    ownerId: uid, title: clip(row.title), owner: clip(row.owner), action: clip(row.action), due: row.due || '', note: '',
    done: false, addedDay: day, doneDay: '', createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateMyTodo(id: string, patch: MyTodoPatch): Promise<void> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) out[k] = k === 'done' ? v === true : clip(v);
  await updateDoc(doc(db, 'myTodos', id), out);
}

export const removeMyTodo = (id: string) => deleteDoc(doc(db, 'myTodos', id));
