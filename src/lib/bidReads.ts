import { collection, onSnapshot, getDocs, type Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';
import type { Opportunity } from '../types';
import { visibleBids, type BidViewer } from './bidVisibility';

/**
 * Privacy-aware bid reads (queue M6b) — the ONE place the app reads the
 * `opportunities` collection as a list. Every screen that shows bids (board,
 * analytics, alerts, Home, Ask, palette, clients, waiting, calendar, handover,
 * duplicates, meetings, weekly report, link pickers, export) goes through here,
 * so a bid hidden from the viewer (`bidVisibility.ts`) is never listed.
 *
 * Today this is one whole-collection listener filtered on the client. M6c (the
 * server lock) changes ONLY the inside of these two functions to a union of
 * rule-safe queries, the way `taskVisibility.ts` does for tasks.
 */

const STATS_DOC = '--stats--';

const toBids = (docs: any[]): Opportunity[] => docs
  .filter(d => d.id !== STATS_DOC)
  .map(d => ({ id: d.id, ...d.data() } as Opportunity));

/** Live list of every bid the viewer may see, unsorted. */
export function subscribeVisibleBids(
  viewer: BidViewer,
  onData: (bids: Opportunity[]) => void,
  onError?: (err: any) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db, 'opportunities'),
    snap => onData(visibleBids(toBids(snap.docs), viewer)),
    err => onError?.(err),
  );
}

/** One-shot read of every bid the viewer may see, unsorted. */
export async function getVisibleBids(viewer: BidViewer): Promise<Opportunity[]> {
  const snap = await getDocs(collection(db, 'opportunities'));
  return visibleBids(toBids(snap.docs), viewer);
}

/** Newest first by `createdAt` (a Firestore Timestamp, or missing). */
export const byCreatedDesc = (a: Opportunity, b: Opportunity): number => {
  const ms = (x: any) => (x && typeof x.toMillis === 'function' ? x.toMillis() : typeof x?.seconds === 'number' ? x.seconds * 1000 : 0);
  return ms((b as any).createdAt) - ms((a as any).createdAt);
};
