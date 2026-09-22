import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Opportunity, Project } from '../types';
import type { KnownParty } from '../lib/mailSuggest';

/** The pieces of a bid/project a new record's link needs (RecordLinks). */
export interface KnownRecord {
  type: 'opportunity' | 'project';
  serial?: string;
  title: string;
}

/**
 * What the boards already know about clients — every bid's client, every
 * project's client AND name ("Meleiha" names the project, not the company) —
 * for the rules that match free text against them: the Outlook suggestions
 * (queue B1) and the one-box capture on Home (queue C1).
 *
 * A live bid beats a project for the same client: it is the record the text is
 * most likely about. `records` carries the serial/title a link needs, keyed by
 * record id.
 */
export function useKnownParties(): { parties: KnownParty[]; records: Record<string, KnownRecord> } {
  const [bidParties, setBidParties] = useState<KnownParty[]>([]);
  const [projectParties, setProjectParties] = useState<KnownParty[]>([]);
  const [records, setRecords] = useState<Record<string, KnownRecord>>({});

  useEffect(() => {
    const unsubBids = onSnapshot(collection(db, 'opportunities'), snap => {
      const rows: KnownParty[] = [];
      const recs: Record<string, KnownRecord> = {};
      snap.docs.forEach(d => {
        if (d.id === '--stats--') return;
        const o = d.data() as Opportunity;
        recs[d.id] = { type: 'opportunity', serial: o.serialNumber, title: o.title };
        if (o.client) {
          rows.push({
            name: o.client,
            type: 'opportunity',
            id: d.id,
            label: [o.serialNumber, o.title].filter(Boolean).join(' · '),
          });
        }
      });
      setBidParties(rows);
      setRecords(prev => ({ ...prev, ...recs }));
    }, err => console.warn('Known parties — opportunities listener:', err.code));

    const unsubProjects = onSnapshot(collection(db, 'projects'), snap => {
      const rows: KnownParty[] = [];
      const recs: Record<string, KnownRecord> = {};
      snap.docs.forEach(d => {
        if (d.id === '--stats--') return;
        const p = d.data() as Project;
        recs[d.id] = { type: 'project', serial: p.serialNumber, title: p.name };
        const label = [p.serialNumber, p.name].filter(Boolean).join(' · ');
        if (p.client) rows.push({ name: p.client, type: 'project', id: d.id, label });
        if (p.name) rows.push({ name: p.name, type: 'project', id: d.id, label });
      });
      setProjectParties(rows);
      setRecords(prev => ({ ...prev, ...recs }));
    }, err => console.warn('Known parties — projects listener:', err.code));

    return () => { unsubBids(); unsubProjects(); };
  }, []);

  const parties = useMemo(() => {
    const seen = new Set<string>();
    const out: KnownParty[] = [];
    for (const p of [...bidParties, ...projectParties]) {
      const key = p.name.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
    return out;
  }, [bidParties, projectParties]);

  return { parties, records };
}
