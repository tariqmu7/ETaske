import type { Opportunity } from '../types';
import { isManagerRole } from './offerApproval';

/**
 * Bid privacy (queue M6). Who may see a bid:
 *   'all'      — every approved user (the default, and what a bid with no
 *                `visibility` field means — every bid before M6 has none);
 *   'managers' — managers and admins, plus the bid's own team;
 *   'private'  — admins plus the bid's own team only.
 * The team = the owner, the co-owners (`collaboratorIds`) and the person who
 * created the bid (`userId`) — so whoever marks a bid private never loses it.
 *
 * Every screen that lists bids filters through `canSeeBid`. The server-side lock
 * (firestore.rules + rule-safe queries) is M6c and must mirror THIS file.
 */
export type BidVisibility = 'all' | 'managers' | 'private';

export const BID_VISIBILITY_OPTIONS: readonly BidVisibility[] = ['all', 'managers', 'private'];

/** English display keys (the i18n key IS the English sentence). */
export const BID_VISIBILITY_LABEL: Record<BidVisibility, string> = {
  all: 'Everyone',
  managers: 'Managers only',
  private: 'Private',
};

export interface BidViewer { id: string; role?: string }

type BidShape = Pick<Opportunity, 'ownerId' | 'collaboratorIds' | 'userId'> & { visibility?: unknown };

export function visibilityOf(o: { visibility?: unknown }): BidVisibility {
  return o.visibility === 'managers' || o.visibility === 'private' ? o.visibility : 'all';
}

export function isBidTeam(o: BidShape, uid: string): boolean {
  if (!uid) return false;
  return o.ownerId === uid || o.userId === uid || (o.collaboratorIds || []).includes(uid);
}

export function canSeeBid(o: BidShape, viewer: BidViewer): boolean {
  const v = visibilityOf(o);
  if (v === 'all') return true;
  if (viewer.role === 'Admin' || isBidTeam(o, viewer.id)) return true;
  return v === 'managers' && isManagerRole(viewer.role);
}

/**
 * Who may change the setting: anyone creating a bid; on an existing bid, its
 * team plus managers/admins. A colleague who can merely see an "Everyone" bid
 * may not hide it from the rest of the department.
 */
export function canSetBidVisibility(o: BidShape | null, viewer: BidViewer): boolean {
  if (!o) return true;
  return isManagerRole(viewer.role) || isBidTeam(o, viewer.id);
}

export const visibleBids = <T extends BidShape>(list: T[], viewer: BidViewer): T[] =>
  list.filter(o => canSeeBid(o, viewer));
