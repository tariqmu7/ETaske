import { collection, query, where, onSnapshot, getDocs, type Query, type Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';
import type { Opportunity } from '../types';
import { visibleBids, type BidViewer } from './bidVisibility';
import { isManagerRole } from './offerApproval';

/**
 * Privacy-aware bid reads (queue M6b) — the ONE place the app reads the
 * `opportunities` collection as a list. Every screen that shows bids (board,
 * analytics, alerts, Home, Ask, palette, clients, waiting, calendar, handover,
 * duplicates, meetings, weekly report, link pickers, export) goes through here,
 * so a bid hidden from the viewer (`bidVisibility.ts`) is never listed.
 *
 * Server lock (queue M6c): firestore.rules refuses a list that could surface a
 * bid the viewer may not read — rules are guards, not filters — so a non-admin
 * reads the union of rule-safe queries, the way `taskVisibility.ts` does:
 *   1. visibility == 'all'                    (everyone)
 *   2. visibility == 'managers'               (managers only)
 *   3. ownerId == me, 4. userId == me, 5. collaboratorIds array-contains me (the team)
 * An admin may read the whole collection. All filters are single-field, so no
 * composite index is needed. `visibleBids` still runs on the result, so the
 * screens and the server can never disagree.
 *
 * A bid with NO `visibility` field matches none of 1–2: every live bid must be
 * backfilled with 'all' (scripts/backfill-bid-visibility.ts) when the rules go live.
 */

const STATS_DOC = '--stats--';

const toBids = (docs: any[]): Opportunity[] => docs
  .filter(d => d.id !== STATS_DOC)
  .map(d => ({ id: d.id, ...d.data() } as Opportunity));

function queriesFor(viewer: BidViewer): Query[] {
  const bids = collection(db, 'opportunities');
  if (viewer.role === 'Admin') return [bids];
  return [
    query(bids, where('visibility', '==', 'all')),
    ...(isManagerRole(viewer.role) ? [query(bids, where('visibility', '==', 'managers'))] : []),
    query(bids, where('ownerId', '==', viewer.id)),
    query(bids, where('userId', '==', viewer.id)),
    query(bids, where('collaboratorIds', 'array-contains', viewer.id)),
  ];
}

function merge(parts: Opportunity[][], viewer: BidViewer): Opportunity[] {
  const byId = new Map<string, Opportunity>();
  for (const part of parts) for (const b of part) byId.set(b.id, b);
  return visibleBids(Array.from(byId.values()), viewer);
}

/**
 * Live list of every bid the viewer may see, unsorted. Emits only once EVERY
 * query has answered, so a screen never sees a half-filled list.
 */
export function subscribeVisibleBids(
  viewer: BidViewer,
  onData: (bids: Opportunity[]) => void,
  onError?: (err: any) => void,
): Unsubscribe {
  const qs = queriesFor(viewer);
  const parts: (Opportunity[] | null)[] = qs.map(() => null);
  const unsubs = qs.map((q, i) => onSnapshot(
    q,
    snap => {
      parts[i] = toBids(snap.docs);
      if (parts.every(p => p)) onData(merge(parts as Opportunity[][], viewer));
    },
    err => onError?.(err),
  ));
  return () => unsubs.forEach(u => u());
}

/** One-shot read of every bid the viewer may see, unsorted. */
export async function getVisibleBids(viewer: BidViewer): Promise<Opportunity[]> {
  const snaps = await Promise.all(queriesFor(viewer).map(q => getDocs(q)));
  return merge(snaps.map(s => toBids(s.docs)), viewer);
}

/** Newest first by `createdAt` (a Firestore Timestamp, or missing). */
export const byCreatedDesc = (a: Opportunity, b: Opportunity): number => {
  const ms = (x: any) => (x && typeof x.toMillis === 'function' ? x.toMillis() : typeof x?.seconds === 'number' ? x.seconds * 1000 : 0);
  return ms((b as any).createdAt) - ms((a as any).createdAt);
};
