// Writes one BD control edit (queue E6b): the row update + one history doc per
// changed field, in ONE batch so the log can never miss a change. The shapes
// come from lib/bdControlEdit.ts; firestore.rules (`bdControl` block) checks them.
import { collection, doc, onSnapshot, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { planEdit, type EditTable, type EditWho, type FieldChange } from './bdControlEdit';
import type { BdRow } from './bdControl';

const rowPath = (table: EditTable) => `bdControl/${table}/rows`;
const historyPath = (table: EditTable, id: string) => `bdControl/${table}/rows/${id}/history`;

export async function saveBdEdit(table: EditTable, row: BdRow, changes: FieldChange[], who: EditWho): Promise<void> {
  if (!changes.length) return;
  const { update, history } = planEdit(row, changes, who, serverTimestamp());
  const batch = writeBatch(db);
  batch.update(doc(db, rowPath(table), row.id), update);
  const base = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  history.forEach((h, i) => batch.set(doc(db, historyPath(table, row.id), `${base}_${i}`), h));
  await batch.commit();
}

export interface BdHistoryEntry { id: string; field: string; from: unknown; to: unknown; byName?: string; at?: unknown }

/** Live change log of one row, newest first. */
export function listenBdHistory(table: EditTable, id: string, next: (rows: BdHistoryEntry[]) => void, fail: (code: string) => void) {
  const secs = (v: unknown) => (v && typeof (v as { seconds?: number }).seconds === 'number' ? (v as { seconds: number }).seconds : 0);
  return onSnapshot(collection(db, historyPath(table, id)),
    s => next(s.docs.map(d => ({ id: d.id, ...(d.data() as Omit<BdHistoryEntry, 'id'>) })).sort((a, b) => secs(b.at) - secs(a.at) || b.id.localeCompare(a.id))),
    (e: { code?: string }) => fail(e.code || 'error'));
}
