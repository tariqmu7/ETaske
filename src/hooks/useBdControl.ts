import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { BD_TABLES, emptyBdData, type BdData, type BdMeta, type BdTable } from '../lib/bdControl';

/**
 * Live BD control data (queue E5a): `bdControl/meta` + one listener per table
 * (`bdControl/<table>/rows`). ~480 docs in all, so the whole book is held in
 * memory and every figure is worked out client-side by lib/bdControl.ts.
 * `loading` stays true until meta and every table have answered once, so the
 * tiles never flash a half-loaded total. The first listener error (normally
 * permission-denied: not a Manager/Admin, or the rules not deployed yet) wins.
 */
export function useBdControl(): { data: BdData; loading: boolean; error: string | null } {
  const [data, setData] = useState<BdData>(emptyBdData);
  const [pending, setPending] = useState<Set<string>>(() => new Set(['meta', ...BD_TABLES]));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const answered = (key: string) => setPending(p => {
      if (!p.has(key)) return p;
      const n = new Set(p); n.delete(key); return n;
    });
    const fail = (key: string) => (err: { code?: string }) => {
      console.warn(`BD control listener (${key}):`, err.code);
      setError(e => e || err.code || 'error');
      answered(key);
    };
    const unsubs = [
      onSnapshot(doc(db, 'bdControl', 'meta'),
        s => { setData(d => ({ ...d, meta: s.exists() ? (s.data() as BdMeta) : null })); answered('meta'); },
        fail('meta')),
      ...BD_TABLES.map((t: BdTable) => onSnapshot(collection(db, `bdControl/${t}/rows`),
        s => { setData(d => ({ ...d, [t]: s.docs.map(x => ({ id: x.id, ...(x.data() as object) })) })); answered(t); },
        fail(t))),
    ];
    return () => unsubs.forEach(u => u());
  }, []);

  return { data, loading: pending.size > 0, error };
}
